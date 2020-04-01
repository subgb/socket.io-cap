const _ = require('lodash');
const http = require('http');
const net = require('net');
const URL = require('url').URL;
const EventEmitter = require('events');
const hoxy = require('@subns/hoxy');
const ioServer = require('socket.io');
const ioClient = require('socket.io-client');
const chalk = require('chalk');

exports.createProxy = function(options) {
	return new IOProxy(options);
}

class IOProxy extends EventEmitter {
	constructor ({
		namespaces = [],
		hosts = [],
		prefix = 'socket.io/*',
		internalPort = 0,
	} = {}) {
		super();
		this.wsHosts = _(hosts).castArray().compact().keyBy().mapValues(x=>true).value();
		this.namespaces = _(namespaces).castArray().compact().without('/').value();
		this.internalPort = internalPort || (47100 + Math.floor(Math.random()*900));
		this.internalServer = createInternalIOServer(this);
		this.proxyServer = createProxyServer(this, prefix);
	}

	listen (port) {
		this.internalServer.listen(this.internalPort, '127.0.0.1');
		this.proxyServer.listen(port, () =>
			console.log(chalk.blue(`socket.io proxy listening on ${port}`))
		);
		return this;
	}

	showPacket ({fromServer, url, event, args}, hideArgs=false) {
		const bg = fromServer? chalk.bgBlue: chalk.bgRed;
		const dir = fromServer? '<=': '=>';
		console.log(bg(` ${event} `), dir, url)
		if (!hideArgs) _.forEach(args, x => console.log(x));
		console.log();
	}

	showHeader ({rawUrl, headers, namespace=''}) {
		console.log(
			chalk.black.bgGreen('[PROXY]'),
			chalk.green(rawUrl),
			chalk.yellow(namespace),
			chalk.gray(JSON.stringify(headers, null, 2)),
		);
	}

	showAll() {
		this.on('conn', ctx => this.showHeader(ctx));
		this.on('packet', p => this.showPacket(p));
	}
}


function createProxyServer (proxy, prefix) {
	const server = hoxy.createServer();

	server.intercept({
		phase: 'request',
		url: prefix,
	}, (req, resp, cycle) => {
		const host = `${req.hostname}:${req.port||80}`;
		proxy.wsHosts[host] = true;
		req.headers.rawhost = `${req.protocol}//${host}`;
		req.hostname = '127.0.0.1';
		req.port = proxy.internalPort;
	});

	server._server.on('connect', (request, clientSocket, head) => {
		let target = request.url;
		const isWs = proxy.wsHosts[target];
		if (isWs) {
			if (head.length) console.log(chalk.red('WebSocket head:'), head.toString());
			target = `127.0.0.1:${proxy.internalPort}`;
		}
		const {hostname, port} = new URL(`http://${target}`);
		const serverSocket = net.connect(port||80, hostname, () => {
			clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			serverSocket.write(head);
			clientSocket.pipe(serverSocket).pipe(clientSocket);
		}).on('error', err => {
			clientSocket.end();
			if (isWs) console.log(chalk.red(err.message));
		});
	});

	return server;
}

function createInternalIOServer (proxy) {
	const internalServer = http.createServer((req, res) => {
		res.end();
		console.log(chalk.red('INNER ERROR'), req.headers.host, req.url)
	});

	const io = ioServer(internalServer);
	io.on('connection', ioHandlerFactory(proxy));
	_.forEach(proxy.namespaces, ns => {
		io.of(ns).on('connection', ioHandlerFactory(proxy, ns));
	});

	io.of(/.*/).on('connection', cSocket => {
		const nsps = _.without(_.keys(io.nsps), '/', ...proxy.namespaces);
		console.log(
			chalk.bgYellow.red(' unknown io namepace: '),
			chalk.red(nsps.join(' ')),
		);
	});

	return internalServer;
}

function ioHandlerFactory (proxy, namespace) {
	return cSocket => {
		const {url, rawUrl} = getIoRequestUrl(cSocket.request, namespace);
		const headers = _.omit(cSocket.request.headers, 'host', 'rawhost');
		const ctx = {url, rawUrl, namespace, headers};
		proxy.emit('conn', ctx);

		const pSocket = ioClient(ctx.url, {
			reconnection: false,
			extraHeaders: headers,
		});
		const onevent = pSocket.onevent.bind(pSocket);

		pSocket.onevent = function (packet) {
			const data = packet.data || [];
			onevent(packet); 
			if (data.length==0) throw new Error('packet no data');
			const [event, ...args] = data;
			const fromServer = true;
			const ctx = {url, fromServer, event, args};
			proxy.emit('packet', ctx, {cSocket, pSocket});
			if (!ctx.drop) cSocket.emit(event, ...ctx.args);
		};
		pSocket.on('disconnect', reason => {
			console.log(chalk.red('[server socket closed]'), reason)
			cSocket.disconnect();
		})

		cSocket.use((packet, next) => {
			const [event, ...args] = packet;
			const fromServer = false;
			const ctx = {url, fromServer, event, args};
			proxy.emit('packet', ctx, {cSocket, pSocket});
			if (!ctx.drop) pSocket.emit(event, ...ctx.args);
			next();
		});
		cSocket.on('error', err => {
			console.log(chalk.red('[client socket error]'), err.message);
		})
		cSocket.on('disconnect', reason => {
			console.log(chalk.red('[client socket closed]'), reason)
			pSocket.close();
		});
	}
}

function getIoRequestUrl (req, path='/') {
	const u = new URL(req.headers.rawhost + req.url);
	const rawUrl = u.href;
	u.pathname = path;
	u.searchParams.delete('EIO');
	u.searchParams.delete('transport');
	u.searchParams.delete('t');
	const url = u.href;
	return {url, rawUrl};
}

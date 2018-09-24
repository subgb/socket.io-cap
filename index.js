const _ = require('lodash');
const http = require('http');
const net = require('net');
const URL = require('url').URL;
const hoxy = require('hoxy');
const ioServer = require('socket.io');
const ioClient = require('socket.io-client');
const chalk = require('chalk');


function showPacket(packet, hideArgs=false) {
	const bg = packet.fromServer? chalk.bgBlue: chalk.bgRed;
	const event = bg(` ${packet.event} `);
	const dir = packet.fromServer? '<=': '=>';
	console.log(event, dir, packet.url)
	if (!hideArgs) _.forEach(packet.args, x => console.log(x));
	console.log();
}


exports.createProxy = function({
	namespaces = [],
	hosts = [],
	silent = false,
	prefix = 'socket.io/*',
	innerPort = 0,
} = {}) {
	const wsHosts = {};
	for (const host of _.castArray(hosts)) {
		wsHosts[host] = true;
	}
	if (!innerPort) {
		innerPort = 47100 + Math.floor(Math.random() * 900);
	}

	const proxy = {
		silent,
		showPacket,
		handler: showPacket,
		namespaces: _(namespaces).castArray().compact().without('/').value(),
		on(callback = showPacket) {
			this.handler = callback;
			return this;
		},
		listen(port) {
			internalServer.listen(innerPort);
			proxyServer.listen(port, '127.0.0.1',
				() => console.log(chalk.blue(`socket.io proxy listening on ${port}`))
			);
			return this;
		},
	};
	const internalServer = createInternalIOServer(proxy);
	const proxyServer = hoxy.createServer();

	proxyServer.intercept({
		phase: 'request',
		url: prefix,
	}, (req, resp, cycle) => {
		const host = `${req.hostname}:${req.port||80}`;
		wsHosts[host] = true;
		req.headers.rawhost = `${req.protocol}//${host}`;
		req.hostname = '127.0.0.1';
		req.port = innerPort;
	});

	proxyServer._server.on('connect', (request, clientSocket, head) => {
		let target = request.url;
		const isWs = wsHosts[target];
		if (isWs) {
			if (head.length) console.log(chalk.red('WebSocket head:'), head.toString());
			target = `127.0.0.1:${innerPort}`;
		}
		const {hostname, port} = new URL(`http://${target}`);
		const serverSocket = net.connect(port, hostname, () => {
			clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			serverSocket.write(head);
			clientSocket.pipe(serverSocket).pipe(clientSocket);
		}).on('error', err => {
			clientSocket.end();
			if (isWs) console.log(chalk.red(err.message));
		});
	});

	return proxy;
}


function createInternalIOServer(proxy) {
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

function ioHandlerFactory(proxy, namespace='/') {
	return cSocket => {
		const req = cSocket.request;
		const url = new URL(req.headers.rawhost + req.url);
		const headers = _.omit(req.headers, 'host', 'rawhost');
		if (!proxy.silent) console.log(
			chalk.black.bgGreen('[PROXY]'),
			chalk.green(url.href),
			namespace=='/'? '': chalk.yellow(namespace),
			chalk.gray(JSON.stringify(headers, null, 2)),
		);

		url.pathname = namespace;
		url.searchParams.delete('EIO');
		url.searchParams.delete('transport');
		url.searchParams.delete('t');
		const pSocket = ioClient(url.href, {
			reconnection: false,
			extraHeaders: headers,
		});

		const onevent = pSocket.onevent;
		pSocket.onevent = function (packet) {
			const data = packet.data || [];
			onevent.call(this, packet); 
			if (data.length==0) throw new Error('packet no data');
			const [event, ...args] = data;
			const fromServer = true;
			const info = {url:url.href, fromServer, event, args};
			proxy.handler(info);
			if (!info.drop) cSocket.emit(event, ...info.args);
		};
		pSocket.on('disconnect', reason => {
			console.log(chalk.red('[server socket closed]'), reason)
			cSocket.disconnect();
		})

		cSocket.use((packet, next) => {
			const [event, ...args] = packet;
			const fromServer = false;
			const info = {url:url.href, fromServer, event, args};
			proxy.handler(info);
			if (!info.drop) pSocket.emit(event, ...info.args);
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

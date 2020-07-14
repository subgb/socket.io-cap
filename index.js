const _ = require('lodash');
const http = require('http');
const net = require('net');
const {URL} = require('url');
const EventEmitter = require('events');
const hoxy = require('hoxyws');
const ioServer = require('socket.io');
const ioClient = require('socket.io-client');
const ProxyAgent = require('proxy-agent');
const chalk = require('chalk');

exports.createProxy = function(...args) {
	return new IOProxy(...args);
}

class IOProxy extends EventEmitter {
	constructor(hoxyOpts, namespaces=[]) {
		super();
		this.namespaces = _(namespaces).castArray().compact().without('/').value();
		this.createInternalIOServer();
		this.createHoxyServer(hoxyOpts);
	}

	listen (port) {
		this.internalServer.listen(0, 'localhost');
		this.proxyServer.listen(port, () =>
			console.log(chalk.blue(`socket.io proxy listening on ${port}`))
		);
		return this;
	}

	showPacket ({fromServer, ioUrl, event, args}, hideArgs=false) {
		const bg = fromServer? chalk.bgBlue: chalk.bgRed;
		const dir = fromServer? '<=': '=>';
		console.log(bg(` ${event} `), dir, ioUrl)
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

	createHoxyServer(hoxyOpts) {
		if (this.proxyServer) return;
		const server = hoxy.createServer(hoxyOpts);
		server.on('error', e=>this.emit('error', e));

		for (const phase of ['request', 'websocket']) {
			server.intercept({
				phase,
				fullUrl: /\/\?.*\bEIO=\d+\b.*&transport=/,
			}, (req, res, cycle) => {
				cycle.skipProxy = true;
				const pu = new URL(req.fullUrl());
				req.headers.rawurl = pu.href;
				pu.protocol = 'http:';
				pu.hostname = '127.0.0.1';
				pu.pathname = '/socket.io/';
				pu.port = this.internalServer.address().port;
				req.fullUrl(pu.href);
			});
		}
		this.proxyServer = server;
	}

	createInternalIOServer() {
		if (this.internalServer) return;

		const server = http.createServer((req, res) => {
			res.end();
			const err = new Error('Internal IO-server received a non IO request');
			err.url = req.headers.rawurl || req.url;
			this.emit('error', err);
		});

		const io = ioServer(server);
		io.on('connection', ioHandlerFactory(this));
		_.forEach(this.namespaces, ns => {
			io.of(ns).on('connection', ioHandlerFactory(this, ns));
		});

		io.of(/.*/).on('connection', cSocket => {
			const nsps = _.without(_.keys(io.nsps), '/', ...this.namespaces);
			console.log(
				chalk.bgYellow.red(' unknown io namepace: '),
				chalk.red(nsps.join(' ')),
			);
		});

		this.internalServer = server;
	}
}

function ioHandlerFactory (proxy, namespace) {
	return cSocket => {
		const rawUrl = cSocket.request.headers.rawurl;
		const {ioUrl, ioPath} = getIoRequestUrl(rawUrl, namespace);
		const headers = _.omit(cSocket.request.headers, 'host', 'rawurl', 'accept-encoding', 'connection');
		const ctx = {ioUrl, ioPath, rawUrl, namespace, headers};
		proxy.emit('conn', ctx);

		const opts = {
			reconnection: false,
			path: ioPath,
			extraHeaders: headers,
			rejectUnauthorized: false,
		};
		if (ctx.proxy) opts.agent = new ProxyAgent(ctx.proxy);
		const pSocket = ioClient(ctx.ioUrl, opts);
		const onevent = pSocket.onevent.bind(pSocket);

		pSocket.onevent = function (packet) {
			const data = packet.data || [];
			onevent(packet);
			if (data.length==0) throw new Error('packet no data');
			const [event, ...args] = data;
			const fromServer = true;
			const ctx = {ioUrl, fromServer, event, args};
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
			const ctx = {ioUrl, fromServer, event, args};
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

function getIoRequestUrl (rawUrl, path='/') {
	const pu = new URL(rawUrl);
	const ioPath = pu.pathname;
	pu.pathname = path;
	pu.searchParams.delete('EIO');
	pu.searchParams.delete('transport');
	pu.searchParams.delete('t');
	pu.searchParams.delete('b64');
	const ioUrl = pu.href;
	return {ioUrl, ioPath};
}

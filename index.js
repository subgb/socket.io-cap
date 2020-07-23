const _ = require('lodash');
const {URL} = require('url');
const {timeiso} = require('shiajs');
const EventEmitter = require('events');
const hoxy = require('hoxyws');
const chalk = require('chalk');
const IOParser = require('socket.io-parser');
const EGParser = require('engine.io-parser');
const RE_SOCKETIO = /\/\?.*\bEIO=\d+\b.*&transport=(polling|websocket|flashsocket)/;
const ioEncoder = new IOParser.Encoder();

const IO_PACKET_TYPES = {
	0: 'CONNECT',
	1: 'DISCONNECT',
	2: 'EVENT',
	3: 'ACK',
	4: 'ERROR',
	5: 'BINARY_EVENT',
	6: 'BINARY_ACK',
};

module.exports = class IOProxy extends EventEmitter {
	constructor(hoxyOpts) {
		super();
		this.ioCache = new Map();
		this.createHoxyServer(hoxyOpts);
	}

	listen (port) {
		this.proxyServer.listen(port, () =>
			console.log(chalk.blue(`socket.io proxy listening on ${port}`))
		);
		return this;
	}

	cachedContext(ctx) {
		if (!ctx.sid) return ctx;
		if (!this.ioCache.has(ctx.sid)) return ctx;
		const cache = this.ioCache.get(ctx.sid);
		return Object.assign(cache, ctx);
	}

	showEnginePacket({packet, fromServer, io, raw}, {
		showUrl = true,
		showRaw = false,
		showParsed = true,
		skipMessage = true,
	} = {}) {
		if (skipMessage&&packet.type=='message') return;
		const bg = fromServer? chalk.bgBlue: chalk.bgRed;
		const dir = fromServer? '<=': '=>';
		const arr = [
			timeiso().slice(-8),
			chalk.yellow(io.sid),
			chalk.gray('ENGINE'),
			bg(` ${packet.type} `),
			dir.padStart(9-packet.type.length),
		];
		if (showUrl) arr.push(chalk.cyan(io.ioUrl))
		if (showRaw) arr.push(chalk.gray.underline(raw));
		if (showParsed) arr.push(packet);
		console.log(...arr);
		console.log();
	}

	showSocketPacket({packet, fromServer, io, raw}, {
		showUrl = true,
		showRaw = false,
		showParsed = true,
		skipMessage = true,
	} = {}) {
		if (skipMessage&&(packet.type==2||packet.type==3)) return;
		const type = IO_PACKET_TYPES[packet.type] || 'unknown';
		const bg = fromServer? chalk.bgBlue: chalk.bgRed;
		const dir = fromServer? '<=': '=>';
		const arr = [
			timeiso().slice(-8),
			chalk.yellow(io.sid),
			'SOCKET',
			bg(` ${type} `),
			dir.padStart(9-type.length),
		];
		if (showUrl) arr.push(chalk.cyan(io.ioUrl))
		if (showRaw) arr.push(chalk.gray.underline(raw));
		if (showParsed) arr.push(packet);
		console.log(...arr);
		console.log();
	}

	showMessage({nsp, event, args, fromServer, io, id}, {
		showUrl = true,
		showArgs = true,
	} = {}) {
		const bg = fromServer? chalk.bgBlue: chalk.bgRed;
		const dir = fromServer? '<=': '=>';
		const isAck = event===null;
		const arr = [
			timeiso().slice(-8),
			chalk.yellow(io.sid),
			chalk.bgWhite.black(` ${nsp} `) + bg.black(` ${isAck?'-ACK-':event} `),
		];
		if (id!=null) arr.push(id);
		arr.push(dir);
		if (showUrl) arr.push(chalk.cyan(io.ioUrl));
		console.log(...arr);
		if (showArgs) {
			args.forEach((x,i) => console.log(chalk.gray(i+1+':'), x));
			if (!isAck&&id!=null) console.log(chalk.gray(args.length+1+':'), ()=>{}, `(id: ${id})`);
		}
		console.log();
	}

	showConn(ctx, {
		showHeader = false,
	} = {}) {
		const arr = [
			chalk.black.bgGreen(' SOCKET '),
			chalk.green(ctx.transport),
			chalk.cyan(ctx.ioUrl),
		];
		if (ctx.sid) arr.push(chalk.yellow(ctx.sid));
		arr.push(...[
			'\n'+timeiso().slice(-8),
			chalk.green(ctx.method),
			ctx.reqUrl
		]);
		if (showHeader) {
			arr.push(chalk.gray(JSON.stringify(ctx.headers, null, 2)));
		}
		else {
			arr.push(...[
				'\n'+timeiso().slice(-8),
				chalk.green('Cookie:'),
				ctx.headers.cookie,
				'\n',
			]);
		}
		console.log(...arr);
	}

	createHoxyServer(opts) {
		if (this.proxyServer) return;
		const server = this.proxyServer = hoxy.createServer(opts);
		server.on('error', e => this.emit('error', e));
		server.on('log',  x => {
			if (x.level=='error') this.emit('error', x.error);
		});

		server.intercept({
			phase: 'request',
			fullUrl: RE_SOCKETIO,
			as: 'string',
		}, (req, res, cycle) => {
			const ctx = cycle.ioContext = parseIoRequest(req);
			this.cachedContext(ctx);
			this.emit('conn', ctx);
			cycle.proxy = ctx.proxy;
			if (req.method=='POST' && req.string.length) {
				this.parsePooling(req.string, false, ctx);
			}
		});

		server.intercept({
			phase: 'response',
			fullUrl: RE_SOCKETIO,
			as: 'string',
		}, (req, res, cycle) => {
			this.parsePooling(res.string, true, cycle.ioContext);
		});

		server.intercept({
			phase: 'websocket',
			fullUrl: RE_SOCKETIO,
		}, (req, res, cycle) => {
			const ctx = cycle.ioContext = parseIoRequest(req);
			const io = this.cachedContext(ctx);
			this.emit('conn', ctx);
			cycle.proxy = ctx.proxy;
			cycle.on('ws-frame', frame => {
				if (frame.type!='message') return;
				const raw = frame.data;
				const packet = EGParser.decodePacket(raw);
				this.parseEngine(packet, frame.fromServer, io, raw);
			});
		});
	}

	parsePooling(payload, fromServer, io) {
		EGParser.decodePayload(payload, (packet) => {
			EGParser.encodePacket(packet, raw => {
				this.parseEngine(packet, fromServer, io, raw);
			});
		});
	}

	parseEngine(packet, fromServer, io, raw) {
		if (packet.type=='open') {
			const data = JSON.parse(packet.data);
			io.sid = data.sid;
			io.sDecoder = this.createDecoder(io, true);
			io.cDecoder = this.createDecoder(io, false);
			this.ioCache.set(data.sid, io);
			this.emit('open', io);
		}
		this.emit('engine', {packet, fromServer, io, raw});
		if (packet.type=='message') {
			this.parseSocket(packet.data, fromServer, io);
		}
	}

	parseSocket(payload, fromServer, ctx) {
		const io = this.ioCache.get(ctx.sid);
		const decoder = fromServer? io.sDecoder: io.cDecoder;
		decoder.add(payload);
	}

	parseMessage(packet, fromServer, io) {
		const {type, nsp, id, data} = packet;
		const [event, ...args] = type==2? data: [null, ...data];
		this.emit('message', {nsp, event, args, id, fromServer, io});
	}

	createDecoder(io, fromServer) {
		const decoder = new IOParser.Decoder();
		decoder.on('decoded', packet => {
			ioEncoder.encode(packet, raw => {
				this.emit('socket', {packet, fromServer, io, raw});
				if (packet.type==2 || packet.type==3) {
					this.parseMessage(packet, fromServer, io);
				}
			});
		});
		return decoder;
	}
}

function parseIoRequest(req) {
	const method = req.method;
	const headers = req.headers;
	const reqUrl = req.fullUrl();

	const pu = new URL(reqUrl);
	const sp = pu.searchParams;
	const transport = sp.get('transport');
	const sid = sp.get('sid');
	sp.delete('transport');
	sp.delete('sid');
	sp.delete('EIO');
	sp.delete('t');
	sp.delete('b64');

	const ioPath = pu.pathname;
	pu.pathname = '/';
	const ioUrl = pu.href;
	return {ioUrl, sid, reqUrl, transport, ioPath, method, headers};
}

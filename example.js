const proxy = require('.').createProxy(/*options*/);
proxy.listen(8889);

proxy.on(packet => {
	proxy.showPacket(packet);

	if (packet.event == 'my-message') {
		packet.args[0] = 'hello world';
	}
});

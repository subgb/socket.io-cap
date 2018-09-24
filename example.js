const proxy = require('.').createProxy(/*options*/);
proxy.listen(8889);

proxy.on('conn', ctx => {
	proxy.showHeader(ctx);
});

proxy.on('packet', p => {
	proxy.showPacket(p);

	if (p.event == 'my-message') {
		p.args[0] = 'hello world';
	}
});

# socket.io-cap

Proxy server for capturing and modifying socket.io data.

## Installation

```bash
npm install socket.io-cap
```

## Example

```js
const proxy = require('socket.io-cap').createProxy().listen(8889);
proxy.showAll();
```

```js
const proxy = require('socket.io-cap').createProxy({/*options*/});
proxy.listen(8889);

proxy.on('conn', ctx => {
  proxy.showHeader(ctx);
  ctx.headers.referer = 'http://example.com';
});

proxy.on('packet', (p, {cSocket, pSocket}) => {
  proxy.showPacket(p, false);

  if (p.event == 'my-message') {
    p.args[0] = 'hello world';
  }

  if (p.event == 'test' && p.fromServer) {
  	p.drop = true;
  	cSocket.emit('custom-message', 'hello world');
  }
})
```

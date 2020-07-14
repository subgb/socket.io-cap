# socket.io-cap

Proxy server for capturing and modifying socket.io data.

## Installation

```bash
npm install socket.io-cap
```

## Example

```js
const IOProxy = require('socket.io-cap');
const proxy = new IOProxy().listen(8889);
proxy.showAll();
```

```js
const fs = require('fs');
const IOProxy = require('socket.io-cap');

const namespaces = ['/io-namespace-one', '/io-namespace-two'];
const hoxyOpts = {
  certAuthority: {
    key: fs.readFileSync('./ca-key.pem'),
    cert: fs.readFileSync('./ca-crt.pem'),
  }
};
const proxy = new IOProxy(hoxyOpts, namespaces).listen(8889);

proxy.on('conn', ctx => {
  proxy.showHeader(ctx);
  ctx.proxy = 'socks://localhost:1080';
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

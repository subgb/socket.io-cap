# socket.io-cap

Proxy server for capturing socket.io data.

## Installation

```bash
npm install socket.io-cap
```

## Example


```js
const fs = require('fs');
const IOProxy = require('socket.io-cap');

const hoxyOpts = {
  certAuthority: {
    key: fs.readFileSync('./ca-key.pem'),
    cert: fs.readFileSync('./ca-crt.pem'),
  }
};
const proxy = new IOProxy(hoxyOpts).listen(8889);

proxy.on('conn', ctx => {
  //ctx.proxy = 'socks://localhost:1080';
  proxy.showConn(ctx, {
    showHeader: false,
  });
});

proxy.on('engine', ctx => {
  proxy.showEnginePacket(ctx, {
    showUrl: true,
    showRaw: false,
    showParsed: true,
    skipMessage: true,
  });
});

proxy.on('socket', ctx => {
  proxy.showSocketPacket(ctx, {
    showUrl: true,
    showRaw: false,
    showParsed: true,
    skipMessage: true,
  });
});

proxy.on('message', ctx => {
  proxy.showMessage(ctx, {
    showUrl: true,
    showArgs: true,
  });
});
```

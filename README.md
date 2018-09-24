# socket.io-cap

Proxy server for capturing and modifying socket.io data.

## Installation

```bash
npm install socket.io-cap
```

## Example

```js
const proxy = require('socket.io-cap').createProxy({/*options*/});
proxy.listen(8889);

proxy.on(packet => {
  proxy.showPacket(packet, false);

  if (packet.event == 'my-message') {
    packet.args[0] = 'hello world';
  }

  if (packet.event == 'test' && packet.fromServer) {
  	packet.drop = true;
  }
})
```

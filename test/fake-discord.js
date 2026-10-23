// 偽の Discord。Agent の Discord 連携が送る内容を、画面に出して確かめる (本物の Discord には何も送らない)
const net = require('net');
const prefix = process.env.NP_DISCORD_PIPE_PREFIX || 'np-test-ipc-';
const { encode, OP } = require('../discord');

net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  console.log('[fake discord] client connected');
  sock.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 8) {
      const op = buf.readUInt32LE(0), len = buf.readUInt32LE(4);
      if (buf.length < 8 + len) return;
      const msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'));
      buf = buf.subarray(8 + len);
      if (op === OP.HANDSHAKE) {
        console.log('[fake discord] handshake', JSON.stringify(msg));
        sock.write(encode(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }));
      } else {
        console.log('[fake discord] frame', JSON.stringify(msg));
      }
    }
  });
  sock.on('error', () => {});
}).listen(`\\\\?\\pipe\\${prefix}0`, () => console.log('[fake discord] listening'));

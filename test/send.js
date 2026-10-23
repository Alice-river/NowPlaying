// 拡張のふりをして Agent にデータを送る確認用スクリプト
// 使い方: node test/send.js [play|pause|long]
const WebSocket = require('ws');
const { encodePng } = require('../png');

const port = Number(process.env.NP_PORT) || 37250;
const mode = process.argv[2] || 'play';

function cover() {
  const s = 128;
  const rgba = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const d = Math.hypot(x - 64, y - 64);
      rgba[i] = d < 36 ? 255 : 90 + x;
      rgba[i + 1] = d < 36 ? 214 : 40 + y / 2;
      rgba[i + 2] = d < 36 ? 120 : 150;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(s, s, rgba);
}

function player({ id, name, title, artist, state, position, duration }) {
  const f = [id, name, title, artist, 'Test Album', '', state, position, duration, 80, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0];
  return f.map((v) => String(v).replace(/\|/g, '\\|')).join('|') + '|';
}

const long = mode === 'long';
const track = {
  id: 7, name: 'YouTube Music',
  title: long ? 'とても長い曲名のテスト：夜明け前の街を走る列車と、遠い海へ続く線路の物語' : 'ネオンの海',
  artist: long ? 'Luna Harbor feat. The Very Long Artist Name Ensemble' : 'Luna Harbor',
  duration: 225,
};

const ws = new WebSocket(`ws://127.0.0.1:${port}`);
ws.on('message', (d) => console.log('server ->', d.toString()));
ws.on('open', () => {
  const state = mode === 'pause' ? 1 : 0;
  ws.send(`0 ${track.id} ${player({ ...track, state, position: 83 })}`);
  const buf = cover();
  const head = Buffer.alloc(4);
  head.writeUInt32LE(track.id);
  ws.send(Buffer.concat([head, buf]));
  console.log(`sent: ${mode}`);
  setTimeout(() => ws.send(`1 ${track.id} ${player({ ...track, state, position: 84 })}`), 1000);
  setTimeout(() => ws.close(), Number(process.env.HOLD_MS) || 600_000);
});
ws.on('error', (e) => { console.error('error:', e.message); process.exit(1); });

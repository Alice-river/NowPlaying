// 本物の Discord を使わずに、偽の Discord (名前付きパイプのサーバ) で確かめる
const net = require('net');
const assert = require('assert');
process.env.NP_DISCORD_PIPE_PREFIX = 'np-test-ipc-' + process.pid + '-';
const { DiscordPresence, encode, field, OP } = require('../discord');

const APP_ID = '123456789012345678';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const check = (name, cond, detail) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + detail)); if (!cond) process.exitCode = 1; else pass++; };

function fakeDiscord({ rejectName = false } = {}) {
  const received = [];
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      while (buf.length >= 8) {
        const op = buf.readUInt32LE(0), len = buf.readUInt32LE(4);
        if (buf.length < 8 + len) return;
        const msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'));
        buf = buf.subarray(8 + len);
        received.push({ op, msg });
        if (op === OP.HANDSHAKE) sock.write(encode(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }));
        else if (msg.cmd === 'SET_ACTIVITY') {
          const a = msg.args.activity;
          if (rejectName && a && a.name !== undefined) sock.write(encode(OP.FRAME, { evt: 'ERROR', data: { code: 4000, message: 'Invalid payload' }, nonce: msg.nonce }));
          else sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', data: {}, evt: null, nonce: msg.nonce }));
        }
      }
    });
    sock.on('error', () => {});
  });
  return { server, received };
}

(async () => {
  check('field pads short text', field('A').length >= 2 && field('').length >= 2);
  check('field truncates to 128', Array.from(field('x'.repeat(300))).length === 128);
  check('field keeps CJK', field('ネオンの海') === 'ネオンの海');

  const fake = fakeDiscord();
  await new Promise((r) => fake.server.listen(`\\\\?\\pipe\\${process.env.NP_DISCORD_PIPE_PREFIX}3`, r));

  let clock = 1_000_000_000_000;
  const statuses = [];
  const d = new DiscordPresence({ now: () => clock, onStatus: (s) => statuses.push(s), log: () => {} });

  d.configure({ enabled: true, appId: 'not-a-number' });
  check('invalid app id stays disabled', d.enabled === false && statuses.at(-1) === 'noid', statuses.join());

  d.configure({ enabled: true, appId: APP_ID });
  await sleep(400); // パイプ 0〜2 は無く、3 番で見つかる
  check('connects to a later pipe number', statuses.includes('connected'), statuses.join());
  const hs = fake.received.find((r) => r.op === OP.HANDSHAKE);
  check('handshake has v=1 and client_id', hs && hs.msg.v === 1 && hs.msg.client_id === APP_ID, JSON.stringify(hs));

  const playing = { state: 0, title: 'ネオンの海', artist: 'Luna Harbor', album: 'Neon', source: 'YouTube Music', cover: 'https://example.com/c.jpg', position: 83, duration: 225 };
  d.update(playing);
  await sleep(100);
  let sets = fake.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY');
  check('first activity sent', sets.length === 1, String(sets.length));
  const a = sets[0] && sets[0].msg.args.activity;
  check('type is Listening (2)', a && a.type === 2, JSON.stringify(a));
  check('details = title, state = artist', a && a.details === 'ネオンの海' && a.state === 'Luna Harbor');
  check('timestamps: end - start = duration', a && a.timestamps.end - a.timestamps.start === 225000);
  check('timestamps: start = now - position', a && a.timestamps.start === clock - 83000);
  check('cover passed as large_image', a && a.assets.large_image === 'https://example.com/c.jpg');
  check('heading name = song title', a && a.name === 'ネオンの海', JSON.stringify(a && a.name));
  check('member list shows details (status_display_type 2)', a && a.status_display_type === 2);
  check('pid included', sets[0].msg.args.pid === process.pid);

  // 位置のわずかな揺れでは、送らない
  clock += 1000;
  d.update({ ...playing, position: 85 });
  await sleep(50);
  check('tiny position jitter not re-sent', fake.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY').length === 1);

  // 曲が変わったとき。直前の送信から 4.5 秒たつまでは、待ってから送る
  clock += 1000;
  d.update({ ...playing, title: 'Second Song', position: 0 });
  await sleep(50);
  check('rate limited: not sent immediately', fake.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY').length === 1);
  clock += 5000;
  await sleep(4700);
  sets = fake.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY');
  check('rate limited update flushed later', sets.length === 2 && sets[1].msg.args.activity.details === 'Second Song', String(sets.length));

  // 一時停止: 進行バー (timestamps) を外す
  clock += 6000;
  d.update({ ...playing, title: 'Second Song', state: 1 });
  await sleep(50);
  sets = fake.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY');
  check('paused removes timestamps', sets.length === 3 && sets[2].msg.args.activity.timestamps === undefined && sets[2].msg.args.activity.assets.small_text.length >= 2, JSON.stringify(sets[2] && sets[2].msg.args.activity));

  // 停止: 消す
  clock += 6000;
  d.update({ state: 2, title: '', artist: '' });
  await sleep(50);
  sets = fake.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY');
  check('stopped clears activity (null)', sets.length === 4 && sets[3].msg.args.activity === null);

  // 短い文字列と、https 以外のカバー
  clock += 6000;
  d.update({ state: 0, title: 'A', artist: '', cover: 'http://insecure/x.jpg', position: 0, duration: 0 });
  await sleep(50);
  sets = fake.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY');
  const b = sets[4] && sets[4].msg.args.activity;
  check('short text padded to >= 2', b && Array.from(b.details).length >= 2 && Array.from(b.state).length >= 2, JSON.stringify(b));
  check('non-https cover dropped, no timestamps without duration', b && b.assets.large_image === undefined && b.timestamps === undefined);

  d.close();
  await sleep(100);
  fake.server.close();

  // Discord が名前の指定を受け付けない場合は、名前なしで送りなおす
  process.env.NP_DISCORD_PIPE_PREFIX = 'np-test-ipc-b' + process.pid + '-';
  const fake2 = fakeDiscord({ rejectName: true });
  await new Promise((r) => fake2.server.listen(`\\\\?\\pipe\\${process.env.NP_DISCORD_PIPE_PREFIX}0`, r));
  const d2 = new DiscordPresence({ now: () => clock, log: () => {} });
  d2.configure({ enabled: true, appId: APP_ID });
  await sleep(300);
  d2.update(playing);
  await sleep(300);
  const sets2 = fake2.received.filter((r) => r.msg.cmd === 'SET_ACTIVITY');
  check('rejected name -> resent without name', sets2.length === 2 && sets2[0].msg.args.activity.name !== undefined && sets2[1].msg.args.activity.name === undefined, JSON.stringify(sets2.map((x) => x.msg.args.activity.name)));
  check('fallback still shows details/state', sets2[1] && sets2[1].msg.args.activity.details === 'ネオンの海' && sets2[1].msg.args.activity.status_display_type === 2);
  d2.close();
  await sleep(100);
  fake2.server.close();

  console.log(process.exitCode ? 'SOME FAILED' : `ALL PASS (${pass})`);
  process.exit(process.exitCode || 0);
})();

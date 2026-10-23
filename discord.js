// Discord の「再生中」(アクティビティ) を、PC で動いている Discord アプリ経由で設定する。
// サーバから直接は設定できないため、サーバの状態を受け取った Agent が、ここでアプリへ伝える。
// 通信は Discord アプリが開く名前付きパイプ (discord-ipc-0〜9) への、公式の IPC (RPC) を使う。
// ユーザートークンなどは使わない。必要なのは、アプリの Application ID だけ。
const net = require('net');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const ACTIVITY_LISTENING = 2;
const MIN_UPDATE_GAP_MS = 4500; // Discord は 20 秒に 5 回までしか更新を受けない
const RECONNECT_MS = 15000;

const pipePath = (i) => `\\\\?\\pipe\\${process.env.NP_DISCORD_PIPE_PREFIX || 'discord-ipc-'}${i}`;

// details / state は 2〜128 文字。短すぎると拒否される
function field(text) {
  const t = Array.from(String(text || '')).slice(0, 128).join('');
  return t.length >= 2 ? t : t + '​'.repeat(2 - t.length);
}

function encode(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

class DiscordPresence {
  constructor({ log = () => {}, onStatus = () => {}, now = () => Date.now() } = {}) {
    this.log = log;
    this.onStatus = onStatus;
    this.now = now;
    this.appId = '';
    this.enabled = false;
    this.sock = null;
    this.ready = false;
    this.buf = Buffer.alloc(0);
    this.nonce = 0;
    this.retryTimer = null;
    this.status = 'off';
    this.want = null; // 出したい状態 (サーバから受け取った最新)
    this.shown = null; // 実際に Discord へ送った内容の鍵
    this.shownStart = 0;
    this.lastSentAt = 0;
    this.flushTimer = null;
    this.useName = true; // 「○○を再生中」の ○○ を曲名にする。受け付けられなければ、アプリ名のままにする
    this.pending = new Map(); // nonce -> 名前を付けて送ったか
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }

  configure({ enabled, appId }) {
    const next = enabled && /^\d{17,20}$/.test(appId || '');
    const changed = next !== this.enabled || appId !== this.appId;
    this.enabled = next;
    this.appId = appId || '';
    if (!changed) return;
    this.teardown();
    if (!this.enabled) { this.setStatus(enabled ? 'noid' : 'off'); return; }
    this.connect();
  }

  teardown() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.flushTimer);
    this.retryTimer = this.flushTimer = null;
    this.ready = false;
    this.shown = null;
    this.shownStart = 0;
    if (this.sock) { const s = this.sock; this.sock = null; s.removeAllListeners(); s.on('error', () => {}); s.end(); setTimeout(() => s.destroy(), 500).unref(); }
  }

  connect(index = 0) {
    if (!this.enabled) return;
    if (index > 9) { this.setStatus('waiting'); return this.scheduleReconnect(); }
    this.setStatus('connecting');
    const sock = net.connect(pipePath(index));
    let opened = false;
    sock.once('connect', () => {
      opened = true;
      this.sock = sock;
      this.buf = Buffer.alloc(0);
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.appId }));
    });
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('error', (e) => {
      if (!opened) return this.connect(index + 1); // 次の番号を試す
      this.log('discord socket error', e.code || e.message);
    });
    sock.on('close', () => {
      if (!opened) return;
      if (this.sock === sock) { this.sock = null; this.ready = false; this.shown = null; this.setStatus('waiting'); this.scheduleReconnect(); }
    });
  }

  scheduleReconnect() {
    clearTimeout(this.retryTimer);
    if (!this.enabled) return;
    this.retryTimer = setTimeout(() => this.connect(), RECONNECT_MS);
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readUInt32LE(0);
      const len = this.buf.readUInt32LE(4);
      if (len > 1024 * 1024) { this.sock && this.sock.destroy(); return; }
      if (this.buf.length < 8 + len) return;
      const body = this.buf.subarray(8, 8 + len).toString('utf8');
      this.buf = this.buf.subarray(8 + len);
      let msg = {};
      try { msg = JSON.parse(body); } catch { /* 無視 */ }
      this.onMessage(op, msg);
    }
  }

  onMessage(op, msg) {
    if (op === OP.PING && this.sock) { this.sock.write(encode(OP.PONG, msg)); return; }
    if (op === OP.CLOSE) { this.log('discord closed us', msg.code, msg.message); this.setStatus(msg.code === 4000 ? 'badid' : 'waiting'); return; }
    if (msg.evt === 'READY') {
      this.ready = true;
      this.setStatus('connected');
      this.log('discord ready');
      this.apply();
    } else if (msg.evt === 'ERROR') {
      this.log('discord error', msg.data && msg.data.code, msg.data && msg.data.message);
      if (this.pending.get(msg.nonce) && this.useName) {
        // 名前の指定が受け付けられなかった。名前なしで、送りなおす
        this.useName = false;
        this.shown = null;
        this.lastSentAt = 0;
        this.apply();
      }
    } else if (msg.cmd === 'SET_ACTIVITY') {
      this.log('discord activity accepted');
    }
    if (msg.nonce !== undefined) this.pending.delete(msg.nonce);
  }

  // サーバから受け取った状態。実際に送るのは apply() が、間隔を守って行う
  update(state) {
    this.want = state;
    this.apply();
  }

  build(state) {
    if (!state || state.state === 2 || !(state.title || state.artist)) return null;
    const playing = state.state === 0;
    const activity = {
      type: ACTIVITY_LISTENING,
      details: field(state.title || state.artist),
      state: field(state.artist || state.source || state.title),
      // 「○○を再生中」の ○○ を曲名にする。メンバー一覧の表示も、曲名 (details) にそろえる
      status_display_type: 2,
      instance: false,
    };
    if (this.useName) activity.name = field(state.title || state.artist);
    if (playing && state.duration > 0) {
      const start = this.now() - Math.round(state.position * 1000);
      activity.timestamps = { start, end: start + state.duration * 1000 };
    }
    const assets = {};
    if (state.cover && /^https:\/\//.test(state.cover)) assets.large_image = state.cover;
    assets.large_text = field(state.album || state.title || 'NowPlaying');
    if (!playing) assets.small_text = field('一時停止中');
    activity.assets = assets;
    return activity;
  }

  // 曲、再生/停止、大きな位置のずれ (シーク) のときだけ送る。位置の細かい揺れでは送らない
  key(activity) {
    if (!activity) return 'none';
    return JSON.stringify([activity.details, activity.state, activity.assets, Boolean(activity.timestamps)]);
  }

  apply() {
    if (!this.ready || !this.sock) return;
    const activity = this.build(this.want);
    const k = this.key(activity);
    const start = activity && activity.timestamps ? activity.timestamps.start : 0;
    const moved = start && this.shownStart && Math.abs(start - this.shownStart) > 2500;
    // 接続したばかりで、まだ何も出していないときの「消去」は送らない (送ると、最初の曲が間隔の制限で遅れる)
    if (!activity && this.shown === null) { this.shown = k; return; }
    if (k === this.shown && !moved) return;
    const wait = MIN_UPDATE_GAP_MS - (this.now() - this.lastSentAt);
    if (wait > 0) {
      if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; this.apply(); }, wait);
      return;
    }
    this.shown = k;
    this.shownStart = start;
    this.lastSentAt = this.now();
    this.send(activity);
  }

  send(activity) {
    this.nonce += 1;
    this.pending.set(String(this.nonce), Boolean(activity && activity.name));
    this.sock.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(this.nonce),
    }));
  }

  close() {
    if (this.ready && this.sock) { try { this.send(null); } catch { /* 閉じるだけ */ } }
    this.teardown();
  }
}

module.exports = { DiscordPresence, encode, field, OP };

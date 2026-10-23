const { EventEmitter } = require('events');

// WebNowPlaying の拡張は WebSocket のクライアント。こちらがサーバー側になる。
// 形式は WebNowPlaying-Library (src/web.c, include/wnp.h) から読み取ったもの。
const ADAPTER_VERSION = '1.0.0';
const WNPLIB_REVISION = 3;
const HANDSHAKE = `ADAPTER_VERSION ${ADAPTER_VERSION};WNPLIB_REVISION ${WNPLIB_REVISION}`;

const MSG = { ADDED: 0, UPDATED: 1, REMOVED: 2, EVENT_RESULT: 3, USE_DESKTOP: 4 };
const STATE = { PLAYING: 0, PAUSED: 1, STOPPED: 2 };

const FIELDS = [
  ['portId', 'int'], ['name', 'str'], ['title', 'str'], ['artist', 'str'], ['album', 'str'],
  ['coverSrc', 'str'], ['state', 'int'], ['position', 'int'], ['duration', 'int'], ['volume', 'int'],
  ['rating', 'int'], ['repeat', 'int'], ['shuffle', 'int'], ['ratingSystem', 'int'],
  ['availableRepeat', 'int'], ['canSetState', 'int'], ['canSkipPrevious', 'int'], ['canSkipNext', 'int'],
  ['canSetPosition', 'int'], ['canSetVolume', 'int'], ['canSetRating', 'int'], ['canSetRepeat', 'int'],
  ['canSetShuffle', 'int'], ['createdAt', 'int'], ['updatedAt', 'int'], ['activeAt', 'int'],
];

// "|" 区切り。リテラルの "|" は "\|" と書かれている
function splitFields(text) {
  const out = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function sniffMime(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'image/png';
}

class Wnp extends EventEmitter {
  constructor() {
    super();
    this.players = new Map();
  }

  clear() {
    if (this.players.size === 0) return;
    this.players.clear();
    this.emit('change');
  }

  handleText(text) {
    const sp = text.indexOf(' ');
    if (sp < 0) return;
    const type = Number(text.slice(0, sp));
    const rest = text.slice(sp + 1);
    if (type === MSG.ADDED || type === MSG.UPDATED) {
      const sp2 = rest.indexOf(' ');
      if (sp2 < 0) return;
      this.applyPlayer(Number(rest.slice(0, sp2)), rest.slice(sp2 + 1));
    } else if (type === MSG.REMOVED) {
      if (this.players.delete(Number(rest))) this.emit('change');
    }
  }

  applyPlayer(idFromPrefix, body) {
    const tokens = splitFields(body);
    let p = this.players.get(idFromPrefix);
    if (!p) {
      p = {
        id: idFromPrefix, name: '', title: '', artist: '', album: '', coverSrc: '', coverData: '',
        state: STATE.STOPPED, position: 0, duration: 0, positionAt: 0, lastPlayingAt: 0, seenAt: 0,
      };
      this.players.set(idFromPrefix, p);
    }
    FIELDS.forEach(([key, kind], i) => {
      const t = tokens[i];
      if (t === undefined || t === '') return;
      if (kind === 'str') p[key] = t === '\u0001' ? '' : t;
      else p[key] = Number.parseInt(t, 10) || 0;
    });
    const now = Date.now();
    p.positionAt = now;
    p.seenAt = now;
    if (p.state === STATE.PLAYING) p.lastPlayingAt = now;
    this.emit('change');
  }

  // バイナリ: 先頭 4 バイトがプレイヤー ID (リトルエンディアン)、残りが画像
  handleBinary(buf) {
    if (buf.length <= 4) return;
    const id = buf.readUInt32LE(0);
    const img = buf.subarray(4);
    const p = this.players.get(id) || this.players.get(Number(id));
    const data = `data:${sniffMime(img)};base64,${img.toString('base64')}`;
    if (p) { p.coverData = data; this.emit('change'); return; }
    this.pendingCovers = this.pendingCovers || new Map();
    this.pendingCovers.set(id, data);
  }

  // 表示対象: 再生中のうち最後に更新されたもの。なければ、最後に再生していたもの
  active() {
    let best = null;
    for (const p of this.players.values()) {
      if (!p.title && !p.artist) continue;
      if (p.state === STATE.PLAYING) {
        if (!best || best.state !== STATE.PLAYING || p.seenAt > best.seenAt) best = p;
      } else if (!best || (best.state !== STATE.PLAYING && p.lastPlayingAt > best.lastPlayingAt)) {
        best = p;
      }
    }
    return best;
  }

  view() {
    const p = this.active();
    if (!p) return null;
    if (!p.coverData && this.pendingCovers && this.pendingCovers.has(p.id)) {
      p.coverData = this.pendingCovers.get(p.id);
      this.pendingCovers.delete(p.id);
    }
    let cover = '';
    if (/^https?:\/\//i.test(p.coverSrc)) cover = p.coverSrc.replace(/^http:\/\//i, 'https://');
    else if (p.coverData) cover = p.coverData;
    return {
      playing: p.state === STATE.PLAYING,
      state: p.state,
      title: p.title,
      artist: p.artist,
      album: p.album,
      source: p.name,
      cover,
      position: p.position,
      duration: p.duration,
      at: p.positionAt,
    };
  }
}

module.exports = { Wnp, HANDSHAKE, MSG, STATE, FIELDS, ADAPTER_VERSION, WNPLIB_REVISION };

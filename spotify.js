const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');

// Spotify デスクトップアプリの再生情報を、Windows の SMTC から読む (OBSSpotifyPlugin と同じ方式)。
// 実際の読み取りは spotify-smtc.ps1 (WinRT) が行い、1 秒ごとに 1 行の JSON を返す。
// view() は wnp.js の view() と同じ形。Spotify が動いていなければ null。
const STATE = { PLAYING: 0, PAUSED: 1, STOPPED: 2 };
const RESTART_MS = 5000;

class SpotifySource extends EventEmitter {
  constructor({ log = () => {} } = {}) {
    super();
    this.log = log;
    this.proc = null;
    this.buf = '';
    this.info = null;      // 直近の読み取り (running のときだけ)
    this.cover = '';
    this.at = 0;
    this.stopped = false;
    this.lastKey = '';
  }

  start() {
    if (process.platform !== 'win32' || this.proc) return;
    this.stopped = false;
    // 配布版 (asar) では、powershell が読めるよう展開済みのほうを使う
    const script = path.join(__dirname, 'spotify-smtc.ps1').replace(/app\.asar([\\\\/])/, 'app.asar.unpacked$1');
    const proc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => this.onData(d));
    proc.stderr.on('data', (d) => this.log('spotify stderr', String(d).trim()));
    proc.on('error', (e) => this.log('spotify spawn failed', e.message));
    proc.on('exit', () => {
      this.proc = null;
      this.setInfo(null);
      if (!this.stopped) setTimeout(() => this.start(), RESTART_MS);
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) this.proc.kill();
  }

  onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try { this.setInfo(JSON.parse(line)); } catch { /* 壊れた行は捨てる */ }
    }
  }

  setInfo(msg) {
    const now = Date.now();
    if (!msg || !msg.running) {
      if (this.info) { this.info = null; this.cover = ''; this.lastKey = ''; this.emit('change'); }
      return;
    }
    if (!msg.title && !msg.artist) { // 曲の情報がまだ無い
      if (this.info) { this.info = null; this.emit('change'); }
      return;
    }
    const key = `${msg.title}\n${msg.artist}\n${msg.album}`;
    const trackChanged = key !== this.lastKey;
    if (trackChanged) { this.lastKey = key; this.cover = ''; }
    if (msg.cover) this.cover = msg.cover;

    const prev = this.info;
    // SMTC の位置は、再生中でも変化があったときしか更新されない。
    // 値が前回と同じなら基準 (position と at) は据え置き、経過は view() 側で足す
    if (prev && !trackChanged && prev.playing === msg.playing && prev.rawPosition === msg.position && !msg.cover) return;
    const elapsed = prev && prev.playing ? (now - this.at) / 1000 : 0;
    const expected = prev ? prev.position + elapsed : 0;
    const changed = trackChanged || !prev || prev.playing !== msg.playing
      || Math.abs(msg.position - expected) > 2.5 || !!msg.cover;
    this.info = { ...msg, rawPosition: msg.position };
    this.at = now;
    if (changed) this.emit('change');
  }

  view() {
    const p = this.info;
    if (!p) return null;
    return {
      playing: !!p.playing,
      state: p.playing ? STATE.PLAYING : STATE.PAUSED,
      title: p.title,
      artist: p.artist,
      album: p.album,
      source: 'Spotify',
      cover: this.cover,
      position: p.position,
      duration: p.duration,
      at: this.at,
    };
  }
}

module.exports = { SpotifySource };

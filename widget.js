const $ = (id) => document.getElementById(id);

const PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h2v9H3zM7 1.5h2v9H7z"/></svg>';

let current = null;
let shown = { title: '', artist: '', cover: '' };

const GAP_PX = 48;
const SPEED_PX_PER_SEC = 40;
const PAUSE_MS = 2000;
const animations = new Map();

// 長い文字列は、同じ文字列をもう 1 つ後ろにつなげ、ちょうど 1 つ分だけ流す。
// 流し終わった位置は先頭と同じ見た目なので、つなぎ目が見えない。先頭では少し止まる。
function setText(lineId, text) {
  const line = $(lineId);
  const track = line.firstElementChild;
  const old = animations.get(lineId);
  if (old) old.cancel();
  animations.delete(lineId);
  track.replaceChildren();
  const first = document.createElement('span');
  first.textContent = text;
  track.append(first);
  requestAnimationFrame(() => {
    if (first.offsetWidth - line.clientWidth <= 4) return;
    first.style.paddingRight = `${GAP_PX}px`;
    const copy = first.cloneNode(true);
    track.append(copy);
    const shift = first.offsetWidth;
    const duration = PAUSE_MS + (shift / SPEED_PX_PER_SEC) * 1000;
    const anim = track.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: PAUSE_MS / duration },
        { transform: `translateX(-${shift}px)`, offset: 1 },
      ],
      { duration, iterations: Infinity, easing: 'linear' },
    );
    animations.set(lineId, anim);
  });
}

function setCover(src) {
  const img = $('img');
  const show = (on) => { img.hidden = !on; $('cover').classList.toggle('has-img', on); };
  if (!src) { show(false); return; }
  img.onload = () => show(true);
  img.onerror = () => show(false);
  img.src = src;
}

function render(state) {
  current = state;
  if (!state) return;
  if (state.title !== shown.title) { setText('title', state.title || '再生中の曲なし'); shown.title = state.title; }
  if (state.artist !== shown.artist) { setText('artist', state.artist); shown.artist = state.artist; }
  if (state.cover !== shown.cover) { setCover(state.cover); shown.cover = state.cover; }
  $('source').textContent = state.source;
  $('state').innerHTML = state.playing ? PLAY : PAUSE;
  $('bar').classList.toggle('none', !(state.duration > 0));
}

function tick() {
  if (current && current.duration > 0) {
    const elapsed = current.playing ? (Date.now() - current.at) / 1000 : 0;
    const pos = Math.min(current.duration, current.position + elapsed);
    $('fill').style.width = `${(pos / current.duration) * 100}%`;
  }
  requestAnimationFrame(tick);
}

window.np.onState(render);
window.np.onConfig((c) => document.body.style.setProperty('--tint', String(c.tint)));
requestAnimationFrame(tick);

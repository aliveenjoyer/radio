// Мини-плеер Encore FM для встраивания (mini.html): экран, дисплей, громкость, ссылка на заказ.
// ?autoplay=1 — включиться сразу (окно открыли по нажатию в «Лобби»). Не дал браузер — плеер просит касание.
import { call, clock, stream } from './api.js?v=20261123075031';
import { $, mmss } from './ui.js?v=20261123075031';
import { Player } from './player.js?v=20261123075031';
import { Sound } from './sound.js?v=20261123075031';

let S = null;
let powered = false;
let lastId = null;
const sound = new Sound();
const sid = (() => {
  try {
    let v = sessionStorage.getItem('radio.sid');
    if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('radio.sid', v); }
    return v;
  } catch (e) { return Math.random().toString(16).slice(2).padEnd(24, '0'); }
})();
const keep = {
  get(k, d) { try { const v = localStorage.getItem('radio.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('radio.' + k, JSON.stringify(v)); } catch (e) { /* без памяти */ } },
};

const player = new Player($('#media'), {
  onError: (it, code) => call('/report', { kind: 'err', vid: it.vid, code, sid }).catch(() => {}),
  onDuration: (it, d) => call('/report', { kind: 'dur', vid: it.vid, dur: d }).catch(() => {}),
  onPlaying: (p) => { $('#screen').classList.toggle('live', p); tell(); },
  onBlocked: (b) => { $('#screen').classList.toggle('tap', b); $('#tap-hint').classList.toggle('hide', !b); mode(); },
  onFail: () => { $('#tune-text').textContent = 'YouTube не загрузился'; },
});

// окну «Лобби» — что играет (для подписи на свёрнутой кнопке)
function tell() {
  try {
    window.parent.postMessage({ radio: 1, playing: player.playing, on: powered, title: S && S.now ? S.now.title : '', artist: S && S.now ? S.now.artist : '' }, '*');
  } catch (e) { /* не во фрейме */ }
}

function bars() { $('#vfd-bars').innerHTML = '<i></i>'.repeat(28); }
let runText = '';
function title(text) {
  const el = $('#vfd-title');
  if (runText === text) return;
  runText = text; el.textContent = text; el.classList.remove('scroll');
  requestAnimationFrame(() => {
    const over = el.scrollWidth - el.parentElement.clientWidth;
    if (over > 4) { el.style.setProperty('--run-x', -(over + 20) + 'px'); el.style.setProperty('--run-t', Math.max(7, over / 26 + 5) + 's'); el.classList.add('scroll'); }
  });
}
function mode() {
  let m = '● ЭФИР';
  if (player.blocked) m = '▶ НАЖМИ НА КЛИП';
  else if ($('#vfd').classList.contains('tuning')) m = '◌ ПОИСК ВОЛНЫ';
  else if (!S || !S.now) m = '○ ТИШИНА';
  else if (S.paused != null) m = 'Ⅱ ПАУЗА';
  else if (S.now.pl) m = '● ФОН';
  $('#vfd-mode').textContent = m;
}

function render() {
  const n = S.now;
  if ((n ? n.id : null) !== lastId) {
    lastId = n ? n.id : null;
    if (powered && n) sound.ident();
    const v = $('#vfd'); v.classList.add('tuning'); clearTimeout(render.t);
    render.t = setTimeout(() => { v.classList.remove('tuning'); mode(); }, 1300);
  }
  if (n) {
    title(n.title || 'Без названия');
    $('#vfd-artist').textContent = n.artist || '';
    $('#vfd-by').textContent = n.pl ? 'ПЛЕЙЛИСТ' : n.by ? 'ЗАКАЗАЛ ' + n.by.name : '';
    $('#screen-art').style.backgroundImage = n.art ? `url("${n.art.replace(/"/g, '')}")` : 'none';
  } else {
    title('Тишина в эфире');
    $('#vfd-artist').textContent = 'Закажи трек на сайте радио';
    $('#vfd-by').textContent = '';
  }
  $('#tune-text').textContent = !n ? 'Эфир молчит' : S.paused != null ? 'Пауза в эфире' : 'Поиск волны…';
  const L = S.listeners || { n: 0 };
  $('#m-crowd').textContent = L.n ? `СЛУШАЮТ ${L.n}` : '';
  mode();
  player.update(n, S.started, S.paused);
  tell();
}

function frame() {
  if (!S || !S.now) { $('#vfd-time').textContent = '--:--'; for (const b of $('#vfd-bars').children) b.classList.remove('on'); return; }
  const at = S.paused != null ? S.paused : clock.now();
  const pos = Math.max(0, (at - S.started) / 1000);
  const k = S.now.dur ? Math.min(1, pos / S.now.dur) : 0;
  $('#vfd-time').textContent = `${mmss(pos)} / ${mmss(S.now.dur)}`;
  const b = $('#vfd-bars').children; const lit = Math.round(k * b.length);
  for (let i = 0; i < b.length; i++) b[i].classList.toggle('on', i < lit);
}

// шум эфира на экране, пока трек не заиграл
function noiseLoop() {
  const cv = $('#noise'); const g = cv.getContext('2d'); const img = g.createImageData(cv.width, cv.height);
  let last = 0;
  const draw = (ts) => {
    requestAnimationFrame(draw);
    const sc = $('#screen');
    if (!sc.classList.contains('on') || sc.classList.contains('live') || ts - last < 50) return;
    last = ts;
    const d = img.data; const band = (ts / 9) % cv.height;
    for (let y = 0; y < cv.height; y++) {
      const roll = Math.abs(y - band) < 5 ? 60 : 0;
      for (let x = 0; x < cv.width; x++) { const i = (y * cv.width + x) * 4; const v = Math.min(255, ((Math.random() * 200) | 0) + roll); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
  };
  requestAnimationFrame(draw);
}

function presence() { call('/presence', { sid, on: powered }).catch(() => {}); }

async function setPower(on) {
  powered = on;
  if (on) sound.wake();
  document.body.classList.toggle('off', !on);
  $('#screen').classList.toggle('on', on);
  $('#power').setAttribute('aria-pressed', String(on));
  presence();
  await player.power(on);
  tell();
}

function setVol(v) {
  v = Math.max(0, Math.min(100, Math.round(v)));
  $('#vol').value = v;
  player.setVolume(v); sound.gain(v); keep.set('vol', v);
}

async function start() {
  bars(); noiseLoop();
  setVol(keep.get('vol', 70));
  $('#vol').addEventListener('input', (e) => setVol(+e.target.value));
  $('#power-cta').addEventListener('click', () => setPower(true));
  $('#power').addEventListener('click', () => setPower(!powered));
  try { const st = await call('/state'); clock.hint(st.t); S = st; render(); } catch (e) { title('Нет связи с радио'); }
  clock.sync().then(() => { if (S) player.update(S.now, S.started, S.paused); });
  stream((st) => { clock.hint(st.t); S = st; render(); });
  setInterval(frame, 250);
  setInterval(presence, 30000);
  if (/[?&]autoplay=1/.test(location.search)) setPower(true);
}

window.__radio = { player, get state() { return S; }, setPower };
start();

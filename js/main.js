// Encore FM: страница радио. Состояние эфира приходит потоком, плеер играет с той же секунды, что у всех.
import { call, clock, stream, session } from './api.js?v=20261123072319';
import { $, esc, toast, modal, mmss, clockAt, ago, plural, holdButton, ICON } from './ui.js?v=20261123072319';
import { user, onUser, setUser, refreshMe, login, logout, meta } from './auth.js?v=20261123072319';
import { Player } from './player.js?v=20261123072319';

let S = null;                 // последнее состояние эфира
let lastNowId = null;
let powered = false;
const sid = (() => {
  try {
    let v = sessionStorage.getItem('radio.sid');
    if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('radio.sid', v); }
    return v;
  } catch (e) { return Math.random().toString(16).slice(2).padEnd(24, '0'); }
})();
const store = {
  get(k, d) { try { const v = localStorage.getItem('radio.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('radio.' + k, JSON.stringify(v)); } catch (e) { /* без памяти */ } },
};

const player = new Player($('#media'), {
  onError: (it, code) => { call('/report', { kind: 'err', vid: it.vid, code, sid }).catch(() => {}); toast('У тебя этот трек не играет — сообщил радио'); },
  onDuration: (it, d) => call('/report', { kind: 'dur', vid: it.vid, dur: d }).catch(() => {}),
  onPlaying: (p) => { document.body.classList.toggle('playing', p); $('#screen').classList.toggle('live', p); },
  onFail: (text) => toast(text, 6000),
});

// ------------------------------------------------------------------ шкала, стрелки, дисплей
function buildDial() {
  const el = $('#dial-scale');
  let h = '';
  for (let f = 88; f <= 108; f += 0.5) {
    const x = ((f - 88) / 20) * 100;
    const big = f % 2 === 0;
    h += `<i class="tk${big ? ' big' : ''}" style="left:${x}%"></i>`;
    if (f % 4 === 0) h += `<span class="fq" style="left:${x}%">${f}</span>`;
  }
  el.innerHTML = h;
}
function buildVU(svg) {
  let h = '';
  const marks = [[-20, '20'], [-10, '10'], [-7, '7'], [-5, '5'], [-3, '3'], [0, '0'], [3, '+3']];
  const ang = (db) => -48 + ((db + 20) / 23) * 96;
  const pt = (a, r) => { const rad = (a - 90) * Math.PI / 180; return [60 + r * Math.cos(rad), 76 + r * Math.sin(rad)]; };
  const [ax, ay] = pt(-48, 56); const [bx, by] = pt(ang(0), 56); const [cx, cy] = pt(48, 56);
  h += `<path d="M${ax} ${ay} A56 56 0 0 1 ${bx} ${by}" stroke="#2a1a0c" stroke-width="1.3" fill="none"/>`;
  h += `<path d="M${bx} ${by} A56 56 0 0 1 ${cx} ${cy}" stroke="#c0261b" stroke-width="3" fill="none"/>`;
  for (const [db, t] of marks) {
    const a = ang(db);
    const [x1, y1] = pt(a, 56); const [x2, y2] = pt(a, 62); const [tx, ty] = pt(a, 68);
    h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${db > 0 ? '#c0261b' : '#2a1a0c'}" stroke-width="1.2"/>`;
    h += `<text x="${tx}" y="${ty + 2}" font-size="7" text-anchor="middle" fill="${db > 0 ? '#b0241a' : '#3a2410'}" font-family="Geist Mono, monospace">${t}</text>`;
  }
  svg.innerHTML = h;
}
function buildBars() { $('#vfd-bars').innerHTML = '<i></i>'.repeat(36); }

function hashFreq(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return 89 + ((h >>> 0) % 1800) / 100;              // 89.00–106.99
}

let runText = '';
function setTitle(text) {
  const el = $('#vfd-title');
  if (runText === text) return;
  runText = text;
  el.textContent = text;
  el.classList.remove('scroll');
  requestAnimationFrame(() => {
    const over = el.scrollWidth - el.parentElement.clientWidth;
    if (over > 4) {
      el.style.setProperty('--run-x', -(over + 24) + 'px');
      el.style.setProperty('--run-t', Math.max(8, over / 28 + 6) + 's');
      el.classList.add('scroll');
    }
  });
}

function tune(item) {
  const f = hashFreq(item ? item.src + item.vid : 'idle');
  document.documentElement.style.setProperty('--nx', ((f - 88) / 20 * 100).toFixed(2) + '%');
  $('.dial').style.setProperty('--nx', ((f - 88) / 20 * 100).toFixed(2) + '%');
  $('#needle').style.left = ((f - 88) / 20 * 100).toFixed(2) + '%';
  if (powered && item) noise.sweep();
  const v = $('#vfd');
  v.classList.add('tuning');
  $('#vfd-mode').textContent = '◌ ПОИСК ВОЛНЫ';
  clearTimeout(tune.t);
  tune.t = setTimeout(() => { v.classList.remove('tuning'); renderMode(); }, 1300);
}

function renderMode() {
  if ($('#vfd').classList.contains('tuning')) return;
  let m = '● ЭФИР';
  if (!S || !S.now) m = '○ ТИШИНА';
  else if (S.paused != null) m = 'Ⅱ ПАУЗА';
  else if (S.now.pl) m = '● ФОН';
  else if (S.now.auto) m = '● АВТОЭФИР';
  $('#vfd-mode').textContent = m;
}

// ------------------------------------------------------------------ эфир
function mine(x) { return user.me && x && x.by && x.by.uid === user.me.uid; }

function renderNow() {
  const n = S.now;
  const id = n ? n.id : null;
  if (id !== lastNowId) { lastNowId = id; tune(n); }
  if (n) {
    setTitle(n.title || 'Без названия');
    $('#vfd-artist').textContent = n.artist || (n.src === 'sc' ? 'SoundCloud' : 'YouTube');
    $('#vfd-by').textContent = n.pl ? 'ПЛЕЙЛИСТ · ' + n.pl : n.auto ? (n.by ? 'ИЗ ФОНДА · ' + n.by.name : 'ИЗ ФОНДА') : n.by ? 'ЗАКАЗАЛ ' + n.by.name : '';
    const art = n.art ? `url("${n.art.replace(/"/g, '')}")` : 'none';
    $('#amb').style.backgroundImage = art;
    $('#amb').classList.toggle('on', !!n.art);
    $('#screen-art').style.backgroundImage = art;
  } else {
    setTitle('Тишина в эфире');
    $('#vfd-artist').textContent = 'Закинь первый трек — заиграет сразу';
    $('#vfd-by').textContent = '';
    $('#amb').classList.remove('on');
    $('#screen-art').style.backgroundImage = 'none';
  }
  renderMode();
  $('#tune-text').textContent = !n ? 'Эфир молчит — закажи трек' : S.paused != null ? 'Пауза в эфире' : 'Поиск волны…';
  // клавиши
  const liked = n && user.me && (n.likes || []).includes(user.me.uid);
  const voted = n && user.me && (n.skips || []).includes(user.me.uid);
  $('#k-like').classList.toggle('down', !!liked);
  $('#k-skip').classList.toggle('down', !!voted);
  $('#k-like-n').textContent = n && n.likes && n.likes.length ? n.likes.length : '';
  $('#k-skip-n').textContent = n && n.skips && n.skips.length ? `${n.skips.length}/${S.need_skips}` : '';
  $('#k-like').disabled = $('#k-skip').disabled = !n;
  $('#k-skip .key-l').textContent = n && mine(n) && !n.auto ? 'Снять мой' : 'Мимо';
  player.update(n, S.started, S.paused);
}

function frame() {
  if (S && S.now) {
    const at = S.paused != null ? S.paused : clock.now();
    const pos = Math.max(0, (at - S.started) / 1000);
    const dur = S.now.dur;
    const k = dur ? Math.min(1, pos / dur) : 0;
    $('#vfd-time').textContent = `${mmss(pos)} / ${mmss(dur)}`;
    const bars = $('#vfd-bars').children;
    const lit = Math.round(k * bars.length);
    for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < lit);
  } else {
    $('#vfd-time').textContent = '--:-- / --:--';
  }
  const ac = document.getElementById('air-clock');
  if (ac && S && S.onair) ac.textContent = mmss((clock.now() - S.onair.since) / 1000);
  if (!S || !S.now) {
    for (const b of $('#vfd-bars').children) b.classList.remove('on');
  }
}

// стрелки уровня: настоящего сигнала у нас нет (звук в чужом плеере), поэтому они «дышат» под игру
const vu = { l: -48, r: -48, tl: -48, tr: -48, t: 0 };
function vuStep(ts) {
  const live = player.playing && powered;
  if (ts - vu.t > 90) {
    vu.t = ts;
    if (live) {
      const base = -8 + Math.sin(ts / 900) * 10 + Math.sin(ts / 2300) * 8;
      vu.tl = Math.min(44, base + (Math.random() - 0.3) * 34);
      vu.tr = Math.min(44, base + (Math.random() - 0.3) * 34);
    } else { vu.tl = vu.tr = -48; }
  }
  vu.l += (vu.tl - vu.l) * (vu.tl > vu.l ? 0.35 : 0.12);
  vu.r += (vu.tr - vu.r) * (vu.tr > vu.r ? 0.35 : 0.12);
  $('#vu-l').style.transform = `rotate(${vu.l.toFixed(1)}deg)`;
  $('#vu-r').style.transform = `rotate(${vu.r.toFixed(1)}deg)`;
  requestAnimationFrame(vuStep);
}

// ------------------------------------------------------------------ списки
function face(p, cls = '') {
  if (p && p.avatar) return `<img class="${cls}" src="${esc(p.avatar)}" alt="" loading="lazy" title="${esc(p.name || '')}">`;
  const ch = ((p && (p.name || p.login)) || '?').trim().charAt(0).toUpperCase();
  return `<span class="ava ${cls}" title="${esc((p && p.name) || '')}">${esc(ch)}</span>`;
}

function byHtml(b, auto) {
  if (!b) return auto ? '<span class="by">автоэфир</span>' : '';
  return `<span class="by">${face(b)}${esc(b.name)}</span>`;
}

function renderQueue() {
  const q = S.queue;
  const host = user.me && user.me.host;
  $('#q-n').textContent = q.length ? q.length : '';
  if (!q.length) {
    $('#queue').innerHTML = `<li class="empty">${S.now ? '<b>Очередь пуста.</b> Закажи — и твой трек пойдёт следующим.' : '<b>Эфир ждёт первый трек.</b> Закажи — заиграет сразу.'}${S.now && S.now.pl ? ` Пока играет плейлист «${esc(S.now.pl)}».` : S.settings.autodj && S.now && S.now.auto ? ' Пока играет золотой фонд эфира.' : ''}</li>`;
    return;
  }
  const now = clock.now();
  $('#queue').innerHTML = q.map((x, i) => {
    const me = mine(x);
    const mins = Math.max(0, Math.round((x.eta - now) / 60000));
    const ops = [];
    if (host) {
      if (i > 0) ops.push(`<button class="op" data-do="next" data-id="${x.id}" title="Поставить следующим">${ICON.top}</button>`);
      if (i > 0) ops.push(`<button class="op" data-do="up" data-id="${x.id}" title="Выше">${ICON.up}</button>`);
      ops.push(`<button class="op no" data-do="remove" data-id="${x.id}" title="Убрать из очереди">${ICON.x}</button>`);
    } else if (me) {
      ops.push(`<button class="op txt no" data-do="remove" data-id="${x.id}">Убрать</button>`);
    }
    return `<li class="qi${me ? ' mine' : ''}">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <img class="art" src="${esc(x.art)}" alt="" loading="lazy">
      <div class="t"><b>${esc(x.title)}</b><span>${esc(x.artist)}${x.dur ? ' · ' + mmss(x.dur) : ''}</span></div>
      <div class="meta">${byHtml(x.by)}<span class="eta" title="Заиграет примерно в ${clockAt(x.eta)}">${mins < 1 ? 'вот-вот' : 'через ' + mins + ' мин'}</span>${ops.length ? `<span class="ops">${ops.join('')}</span>` : ''}</div>
    </li>`;
  }).join('');
}

function renderSuggest() {
  const host = user.me && user.me.host;
  const box = $('#suggest');
  const mineS = S.suggest.filter(mine);
  if (!S.suggest.length || (!host && !mineS.length)) { box.classList.add('hide'); return; }
  box.classList.remove('hide');
  const list = host ? S.suggest : mineS;
  box.innerHTML = `<h2 class="h">${host ? 'Предложка — решаешь ты' : 'Ждёт ведущего'} <span class="h-n">${list.length}</span></h2><ol class="queue">${list.map((x) => `
    <li class="qi${mine(x) ? ' mine' : ''}"><span class="n">·</span><img class="art" src="${esc(x.art)}" alt="" loading="lazy">
      <div class="t"><b>${esc(x.title)}</b><span>${esc(x.artist)}${x.dur ? ' · ' + mmss(x.dur) : ''}</span></div>
      <div class="meta">${byHtml(x.by)}<span class="ops">${host
        ? `<button class="op ok" data-do="approve" data-id="${x.id}" title="В очередь">${ICON.ok}</button><button class="op no" data-do="reject" data-id="${x.id}" title="Отказать">${ICON.x}</button>`
        : `<button class="op txt no" data-do="remove" data-id="${x.id}">Убрать</button>`}</span></div></li>`).join('')}</ol>`;
}

function renderLog() {
  const h = S.history;
  const now = clock.now();
  $('#log').innerHTML = h.length ? h.slice(0, 8).map((x) => `
    <li class="li${x.skipped ? ' skipped' : ''}"><img src="${esc(x.art)}" alt="" loading="lazy">
      <div class="t"><b>${esc(x.title)}</b><span>${esc(x.artist)}${x.pl ? ' · плейлист' : x.by ? ' · ' + esc(x.by.name) : ''}</span></div>
      <span class="v${x.nlikes ? ' fire' : ''}">${x.nlikes ? ICON.fire + ' ' + x.nlikes : ago(x.played, now)}</span></li>`).join('')
    : '<li class="side-empty">Пока ничего — эфир только начался.</li>';
}

async function renderTop() {
  let d;
  try { d = await call('/top'); } catch (e) { return; }
  $('#hits').innerHTML = d.top.length ? d.top.slice(0, 6).map((x) => `
    <li class="li"><img src="${esc(x.art)}" alt="" loading="lazy"><div class="t"><b>${esc(x.title)}</b><span>${esc(x.artist)}</span></div>
      <span class="v fire">${ICON.fire} ${x.likes}</span></li>`).join('')
    : '<li class="side-empty">Жми «Качает» на треках, которые зашли, — лучшие окажутся здесь.</li>';
  $('#djs').innerHTML = d.djs.length ? d.djs.slice(0, 5).map((x) => `
    <li class="li">${face(x)}<div class="t"><b>${esc(x.name)}</b><span>${x.n} ${plural(x.n, 'трек', 'трека', 'треков')}</span></div>
      <span class="v fire">${ICON.fire} ${x.likes}</span></li>`).join('')
    : '<li class="side-empty">Кто приносит треки, которые качают, — тот здесь.</li>';
}

function renderCrowd() {
  const L = S.listeners || { n: 0, people: [] };
  const faces = L.people.slice(0, 6).map((p) => face(p)).join('');
  const rest = L.n - Math.min(6, L.people.length);
  $('#crowd').innerHTML = L.n
    ? `<span class="crowd"><i class="pulse"></i><span class="faces">${faces}${rest > 0 && faces ? `<span class="anon">+${rest}</span>` : ''}</span><span>${L.n} ${plural(L.n, 'слушает', 'слушают', 'слушают')} сейчас</span></span>`
    : '<span class="crowd">Сейчас никто не слушает — будь первым</span>';
}

function renderOnAir() {
  const oa = S.onair;
  $('#onair').classList.toggle('lit', !!oa);
  $('#onair-who').textContent = oa ? 'ведёт ' + oa.name : '';
}

function renderOrder() {
  const s = S.settings;
  const note = $('#note');
  note.textContent = s.note || '';
  note.classList.toggle('hide', !s.note);
  const host = user.me && user.me.host;
  const closed = !s.open && !host;
  $('#q').disabled = closed;
  $('#order-btn').disabled = closed;
  $('#q').placeholder = closed ? 'Заказ сейчас закрыт ведущим' : 'Название трека или ссылка YouTube, SoundCloud, Spotify';
  const parts = ['<b>Бесплатно</b>', `до ${s.per_user} ${plural(s.per_user, 'трека', 'треков', 'треков')} в очереди`, `до ${Math.round(s.max_len / 60)} мин`];
  if (s.cooldown) parts.push(`повтор через ${s.cooldown >= 60 ? Math.round(s.cooldown / 60) + ' ч' : s.cooldown + ' мин'}`);
  if (s.mode === 'host') parts.push('<b>треки сначала смотрит ведущий</b>');
  $('#rules').innerHTML = parts.join(' · ');
}

// Пульт (вариант A, выбран владельцем 23.11): неоновая вывеска «В эфире» — главное; пауза и следующий трек —
// тихие стеклянные кнопки; как принимать заказы — одна плашка с меню; слово ведущего и настройки — значками.
const ORDER_MODES = [
  { k: 'free', t: 'Сразу в очередь', d: 'Заказы идут в эфир без тебя' },
  { k: 'premod', t: 'Через меня', d: 'Сначала треки смотришь ты' },
  { k: 'close', t: 'Закрыть заказ', d: 'Новые треки не принимаются' },
];
function orderMode(s) { return !s.open ? 'close' : s.mode === 'host' ? 'premod' : 'free'; }

function renderHost() {
  const box = $('#host');
  const me = user.me;
  if (!me || !me.host) { box.classList.add('hide'); box.innerHTML = ''; return; }
  box.classList.remove('hide');
  const s = S.settings;
  const oa = S.onair;
  const mineAir = oa && oa.login === me.login;
  const paused = S.paused != null;
  const mode = orderMode(s);
  const cnt = S.suggest.length;
  const open = !$('#modes-menu') || $('#modes-menu').classList.contains('hide') ? ' hide' : '';
  const label = mode === 'close' ? 'Заказы закрыты' : `Заказы: <em>${mode === 'premod' ? 'через меня' : 'сразу в очередь'}</em>`;
  const cap = mineAir ? '<span id="air-clock"></span> · нажми, чтобы уйти' : oa ? 'Сейчас ведёт ' + esc(oa.name) : 'Нажми — лампа загорится у всех';
  box.innerHTML = `
    <button class="sign${mineAir ? ' live' : ''}" data-h="onair" type="button" aria-pressed="${!!mineAir}"><b>В ЭФИРЕ</b><small>${cap}</small></button>
    <button class="pill" data-h="${paused ? 'resume' : 'pause'}" type="button" ${S.now ? '' : 'disabled'}>${paused ? ICON.play : ICON.pause}<span>${paused ? 'Продолжить' : 'Пауза'}</span></button>
    <button class="pill" data-h="skip" type="button" ${S.now ? '' : 'disabled'}>${ICON.next}<span>Следующий трек</span></button>
    <span class="grow"></span>
    <div class="chip-wrap">
      <button class="chip m-${mode}" data-h="modes" type="button" aria-haspopup="menu"><i></i><span>${label}</span>${cnt ? `<b class="cnt">${cnt}</b>` : ''}<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7 10 5 5 5-5z"/></svg></button>
      <div class="menu${open}" id="modes-menu" role="menu">${ORDER_MODES.map((m) => `
        <button class="menu-i${m.k === mode ? ' on' : ''} m-${m.k}" data-h="${m.k}" type="button" role="menuitemradio" aria-checked="${m.k === mode}"><i></i><span><b>${m.t}${m.k === 'premod' && cnt ? ` <b class="cnt">${cnt}</b>` : ''}</b><small>${m.d}</small></span></button>`).join('')}
      </div>
    </div>
    <button class="ico" data-h="note" type="button" title="Слово ведущего" aria-label="Слово ведущего">${ICON.pen}</button>
    <button class="ico" data-h="settings" type="button" title="Настройки" aria-label="Настройки">${ICON.gear}</button>`;
}

function renderAll() {
  if (!S) return;
  renderNow(); renderQueue(); renderSuggest(); renderLog(); renderCrowd(); renderOnAir(); renderOrder(); renderHost();
  frame();
}

function renderWho() {
  const me = user.me;
  $('#who').innerHTML = me
    ? `<button class="me-chip" id="me-chip" title="Выйти">${face(me)}<span>${esc(me.name)}</span><span class="x">выйти</span></button>`
    : `<button class="btn-ghost" id="login-btn">${ICON.twitch}<span>Войти</span></button>`;
}

// ------------------------------------------------------------------ действия
async function act(d) {
  if (!user.me) { login(); return null; }
  try { return await call('/act', d); } catch (e) { toast(e.message); return null; }
}

function showResult(r, q) {
  const box = $('#result');
  if (!r) { box.classList.add('hide'); return; }
  box.className = 'result' + (r.bad ? ' bad' : '');
  if (r.bad) {
    box.innerHTML = `<div class="r-t"><b>${esc(r.message)}</b><span>${esc(q || '')}</span></div>`;
    return;
  }
  const x = r.item;
  let line;
  if (r.where === 'suggest') line = 'Отправил ведущему — заиграет, если он одобрит';
  else if (r.pos === 1 && !(S && S.now)) line = 'Заиграет прямо сейчас';
  else line = `№${r.pos} в очереди · ${r.eta ? 'примерно в ' + clockAt(r.eta) + ' (через ' + Math.max(1, Math.round((r.eta - clock.now()) / 60000)) + ' мин)' : 'скоро'}`;
  box.innerHTML = `<img src="${esc(x.art)}" alt=""><div class="r-t"><b>${esc(x.title)}${x.artist ? ' — ' + esc(x.artist) : ''}</b><span>${line}</span></div>
    <button class="op txt no" id="undo">Убрать</button>`;
  $('#undo', box).addEventListener('click', async () => {
    const ok = await act({ do: 'remove', id: x.id });
    if (ok) { box.classList.add('hide'); toast('Убрал из очереди'); }
  });
}

let ordering = false;
async function order(q) {
  q = (q || '').trim();
  if (!q) { $('#q').focus(); return; }
  if (!user.me) {
    try { sessionStorage.setItem('radio.want', JSON.stringify({ q, at: Date.now() })); } catch (e) { /* без памяти */ }
    login();
    return;
  }
  if (ordering) return;
  ordering = true;
  const btn = $('#order-btn');
  btn.disabled = true;
  btn.firstElementChild.textContent = 'Ищу трек…';
  try {
    const r = await call('/request', { q });
    $('#q').value = '';
    showResult(r);
  } catch (e) {
    if (e.status === 401) { login(); } else showResult({ bad: true, message: e.message }, q);
  } finally {
    ordering = false;
    btn.firstElementChild.textContent = 'Заказать трек';
    renderOrder();
  }
}

function resumeWant() {
  let w = null;
  try { w = JSON.parse(sessionStorage.getItem('radio.want') || 'null'); sessionStorage.removeItem('radio.want'); } catch (e) { /* */ }
  if (w && user.me && Date.now() - w.at < 15 * 60000) { $('#q').value = w.q; order(w.q); }
}

function noteModal() {
  const m = modal(`<h3>Слово ведущего</h3><p>Строка над заказом, её видят все. Например: «Сегодня вечер фонка» или «Собираем треки к кастомке».</p>
    <input type="text" id="nt" maxlength="160" value="${esc(S.settings.note)}">
    <div class="acts"><button class="btn-ghost" id="nt-clear">Убрать</button><button class="btn-main" id="nt-go">Показать всем</button></div>`);
  const go = async (text) => { if (await act({ do: 'settings', set: { note: text } })) m.close(); };
  $('#nt-go', m.el).addEventListener('click', () => go($('#nt', m.el).value));
  $('#nt-clear', m.el).addEventListener('click', () => go(''));
  $('#nt', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') go($('#nt', m.el).value); });
  $('#nt', m.el).focus();
}

async function settingsModal() {
  const s = S.settings;
  let h = { bans: [], cohosts: [] };
  try { h = await call('/host'); } catch (e) { /* покажем без списков */ }
  const pls = h.playlists || [];
  const m = modal(`<h3>Настройки эфира</h3>
    <div class="sep-t" style="margin-top:10px">Фоновая музыка — когда нет заказов</div>
    <p class="bg-hint">Кинь ссылку на свой плейлист YouTube или YouTube Music — треки будут играть вперемешку, пока никто не заказывает. Заказы встают в очередь и играют после текущего трека. Плейлист должен быть открытым или «по ссылке»; «Понравившиеся» не подойдут.</p>
    <div class="row"><input type="text" id="pl-url" placeholder="https://music.youtube.com/playlist?list=…" maxlength="400"><button class="btn-main" id="pl-add">Добавить</button></div>
    <div class="pl-list">${pls.map((p) => `<div class="pl-i${p.on === false ? ' off' : ''}">
      <button class="switch${p.on === false ? '' : ' on'}" data-pl-toggle="${esc(p.id)}" data-on="${p.on === false ? 1 : 0}" type="button" aria-label="Играть этот плейлист"></button>
      <span><b>${esc(p.title)}</b><small>${p.count} ${plural(p.count, 'трек', 'трека', 'треков')}</small></span>
      <button class="op" data-pl-refresh="${esc(p.id)}" type="button" title="Перечитать плейлист с YouTube"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4l-2.4 2.4Z"/></svg></button>
      <button class="op no" data-pl-remove="${esc(p.id)}" type="button" title="Убрать плейлист">${ICON.x}</button></div>`).join('') || '<small style="color:var(--faint)">Пока нет — без плейлистов в тишине играет золотой фонд: треки, которые заказывали и лайкали.</small>'}</div>
    <div class="sep-t">Заказы</div>
    <div class="row"><label>Треков от одного человека в очереди</label><input type="number" id="s-per" min="1" max="20" value="${s.per_user}"></div>
    <div class="row"><label>Самый длинный трек, мин</label><input type="number" id="s-len" min="1" max="60" value="${Math.round(s.max_len / 60)}"></div>
    <div class="row"><label>Тот же трек снова через, мин<small>0 — можно сразу</small></label><input type="number" id="s-cd" min="0" max="1440" value="${s.cooldown}"></div>
    <div class="row"><label>«Мимо» пропускает трек от, % слушателей</label><input type="number" id="s-sk" min="10" max="100" value="${s.skip_share}"></div>
    <div class="row"><label>Музыка, когда нет заказов<small>Выключишь — в тишине будет тишина</small></label><button class="switch${s.autodj ? ' on' : ''}" id="s-auto" type="button" aria-label="Автоэфир"></button></div>
    <div class="sep-t">Закрыть заказ человеку</div>
    <div class="row"><input type="text" id="b-login" placeholder="логин Twitch" maxlength="25"><button class="btn-ghost" id="b-day">На сутки</button><button class="btn-ghost" id="b-ever">Навсегда</button></div>
    <div class="tag-list" id="b-list">${h.bans.map((b) => `<span>${esc(b.login)}${b.until ? ' · до ' + clockAt(b.until * 1000) : ''}<button data-unban="${esc(b.login)}" title="Вернуть">×</button></span>`).join('') || '<small style="color:var(--faint)">Никого</small>'}</div>
    ${user.me.admin ? `<div class="sep-t">Соведущие — тоже видят этот пульт</div>
    <div class="row"><input type="text" id="c-login" placeholder="логин Twitch" maxlength="25"><button class="btn-ghost" id="c-add">Добавить</button></div>
    <div class="tag-list">${h.cohosts.map((c) => `<span>${esc(c)}<button data-uncohost="${esc(c)}" title="Убрать">×</button></span>`).join('') || '<small style="color:var(--faint)">Пока нет</small>'}</div>` : ''}
    <div class="sep-t">Очистить очередь и предложку</div>
    <div class="row"><button class="hold" id="s-clear">Удерживай, чтобы стереть ${S.queue.length + S.suggest.length} ${plural(S.queue.length + S.suggest.length, 'трек', 'трека', 'треков')}</button></div>
    <div class="acts"><button class="btn-ghost" data-close>Закрыть</button><button class="btn-main" id="s-save">Сохранить</button></div>`);
  const el = m.el;
  $('#s-auto', el).addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
  $('#s-save', el).addEventListener('click', async () => {
    const r = await act({ do: 'settings', set: {
      per_user: +$('#s-per', el).value, max_len: +$('#s-len', el).value * 60, cooldown: +$('#s-cd', el).value,
      skip_share: +$('#s-sk', el).value, autodj: $('#s-auto', el).classList.contains('on'),
    } });
    if (r) { m.close(); toast('Сохранил'); }
  });
  const ban = async (hours) => {
    const login = $('#b-login', el).value.trim();
    if (!login) return;
    if (await act({ do: 'ban', login, hours })) { m.close(); toast(login + ' больше не заказывает'); }
  };
  $('#b-day', el).addEventListener('click', () => ban(24));
  $('#b-ever', el).addEventListener('click', () => ban(0));
  el.addEventListener('click', async (e) => {
    const u = e.target.closest('[data-unban]');
    if (u && await act({ do: 'unban', login: u.dataset.unban })) { m.close(); settingsModal(); }
    const c = e.target.closest('[data-uncohost]');
    if (c && await act({ do: 'cohost', login: c.dataset.uncohost, on: false })) { m.close(); settingsModal(); }
  });
  const plAdd = async (url) => {
    if (!url) { $('#pl-url', el).focus(); return; }
    const b = $('#pl-add', el); b.disabled = true; b.textContent = 'Читаю плейлист…';
    try {
      const r = await call('/act', { do: 'pl_add', url });
      toast(`Плейлист «${r.playlist.title}» — ${r.playlist.count} ${plural(r.playlist.count, 'трек', 'трека', 'треков')}`);
      m.close(); settingsModal();
    } catch (e) { toast(e.message, 5000); b.disabled = false; b.textContent = 'Добавить'; }
  };
  $('#pl-add', el).addEventListener('click', () => plAdd($('#pl-url', el).value.trim()));
  $('#pl-url', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') plAdd($('#pl-url', el).value.trim()); });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-pl-toggle]');
    if (t && await act({ do: 'pl_toggle', id: t.dataset.plToggle, on: t.dataset.on === '1' })) { m.close(); settingsModal(); }
    const r = e.target.closest('[data-pl-remove]');
    if (r && await act({ do: 'pl_remove', id: r.dataset.plRemove })) { m.close(); settingsModal(); }
    const f = e.target.closest('[data-pl-refresh]');
    if (f) plAdd('https://music.youtube.com/playlist?list=' + f.dataset.plRefresh);
  });
  const add = $('#c-add', el);
  if (add) add.addEventListener('click', async () => { if (await act({ do: 'cohost', login: $('#c-login', el).value.trim(), on: true })) { m.close(); settingsModal(); } });
  holdButton($('#s-clear', el), async () => { if (await act({ do: 'clear' })) { m.close(); toast('Очередь пуста'); } });
}

// ------------------------------------------------------------------ питание и громкость
async function setPower(on) {
  powered = on;
  if (on) noise.wake();
  document.body.classList.toggle('off', !on);
  $('#screen').classList.toggle('on', on);
  $('#vfd').classList.toggle('off', false);
  $('#power').setAttribute('aria-pressed', String(on));
  $('#power span').textContent = on ? 'Выкл' : 'Вкл';
  presence();
  await player.power(on);
  if (on && S && !S.now) toast('Сейчас тишина — закажи трек, он заиграет сразу');
}

let vol = store.get('vol', 70);
let volBack = store.get('volBack', 70);
function setVol(v) {
  vol = Math.max(0, Math.min(100, Math.round(v)));
  const f = $('#fader');
  f.style.setProperty('--v', vol);
  f.setAttribute('aria-valuenow', vol);
  $('#vol-n').textContent = vol;
  $('#mute').classList.toggle('muted', vol === 0);
  $('#mute').title = vol === 0 ? 'Вернуть звук' : 'Выключить звук';
  player.setVolume(vol);
  store.set('vol', vol);
  noise.gain(vol);
}
function fader() {
  const f = $('#fader');
  const at = (e) => {
    const r = f.getBoundingClientRect();
    return r.width > r.height                     // на телефоне фейдер лежит
      ? ((e.clientX - r.left - 10) / (r.width - 20)) * 100
      : ((r.bottom - 10 - e.clientY) / (r.height - 20)) * 100;
  };
  let drag = false;
  f.addEventListener('pointerdown', (e) => { drag = true; f.classList.add('drag'); f.setPointerCapture(e.pointerId); setVol(at(e)); });
  f.addEventListener('pointermove', (e) => { if (drag) setVol(at(e)); });
  const end = () => { drag = false; f.classList.remove('drag'); };
  f.addEventListener('pointerup', end);
  f.addEventListener('pointercancel', end);
  f.addEventListener('wheel', (e) => { e.preventDefault(); setVol(vol - Math.sign(e.deltaY) * 5); }, { passive: false });
  f.addEventListener('keydown', (e) => {
    const k = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20 }[e.key];
    if (k) { setVol(vol + k); e.preventDefault(); }
    if (e.key === 'Home') { setVol(0); e.preventDefault(); }
    if (e.key === 'End') { setVol(100); e.preventDefault(); }
  });
  $('#mute').addEventListener('click', () => {
    if (vol > 0) { volBack = vol; store.set('volBack', vol); setVol(0); } else setVol(volBack || 70);
  });
}

// Шум эфира: на экране, пока трек не заиграл, и коротким шорохом в колонках, когда радио «перестраивается» на
// новый трек. Звук делает сам браузер (Web Audio), он тише музыки и идёт за ползунком громкости.
const noise = (() => {
  let ctx = null; let buf = null; let level = 0.7;
  const cv = $('#noise'); const g2 = cv.getContext('2d'); const img = g2.createImageData(cv.width, cv.height);
  let last = 0;
  const draw = (ts) => {
    requestAnimationFrame(draw);
    const sc = $('#screen');
    if (!sc.classList.contains('on') || sc.classList.contains('live') || ts - last < 45) return;
    last = ts;
    const d = img.data;
    const band = (ts / 9) % cv.height;
    for (let y = 0; y < cv.height; y++) {
      const roll = Math.abs(y - band) < 6 ? 60 : 0;
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        const v = Math.min(255, ((Math.random() * 200) | 0) + roll);
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    }
    g2.putImageData(img, 0, 0);
  };
  requestAnimationFrame(draw);
  return {
    wake() {                                       // только по нажатию: иначе браузер не даст звук
      if (ctx) { ctx.resume(); return; }
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        buf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      } catch (e) { ctx = null; }
    },
    gain(v) { level = v / 100; },
    sweep() {
      if (!ctx || !buf || level <= 0) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.45); bp.frequency.exponentialRampToValueAtTime(900, t + 1.0);
      const g = ctx.createGain();
      const peak = 0.07 * level * level;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.08); g.gain.setValueAtTime(peak, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t); src.stop(t + 1.15);
    },
  };
})();

function presence() {
  call('/presence', { sid, on: powered }).catch(() => {});
}

// ------------------------------------------------------------------ запуск
function wire() {
  $('#power-cta').addEventListener('click', () => setPower(true));
  $('#power').addEventListener('click', () => setPower(!powered));
  $('#slot').addEventListener('submit', (e) => { e.preventDefault(); order($('#q').value); });
  $('#k-like').addEventListener('click', async () => {
    const r = await act({ do: 'like' });
    if (r && r.liked) toast('Качает! Трек попадёт в золотой фонд эфира');
  });
  $('#k-skip').addEventListener('click', () => act({ do: 'skip' }));
  $('#who').addEventListener('click', (e) => {
    if (e.target.closest('#login-btn')) login();
    if (e.target.closest('#me-chip')) logout();
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-do]');
    if (b) { await act({ do: b.dataset.do, id: b.dataset.id }); return; }
    const h = e.target.closest('[data-h]');
    const menu = document.getElementById('modes-menu');
    if (menu && !e.target.closest('.chip-wrap')) menu.classList.add('hide');
    if (!h) return;
    const k = h.dataset.h;
    if (k === 'onair') act({ do: 'onair', on: !(S.onair && S.onair.login === user.me.login) });
    else if (k === 'pause' || k === 'resume') act({ do: k });
    else if (k === 'skip') act({ do: 'skip', force: true });
    else if (k === 'modes') { $('#modes-menu').classList.toggle('hide'); return; }
    else if (k === 'close') { $('#modes-menu').classList.add('hide'); act({ do: 'settings', set: { open: false } }); }
    else if (k === 'free' || k === 'premod') { $('#modes-menu').classList.add('hide'); act({ do: 'settings', set: { open: true, mode: k === 'free' ? 'free' : 'host' } }); }
    else if (k === 'note') noteModal();
    else if (k === 'settings') settingsModal();
  });
  fader();
}

async function start() {
  buildDial(); buildVU($('#vu-scale-l')); buildVU($('#vu-scale-r')); buildBars();
  document.body.classList.add('off');
  setVol(vol);
  wire();
  onUser(() => { renderWho(); renderAll(); presence(); });
  renderWho();
  try {
    const st = await call('/state');
    Object.assign(meta, st.meta || {});
    clock.hint(st.t);
    S = st;
    renderAll();
  } catch (e) { toast(e.message, 6000); }
  try { const fl = sessionStorage.getItem('radio.flash'); if (fl) { sessionStorage.removeItem('radio.flash'); toast(fl); } } catch (e) { /* */ }
  clock.sync().then(() => { if (S) player.update(S.now, S.started, S.paused); });
  setInterval(() => clock.sync(2), 5 * 60000);
  await refreshMe();
  resumeWant();
  stream((st) => { clock.hint(st.t); S = st; renderAll(); });
  setInterval(frame, 250);
  setInterval(presence, 30000);
  setInterval(() => { if (S) { renderQueue(); renderLog(); } }, 30000);
  renderTop();
  setInterval(renderTop, 60000);
  presence();
  requestAnimationFrame(vuStep);
}

window.__radio = { player, get state() { return S; }, setPower };   // для проверок
start();

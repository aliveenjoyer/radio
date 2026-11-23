// Вход через Twitch: в одно нажатие (страница Twitch → twitch.html), а если так нельзя — по коду, как в «Лобби».
import { call, session, BASE } from './api.js?v=20261123075031';
import { modal, $, ICON, toast } from './ui.js?v=20261123075031';

export const user = { me: null };
const subs = new Set();
export function onUser(fn) { subs.add(fn); }
export function setUser(me) { user.me = me; subs.forEach((f) => f(me)); }

export const meta = { login: {}, dev: false };

export async function refreshMe() {
  if (!session.token) { setUser(null); return null; }
  try {
    const d = await call('/me');
    if (!d.me) session.set(null);
    setUser(d.me);
  } catch (e) { /* сервер недоступен — остаёмся как были */ }
  return user.me;
}

function loginRedirect() {
  const m = meta.login || {};
  if (!m.redirect || !m.client || !window.crypto) return false;
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    if (sessionStorage.getItem('radio.login') === 'code') return false;
    sessionStorage.setItem('radio.tw', JSON.stringify({ state, at: Date.now() }));
    if (!sessionStorage.getItem('radio.tw')) return false;
  } catch (e) { return false; }
  location.href = `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(m.client)}&redirect_uri=${encodeURIComponent(BASE + 'twitch.html')}&response_type=token&scope=&state=${state}`;
  return true;
}

function devLogin() {
  const m = modal(`<h3>Вход (у себя)</h3><p>Twitch здесь выдуманный: введи любой логин. <b>aliveenjoyer</b> и <b>streamer</b> — ведущие.</p>
    <input type="text" id="dl" value="viewer${Math.floor(Math.random() * 90 + 10)}" maxlength="25">
    <div class="acts"><button class="btn-ghost" data-close>Отмена</button><button class="btn-main" id="dl-go">Войти</button></div>`);
  const go = async () => {
    try {
      const r = await call('/dev/login', { login: $('#dl', m.el).value.trim() });
      session.set(r.token); setUser(r.me); m.close(); toast('Вошёл как ' + r.me.name);
    } catch (e) { toast(e.message); }
  };
  $('#dl-go', m.el).addEventListener('click', go);
  $('#dl', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#dl', m.el).select();
}

let open = false;
export async function login() {
  if (open) return;
  if (meta.dev) { devLogin(); return; }
  if (loginRedirect()) return;
  open = true;
  const tab = window.open('about:blank', '_blank');
  let stop = false; let timer = 0;
  const m = modal(`<h3>Вход через Twitch</h3>
      <p id="lg-text">Спрашиваю у Twitch код входа…</p>
      <div class="code-big hide" id="lg-code"></div>
      <div class="acts"><button class="btn-ghost" data-close>Отмена</button><a class="btn-main hide" id="lg-open" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none">${ICON.twitch}<span>Открыть Twitch</span></a></div>`,
  { onClose: () => { stop = true; clearTimeout(timer); open = false; } });
  const fail = (text) => { if (tab && !tab.closed) tab.close(); $('#lg-text', m.el).textContent = text; $('#lg-code', m.el).classList.add('hide'); };
  let d;
  try { d = await call('/auth/twitch/start', {}); } catch (e) { fail(e.message); return; }
  if (stop) { if (tab && !tab.closed) tab.close(); return; }
  if (tab && !tab.closed) tab.location.href = d.url;
  $('#lg-text', m.el).textContent = 'На странице Twitch нажми «Разрешить» и вернись сюда. Код уже подставлен:';
  const code = $('#lg-code', m.el); code.textContent = d.code; code.classList.remove('hide');
  const op = $('#lg-open', m.el); op.href = d.url; op.classList.remove('hide');
  const poll = async () => {
    if (stop) return;
    let r;
    try { r = await call('/auth/twitch/poll', { lid: d.lid }); } catch (e) { r = { status: 'wait' }; }
    if (stop) return;
    if (r.status === 'ok') { session.set(r.token); setUser(r.me); m.close(); toast('Вошёл как ' + r.me.name); return; }
    if (r.status === 'gone') { fail('Код не подтвердили вовремя. Нажми «Войти» ещё раз.'); return; }
    timer = setTimeout(poll, Math.max(1, d.interval) * 1000 + 200);
  };
  timer = setTimeout(poll, Math.max(1, d.interval) * 1000);
}

export async function logout() {
  try { await call('/auth/logout', {}); } catch (e) { /* выйдем и так */ }
  session.set(null);
  setUser(null);
}

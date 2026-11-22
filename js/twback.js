// Возврат со страницы Twitch после «Разрешить» (вход в одно нажатие, auth.js: loginRedirect).
// Токен лежит в адресе после решётки: страница сразу убирает его из адреса, сверяет метку входа и меняет на вход радио.
import { call, session } from './api.js?v=20261123064934';

const box = document.getElementById('box');
const frag = new URLSearchParams(location.hash.replace(/^#/, ''));
const q = new URLSearchParams(location.search);
try { history.replaceState(null, '', location.pathname); } catch (e) { /* адрес останется как есть */ }
let saved = null;
try { saved = JSON.parse(sessionStorage.getItem('radio.tw') || 'null'); sessionStorage.removeItem('radio.tw'); } catch (e) { /* хранилище закрыто */ }
const home = (flash) => { try { if (flash) sessionStorage.setItem('radio.flash', flash); } catch (e) { /* */ } location.replace('./'); };
const fail = (text) => {
  try { sessionStorage.setItem('radio.login', 'code'); } catch (e) { /* */ }
  box.innerHTML = '<h2 style="margin:0 0 8px">Войти не получилось</h2><p style="color:var(--dim)"></p><a class="btn-main" style="display:inline-flex;align-items:center;text-decoration:none" href="./">Вернуться на радио</a>';
  box.querySelector('p').textContent = text + ' Вернись и нажми «Войти» ещё раз — вход пойдёт по коду.';
};
const token = frag.get('access_token');
const state = frag.get('state') || q.get('state');
if (q.get('error') || frag.get('error')) home('Вход через Twitch отменён');
else if (!token) fail('Twitch не вернул вход.');
else if (!saved || !state || state !== saved.state || Date.now() - saved.at > 15 * 60000) fail('Эта страница открылась не после нажатия «Войти».');
else {
  try { const r = await call('/auth/twitch/token', { token }); session.set(r.token); home('Вошёл как ' + r.me.name); }
  catch (e) { fail(e.message || 'Радио не ответило.'); }
}

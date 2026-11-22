// Связь с сервером радио: запросы, вход, поток эфира и часы сервера.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const API = LOCAL ? '/api' : 'https://173-249-26-11.sslip.io:8444/radio';
export const BASE = location.origin + location.pathname.replace(/[^/]*$/, '');

export const session = {
  get token() { try { return localStorage.getItem('radio.token'); } catch (e) { return null; } },
  set(t) { try { t ? localStorage.setItem('radio.token', t) : localStorage.removeItem('radio.token'); } catch (e) { /* без памяти */ } },
};

export class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

export async function call(path, body) {
  const h = {};
  if (session.token) h.Authorization = 'Bearer ' + session.token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch (e) {
    throw new ApiError('net', 'Нет связи с радио. Проверь интернет', 0);
  }
  let d = null;
  try { d = await r.json(); } catch (e) { /* пустой ответ */ }
  if (!r.ok || (d && d.ok === false)) {
    if (r.status === 401 && d && d.error === 'auth') session.set(null);
    throw new ApiError((d && d.error) || 'http', (d && d.message) || 'Радио не ответило (' + r.status + ')', r.status);
  }
  return d || {};
}

// Часы сервера: сколько у него сейчас миллисекунд. Сверяемся несколько раз и берём замер с самой короткой дорогой.
let offset = 0;
let best = Infinity;
export const clock = {
  now: () => Date.now() + offset,
  hint(t) { if (best === Infinity) offset = t - Date.now(); },     // пока не сверились — хотя бы по состоянию
  async sync(n = 4) {
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      const d0 = Date.now();
      try {
        const r = await fetch(API + '/time', { cache: 'no-store' });
        const { t } = await r.json();
        const rtt = performance.now() - a;
        if (rtt < best + 30) { best = Math.min(best, rtt); offset = t - (d0 + rtt / 2); }
      } catch (e) { /* в следующий раз */ }
      await new Promise((res) => setTimeout(res, 150));
    }
  },
};

export function stream(onState) {
  let es = null;
  let dead = 0;
  const open = () => {
    es = new EventSource(API + '/stream');
    es.onmessage = (e) => { dead = 0; try { onState(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    es.addEventListener('tick', () => { dead = 0; });
    es.onerror = () => {
      if (es.readyState === 2) { es.close(); setTimeout(open, 3000); }
    };
  };
  open();
  setInterval(() => {                                 // поток молчит дольше 45 с — переподключаемся сами
    if (++dead > 9) { dead = 0; try { es.close(); } catch (e) { /* уже закрыт */ } open(); }
  }, 5000);
}

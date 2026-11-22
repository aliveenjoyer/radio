// Мелочи страницы: экранирование, всплывашки, окна, время.
export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastT = 0;
export function toast(text, ms = 3400) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}

export function modal(html, { onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', key);
  return { el: bg.firstElementChild, close };
}

export function mmss(s) {
  if (s == null || !isFinite(s)) return '--:--';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function clockAt(ms) {
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function ago(ms, now) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  const h = Math.floor(m / 60);
  return h + ' ч назад';
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100; const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Кнопка с удержанием для того, что не вернуть (стереть очередь): держишь 1,2 с — срабатывает.
export function holdButton(btn, fn, ms = 1200) {
  const bar = document.createElement('i');
  btn.prepend(bar);
  let t0 = 0; let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); bar.style.width = '0'; t0 = 0; };
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    bar.style.width = k * 100 + '%';
    if (k >= 1) { stop(); fn(); return; }
    raf = requestAnimationFrame(step);
  };
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(step); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
}

export const ICON = {
  twitch: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M4.3 2 3 5.4v13.7h4.6V22h2.6l2.8-2.9h3.7L22 13.9V2H4.3Zm15.6 11-3.1 3.1h-4.6l-2.6 2.6v-2.6H5.6V4h14.3v9ZM16.4 7.1h-2v5.5h2V7.1Zm-5.5 0h-2v5.5h2V7.1Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 7 6 6-1.4 1.4L12 9.8l-4.6 4.6L6 13z"/></svg>',
  top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4h14v2H5zm7 4 6 6-1.4 1.4-3.6-3.6V20h-2v-8.2l-3.6 3.6L6 14z"/></svg>',
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6L21 7.4 19.6 6z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5.8v12.4a1 1 0 0 0 1.6.8l8-6.2a1 1 0 0 0 0-1.6l-8-6.2A1 1 0 0 0 5 5.8ZM17 5h2v14h-2z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.7h-4l-.4 2.7c-.6.2-1.2.6-1.7 1l-2.5-1-2 3.5L4.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.8 1.7 1l.4 2.7h4l.4-2.7c.6-.2 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.2V21h3.8L17.8 9.9l-3.7-3.7L3 17.2ZM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7Z"/></svg>',
  fire: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12.6 2.3c.4 3-1.2 4.6-2.7 6.1C8.4 9.9 7 11.4 7 14a5 5 0 0 0 10 0c0-1.6-.6-2.8-1.4-3.8.1 1.3-.4 2.3-1.4 2.8.4-3.6-.9-7.6-1.6-10.7Z"/></svg>',
};

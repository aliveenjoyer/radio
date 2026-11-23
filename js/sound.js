// Звук самого радио (не музыка): перебивки между треками — короткие радийные заставки на 1–2 с, пока грузится
// следующий трек. Шесть разных, подряд одна и та же не играет. Всё синтезирует браузер (Web Audio), файлов нет.
// Громкость идёт за ползунком, заметно тише музыки.

const IDENTS = ['wave', 'arp', 'tape', 'morse', 'vinyl', 'riser'];

export class Sound {
  constructor() { this.ctx = null; this.level = 0.7; this.last = ''; }

  wake() {                                   // только по нажатию: иначе браузер не даст звук
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.build(this.ctx, this.ctx.destination);
    } catch (e) { this.ctx = null; }
  }

  // общая цепочка: master -> выход, плюс «зал» (реверберация) и эхо
  build(ctx, out) {
    this.out = out;
    this.master = ctx.createGain();
    this.master.connect(out);
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.rev = ctx.createConvolver(); this.rev.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.55;
    this.rev.connect(rg).connect(this.master);
    this.dly = ctx.createDelay(1); this.dly.delayTime.value = 0.19;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 3200;
    this.dly.connect(dl).connect(fb).connect(this.dly);
    const dg = ctx.createGain(); dg.gain.value = 0.5;
    dl.connect(dg).connect(this.master);
    const nl = Math.floor(ctx.sampleRate * 1.5);
    this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
  }

  gain(v) { this.level = v / 100; }

  // ---------- кирпичики
  env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }
  sends(node, wet = 0.4, echo = 0) {
    node.connect(this.master);
    if (wet) { const w = this.ctx.createGain(); w.gain.value = wet; node.connect(w).connect(this.rev); }
    if (echo) { const e = this.ctx.createGain(); e.gain.value = echo; node.connect(e).connect(this.dly); }
  }
  tone(f, t, { type = 'sine', a = 0.005, hold = 0, rel = 0.5, peak = 0.3, wet = 0.4, echo = 0, det = 0, cut = 0, slide = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = det;
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + a + hold + rel);
    const g = ctx.createGain(); this.env(g, t, a, peak, hold, rel);
    let n = o.connect(g);
    if (cut) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; n = n.connect(lp); }
    this.sends(n, wet, echo);
    o.start(t); o.stop(t + a + hold + rel + 0.05);
    return o;
  }
  bell(f, t, peak = 0.22, rel = 0.9, echo = 0.25) {          // колокольчик: частотная модуляция
    const ctx = this.ctx;
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * 3.5;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + rel);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain(); this.env(g, t, 0.004, peak, 0, rel);
    this.sends(car.connect(g), 0.5, echo);
    car.start(t); mod.start(t); car.stop(t + rel + 0.05); mod.stop(t + rel + 0.05);
  }
  noise(t, dur, { type = 'bandpass', f0 = 800, f1 = 0, q = 1, peak = 0.2, a = 0.02, rel = 0.1, wet = 0.2, lfo = 0 } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (lfo) {                                                 // «скретч»: частота ходит туда-сюда
      const l = ctx.createOscillator(); l.frequency.value = lfo;
      const lg = ctx.createGain(); lg.gain.value = f0 * 0.8;
      l.connect(lg).connect(f.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    const g = ctx.createGain(); this.env(g, t, a, peak, Math.max(0, dur - a - rel), rel);
    this.sends(s.connect(f).connect(g), wet);
    s.start(t); s.stop(t + dur + 0.05);
  }
  kick(t, peak = 0.6) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.28);
    const g = ctx.createGain(); this.env(g, t, 0.003, peak, 0.02, 0.33);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.4);
  }
  snare(t, peak = 0.3) {
    this.noise(t, 0.18, { type: 'highpass', f0: 1800, q: 0.7, peak, a: 0.002, rel: 0.15, wet: 0.35 });
    this.tone(190, t, { type: 'triangle', a: 0.002, rel: 0.12, peak: peak * 0.6, wet: 0.2 });
  }
  chord(fs, t, opts) { fs.forEach((f, i) => this.tone(f, t, Object.assign({}, opts, { det: (i % 2 ? 6 : -6) }))); }

  // ---------- шесть перебивок (секунды — примерная длина)
  wave(t) {          // «Волна» — шорох настройки, и станция поймана: светлый аккорд колокольчиками (1,8)
    this.noise(t, 0.55, { f0: 350, f1: 3400, q: 2.2, peak: 0.24, a: 0.05, rel: 0.12 });
    [440, 554.4, 659.3, 830.6].forEach((f, i) => this.bell(f, t + 0.5 + i * 0.045, 0.2, 1.1, 0.2));
    this.tone(110, t + 0.5, { a: 0.01, rel: 0.7, peak: 0.26, wet: 0.1 });
  }
  arp(t) {           // «Энкор» — три ноты вверх с эхом (1,5)
    this.kick(t, 0.35);
    [659.3, 987.8, 1661.2].forEach((f, i) => this.bell(f, t + i * 0.12, 0.2, 0.7, 0.35));
    this.tone(82.4, t, { a: 0.01, rel: 0.6, peak: 0.16, wet: 0 });
  }
  tape(t) {          // «Плёнка» — перемотка вверх, щелчок и удар (1,3)
    this.noise(t, 0.6, { type: 'lowpass', f0: 260, f1: 7000, q: 9, peak: 0.2, a: 0.25, rel: 0.03, wet: 0.1 });
    this.tone(180, t, { type: 'sawtooth', a: 0.25, hold: 0.32, rel: 0.03, peak: 0.05, slide: 2400, cut: 3000, wet: 0 });
    this.tone(2000, t + 0.62, { type: 'square', a: 0.001, rel: 0.02, peak: 0.12, wet: 0 });
    this.kick(t + 0.64, 0.65);
    this.tone(55, t + 0.64, { a: 0.005, rel: 0.6, peak: 0.25, wet: 0.15 });
  }
  morse(t) {         // «Позывной» — морзянка «· — ·» в эфире и мягкий аккорд (1,7)
    this.noise(t, 0.9, { f0: 1800, q: 0.5, peak: 0.06, a: 0.05, rel: 0.2, wet: 0 });
    let x = t + 0.04;
    for (const d of [0.07, 0.2, 0.07]) {
      this.tone(880, x, { type: 'square', a: 0.004, hold: d, rel: 0.01, peak: 0.2, cut: 2200, wet: 0.15 });
      x += d + 0.08;
    }
    this.chord([293.7, 370, 440, 554.4], t + 0.55, { type: 'sawtooth', a: 0.25, hold: 0.25, rel: 0.6, peak: 0.1, cut: 1100, wet: 0.6 });
    this.kick(t + 0.55, 0.4);
  }
  vinyl(t) {         // «Пластинка» — скретч и бочка с малым (1,2)
    this.noise(t, 0.34, { f0: 900, q: 3, peak: 0.22, a: 0.01, rel: 0.05, lfo: 9, wet: 0.05 });
    this.kick(t + 0.4, 0.7);
    this.tone(82.4, t + 0.4, { a: 0.005, rel: 0.45, peak: 0.25, wet: 0 });
    this.snare(t + 0.66, 0.32);
  }
  riser(t) {         // «Синтвейв» — нарастающий аккорд и удар с хвостом (1,9)
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(250, t); lp.frequency.exponentialRampToValueAtTime(4200, t + 0.8);
    const g = ctx.createGain(); this.env(g, t, 0.75, 0.09, 0.02, 0.06);
    lp.connect(g); this.sends(g, 0.2);
    [261.6, 329.6, 392, 493.9].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = i % 2 ? 9 : -9;
      o.connect(lp); o.start(t); o.stop(t + 0.9);
    });
    this.chord([261.6, 329.6, 392, 493.9, 523.3], t + 0.84, { type: 'sawtooth', a: 0.004, hold: 0.06, rel: 0.5, peak: 0.06, cut: 2600, wet: 0.7, echo: 0.2 });
    this.kick(t + 0.84, 0.6);
  }

  // сыграть перебивку: случайную, но не ту же, что в прошлый раз (или названную — для проверки)
  ident(name) {
    if (!this.ctx || this.level <= 0) return '';
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const pool = IDENTS.filter((x) => x !== this.last);
    const pick = IDENTS.includes(name) ? name : pool[Math.floor(Math.random() * pool.length)];
    this.last = pick;
    this.master.gain.value = 0.55 * this.level;
    this[pick](this.ctx.currentTime + 0.05);
    return pick;
  }
}

export { IDENTS };

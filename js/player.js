// Плеер эфира: YouTube или SoundCloud у этого слушателя, с той секунды, что идёт у всех.
// Сервер называет трек и момент его нулевой секунды (started, по часам сервера). Раз в 2 с сверяемся: разошлись больше
// чем на 1,5 с — перематываем. Реклама YouTube и подгрузка сбивают время, сверка его возвращает.
import { clock } from './api.js?v=20261123073609';

const DRIFT = 1.5;
let ytReady = null;
let scReady = null;

function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = ok; s.onerror = () => bad(new Error('script ' + src));
    document.head.appendChild(s);
  });
}
function yt() {
  if (!ytReady) {
    ytReady = new Promise((ok, bad) => {
      window.onYouTubeIframeAPIReady = () => ok(window.YT);
      loadScript('https://www.youtube.com/iframe_api').catch(bad);
      setTimeout(() => bad(new Error('yt timeout')), 15000);
    });
    ytReady.catch(() => { ytReady = null; });
  }
  return ytReady;
}
function sc() {
  if (!scReady) {
    scReady = loadScript('https://w.soundcloud.com/player/api.js').then(() => window.SC);
    scReady.catch(() => { scReady = null; });
  }
  return scReady;
}

export class Player {
  constructor(box, hooks) {
    this.box = box;                    // .screen-media
    this.hooks = hooks;                // {onError(item, code), onDuration(item, sec), onPlaying(bool), onFail(text)}
    this.on = false;
    this.vol = 70;
    this.item = null;
    this.started = 0;
    this.paused = null;
    this.ytp = null; this.ytEl = null; this.ytOk = false;
    this.scw = null; this.scEl = null; this.scVid = null;
    this.lastSeek = 0;
    this.seekedAt = 0;
    this.lead = { yt: 0, sc: 1.2 };
    this.playing = false;
    this.blocked = false;          // браузер телефона не дал запустить звук сам: нужно касание по самому плееру
    this.idleSince = 0;            // с какого момента должно играть, а не играет
    this.timer = setInterval(() => this.check(), 2000);
    this.watch = setInterval(() => this.watchStart(), 700);
  }

  pos() {
    const at = this.paused != null ? this.paused : clock.now();
    return (at - this.started) / 1000;
  }

  setVolume(v) {
    this.vol = v;
    if (this.ytp && this.ytOk) { try { this.ytp.setVolume(v); if (v > 0) this.ytp.unMute(); } catch (e) { /* ещё не готов */ } }
    if (this.scw) { try { this.scw.setVolume(v); } catch (e) { /* ещё не готов */ } }
  }

  async power(on) {
    this.on = on;
    if (!on) { this.stopAll(); this.setPlaying(false); return; }
    await this.apply(true);
  }

  // новое состояние эфира
  update(now, started, paused) {
    const same = this.item && now && this.item.src === now.src && this.item.vid === now.vid && this.item.id === now.id;
    this.item = now;
    this.started = started;
    this.paused = paused;
    if (!this.on) return;
    this.apply(!same);
  }

  setPlaying(p) {
    if (p) { this.idleSince = 0; this.setBlocked(false); }
    if (p !== this.playing) { this.playing = p; this.hooks.onPlaying && this.hooks.onPlaying(p); }
  }

  setBlocked(b) { if (b !== this.blocked) { this.blocked = b; this.hooks.onBlocked && this.hooks.onBlocked(b); } }

  // Телефоны (Safari на iPhone — всегда) не дают сайту самому включить клип YouTube или SoundCloud со звуком: нужно
  // одно касание по самому плееру. Если трек должен играть, а плеер стоит дольше 2,5 с, — открываем плеер для касания.
  watchStart() {
    const it = this.item;
    const want = this.pos();
    const should = this.on && it && this.paused == null && want > 0.5 && !(it.dur && want > it.dur - 2);
    if (!should) { this.idleSince = 0; this.setBlocked(false); return; }
    let idle = false;
    if (it.src === 'yt') {
      if (!this.ytp || !this.ytOk) return;
      let st = -1;
      try { st = this.ytp.getPlayerState(); } catch (e) { return; }
      const YT = window.YT;
      idle = st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING;
    } else if (it.src === 'sc') {
      idle = !this.playing;
    }
    if (!idle) { this.idleSince = 0; return; }
    if (!this.idleSince) this.idleSince = Date.now();
    if (Date.now() - this.idleSince > 2500) this.setBlocked(true);
  }

  stopAll() {
    if (this.ytp && this.ytOk) { try { this.ytp.stopVideo(); } catch (e) { /* нет плеера */ } }
    if (this.scw) { try { this.scw.pause(); } catch (e) { /* нет виджета */ } }
    clearTimeout(this.waitT);
  }

  show(which) {
    if (this.ytEl) this.ytEl.classList.toggle('hidden-engine', which !== 'yt');
    if (this.scEl) this.scEl.classList.toggle('hidden-engine', which !== 'sc');
  }

  async apply(fresh) {
    const it = this.item;
    clearTimeout(this.waitT);
    if (!it) { this.stopAll(); this.show(null); this.setPlaying(false); return; }
    const p = this.pos();
    if (it.src === 'yt') {
      if (this.scw) { try { this.scw.pause(); } catch (e) { /* */ } }
      await this.ytLoad(it, p, fresh);
    } else if (it.src === 'sc') {
      if (this.ytp && this.ytOk) { try { this.ytp.stopVideo(); } catch (e) { /* */ } }
      await this.scLoad(it, p, fresh);
    }
  }

  // ---------------- YouTube
  async ytEnsure() {
    if (this.ytp) return this.ytOkP;
    const YT = await yt();
    this.ytEl = document.createElement('div');
    const inner = document.createElement('div');
    this.ytEl.appendChild(inner);
    this.box.appendChild(this.ytEl);
    this.ytOkP = new Promise((ok) => {
      this.ytp = new YT.Player(inner, {
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, cc_load_policy: 0, origin: location.origin },
        events: {
          onReady: () => { this.ytOk = true; this.ytp.setVolume(this.vol); ok(); },
          onStateChange: (e) => this.ytState(e.data),
          onError: (e) => { if (this.item && this.item.src === 'yt') this.hooks.onError(this.item, 'yt' + e.data); },
        },
      });
    });
    return this.ytOkP;
  }

  async ytLoad(it, p, fresh) {
    try { await this.ytEnsure(); } catch (e) { this.hooks.onFail('YouTube не загрузился. Если ты в России — без VPN он не откроется'); return; }
    if (this.item !== it || !this.on) return;
    this.show('yt');
    const cur = (() => { try { return this.ytp.getVideoData().video_id; } catch (e) { return null; } })();
    if (this.paused != null) {
      if (cur !== it.vid) this.ytp.cueVideoById({ videoId: it.vid, startSeconds: Math.max(0, p) });
      else this.ytp.pauseVideo();
      this.setPlaying(false);
      return;
    }
    if (p < 0) {                                  // трек ещё не начался: готовим и включаем ровно в нулевую секунду
      if (cur !== it.vid || fresh) this.ytp.cueVideoById({ videoId: it.vid, startSeconds: 0 });
      this.waitT = setTimeout(() => { if (this.item === it && this.on) { this.ytp.seekTo(0, true); this.ytp.playVideo(); } }, -p * 1000);
      return;
    }
    const to = p + this.lead.yt;
    if (cur !== it.vid || fresh) this.ytp.loadVideoById({ videoId: it.vid, startSeconds: to });
    else { this.ytp.seekTo(to, true); this.ytp.playVideo(); }
    this.lastSeek = Date.now(); this.seekedAt = Date.now();
  }

  ytState(s) {
    const YT = window.YT;
    if (!YT || !this.item || this.item.src !== 'yt') return;
    if (s === YT.PlayerState.PLAYING) {
      this.setPlaying(true);
      try { this.ytp.unloadModule('captions'); this.ytp.unloadModule('cc'); } catch (e) { /* у ролика нет субтитров */ }
      if (!this.item.dur) { const d = this.ytp.getDuration(); if (d > 0) this.hooks.onDuration(this.item, d); }
      if (this.paused != null) this.ytp.pauseVideo();
    } else if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.ENDED || s === YT.PlayerState.CUED) {
      this.setPlaying(false);
    }
  }

  // ---------------- SoundCloud
  async scEnsure(it) {
    const SC = await sc();
    const url = 'https://api.soundcloud.com/tracks/' + encodeURIComponent(it.vid);
    if (!this.scw) {
      this.scEl = document.createElement('iframe');
      this.scEl.allow = 'autoplay';
      this.scEl.title = 'SoundCloud';
      this.scEl.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) + '&auto_play=false&visual=true&show_comments=false&show_user=true&hide_related=true&show_teaser=false&buying=false&sharing=false&download=false&show_artwork=true';
      this.box.appendChild(this.scEl);
      this.scw = SC.Widget(this.scEl);
      this.scVid = it.vid;
      await new Promise((ok) => this.scw.bind(SC.Widget.Events.READY, ok));
      this.scw.bind(SC.Widget.Events.PLAY, () => { if (this.item && this.item.src === 'sc') this.setPlaying(true); });
      this.scw.bind(SC.Widget.Events.PAUSE, () => { if (this.item && this.item.src === 'sc') this.setPlaying(false); });
      this.scw.bind(SC.Widget.Events.ERROR, () => { if (this.item && this.item.src === 'sc') this.hooks.onError(this.item, 'sc'); });
      return true;
    }
    if (this.scVid !== it.vid) {
      this.scVid = it.vid;
      await new Promise((ok) => this.scw.load(url, { auto_play: false, visual: true, show_comments: false, hide_related: true, show_teaser: false, callback: ok }));
    }
    return true;
  }

  async scLoad(it, p) {
    try { await this.scEnsure(it); } catch (e) { this.hooks.onFail('SoundCloud не загрузился'); return; }
    if (this.item !== it || !this.on) return;
    this.show('sc');
    this.scw.setVolume(this.vol);
    if (this.paused != null) { this.scw.pause(); this.setPlaying(false); return; }
    if (p < 0) {
      this.scw.pause(); this.scw.seekTo(0);
      this.waitT = setTimeout(() => { if (this.item === it && this.on) { this.scw.seekTo(0); this.scw.play(); } }, -p * 1000);
      return;
    }
    this.scw.seekTo((p + this.lead.sc) * 1000);
    this.scw.play();
    this.lastSeek = Date.now(); this.seekedAt = Date.now();
  }

  // ---------------- сверка раз в 2 с
  // Перемотка сама сбивает время: плеер подгружает кусок и стоит. Поэтому мотаем с упреждением (lead) и после каждой
  // перемотки смотрим, насколько всё равно отстали, — упреждение подстраивается под этого слушателя и этот сайт.
  fix(src, cur, playing, seek) {
    const want = this.pos();
    const d = cur - want;
    if (src === 'sc' && this.seekedAt && playing && Date.now() - this.seekedAt > 3500) {     // YouTube мотает в загруженном мгновенно
      if (Math.abs(d) < 6) this.lead[src] = Math.max(0, Math.min(4, this.lead[src] - d * 0.6));
      this.seekedAt = 0;
    }
    if (!playing || Math.abs(d) > (src === 'sc' ? 2 : 0.8)) {
      seek(Math.max(0, want + this.lead[src]));
      this.seekedAt = Date.now();
      this.lastSeek = Date.now();
    }
  }

  check() {
    const it = this.item;
    if (!this.on || !it || this.paused != null) return;
    const want = this.pos();
    if (want < 0 || (it.dur && want > it.dur - 2)) return;
    if (Date.now() - this.lastSeek < 4000) return;
    if (it.src === 'yt' && this.ytp && this.ytOk) {
      let cur = 0; let st = -1;
      try { cur = this.ytp.getCurrentTime(); st = this.ytp.getPlayerState(); } catch (e) { return; }
      const YT = window.YT;
      if (st === YT.PlayerState.BUFFERING) return;
      this.fix('yt', cur, st === YT.PlayerState.PLAYING, (to) => { this.ytp.seekTo(to, true); this.ytp.playVideo(); });
    } else if (it.src === 'sc' && this.scw) {
      this.scw.getPosition((ms) => this.scw.isPaused((paused) => {
        if (this.item !== it) return;
        this.fix('sc', ms / 1000, !paused, (to) => { this.scw.seekTo(to * 1000); this.scw.play(); });
      }));
    }
  }
}

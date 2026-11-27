'use strict';
const VERSION = 'v1.7.5';
const $ = (s, r) => (r || document).querySelector(s);
const IC = n => '<svg class="i" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
const esc = t => String(t == null ? '' : t);
const toastEl = $('#toast'); let tt;
function toast(m){ toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('on'), 2800); }

// ================= storage =================
const DBP = new Promise((res, rej) => {
  const r = indexedDB.open('collied', 1);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('tracks', { keyPath: 'id' }); d.createObjectStore('kv'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function io(store, mode, fn){
  const d = await DBP;
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
const kvGet = k => io('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => io('kv', 'readwrite', s => s.put(v, k));
const kvDel = k => io('kv', 'readwrite', s => s.delete(k));
const trAll = () => io('tracks', 'readonly', s => s.getAll());
const trPut = t => io('tracks', 'readwrite', s => s.put(t));
const trGet = id => io('tracks', 'readonly', s => s.get(id));
const trDel = id => io('tracks', 'readwrite', s => s.delete(id));
const trClear = () => io('tracks', 'readwrite', s => s.clear());
async function trPatch(id, patch){ const f = await trGet(id); if (f){ Object.assign(f, patch); await trPut(f); } }

// ================= state =================
let tracks = [], backup = null, known = {}, local = [], pls = [], favs = [], master = null;
let dayPick = '';
let queue = [], qi = -1, shuffle = false, repeat = 0;
let view = { k: 'songs' }, period = 'all';
const audio = new Audio(); audio.preload = 'auto';
let curUrl = null, sess = null, pendingSeek = 0;
let prefs = { speed: 1, auto: true }, auto = { scan: {}, art: {} }, rates = {}, starts = {}, ab = null;
const rateOf = t => (t && rates[t.id]) || 1;
const saveRates = () => kvSet('rates', rates).catch(() => {});
const savePrefs = () => kvSet('prefs', prefs).catch(() => {});
const saveAuto = () => kvSet('auto', auto).catch(() => {});

// ================= helpers =================
const norm = s => String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\p{L}\p{N}]+/gu, '');
const base = p => String(p || '').split(/[\\/]/).pop();
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const hid = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const pj = (v, d) => { try { return typeof v === 'string' ? JSON.parse(v) : (v == null ? d : v); } catch (e) { return d; } };
const ini = s => (esc(s).trim().charAt(0) || '♪').toUpperCase();
const h = s => esc(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byTitle = (a, b) => a.title.localeCompare(b.title);
const trBySid = sid => tracks.find(t => t.sid === sid);
function parseName(file){
  const n = file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
  const m = n.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: 'Unknown artist', title: n };
}
function setArt(el, t){
  if (t && t.art){ el.style.backgroundImage = 'url("' + t.art + '")'; el.textContent = ''; }
  else { el.style.backgroundImage = ''; const c = esc(t && t.title).trim().charAt(0); if (c) el.textContent = c.toUpperCase(); else el.innerHTML = IC('music'); }
}

const noAnim = () => document.documentElement.classList.contains('noanim');
// ================= back-button stack =================
const uiStack = [];
function pushUI(close){ uiStack.push(close); history.pushState({ c: uiStack.length }, ''); }
function popUI(){ if (uiStack.length) history.back(); }
window.addEventListener('popstate', () => { const c = uiStack.pop(); if (c) c(); });

// ================= sheet =================
function sheet(build){
  const sh = $('#sheet'), box = $('.sh-box', sh); box.innerHTML = ''; sh.hidden = false;
  let closed = false; clearTimeout(sh._t); sh.classList.remove('closing');
  const close = () => { if (closed) return; closed = true; if (noAnim()){ sh.hidden = true; return; } sh.classList.add('closing'); sh._t = setTimeout(() => { sh.hidden = true; sh.classList.remove('closing'); }, 230); };
  pushUI(close);
  $('.sh-bg', sh).onclick = () => popUI();
  build(box, () => popUI());
  box.scrollTop = 0;
}
function opt(box, label, fn, closeAfter, o){ o = o || {}; const b = document.createElement('button'); b.className = 'opt'; if (o.icon) b.insertAdjacentHTML('beforeend', IC(o.icon).replace('class="i"', 'class="i oi"')); b.appendChild(document.createTextNode(label)); if (o.sel) b.insertAdjacentHTML('beforeend', IC('check').replace('class="i"', 'class="i sel"')); b.onclick = () => { if (closeAfter !== false) popUI(); setTimeout(fn, closeAfter === false ? 0 : 280); }; box.appendChild(b); return b; }
const asyncPrompt = (title, val) => new Promise(res => {
  sheet((box, close) => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: title }));
    const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; box.appendChild(i);
    const ok = document.createElement('button'); ok.className = 'btn pri'; ok.textContent = 'Save'; ok.onclick = () => { const v = i.value; close(); setTimeout(() => res(v), 280); };
    const no = document.createElement('button'); no.className = 'btn'; no.textContent = 'Cancel'; no.onclick = () => { close(); setTimeout(() => res(null), 280); };
    box.appendChild(ok); box.appendChild(no); setTimeout(() => i.focus(), 350);
  });
});

// ================= Rhythm index + matching =================
function buildKnown(){
  known = {}; if (!backup) return;
  const put = (id, o) => { if (!id) return; const k = known[id] || (known[id] = {}); Object.keys(o).forEach(x => { if (o[x] && !k[x]) k[x] = o[x]; }); };
  pj(backup.playlists_data, []).forEach(p => (p.songs || []).forEach(s => put(String(s.id), { title: s.title, artist: s.artist, album: s.album, dur: +s.duration || 0, file: base(s.path) })));
  const rc = pj((backup.preferences || {}).recently_played_song_cache, []);
  (Array.isArray(rc) ? rc : []).forEach(s => put(String(s.id), { title: s.title, artist: s.artist, album: s.album, dur: +s.duration || 0, file: base(s.path) }));
  pj(backup.playback_history, []).forEach(x => put(String(x.songId), { title: x.songTitle, artist: x.artistName, album: x.albumName, dur: x.durationMs }));
}
function matchSid(t){
  const nf = norm(t.name), nt = norm(t.title); let best = null;
  for (const id in known){
    const k = known[id];
    if (k.file && norm(k.file) === nf) return id;
    if (!best && k.title && norm(k.title) === nt && (!k.dur || !t.dur || Math.abs(k.dur - t.dur * 1000) < 3500)) best = id;
  }
  return best || ('c' + t.id);
}
async function rematch(){
  let n = 0;
  for (const t of tracks){
    const sid = matchSid(t); t.sid = sid;
    if (!sid.startsWith('c')){ const k = known[sid]; if (k){ if (k.title && !t.edited) t.title = k.title; if (k.artist && !t.edited) t.artist = k.artist; if (k.album && !t.album) t.album = k.album; } n++; }
    await trPatch(t.id, { sid: t.sid, title: t.title, artist: t.artist, album: t.album || '' });
  }
  return n;
}

// ================= stats =================
const hkey = x => x.songId + '@' + x.startTimestamp;
// Collied is the master copy of your stats. A Rhythm backup only ever adds to it (per-song counts take the higher
// number, histories are merged), so importing an older backup can never make your numbers smaller.
function maxMerge(a, b){ const o = Object.assign({}, a); Object.keys(b || {}).forEach(k => { o[k] = Math.max(+o[k] || 0, +b[k] || 0); }); return o; }
function absorb(j){
  const sg = j.stats_rhythm_guard_data || {}, m = master || { counts: {}, daily: {}, arts: {}, plays: 0, time: 0, hist: [] };
  const seen = new Set(m.hist.map(hkey)), nh = pj(j.playback_history, []);
  nh.forEach(e => { const k = hkey(e); if (!seen.has(k)){ seen.add(k); m.hist.push(e); } });
  m.counts = maxMerge(m.counts, pj(sg.song_play_counts, {})); m.daily = maxMerge(m.daily, pj(sg.daily_listening_stats, {})); m.arts = maxMerge(m.arts, pj(sg.weekly_top_artists, {}));
  m.plays = Math.max(m.plays, +sg.songs_played || 0); m.time = Math.max(m.time, +sg.listening_time || 0);
  master = m; return kvSet('master', m);
}
function histData(){
  const bh = master ? master.hist : [];
  const bk = new Set(bh.map(hkey));
  const extra = local.filter(e => !bk.has(hkey(e)));
  return { bh, extra, all: bh.concat(extra) };
}
function compute(p){
  const sg = master ? { song_play_counts: master.counts, daily_listening_stats: master.daily, weekly_top_artists: master.arts, songs_played: master.plays, listening_time: master.time } : {};
  const H = histData(), names = {};
  Object.keys(known).forEach(id => names[id] = { title: known[id].title, artist: known[id].artist });
  tracks.forEach(t => { names[t.sid] = names[t.sid] || { title: t.title, artist: t.artist }; });
  H.all.forEach(e => { names[e.songId] = names[e.songId] || { title: e.songTitle, artist: e.artistName }; });
  let counts, daily, arts, plays, time;
  if (!p || p === 'all'){
    counts = Object.assign({}, pj(sg.song_play_counts, {})); daily = Object.assign({}, pj(sg.daily_listening_stats, {})); arts = Object.assign({}, pj(sg.weekly_top_artists, {}));
    plays = +sg.songs_played || 0; time = +sg.listening_time || 0;
    H.extra.forEach(e => { counts[e.songId] = (counts[e.songId] || 0) + 1; const d = dayKey(e.startTimestamp); daily[d] = (daily[d] || 0) + 1; if (e.artistName) arts[e.artistName] = (arts[e.artistName] || 0) + 1; plays++; time += e.listenedMs || e.durationMs || 0; });
  } else {
    const cut = Date.now() - (+p) * 864e5; counts = {}; daily = {}; arts = {}; plays = 0; time = 0;
    H.all.filter(e => (e.endTimestamp || e.timestamp || 0) >= cut).forEach(e => {
      counts[e.songId] = (counts[e.songId] || 0) + 1; const d = dayKey(e.startTimestamp); daily[d] = (daily[d] || 0) + 1;
      if (e.artistName) arts[e.artistName] = (arts[e.artistName] || 0) + 1; plays++; time += e.listenedMs || Math.min(Math.max(0, (e.endTimestamp || 0) - (e.startTimestamp || 0)), e.durationMs || 9e9);
    });
  }
  return { counts, daily, arts, plays, time, names, extra: H.extra, bh: H.bh, hist: H.all, basePlays: +sg.songs_played || 0 };
}
function streak(daily){ let n = 0; const d = new Date(); if (!daily[dayKey(d)]) d.setDate(d.getDate() - 1); while (daily[dayKey(d)]){ n++; d.setDate(d.getDate() - 1); } return n; }
function tween(el, to, dec, suf){
  if (document.documentElement.classList.contains('noanim')){ el.textContent = to.toLocaleString(undefined, { maximumFractionDigits: dec }) + suf; return; }
  const t0 = performance.now(), D = 800;
  (function f(t){ const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); el.textContent = (to * e).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; if (k < 1) requestAnimationFrame(f); })(t0);
}
function renderStats(){
  if (period === 'day'){ renderDay(); return; }
  const S = compute(period), el = $('#stats');
  if (!S.plays){ el.innerHTML = '<div class="empty">No plays in this period.<br>Import a Rhythm backup in <b>Backup</b>, or just play something.</div>'; return; }
  const rows = (obj, nameFn, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map((e, i) => { const nm = nameFn(e[0]); return '<div class="top" style="--i:' + i + '"><span class="n">' + (i + 1) + '</span><div class="rt"><b>' + nm[0] + '</b>' + (nm[1] ? '<span>' + nm[1] + '</span>' : '') + '</div><div class="rc"><b>' + e[1] + '</b> plays</div></div>'; }).join('');
  const bars = []; const dd = new Date(); dd.setDate(dd.getDate() - 29); let mx = 1;
  for (let i = 0; i < 30; i++){ const v = S.daily[dayKey(dd)] || 0; bars.push(v); mx = Math.max(mx, v); dd.setDate(dd.getDate() + 1); }
  const hrs = new Array(24).fill(0); S.hist.forEach(e => { if (period === 'all' || (e.endTimestamp || 0) >= Date.now() - (+period) * 864e5) hrs[new Date(e.startTimestamp).getHours()]++; });
  const hmx = Math.max(1, ...hrs), peak = hrs.indexOf(Math.max(...hrs));
  const cPct = S.plays && period === 'all' ? Math.round(S.extra.length / S.plays * 100) : 0;
  el.innerHTML =
    '<div class="grid"><div class="kpi"><b data-n="' + S.plays + '" data-d="0" data-s="">0</b><span>Plays</span></div><div class="kpi"><b data-n="' + (S.time / 3.6e6) + '" data-d="1" data-s=" h">0</b><span>Listening time</span></div>' +
    '<div class="kpi"><b>' + Object.keys(S.counts).length + '</b><span>Different songs</span></div><div class="kpi"><b>' + streak(S.daily) + ' d</b><span>Streak (all time) · ' + Object.keys(S.daily).length + ' active days</span></div></div>' +
    '<div class="card"><h3>Last 30 days</h3><div class="bars">' + bars.map((v, i) => '<i class="' + (v ? '' : 'z') + '" style="--i:' + i + ';height:' + Math.max(3, Math.round(v / mx * 100)) + '%"></i>').join('') + '</div><div class="axis"><span>30 days ago</span><span>peak ' + mx + '/day</span><span>today</span></div></div>' +
    '<div class="card"><h3>Time of day</h3><div class="bars hr">' + hrs.map((v, i) => '<i class="' + (v ? '' : 'z') + '" style="--i:' + i + ';height:' + Math.max(3, Math.round(v / hmx * 100)) + '%"></i>').join('') + '</div><div class="axis"><span>12 am</span><span>' + (S.hist.length ? 'you listen most around ' + (peak % 12 || 12) + (peak < 12 ? ' am' : ' pm') : '') + '</span><span>11 pm</span></div></div>' +
    (period === 'all' ? '<div class="card"><h3>Where the plays came from</h3><div class="split"><i style="width:' + (100 - cPct) + '%;background:#7c5cff"></i><i style="width:' + cPct + '%;background:var(--ac)"></i></div><div class="note">Rhythm ' + S.basePlays.toLocaleString() + ' · Collied ' + S.extra.length.toLocaleString() + '</div></div>' : '') +
    '<div class="card"><h3>Top songs</h3>' + rows(S.counts, id => { const n = S.names[id] || {}; return [h(n.title || ('Song ' + id)), h(n.artist || '')]; }, 10) + '</div>' +
    '<div class="card"><h3>Top artists</h3>' + rows(S.arts, a => [h(a), ''], 10) + '</div>';
  el.querySelectorAll('b[data-n]').forEach(b => tween(b, +b.dataset.n, +b.dataset.d, b.dataset.s));
}

const lisMs = e => e.listenedMs || Math.min(Math.max(0, (e.endTimestamp || 0) - (e.startTimestamp || 0)), e.durationMs || 9e9);
const clock = ts => { const d = new Date(ts); return ((d.getHours() % 12) || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() < 12 ? ' am' : ' pm'); };
const hm = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' m'; };
function dayLabel(k){ const t = dayKey(Date.now()), y = dayKey(Date.now() - 864e5); const d = new Date(k + 'T12:00:00'); const s = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); return k === t ? 'Today · ' + s : k === y ? 'Yesterday · ' + s : s; }
function shiftDay(n){ const d = new Date(dayPick + 'T12:00:00'); d.setDate(d.getDate() + n); if (d.getTime() > Date.now() + 864e5) return; dayPick = dayKey(d.getTime()); renderStats(); }
function renderDay(){
  if (!dayPick) dayPick = dayKey(Date.now());
  const S = compute('all'), el = $('#stats');
  const ents = S.hist.filter(e => dayKey(e.startTimestamp) === dayPick).sort((a, b) => a.startTimestamp - b.startTimestamp);
  const tot = ents.reduce((a, e) => a + lisMs(e), 0), uniq = new Set(ents.map(e => e.songId)).size;
  const hrs = new Array(24).fill(0); ents.forEach(e => { hrs[new Date(e.startTimestamp).getHours()] += lisMs(e); }); const hmx = Math.max(1, ...hrs);
  const mins = {}; S.hist.forEach(e => { const k = dayKey(e.startTimestamp); mins[k] = (mins[k] || 0) + lisMs(e); });
  let mm = 1; for (let i = 0; i < 14; i++){ const k = dayKey(Date.now() - i * 864e5); mm = Math.max(mm, mins[k] || 0); }
  let strip = ''; for (let i = 13; i >= 0; i--){ const dt = new Date(Date.now() - i * 864e5), k = dayKey(dt.getTime()); strip += '<button data-d="' + k + '" class="' + (k === dayPick ? 'on' : '') + '"><small>' + dt.toLocaleDateString(undefined, { weekday: 'short' }) + '</small><b>' + dt.getDate() + '</b><i style="height:' + Math.max(3, Math.round((mins[k] || 0) / mm * 18)) + 'px' + ((mins[k] || 0) ? '' : ';opacity:.25') + '"></i></button>'; }
  el.innerHTML =
    '<div class="daynav"><button class="rb" id="dprev" aria-label="Previous day">' + IC('left') + '</button><div class="dlabel"><b>' + h(dayLabel(dayPick)) + '</b><label class="dpick">Pick a date<input type="date" id="dinput" value="' + dayPick + '" max="' + dayKey(Date.now()) + '"></label></div><button class="rb" id="dnext" aria-label="Next day"><svg class="i rt180"><use href="#i-left"/></svg></button></div>' +
    '<div class="daystrip" id="dstrip">' + strip + '</div>' +
    '<div class="grid"><div class="kpi"><b>' + (tot ? hm(tot) : '0 min') + '</b><span>Listening time</span></div><div class="kpi"><b>' + ents.length + '</b><span>Plays</span></div>' +
    '<div class="kpi"><b>' + uniq + '</b><span>Different songs</span></div><div class="kpi"><b>' + (ents.length ? clock(ents[0].startTimestamp) : '-') + '</b><span>' + (ents.length ? 'First play · last ' + clock(ents[ents.length - 1].startTimestamp) : 'First play') + '</span></div></div>' +
    (ents.length ? '<div class="card"><h3>Through the day</h3><div class="bars hr">' + hrs.map((v, i) => '<i class="' + (v ? '' : 'z') + '" style="--i:' + i + ';height:' + Math.max(3, Math.round(v / hmx * 100)) + '%"></i>').join('') + '</div><div class="axis"><span>12 am</span><span>12 pm</span><span>11 pm</span></div></div>' +
      '<div class="card"><h3>What you played</h3>' + ents.slice().reverse().slice(0, 300).map((e, i) => { const n = S.names[e.songId] || {}; return '<div class="top dayrow" style="--i:' + Math.min(i, 12) + '"><span class="tm">' + clock(e.startTimestamp) + '</span><div class="rt"><b>' + h(n.title || e.songTitle || ('Song ' + e.songId)) + '</b><span>' + h(n.artist || e.artistName || '') + (e.src === 'collied' ? ' · Collied' : '') + '</span></div><div class="rc">' + fmt(lisMs(e) / 1000) + '</div></div>'; }).join('') + '</div>'
      : '<div class="empty">Nothing was played on this day.</div>');
  $('#dprev').onclick = () => shiftDay(-1); $('#dnext').onclick = () => shiftDay(1);
  $('#dinput').onchange = e => { if (e.target.value){ dayPick = e.target.value; renderStats(); } };
  el.querySelectorAll('#dstrip button').forEach(b => b.onclick = () => { dayPick = b.dataset.d; renderStats(); });
  const act = $('#dstrip .on'); if (act) $('#dstrip').scrollLeft = act.offsetLeft - 120;
}

// ================= recording plays =================
function startSess(t){ sess = { t, start: Date.now(), listened: 0, last: 0 }; }
async function endSess(){
  const s = sess; sess = null; if (!s) return;
  const dur = (s.t.dur || 0) * 1000, need = Math.min(30000, dur ? dur * 0.5 : 30000);
  if (s.listened < need) return;
  local.push({ songId: s.t.sid, songTitle: s.t.title, artistName: s.t.artist, albumName: s.t.album || (known[s.t.sid] && known[s.t.sid].album) || 'Collied', durationMs: dur || Math.round(s.listened), startTimestamp: s.start, endTimestamp: Date.now(), timestamp: Date.now(), listenedMs: Math.round(s.listened), src: 'collied' });
  try { await kvSet('local', local); } catch (e) {}
  if ($('#tab-stats').classList.contains('active')) renderStats();
}
let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  if (sess){ const d = audio.currentTime - sess.last; if (d > 0 && d < 2.5) sess.listened += d * 1000; sess.last = audio.currentTime; }
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  $('#m-fill').style.width = (p * 100) + '%';
  if (!seeking){ $('#f-seek').value = Math.round(p * 1000); $('#f-cur').textContent = fmt(audio.currentTime); }
  $('#f-dur').textContent = fmt(audio.duration);
  lyrTick();
  if (Date.now() - lastSave > 5000 && queue[qi]){ lastSave = Date.now(); kvSet('last', { id: queue[qi].id, pos: audio.currentTime }).catch(() => {}); }
});
audio.addEventListener('ended', () => { endSess().then(() => { if (sleep.end){ sleepOff(); audio.pause(); return; } next(true); }); });
audio.addEventListener('play', syncPlay); audio.addEventListener('pause', syncPlay);
window.addEventListener('pagehide', () => { if (sess) endSess(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && sess && audio.paused) endSess(); });

// ================= soft fade (play / pause / song change) =================
let fadeOn = true; try { fadeOn = localStorage.getItem('collied_fade') !== 'off'; } catch (e) {}
let fadeTok = 0;
const rawPlay = audio.play.bind(audio), rawPause = audio.pause.bind(audio);
function ramp(to, ms){
  const tok = ++fadeTok;
  return new Promise(res => {
    if (!fadeOn || document.hidden || ms <= 0){ audio.volume = to; res(); return; }
    const from = audio.volume, t0 = performance.now();
    (function st(){ if (tok !== fadeTok){ res(); return; } const k = Math.min(1, (performance.now() - t0) / ms); audio.volume = from + (to - from) * k; if (k < 1) setTimeout(st, 16); else res(); })();
  });
}
audio.play = function(){ if (fadeOn && !document.hidden && audio.paused) audio.volume = 0; const p = rawPlay(); ramp(1, 320); return p; };
audio.pause = function(){
  if (audio.paused || !fadeOn || document.hidden){ fadeTok++; rawPause(); audio.volume = 1; return; }
  ramp(0, 240); const my = fadeTok; setTimeout(() => { if (my === fadeTok){ rawPause(); audio.volume = 1; } }, 250);
};

// ================= player =================
async function playIndex(i, seek){
  if (i < 0 || i >= queue.length) return;
  await endSess(); if (!audio.paused && fadeOn && !document.hidden) await ramp(0, 150); qi = i; const t = queue[i]; ab = null; abPaint();
  prefs.speed = rateOf(t); applySpeed();   // this song's saved speed & pitch, or 1x if never set
  const full = await trGet(t.id); if (!full){ toast('File missing'); return; }
  if (curUrl) URL.revokeObjectURL(curUrl);
  curUrl = URL.createObjectURL(full.blob); audio.src = curUrl;
  if (seek) audio.currentTime = seek; else if (starts[t.id] > 0) audio.currentTime = starts[t.id];
  startSess(t);
  try { await audio.play(); } catch (e) { toast('Tap play to start'); }
  paintNow(); setSession(t); markCur(); loadLyrics(false);
}
function playList(list, i){ queue = list.slice(); playIndex(i); }
function next(auto){
  if (!queue.length) return;
  if (auto && repeat === 2){ playIndex(qi); return; }
  let n = shuffle && queue.length > 1 ? (() => { let r; do { r = Math.floor(Math.random() * queue.length); } while (r === qi); return r; })() : qi + 1;
  if (n >= queue.length){ if (repeat === 1 || !auto) n = 0; else { audio.pause(); return; } }
  playIndex(n);
}
function prev(){ if (audio.currentTime > 4){ audio.currentTime = 0; return; } playIndex(qi > 0 ? qi - 1 : queue.length - 1); }
function toggle(){
  if (!audio.src){ if (qi >= 0) playIndex(qi, pendingSeek); else if (tracks.length){ playList(tracks.slice().sort(byTitle), 0); } return; }
  audio.paused ? audio.play() : audio.pause();
}
function syncPlay(){
  const p = audio.paused; $('#m-play').innerHTML = IC(p ? 'play' : 'pause'); $('#f-play').innerHTML = IC(p ? 'play' : 'pause');
  $('#full').classList.toggle('paused', p); document.body.classList.toggle('playing', !p);
  const fp = $('#f-play'); fp.classList.remove('pop'); void fp.offsetWidth; fp.classList.add('pop');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'paused' : 'playing';
}
function paintNow(){
  const t = queue[qi]; if (!t) return;
  $('#mini').hidden = false;
  $('#m-title').textContent = t.title; $('#m-artist').textContent = t.artist;
  $('#f-title').textContent = t.title; $('#f-artist').textContent = t.artist;
  setArt($('#m-art'), t); setArt($('#f-art'), t); paintFav(); syncPlay();
  $('#f-art').classList.remove('swl', 'swr', 'dtap');
  ['#f-art', '#m-art', '#f-title', '#m-title'].forEach(q => { const e = $(q); e.classList.remove('swap'); void e.offsetWidth; e.classList.add('swap'); });
}
function setSession(t){
  if (!('mediaSession' in navigator)) return;
  const md = { title: t.title, artist: t.artist, album: t.album || 'Collied' };
  if (t.art) md.artwork = [{ src: t.art, sizes: '360x360', type: 'image/jpeg' }];
  try { navigator.mediaSession.metadata = new MediaMetadata(md); } catch (e) {}
  const hh = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  try { hh('play', () => audio.play()); hh('pause', () => audio.pause()); hh('previoustrack', prev); hh('nexttrack', () => next(false)); hh('seekto', e => { if (e.seekTime != null) audio.currentTime = e.seekTime; }); } catch (e) {}
}
$('#m-play').onclick = e => { e.stopPropagation(); toggle(); };
$('#m-next').onclick = e => { e.stopPropagation(); next(false); };
$('#mini').onclick = () => openFull();
function closeFull(){ const f = $('#full'); if (f.hidden) return; if (noAnim()){ f.hidden = true; f.style.transform = ''; f.style.opacity = ''; return; } f.classList.remove('dragging'); f.classList.add('closing'); f.style.transform = ''; f.style.opacity = ''; setTimeout(() => { f.hidden = true; f.classList.remove('closing'); }, 280); }
function openFull(){ const f = $('#full'); if (!f.hidden && !f.classList.contains('closing')) return; f.classList.remove('closing', 'dragging'); f.style.transform = ''; f.style.opacity = ''; f.hidden = false; pushUI(closeFull); }
$('#f-close').onclick = () => popUI();
$('#f-play').onclick = toggle; $('#f-next').onclick = () => next(false); $('#f-prev').onclick = prev;
$('#f-shuf').onclick = e => { shuffle = !shuffle; e.currentTarget.classList.toggle('on', shuffle); toast(shuffle ? 'Shuffle on' : 'Shuffle off'); };
$('#f-rep').onclick = e => { repeat = (repeat + 1) % 3; e.currentTarget.classList.toggle('on', repeat > 0); e.currentTarget.innerHTML = IC(repeat === 2 ? 'repeat1' : 'repeat'); toast(['Repeat off', 'Repeat all', 'Repeat one'][repeat]); };
let seeking = false;
$('#f-seek').addEventListener('input', e => { seeking = true; if (audio.duration) $('#f-cur').textContent = fmt(audio.duration * e.target.value / 1000); });
$('#f-seek').addEventListener('change', e => { if (audio.duration) audio.currentTime = audio.duration * e.target.value / 1000; seeking = false; });

// ---- queue ----
function playNext(t){ if (!queue.length){ playList([t], 0); return; } queue.splice(qi + 1, 0, t); toast('Plays next'); }
function addQueue(t){ if (!queue.length){ playList([t], 0); return; } queue.push(t); toast('Added to queue'); }
function queueSheet(){
  sheet((box, close) => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Up next' }));
    const up = queue.slice(qi + 1);
    if (!up.length) box.appendChild(Object.assign(document.createElement('div'), { className: 'note', textContent: 'Nothing queued after this song.' }));
    up.forEach((t, i) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = '<div class="art"></div><div class="rt"><b></b><span></span></div><button class="more" aria-label="Remove">' + IC('close') + '</button>'; setArt($('.art', r), t); $('b', r).textContent = t.title; $('span', r).textContent = t.artist; $('.more', r).onclick = () => { queue.splice(qi + 1 + i, 1); r.remove(); }; $('.rt', r).onclick = () => { close(); setTimeout(() => playIndex(qi + 1 + i), 280); }; box.appendChild(r); });
  });
}
$('#f-q').onclick = queueSheet;

// ---- speed / pitch / sleep ----
const sleep = { t: null, end: false, until: 0, tick: null };
function sleepLabel(){
  if (sleep.end) return 'After this song';
  if (sleep.until){ const s = Math.max(0, Math.round((sleep.until - Date.now()) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' left'; }
  return '';
}
function sleepPaint(){
  const l = sleepLabel(), c = $('#f-sleep'); c.hidden = !l; c.innerHTML = l ? IC('moon') + '<span>' + l + '</span>' : '';
  $('#f-sleepbtn').classList.toggle('on', !!l);
  const st = $('#sl-status'); if (st) st.textContent = l || 'Off';
}
function sleepOff(){ clearTimeout(sleep.t); clearInterval(sleep.tick); sleep.t = sleep.tick = null; sleep.end = false; sleep.until = 0; sleepPaint(); }
function sleepSet(min){
  sleepOff(); if (!min) return;
  if (min === 'end'){ sleep.end = true; sleepPaint(); return; }
  sleep.until = Date.now() + min * 60000;
  sleep.t = setTimeout(() => { audio.pause(); sleepOff(); toast('Sleep timer: paused'); }, min * 60000);
  sleep.tick = setInterval(sleepPaint, 1000); sleepPaint();
}

// Speed and pitch move together (like Argus): playbackRate with preservesPitch off. 0.50x to 3.00x.
const clampR = r => Math.min(3, Math.max(0.5, Math.round(r * 100) / 100));
function applySpeed(){
  audio.defaultPlaybackRate = prefs.speed; audio.playbackRate = prefs.speed;
  try { audio.preservesPitch = false; audio.webkitPreservesPitch = false; audio.mozPreservesPitch = false; } catch (e) {}
  $('#f-tune').classList.toggle('on', prefs.speed !== 1);
}
function setSpeed(v){
  prefs.speed = clampR(v); const t = queue[qi];
  if (t){ if (prefs.speed === 1) delete rates[t.id]; else rates[t.id] = prefs.speed; saveRates(); }   // every song remembers its own speed & pitch
  applySpeed();
}
['loadstart', 'loadedmetadata', 'play'].forEach(ev => audio.addEventListener(ev, applySpeed));
const fmtSp = v => v.toFixed(2) + 'x', fmtSt = v => { const st = 12 * Math.log2(v); return (st > 0.05 ? '+' : '') + (Math.abs(st) < 0.05 ? '0' : st.toFixed(1)) + ' semitones'; };
function tuneSheet(){
  sheet(box => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Speed & pitch' }));
    const card = document.createElement('div'); card.className = 'tcard';
    card.innerHTML =
      '<div class="trow"><span class="tl">' + IC('gauge') + 'Speed &amp; pitch</span><b class="tv" id="sp-v"></b></div>' +
      '<div class="tsub" id="sp-st"></div>' +
      '<div class="stp"><button class="rb" id="sp-m" aria-label="Slower">' + IC('minus') + '</button><input type="range" id="sp-r" min="0.5" max="3" step="0.05"><button class="rb" id="sp-p" aria-label="Faster">' + IC('plus') + '</button></div>' +
      '<div class="pre" id="sp-pre"></div>' +
      '<p class="note">Speed and pitch move together. 0.50x to 3.00x. Each song remembers its own setting.</p>' +
      '<button class="btn" id="tn-reset">Reset to 1.00x</button>';
    box.appendChild(card);
    const q = s => card.querySelector(s);
    [0.65, 0.75, 0.85, 1, 1.25, 1.5, 2].forEach(v => { const b = document.createElement('button'); b.textContent = fmtSp(v).replace('.00x', 'x').replace(/0x$/, 'x'); b.dataset.v = v; b.onclick = () => { setSpeed(v); paint(true); }; q('#sp-pre').appendChild(b); });
    function paint(bump){
      const v = q('#sp-v'); v.textContent = fmtSp(prefs.speed); q('#sp-st').textContent = 'Pitch ' + fmtSt(prefs.speed); q('#sp-r').value = prefs.speed;
      q('#sp-pre').querySelectorAll('button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.v - prefs.speed) < 0.005));
      if (bump){ v.classList.remove('bump'); void v.offsetWidth; v.classList.add('bump'); }
    }
    q('#sp-r').oninput = e => { setSpeed(+e.target.value); paint(true); };
    q('#sp-m').onclick = () => { setSpeed(prefs.speed - 0.05); paint(true); }; q('#sp-p').onclick = () => { setSpeed(prefs.speed + 0.05); paint(true); };
    q('#tn-reset').onclick = () => { setSpeed(1); paint(true); toast('Back to 1.00x'); };
    paint();
  });
}
function sleepSheet(){
  sheet((box, close) => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Sleep timer' }));
    const card = document.createElement('div'); card.className = 'tcard';
    card.innerHTML =
      '<div class="trow"><span class="tl">' + IC('moon') + 'Playback stops in</span><b class="tv" id="sl-status"></b></div>' +
      '<div class="pre" id="sl-pre"></div>' +
      '<div class="pre"><button id="sl-end">After this song</button><button id="sl-off">Turn off</button></div>' +
      '<div class="slcustom"><input id="sl-min" type="number" inputmode="numeric" min="1" max="600" placeholder="Minutes"><button class="btn pri" id="sl-go">Start</button></div>';
    box.appendChild(card);
    const q = s => card.querySelector(s);
    [5, 10, 15, 30, 45, 60, 90].forEach(m => { const b = document.createElement('button'); b.textContent = m + ' min'; b.onclick = () => { sleepSet(m); toast('Sleep in ' + m + ' min'); close(); }; q('#sl-pre').appendChild(b); });
    q('#sl-end').onclick = () => { sleepSet('end'); toast('Sleep after this song'); close(); };
    q('#sl-off').onclick = () => { sleepOff(); toast('Sleep timer off'); close(); };
    q('#sl-go').onclick = () => { const m = Math.round(+q('#sl-min').value); if (!(m >= 1 && m <= 600)){ toast('Enter 1 to 600 minutes'); return; } sleepSet(m); toast('Sleep in ' + m + ' min'); close(); };
    sleepPaint();
  });
}
$('#f-tune').onclick = tuneSheet; $('#f-sleepbtn').onclick = sleepSheet; $('#f-sleep').onclick = sleepSheet;
$('#f-more').onclick = () => sheet(box => {
  const t = queue[qi]; box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'More' }));
  if (!t){ box.appendChild(Object.assign(document.createElement('div'), { className: 'note', textContent: 'Play a song first.' })); return; }
  opt(box, 'Set cover from a photo…', () => pickCover(t), true, { icon: 'image' });
  opt(box, 'Find cover online', () => onlineCover(t, true), true, { icon: 'search' });
  opt(box, 'Search lyrics manually…', () => lyricSearch(t), true, { icon: 'lyrics' });
  opt(box, 'Loop a part (A-B)…', () => setTimeout(loopSheet, 260), true, { icon: 'repeat' });
  const sp = starts[t.id];
  opt(box, sp > 0 ? 'Start point: ' + fmt(sp) + ' (tap to clear)' : 'Start this song from here (' + fmt(audio.currentTime) + ')', async () => { if (sp > 0){ delete starts[t.id]; toast('Start point cleared'); } else { starts[t.id] = Math.round(audio.currentTime * 10) / 10; toast('Will start at ' + fmt(starts[t.id])); } await kvSet('starts', starts).catch(() => {}); }, true, { icon: 'play' });
});
function abPaint(){ $('#f-more').classList.toggle('on', !!(ab && ab.b != null)); }
function loopSheet(){
  sheet(box => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Loop a part' }));
    const card = document.createElement('div'); card.className = 'tcard';
    card.innerHTML = '<div class="trow"><span class="tl">' + IC('repeat') + 'A to B</span><b class="tv" id="ab-v"></b></div><p class="note">Play to the start of your favourite part, tap Set A. At the end of it, tap Set B. That part then repeats until you clear it or change the song.</p><div class="pre"><button id="ab-a">Set A here</button><button id="ab-b">Set B here</button></div><button class="btn" id="ab-c">Clear loop</button>';
    box.appendChild(card); const q = x => card.querySelector(x);
    const paint = () => { q('#ab-v').textContent = ab ? fmt(ab.a) + ' - ' + (ab.b != null ? fmt(ab.b) : '?') : 'Off'; abPaint(); };
    q('#ab-a').onclick = () => { ab = { a: audio.currentTime, b: null }; paint(); toast('A set'); };
    q('#ab-b').onclick = () => { if (!ab){ toast('Set A first'); return; } if (audio.currentTime < ab.a + 0.5){ toast('B must be after A'); return; } ab.b = audio.currentTime; paint(); toast('Looping'); startAB(); };
    q('#ab-c').onclick = () => { ab = null; paint(); toast('Loop cleared'); };
    paint();
  });
}
// the loop is checked every animation frame (accurate), with timeupdate as a fallback when the screen is off
let abRaf = 0;
function abCheck(){ if (ab && ab.b != null && audio.currentTime >= ab.b - 0.02) audio.currentTime = ab.a; }
function startAB(){ if (abRaf) return; const f = () => { abRaf = 0; if (!ab || ab.b == null || audio.paused) return; abCheck(); abRaf = requestAnimationFrame(f); }; abRaf = requestAnimationFrame(f); }
audio.addEventListener('playing', startAB); audio.addEventListener('timeupdate', abCheck);

// ================= favourites & playlists =================
const isFav = t => favs.includes(t.sid);
async function toggleFav(t){ favs = isFav(t) ? favs.filter(x => x !== t.sid) : favs.concat(t.sid); await kvSet('favs', favs); paintFav(); if (view.k === 'favs') renderList(); }
function paintFav(){ const t = queue[qi]; const b = $('#f-fav'); const on = !!t && isFav(t); b.classList.toggle('on', on); }
$('#f-fav').onclick = () => { const t = queue[qi]; if (t) toggleFav(t); };
const savePls = () => kvSet('pls', pls);
async function newPlaylist(then){ const n = await asyncPrompt('New playlist', ''); if (!n || !n.trim()) return; const p = { id: 'p' + Date.now().toString(36), name: n.trim().slice(0, 60), sids: [], src: 'collied' }; pls.push(p); await savePls(); if (then) then(p); renderList(); }
function addToPlaylist(t){
  sheet((box, close) => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Add to playlist' }));
    opt(box, 'New playlist', () => newPlaylist(async p => { p.sids.push(t.sid); await savePls(); toast('Added to ' + p.name); }), true, { icon: 'plus' });
    pls.forEach(p => opt(box, p.name, async () => { if (p.sids.includes(t.sid)) { toast('Already there'); return; } p.sids.push(t.sid); await savePls(); toast('Added to ' + p.name); renderList(); }, true, { icon: 'queue', sel: p.sids.includes(t.sid) }));
  });
}

// ================= covers =================
function refreshArt(t){
  const r = document.querySelector('#list .row[data-id="' + t.id + '"] .art'); if (r) setArt(r, t);
  if (queue[qi] && queue[qi].id === t.id){ paintNow(); setSession(t); }
}
function pickCover(t){
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = async () => { const f = i.files[0]; if (!f) return; const art = await shrinkCover(f, 420); if (!art){ toast('Could not read that image'); return; } t.art = art; await trPatch(t.id, { art }); renderList(); if (queue[qi] && queue[qi].id === t.id){ paintNow(); setSession(t); } toast('Cover saved'); };
  i.click();
}
// returns 1 = found, 0 = nothing found, -1 = network / service error
async function onlineCover(t, loud){
  try {
    const q = encodeURIComponent((t.artist === 'Unknown artist' ? '' : t.artist + ' ') + t.title);
    const rr = await netJson('https://itunes.apple.com/search?media=music&entity=song&limit=3&term=' + q); if (rr.status >= 400 || !rr.json) throw new Error('http ' + rr.status); const j = rr.json;
    const hit = (j.results || []).find(x => x.artworkUrl100); if (!hit){ if (loud) toast('No cover found'); return 0; }
    const url = hit.artworkUrl100.replace('100x100bb', '600x600bb');
    const art = await shrinkCover(await netBlob(url), 420);
    if (!art){ if (loud) toast('Could not download the cover'); return 0; }
    t.art = art; await trPatch(t.id, { art }); refreshArt(t); if (loud) toast('Cover found'); return 1;
  } catch (e) { if (loud) toast('Cover search needs internet'); return -1; }
}

// ================= network (native app uses Android's own HTTP, so CORS can never block covers or lyrics) =================
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
let HTTP = null; try { if (NATIVE) HTTP = (Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp) || (Capacitor.registerPlugin ? Capacitor.registerPlugin('CapacitorHttp') : null); } catch (e) { HTTP = null; }
async function netJson(url){
  if (HTTP){ try { const r = await HTTP.request({ url, method: 'GET', responseType: 'json', headers: { Accept: 'application/json' } }); let d = r.data; if (typeof d === 'string'){ try { d = JSON.parse(d); } catch (e) {} } return { status: r.status, json: d }; } catch (e) {} }
  const r = await fetch(url); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, json: j };
}
async function netBlob(url){
  if (HTTP){ try { const r = await HTTP.request({ url, method: 'GET', responseType: 'blob' }); if (r.status < 400 && r.data){ const bin = atob(r.data), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const h = r.headers || {}; return new Blob([u], { type: h['Content-Type'] || h['content-type'] || 'image/jpeg' }); } } catch (e) {} }
  const r = await fetch(url); if (!r.ok) throw new Error('img'); return r.blob();
}

// ================= lyrics (lrclib) =================
const LR = 'https://lrclib.net/api/';
let lyr = null, lyrIdx = -1, lyrShown = false, lyrScrollHold = 0;
function parseLrc(s){
  const out = [];
  String(s || '').split(/\r?\n/).forEach(line => {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)]; if (!tags.length) return;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    tags.forEach(m => out.push({ t: (+m[1]) * 60 + parseFloat(m[2].replace(':', '.')), text }));
  });
  return out.sort((a, b) => a.t - b.t);
}
const cleanTitle = s => String(s || '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft)\.?\s.*$/i, '').replace(/\b(slowed|reverb|sped up|remastered|official|lyrics|audio|video)\b/gi, ' ').replace(/\s+/g, ' ').trim();
async function lrGet(url){ const r = await netJson(url); if (r.status === 404) return null; if (r.status >= 400 || r.json == null) throw new Error('http ' + r.status); return r.json; }
async function lrFind(t){
  const art = t.artist === 'Unknown artist' ? '' : t.artist, dur = Math.round(t.dur || 0);
  const tries = [];
  [t.title, cleanTitle(t.title)].forEach((nm, i) => { if (!nm || (i && nm === t.title)) return; tries.push(LR + 'get?track_name=' + encodeURIComponent(nm) + '&artist_name=' + encodeURIComponent(art) + (t.album ? '&album_name=' + encodeURIComponent(t.album) : '') + (dur ? '&duration=' + dur : '')); });
  for (const u of tries){ const j = await lrGet(u); if (j && (j.syncedLyrics || j.plainLyrics || j.instrumental)) return j; }
  const qs = (cleanTitle(t.title) + ' ' + art).trim();
  const arr = await lrGet(LR + 'search?q=' + encodeURIComponent(qs));
  if (arr && arr.length){
    const sc = x => (x.syncedLyrics ? 100 : 0) - (dur && x.duration ? Math.min(60, Math.abs(x.duration - dur)) : 0) + (norm(x.trackName) === norm(cleanTitle(t.title)) ? 30 : 0);
    const best = arr.slice().sort((a, b) => sc(b) - sc(a))[0]; if (best && (best.syncedLyrics || best.plainLyrics)) return best;
  }
  return null;
}
const lyrStore = (j, src) => ({ at: Date.now(), synced: j && j.syncedLyrics || '', plain: j && j.plainLyrics || '', inst: !!(j && j.instrumental), name: j ? (j.trackName + ' - ' + j.artistName) : '', off: 0, src: src || 'lrclib' });
function textLyr(text, t, src){ const s = String(text || '').trim(), sync = /\[\d+:\d+(?:[.:]\d+)?\]/.test(s); return lyrStore({ syncedLyrics: sync ? s : '', plainLyrics: sync ? '' : s, trackName: t.title, artistName: src === 'lrc' ? 'lrc file' : 'song file' }, src || 'file'); }
function lyrReady(t){ if (lyrShown && queue[qi] && queue[qi].id === t.id) loadLyrics(false); }
async function loadLyrics(force){
  const t = queue[qi]; lyr = null; lyrIdx = -1; if (!t){ return; }
  let c = await kvGet('lyr:' + t.id);
  if (c && !force && (c.synced || c.plain || c.inst || Date.now() - c.at < 7 * 864e5)){ lyr = prep(c, t); drawLyrics(); return; }
  if (!lyrShown && !force) { lyr = null; return; }   // fetch only when the lyrics view is open
  lyr = { loading: true, id: t.id }; drawLyrics();
  try { const j = await lrFind(t); c = lyrStore(j); await kvSet('lyr:' + t.id, c); if (queue[qi] && queue[qi].id === t.id){ lyr = prep(c, t); drawLyrics(); } }
  catch (e) { console.warn('lyrics', e); if (queue[qi] && queue[qi].id === t.id){ lyr = { err: 1, id: t.id }; drawLyrics(); } }
}
function prep(c, t){ return { id: t.id, c, lines: c.synced ? parseLrc(c.synced) : [] }; }
function drawLyrics(){
  const el = $('#lyr'); el.innerHTML = ''; el.classList.remove('plain'); lyrIdx = -1;
  const st = (m) => { const d = document.createElement('div'); d.className = 'st'; d.textContent = m; el.appendChild(d); };
  if (!lyr) { st('Loading…'); return; }
  if (lyr.loading) { st('Searching lrclib…'); return; }
  if (lyr.err) { st('Could not reach lrclib.\nCheck your internet and tap Lyrics again.'); return; }
  const c = lyr.c;
  if (c.inst) { st('Instrumental'); return; }
  if (lyr.lines.length){
    lyr.lines.forEach((l, i) => { const p = document.createElement('p'); if (l.text) p.textContent = l.text; else { p.innerHTML = IC('music'); p.className = 'gap'; } p.onclick = () => { audio.currentTime = Math.max(0, l.t - (c.off || 0)); }; el.appendChild(p); });
    const adj = document.createElement('div'); adj.className = 'st'; adj.innerHTML = '<button class="btn lo-m">−0.5 s</button><button class="btn lo-p">+0.5 s</button><button class="btn lo-r">Re-fetch</button>';
    el.appendChild(adj);
    $('.lo-m', el).onclick = () => shiftLyr(-0.5); $('.lo-p', el).onclick = () => shiftLyr(0.5); $('.lo-r', el).onclick = () => loadLyrics(true);
    lyrTick(true); return;
  }
  if (c.plain){ el.classList.add('plain'); c.plain.split(/\r?\n/).forEach(l => { const p = document.createElement('p'); p.textContent = l || ' '; el.appendChild(p); }); return; }
  st('No lyrics found for this song.\nUse More, then "Search lyrics manually…"');
}
async function shiftLyr(d){ if (!lyr || !lyr.c) return; lyr.c.off = Math.round(((lyr.c.off || 0) + d) * 10) / 10; await kvSet('lyr:' + lyr.id, lyr.c); toast('Lyrics offset ' + lyr.c.off + ' s'); lyrTick(true); }
function lyrTick(force){
  if (!lyrShown || !lyr || !lyr.lines || !lyr.lines.length) return;
  const tm = audio.currentTime + (lyr.c.off || 0) + 0.15; let i = -1;
  for (let k = 0; k < lyr.lines.length; k++){ if (lyr.lines[k].t <= tm) i = k; else break; }
  if (i === lyrIdx && !force) return; lyrIdx = i;
  const ps = $('#lyr').querySelectorAll('p');
  ps.forEach((p, k) => { p.classList.toggle('on', k === i); p.classList.toggle('past', k < i); });
  if (i >= 0 && ps[i] && Date.now() - lyrScrollHold > 3000){ const box = $('#lyr'); box.scrollTo({ top: ps[i].offsetTop - box.clientHeight / 2 + ps[i].clientHeight / 2, behavior: document.documentElement.classList.contains('noanim') ? 'auto' : 'smooth' }); }
}
$('#lyr').addEventListener('touchstart', () => { lyrScrollHold = Date.now(); }, { passive: true });
$('#lyr').addEventListener('wheel', () => { lyrScrollHold = Date.now(); }, { passive: true });
$('#f-lyr').onclick = () => {
  lyrShown = !lyrShown; $('#lyr').hidden = !lyrShown; $('#f-art').style.visibility = lyrShown ? 'hidden' : ''; $('#f-lyr').classList.toggle('on', lyrShown);
  if (lyrShown){ if (!lyr || lyr.id !== (queue[qi] && queue[qi].id)) { lyr = null; drawLyrics(); } loadLyrics(false); setTimeout(() => lyrTick(true), 60); }
};
function lyricSearch(t){
  sheet((box, close) => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Search lyrics' }));
    const i = document.createElement('input'); i.type = 'text'; i.value = cleanTitle(t.title) + (t.artist === 'Unknown artist' ? '' : ' ' + t.artist); box.appendChild(i);
    const go = document.createElement('button'); go.className = 'btn pri'; go.textContent = 'Search'; box.appendChild(go);
    const res = document.createElement('div'); box.appendChild(res);
    go.onclick = async () => {
      res.innerHTML = '<div class="note">Searching…</div>';
      try {
        const arr = await lrGet(LR + 'search?q=' + encodeURIComponent(i.value)); res.innerHTML = '';
        if (!arr || !arr.length){ res.innerHTML = '<div class="note">Nothing found.</div>'; return; }
        arr.slice(0, 12).forEach(x => { const b = document.createElement('button'); b.className = 'opt'; b.textContent = x.trackName + ' — ' + x.artistName + ' · ' + fmt(x.duration) + (x.syncedLyrics ? ' · synced' : x.plainLyrics ? ' · text only' : ''); b.onclick = async () => { await kvSet('lyr:' + t.id, lyrStore(x)); close(); setTimeout(() => { if (queue[qi] && queue[qi].id === t.id){ loadLyrics(false); if (!lyrShown) $('#f-lyr').click(); } toast('Lyrics saved'); }, 300); }; res.appendChild(b); });
      } catch (e) { res.innerHTML = '<div class="note">Could not reach lrclib. Check your internet.</div>'; }
    };
  });
}
// ================= auto covers & lyrics (local first, then online) =================
let autoBusy = false, autoStop = false;
const WEEK = 7 * 864e5, nap = ms => new Promise(r => setTimeout(r, ms));
const hasLy = c => !!(c && (c.synced || c.plain || c.inst));
async function autoFill(manual){
  if (autoBusy){ if (manual){ autoStop = true; $('#lyrinfo').textContent = 'Stopping…'; } return; }
  autoBusy = true; autoStop = false;
  const btn = $('#getall'), pg = $('#lyrinfo'), say = m => { pg.textContent = m; };
  btn.textContent = 'Stop';
  let cLoc = 0, lLoc = 0, cNet = 0, lNet = 0, stopped = '';
  try {
    // 1) on this phone: cover + lyrics stored inside each song file (once per song). Saved lyrics are read from the phone when needed.
    const scan = tracks.filter(t => auto.scan[t.id] !== 2);
    for (let i = 0; i < scan.length && !autoStop; i++){
      const t = scan[i]; say('Checking song files: ' + (i + 1) + ' / ' + scan.length);
      const rec = await trGet(t.id);
      if (rec && rec.blob){
        const m = await readMeta(rec.blob);
        if (!t.art && m.pic){ const a = await shrinkCover(m.pic, 420); if (a){ t.art = a; await trPatch(t.id, { art: a }); cLoc++; refreshArt(t); } }
        if (m.lyrics && !hasLy(await kvGet('lyr:' + t.id))){ await kvSet('lyr:' + t.id, textLyr(m.lyrics, t)); lLoc++; lyrReady(t); }
      }
      auto.scan[t.id] = 2; if (i % 10 === 9) await saveAuto();
      if (i % 4 === 3) await nap(15);
    }
    await saveAuto();
    // 2) online, only for what is still missing
    if (!autoStop){
      if (!navigator.onLine) stopped = 'Offline: online lookup skipped.';
      else {
        const now = Date.now(), todo = [];
        for (const t of tracks){
          const c = await kvGet('lyr:' + t.id);
          const needC = !t.art && (manual || !auto.art[t.id] || now - auto.art[t.id] > WEEK);
          const needL = !hasLy(c) && (manual || !c || now - c.at > WEEK);
          if (needC || needL) todo.push({ t, needC, needL });
        }
        let errs = 0;
        for (let i = 0; i < todo.length && !autoStop; i++){
          const { t, needC, needL } = todo[i]; say('Looking online: ' + (i + 1) + ' / ' + todo.length + ' (' + cNet + ' covers, ' + lNet + ' lyrics found)');
          if (needC){
            const r = await onlineCover(t, false);
            if (r === 1){ cNet++; errs = 0; } else if (r === 0){ auto.art[t.id] = Date.now(); errs = 0; } else if (++errs > 3){ stopped = 'Stopped: no internet connection.'; break; }
            await nap(3000);   // iTunes allows about 20 searches a minute
          }
          if (needL && !autoStop){
            try { const j = await lrFind(t); await kvSet('lyr:' + t.id, lyrStore(j)); if (j && (j.syncedLyrics || j.plainLyrics)){ lNet++; lyrReady(t); } errs = 0; }
            catch (e) { if (++errs > 3){ stopped = 'Stopped: lrclib is not reachable.'; break; } }
            await nap(400);
          }
        }
        await saveAuto();
      }
    }
    const miss = tracks.filter(t => !t.art).length;
    say((autoStop ? 'Stopped. ' : stopped ? stopped + ' ' : 'Done. ') + 'Covers: ' + cLoc + ' from song files, ' + cNet + ' online. Lyrics: ' + lLoc + ' from song files, ' + lNet + ' online.' + (miss ? ' ' + miss + ' songs still have no cover.' : ''));
    if (manual) toast(autoStop ? 'Stopped' : 'Covers & lyrics updated');
  } catch (e) { console.warn('autoFill', e); say('Something went wrong: ' + e.message); }
  finally { autoBusy = false; autoStop = false; btn.textContent = 'Find covers & lyrics now'; }
}
$('#getall').onclick = () => autoFill(true);
$('#lrcfiles').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  let ok = 0, miss = 0;
  for (const f of files){
    const key = norm(f.name), p = parseName(f.name);
    const t = tracks.find(x => norm(x.name) === key) || tracks.find(x => norm(x.title) === norm(p.title));
    if (!t){ miss++; continue; }
    const txt = await f.text(); if (!txt.trim()){ miss++; continue; }
    await kvSet('lyr:' + t.id, textLyr(txt, t, 'lrc')); ok++; lyrReady(t);
  }
  $('#lyrinfo').textContent = 'Lyric files: ' + ok + ' matched' + (miss ? ', ' + miss + ' not matched (the file name must match the song file name).' : '.');
  toast(ok + ' lyric files saved');
});

// ================= library UI =================
function rowEl(t, list, i){
  const r = document.createElement('div'); r.className = 'row'; r.dataset.id = t.id; r.style.setProperty('--i', Math.min(i, 14));
  r.innerHTML = '<div class="art"></div><div class="rt"><b></b><span></span></div><div class="rc"></div><button class="more" aria-label="Options">' + IC('more') + '</button>';
  setArt($('.art', r), t); $('b', r).textContent = t.title; $('span', r).textContent = t.artist;
  const S = counts(); const c = S[t.sid] || 0;
  $('.rc', r).innerHTML = (isFav(t) ? '<span class="heart">' + IC('heart') + '</span> ' : '') + fmt(t.dur) + (c ? '<br>' + c + 'x' : '');
  r.insertAdjacentHTML('beforeend', '<div class="eq"><i></i><i></i><i></i></div>');
  r.onclick = e => { if (e.target.closest('.more')) return; playList(list, i); };
  $('.more', r).onclick = e => { e.stopPropagation(); songMenu(t); };
  return r;
}
let cCache = null, cStamp = 0;
function counts(){ if (cCache && Date.now() - cStamp < 1500) return cCache; cCache = compute('all').counts; cStamp = Date.now(); return cCache; }
function songMenu(t){
  sheet((box) => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: t.title }));
    opt(box, 'Play next', () => playNext(t)); opt(box, 'Add to queue', () => addQueue(t));
    opt(box, isFav(t) ? 'Remove from favourites' : 'Add to favourites', () => toggleFav(t).then(renderList));
    opt(box, 'Add to playlist…', () => addToPlaylist(t));
    if (view.k === 'pl'){ opt(box, 'Remove from this playlist', async () => { const p = pls.find(x => x.id === view.id); if (p){ p.sids = p.sids.filter(s => s !== t.sid); await savePls(); renderList(); } }); }
    opt(box, 'Edit title & artist…', async () => { const a = await asyncPrompt('Title', t.title); if (a === null) return; const b = await asyncPrompt('Artist', t.artist); if (b === null) return; t.title = a.trim() || t.title; t.artist = b.trim() || t.artist; t.edited = 1; await trPatch(t.id, { title: t.title, artist: t.artist, edited: 1 }); renderList(); });
    opt(box, 'Set cover from a photo…', () => pickCover(t)); opt(box, 'Find cover online', () => onlineCover(t, true));
    opt(box, 'Remove from Collied', async () => { if (!confirm('Remove "' + t.title + '" from Collied? (Your stats stay.)')) return; await trDel(t.id); await kvDel('lyr:' + t.id); delete rates[t.id]; delete starts[t.id]; kvSet('starts', starts).catch(() => {}); saveRates(); tracks = tracks.filter(x => x.id !== t.id); queue = queue.filter(x => x.id !== t.id); renderList(); });
  });
}
function setSub(sub, title){ $('#back').hidden = !sub; $('#title').textContent = title; }
function renderList(){
  const el = $('#list'), q = norm($('#q').value), sa = $('#subact'), emp = $('#empty');
  sa.hidden = true; sa.innerHTML = ''; emp.hidden = true; el.innerHTML = '';
  $('#libbar').hidden = !(view.k === 'songs' || view.k === 'favs' || view.k === 'artist' || view.k === 'pl');
  document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', b.dataset.v === (view.k === 'pl' ? 'pls' : view.k === 'artist' ? 'artists' : view.k)));
  $('#chips').hidden = view.k === 'pl' || view.k === 'artist';
  const filt = list => list.filter(t => !q || norm(t.title + t.artist + t.name).includes(q));
  const songs = list => { const arr = filt(list); arr.forEach((t, i) => el.appendChild(rowEl(t, arr, i))); markCur(); return arr; };
  if (view.k === 'songs'){
    setSub(false, 'Library');
    if (!tracks.length){ emp.hidden = false; emp.innerHTML = 'No songs yet.<br>Tap <b>Add songs</b> and pick files from your phone.'; return; }
    songs(tracks.slice().sort(byTitle));
  } else if (view.k === 'favs'){
    setSub(false, 'Library'); const l = favs.map(trBySid).filter(Boolean);
    if (!l.length){ emp.hidden = false; emp.innerHTML = 'No favourites yet.<br>Open a song\'s menu and choose <b>Add to favourites</b>.'; return; }
    songs(l);
  } else if (view.k === 'pls'){
    setSub(false, 'Library');
    const b = document.createElement('button'); b.className = 'btn pri'; b.innerHTML = IC('plus') + 'New playlist'; b.onclick = () => newPlaylist(); sa.hidden = false; sa.appendChild(b);
    if (!pls.length){ emp.hidden = false; emp.innerHTML = 'No playlists yet.<br>Import a Rhythm backup to bring yours in, or create one.'; }
    pls.forEach((p, i) => { const have = p.sids.filter(s => trBySid(s)).length; const r = document.createElement('div'); r.className = 'row'; r.style.setProperty('--i', Math.min(i, 14)); r.innerHTML = '<div class="art">' + IC('music') + '</div><div class="rt"><b></b><span></span></div><button class="more" aria-label="Options">' + IC('more') + '</button>'; $('b', r).textContent = p.name; $('span', r).textContent = have + ' of ' + p.sids.length + ' songs on this phone' + (p.src === 'rhythm' ? ' · from Rhythm' : '');
      const first = p.sids.map(trBySid).find(t => t && t.art); if (first) setArt($('.art', r), first);
      r.onclick = e => { if (e.target.closest('.more')) return; openSub({ k: 'pl', id: p.id }); };
      $('.more', r).onclick = e => { e.stopPropagation(); plMenu(p); }; el.appendChild(r); });
  } else if (view.k === 'artists'){
    setSub(false, 'Library'); const m = {}; tracks.forEach(t => { (m[t.artist] = m[t.artist] || []).push(t); });
    const names = Object.keys(m).sort((a, b) => a.localeCompare(b)).filter(n => !q || norm(n).includes(q));
    if (!names.length){ emp.hidden = false; emp.textContent = 'No artists yet.'; }
    names.forEach((n, i) => { const r = document.createElement('div'); r.className = 'row'; r.style.setProperty('--i', Math.min(i, 14)); r.innerHTML = '<div class="art"></div><div class="rt"><b></b><span></span></div>'; setArt($('.art', r), m[n].find(t => t.art) || { title: n }); $('b', r).textContent = n; $('span', r).textContent = m[n].length + ' songs'; r.onclick = () => openSub({ k: 'artist', name: n }); el.appendChild(r); });
    $('#libbar').hidden = false; $('#addfiles').parentElement.style.display = 'none';
  } else if (view.k === 'pl'){
    const p = pls.find(x => x.id === view.id); if (!p){ view = { k: 'pls' }; return renderList(); }
    setSub(true, p.name); const l = p.sids.map(trBySid).filter(Boolean);
    const play = document.createElement('button'); play.className = 'btn pri'; play.innerHTML = IC('play') + 'Play'; play.onclick = () => l.length && playList(l, 0);
    const sh = document.createElement('button'); sh.className = 'btn'; sh.innerHTML = IC('shuffle') + 'Shuffle'; sh.onclick = () => { if (!l.length) return; shuffle = true; $('#f-shuf').classList.add('on'); playList(l, Math.floor(Math.random() * l.length)); };
    sa.hidden = false; sa.appendChild(play); sa.appendChild(sh);
    if (!l.length){ emp.hidden = false; emp.textContent = 'None of this playlist\'s songs are on this phone yet.'; } else songs(l);
  } else if (view.k === 'artist'){
    setSub(true, view.name); songs(tracks.filter(t => t.artist === view.name).sort(byTitle));
  }
  if (view.k !== 'artists') $('#addfiles').parentElement.style.display = '';
}
function openSub(v){ const prev = view; view = v; pushUI(() => { view = prev; renderList(); }); renderList(); window.scrollTo(0, 0); }
$('#back').onclick = () => popUI();
function plMenu(p){
  sheet(box => {
    box.appendChild(Object.assign(document.createElement('h3'), { textContent: p.name }));
    opt(box, 'Rename…', async () => { const n = await asyncPrompt('Rename playlist', p.name); if (n && n.trim()){ p.name = n.trim().slice(0, 60); await savePls(); renderList(); } });
    opt(box, 'Delete playlist', async () => { if (!confirm('Delete "' + p.name + '"? Songs stay in your library.')) return; pls = pls.filter(x => x !== p); await savePls(); renderList(); });
  });
}
function markCur(){ const t = queue[qi]; document.querySelectorAll('#list .row[data-id]').forEach(r => r.classList.toggle('cur', !!t && r.dataset.id === t.id)); }
$('#q').addEventListener('input', renderList);
document.querySelectorAll('#chips button').forEach(b => b.onclick = () => { view = { k: b.dataset.v }; $('#q').value = ''; renderList(); });
document.querySelectorAll('#pchips button').forEach(b => b.onclick = () => { period = b.dataset.p; document.querySelectorAll('#pchips button').forEach(x => x.classList.toggle('on', x === b)); renderStats(); });

// ================= adding songs =================
function probe(file){
  return new Promise(res => { const u = URL.createObjectURL(file), a = new Audio(); let done = false; const fin = d => { if (done) return; done = true; URL.revokeObjectURL(u); res(d); };
    a.preload = 'metadata'; a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0); a.onerror = () => fin(0); setTimeout(() => fin(0), 5000); a.src = u; });
}
$('#addfiles').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  const pg = $('#prog'); pg.hidden = false; let added = 0, matched = 0, covers = 0;
  for (let i = 0; i < files.length; i++){
    const f = files[i]; pg.textContent = 'Adding ' + (i + 1) + ' / ' + files.length + '…';
    const id = hid(f.name + '|' + f.size); if (tracks.some(t => t.id === id)) continue;
    const p = parseName(f.name), dur = await probe(f), m = await readMeta(f);
    const t = { id, name: f.name, title: (m.title || p.title), artist: (m.artist || p.artist), album: m.album || '', dur, sid: '', art: '' };
    if (m.pic){ t.art = await shrinkCover(m.pic, 420); if (t.art) covers++; }
    t.sid = matchSid(t); const k = known[t.sid]; if (k){ if (k.title) t.title = k.title; if (k.artist) t.artist = k.artist; if (k.album && !t.album) t.album = k.album; matched++; }
    try { await trPut(Object.assign({ blob: f }, t)); tracks.push(t); added++; auto.scan[id] = 2; if (m.lyrics) await kvSet('lyr:' + id, textLyr(m.lyrics, t)); } catch (err) { toast('Storage full or blocked: ' + f.name); break; }
  }
  await saveAuto(); pg.hidden = true; renderList(); toast('Added ' + added + (covers ? ' · ' + covers + ' covers' : '') + (matched ? ' · ' + matched + ' matched with Rhythm' : ''));
  if (prefs.auto) autoFill(false);
});

// ================= backup import / export =================
async function importBackup(file){
  let j; try { j = JSON.parse(await file.text()); } catch (e) { toast('That file is not valid JSON.'); return; }
  if (!j || !j.stats_rhythm_guard_data || j.playback_history == null){ toast('This is not a Rhythm backup.'); return; }
  backup = j; await kvSet('backup', j); await absorb(j); buildKnown();
  const n = await rematch();
  // playlists + favourites from Rhythm (Rhythm playlists are replaced, Collied ones stay)
  const rp = pj(j.playlists_data, []).map(p => ({ id: 'r' + p.id, name: p.name || 'Playlist', sids: (p.songs || []).map(s => String(s.id)), src: 'rhythm' }));
  pls = pls.filter(p => p.src !== 'rhythm').concat(rp); await savePls();
  const rf = pj(j.favorite_songs_data, []).map(String); favs = Array.from(new Set(favs.concat(rf))); await kvSet('favs', favs);
  renderList(); renderStats(); info(); toast('Imported: ' + n + ' songs matched · ' + rp.length + ' playlists · ' + rf.length + ' favourites');
}
function info(){
  const el = $('#impinfo'); if (!backup){ el.textContent = 'No backup imported yet.'; return; }
  const H = histData();
  el.textContent = 'Rhythm backup from ' + new Date(backup.timestamp).toLocaleString() + ' · ' + (+backup.stats_rhythm_guard_data.songs_played || 0).toLocaleString() + ' plays · Collied added ' + H.extra.length + ' · ' + tracks.filter(t => !t.sid.startsWith('c')).length + '/' + tracks.length + ' songs matched.';
}
$('#impfile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); });
function exportBackup(){
  if (!backup){ toast('Import a Rhythm backup first.'); return; }
  const S = compute('all'), out = JSON.parse(JSON.stringify(backup)), bh = S.bh.slice();
  S.extra.forEach(e => bh.push({ albumName: e.albumName, artistName: e.artistName, durationMs: e.durationMs, endTimestamp: e.endTimestamp, songId: e.songId, songTitle: e.songTitle, startTimestamp: e.startTimestamp, timestamp: e.timestamp }));
  out.playback_history = JSON.stringify(bh);
  const last = bh.reduce((m, x) => Math.max(m, x.endTimestamp || 0), 0);
  const o = out.stats_rhythm_guard_data;
  if (o){ o.songs_played = S.plays; o.listening_time = Math.round(S.time); o.song_play_counts = JSON.stringify(S.counts); o.daily_listening_stats = JSON.stringify(S.daily); o.weekly_top_artists = JSON.stringify(S.arts); if (last) o.last_played_timestamp = last; }
  out.favorite_songs_data = JSON.stringify(Array.from(new Set(pj(backup.favorite_songs_data, []).map(String).concat(favs.filter(x => !x.startsWith('c'))))));
  out.timestamp = Date.now();
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  const d = new Date(); a.download = 'rhythm_backup_collied_' + dayKey(d).replace(/-/g, '') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.json';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('Exported with ' + S.extra.length + ' Collied plays.');
}
$('#expbtn').onclick = exportBackup;
$('#rematch').onclick = async () => { const n = await rematch(); renderList(); info(); toast(n + ' songs matched.'); };
$('#clearlib').onclick = async () => { if (!confirm('Remove all songs from Collied? Stats, playlists and favourites stay.')) return; await trClear(); tracks = []; queue = []; qi = -1; audio.pause(); audio.removeAttribute('src'); $('#mini').hidden = true; renderList(); };
$('#clearstats').onclick = async () => { if (!confirm('Delete every play recorded in Collied? Imported Rhythm stats stay.')) return; local = []; await kvSet('local', local); renderStats(); renderList(); info(); };
$('#autosw').onchange = e => { prefs.auto = e.target.checked; savePrefs(); if (prefs.auto) autoFill(false); };
let deferredInstall = null;
function paintInstall(){
  const info = $('#instinfo'), b = $('#instbtn'), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  b.hidden = !deferredInstall;
  if (standalone) info.textContent = 'Collied is running as an installed app.';
  else if (deferredInstall) info.textContent = 'Ready: tap Install to add Collied to your home screen.';
  else if (!window.isSecureContext) info.textContent = 'Chrome only installs apps opened from https:// or localhost. Open this page from localhost (not a file:// address).';
  else info.textContent = 'Chrome has not offered the install yet. Open the Chrome menu (three dots) and look for Install app or Add to Home screen. If it is missing, an older app on the same localhost address may already be installed: remove it, close Chrome fully, then open this page again.';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; paintInstall(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; paintInstall(); toast('Collied installed'); });
$('#instbtn').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) {} deferredInstall = null; paintInstall(); };
$('#animsw').onchange = e => { document.documentElement.classList.toggle('noanim', !e.target.checked); try { localStorage.setItem('collied_anim', e.target.checked ? 'on' : 'off'); } catch (x) {} };

// ================= tabs + boot =================
const titles = { 'tab-lib': 'Library', 'tab-stats': 'Stats', 'tab-set': 'Backup' };
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === b.dataset.t));
  $('#back').hidden = true; $('#title').textContent = titles[b.dataset.t];
  if (b.dataset.t === 'tab-lib') renderList(); if (b.dataset.t === 'tab-stats') renderStats(); if (b.dataset.t === 'tab-set') info();
  window.scrollTo(0, 0);
});
(async function(){
  $('#ver').textContent = 'Collied ' + VERSION + ' · personal use · everything stays on this phone.';
  $('#animsw').checked = !document.documentElement.classList.contains('noanim');
  try {
    backup = (await kvGet('backup')) || null; master = (await kvGet('master')) || null; if (!master && backup) await absorb(backup); local = (await kvGet('local')) || []; pls = (await kvGet('pls')) || []; favs = (await kvGet('favs')) || [];
    prefs = Object.assign(prefs, (await kvGet('prefs')) || {}); auto = Object.assign({ scan: {}, art: {} }, (await kvGet('auto')) || {}); rates = (await kvGet('rates')) || {}; starts = (await kvGet('starts')) || {};
    buildKnown(); tracks = (await trAll()).map(t => { delete t.blob; return t; });
    const last = await kvGet('last'); if (last){ const t = tracks.find(x => x.id === last.id); if (t){ queue = tracks.slice().sort(byTitle); qi = queue.indexOf(t); pendingSeek = last.pos || 0; paintNow(); } }
  } catch (e) { toast('Storage unavailable'); }
  $('#autosw').checked = !!prefs.auto; prefs.speed = rateOf(queue[qi]); applySpeed(); paintInstall(); renderList(); info();
  if (prefs.auto) setTimeout(() => autoFill(false), 2500);
  window.addEventListener('online', () => { if (prefs.auto) autoFill(false); });
  const isApp = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  if (isApp && 'serviceWorker' in navigator){   // inside the APK every file is bundled, so an old cached copy must never win over it
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
  } else if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__collied = { audio, next, get tracks(){ return tracks; }, compute, get local(){ return local; }, get pls(){ return pls; }, get favs(){ return favs; }, get lyr(){ return lyr; }, parseLrc, playList, onlineCover };
})();


/* ================= v1.4: touch gestures + polish ================= */
(function(){
  const full = $('#full'), mini = $('#mini'), stage = $('.f-stage'), lyrEl = $('#lyr');
  // lyrics view fades in over the cover instead of switching instantly
  lyrEl.hidden = false;
  $('#f-lyr').onclick = () => {
    lyrShown = !lyrShown; full.classList.toggle('lyr-on', lyrShown); $('#f-lyr').classList.toggle('on', lyrShown);
    if (lyrShown){ if (!lyr || lyr.id !== (queue[qi] && queue[qi].id)){ lyr = null; drawLyrics(); } loadLyrics(false); setTimeout(() => lyrTick(true), 60); }
  };
  // taps on lyric lines no longer jump; a long press does (so a tap can close the lyrics)
  lyrEl.addEventListener('click', e => { if (e.target.closest('.st button')) return; e.stopPropagation(); e.preventDefault(); }, true);

  // ---- cover / lyrics area: 1 tap = lyrics on/off, 2 taps = play/pause, swipe left/right = next/previous ----
  let tap = null, taps = 0, tapT = null, lp = null, lpFired = false;
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.st button')) return;
    tap = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, moved: false }; lpFired = false;
    const p = e.target.closest('#lyr p');
    clearTimeout(lp); if (p && lyr && lyr.lines && lyr.lines.length){ lp = setTimeout(() => { if (tap && !tap.moved){ const i = [...lyrEl.querySelectorAll('p')].indexOf(p); const l = lyr.lines[i]; if (l){ lpFired = true; audio.currentTime = Math.max(0, l.t - (lyr.c.off || 0)); if (navigator.vibrate) navigator.vibrate(12); toast('Jumped to this line'); } } }, 700); }
  });
  stage.addEventListener('pointermove', e => { if (tap && (Math.abs(e.clientX - tap.x) > 10 || Math.abs(e.clientY - tap.y) > 10)){ tap.moved = true; clearTimeout(lp); } });
  const endTap = e => {
    clearTimeout(lp); const t0 = tap; tap = null; if (!t0) return;
    const dx = e.clientX - t0.x, dy = e.clientY - t0.y, dt = Date.now() - t0.t;
    if (t0.moved){
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 700){ swipeSong(dx < 0 ? 1 : -1); }
      return;
    }
    if (lpFired || dt > 450) return;
    taps++; clearTimeout(tapT);
    if (taps >= 2){ taps = 0; toggle(); const a = $('#f-art'); a.classList.remove('dtap'); void a.offsetWidth; a.classList.add('dtap'); return; }
    tapT = setTimeout(() => { taps = 0; $('#f-lyr').click(); }, 260);
  };
  stage.addEventListener('pointerup', endTap); stage.addEventListener('pointercancel', () => { tap = null; clearTimeout(lp); });
  function swipeSong(dir){
    const a = $('#f-art'); if (!a) return; a.classList.remove('swl', 'swr'); void a.offsetWidth; a.classList.add(dir > 0 ? 'swl' : 'swr');
    setTimeout(() => { if (dir > 0) next(false); else prev(); }, noAnim() ? 0 : 140);
  }

  // ---- drag the full player down = shrink into the mini bar ----
  let dg = null;
  full.addEventListener('pointerdown', e => {
    if (e.target.closest('input,#lyr')) return; if (lyrShown && e.target.closest('.f-stage')) return;
    dg = { x: e.clientX, y: e.clientY, t: Date.now(), on: false, id: e.pointerId };
  });
  full.addEventListener('pointermove', e => {
    if (!dg) return; const dy = e.clientY - dg.y, dx = e.clientX - dg.x;
    if (!dg.on){ if (dy > 14 && dy > Math.abs(dx) * 1.3){ dg.on = true; full.classList.add('dragging'); try { full.setPointerCapture(dg.id); } catch (x) {} } else if (Math.abs(dx) > 14 || dy < -14){ dg = null; return; } else return; }
    dg.y2 = Math.max(0, dy); if (!dg.raf) dg.raf = requestAnimationFrame(() => { if (!dg) return; dg.raf = 0; const y = dg.y2; full.style.transform = 'translate3d(0,' + y + 'px,0) scale(' + (1 - Math.min(y, 400) / 4000) + ')'; full.style.opacity = String(1 - Math.min(y, 500) / 900); });
  });
  const endDrag = e => {
    if (!dg) return; const d = dg; dg = null; if (d.raf) cancelAnimationFrame(d.raf); if (!d.on) return;
    const dy = e.clientY - d.y, v = dy / Math.max(1, Date.now() - d.t); full.classList.remove('dragging');
    if (dy > 140 || v > 0.7){ full.style.transform = 'translateY(100%)'; full.style.opacity = '0'; popUI(); }
    else { full.style.transform = ''; full.style.opacity = ''; }
  };
  full.addEventListener('pointerup', endDrag); full.addEventListener('pointercancel', endDrag);

  // ---- drag the mini bar up = grow into the full player ----
  let mg = null;
  mini.addEventListener('pointerdown', e => { mg = { x: e.clientX, y: e.clientY, done: false }; try { mini.setPointerCapture(e.pointerId); } catch (x) {} });
  mini.addEventListener('pointermove', e => { if (!mg || mg.done) return; const dy = e.clientY - mg.y, dx = e.clientX - mg.x; if (dy < -22 && Math.abs(dy) > Math.abs(dx)){ mg.done = true; mini._swiped = true; openFull(); setTimeout(() => { mini._swiped = false; }, 400); } });
  mini.addEventListener('pointerup', () => { mg = null; }); mini.addEventListener('pointercancel', () => { mg = null; });
  mini.addEventListener('click', e => { if (mini._swiped){ e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  mini.style.touchAction = 'none'; full.style.touchAction = 'none'; stage.style.touchAction = 'none'; lyrEl.style.touchAction = 'pan-y';
  document.querySelectorAll('#full input[type=range]').forEach(i => { i.style.touchAction = 'pan-x'; });
})();

// ================= v1.4.1 beat glow (bass / mid / treble, like Argus) =================
(function(){
  const g = document.querySelector('body>.glow'), g2 = g.cloneNode(true); $('#full').insertBefore(g2, $('#full').firstChild); const gs = [g, g2], sw = $('#glowsw');
  let on = true; try { on = localStorage.getItem('collied_glow') !== 'off'; } catch (e) {}
  let ac = null, an = null, src = null, fb = null, raf = 0, flip = 0, lv = [0, 0, 0], all = 0;
  const SPD = { slow: [0.35, 0.07], normal: [0.7, 0.16], fast: [0.92, 0.32] };
  let cfg = { sp: 'normal', br: 100, h: 85 }; try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem('collied_glowcfg') || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem('collied_glowcfg', JSON.stringify(cfg)); } catch (e) {} };
  const applyCfg = () => { gs.forEach(x => x.style.setProperty('--gb', (cfg.br / 100).toFixed(2))); $('#g-brv').textContent = cfg.br + '%'; $('#g-hv').textContent = cfg.h + '%'; $('#g-br').value = cfg.br; $('#g-h').value = cfg.h; document.querySelectorAll('#g-sp button').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.sp)); };
  const lyrE = $('#lyr');
  sw.checked = on;
  let mes = null;
  const hook = () => {
    try {
      if (!on || mes) return;
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      if (!an){ an = ac.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.5; fb = new Uint8Array(an.frequencyBinCount); }
      let ok = false;
      if (audio.captureStream){   // preferred: listen only, the sound path is not touched
        const st = audio.captureStream();
        if (st.getAudioTracks().length){ if (src){ try { src.disconnect(); } catch (e) {} } src = ac.createMediaStreamSource(st); src.connect(an); ok = true; }
      }
      if (!ok){   // fallback for WebViews without captureStream: route the song through the analyser (works for local blob: songs)
        mes = ac.createMediaElementSource(audio); mes.connect(an); an.connect(ac.destination);
        if (src){ try { src.disconnect(); } catch (e) {} }
      }
    } catch (e) {}
  };
  const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += fb[i]; return s / (b - a) / 255; };
  function loop(){
    raf = 0;
    if (audio.paused || document.hidden || !on || !an){ stop(); return; }
    raf = requestAnimationFrame(loop);
    if ((flip ^= 1)) return;              // ~30 fps is enough and keeps the phone cool
    an.getByteFrequencyData(fb);
    const t = [avg(1, 7) * 1.5, avg(7, 28) * 1.9, avg(28, 90) * 3.4];
    const [at, rl] = SPD[cfg.sp] || SPD.normal; let sum = 0;
    for (let i = 0; i < 3; i++){ const v = Math.min(1, t[i]); lv[i] += (v - lv[i]) * (v > lv[i] ? at : rl); sum += lv[i]; const tf = 'scaleY(' + (lv[i] * cfg.h / 100).toFixed(3) + ')'; gs[0].children[i].style.transform = tf; gs[1].children[i].style.transform = tf; }
    const fo = !$('#full').hidden; gs[0].classList.toggle('on', !fo); gs[1].classList.toggle('on', fo);
    all = sum / 3; if (!$('#full').hidden && $('#full').classList.contains('lyr-on')) lyrE.style.setProperty('--ll', Math.min(1, all * 1.6).toFixed(2));   // lyrics glow follows the music
  }
  function stop(){ if (raf){ cancelAnimationFrame(raf); raf = 0; } gs.forEach(x => x.classList.remove('on')); lv = [0, 0, 0]; lyrE.style.setProperty('--ll', '0'); setTimeout(() => { if (!raf) gs.forEach(x => [...x.children].forEach(b => { b.style.transform = 'scaleY(0)'; })); }, 520); }
  audio.addEventListener('playing', () => { hook(); if (!raf && on) raf = requestAnimationFrame(loop); });
  ['pause', 'ended', 'emptied'].forEach(ev => audio.addEventListener(ev, stop));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !audio.paused && !raf && on) raf = requestAnimationFrame(loop); });
  sw.onchange = () => { on = sw.checked; try { localStorage.setItem('collied_glow', on ? 'on' : 'off'); } catch (e) {} if (!on) stop(); else if (!audio.paused){ hook(); if (!raf) raf = requestAnimationFrame(loop); } };
  applyCfg();
  document.querySelectorAll('#g-sp button').forEach(b => b.onclick = () => { cfg.sp = b.dataset.v; saveCfg(); applyCfg(); });
  $('#g-br').oninput = e => { cfg.br = +e.target.value; saveCfg(); applyCfg(); };
  $('#g-h').oninput = e => { cfg.h = +e.target.value; saveCfg(); applyCfg(); };
  window.__glow = { get lv(){ return lv; } };
})();

// ================= v1.6 look: accent colour + font (background always pure black) =================
(function(){
  const ACC = { Lime: ['#c8ff3d', '#7c5cff'], Violet: ['#a78bfa', '#6d4aff'], Pink: ['#ff6fa8', '#ff4d8d'], Cyan: ['#4dd8ff', '#2a8cff'], Orange: ['#ffa03d', '#ff5a3d'], White: ['#f4f4f7', '#9a9aa6'] };
  const FNT = { System: 'system-ui,-apple-system,Roboto,sans-serif', Serif: 'Georgia,"Times New Roman",serif', Mono: 'ui-monospace,Menlo,Consolas,monospace', Condensed: '"Roboto Condensed","Arial Narrow",sans-serif-condensed,sans-serif' };
  let th = { ac: 'Lime', font: 'System' }; try { th = Object.assign(th, JSON.parse(localStorage.getItem('collied_theme') || '{}')); } catch (e) {}
  const rs = document.documentElement.style;
  function apply(){
    const a = ACC[th.ac] || ACC.Lime; rs.setProperty('--ac', a[0]); rs.setProperty('--ac2', a[1]); rs.setProperty('--font', FNT[th.font] || FNT.System);
    document.querySelectorAll('#t-ac button').forEach(b => b.classList.toggle('on', b.dataset.v === th.ac));
    document.querySelectorAll('#t-font button').forEach(b => b.classList.toggle('on', b.dataset.v === th.font));
    try { localStorage.setItem('collied_theme', JSON.stringify(th)); } catch (e) {}
  }
  Object.keys(ACC).forEach(k => { const b = document.createElement('button'); b.textContent = k; b.dataset.v = k; b.style.borderLeft = '4px solid ' + ACC[k][0]; b.onclick = () => { th.ac = k; apply(); }; $('#t-ac').appendChild(b); });
  Object.keys(FNT).forEach(k => { const b = document.createElement('button'); b.textContent = k; b.dataset.v = k; b.style.fontFamily = FNT[k]; b.onclick = () => { th.font = k; apply(); }; $('#t-font').appendChild(b); });
  apply();
  const fs = $('#fadesw'); fs.checked = fadeOn; fs.onchange = () => { fadeOn = fs.checked; try { localStorage.setItem('collied_fade', fadeOn ? 'on' : 'off'); } catch (e) {} };
})();

// ================= v1.6 update check (GitHub Releases) =================
(function(){
  const btn = $('#updbtn'), info = $('#updinfo'), chg = $('#updrepo');
  const num = v => (String(v).match(/\d+/g) || []).map(Number);
  const newer = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++){ const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y; } return false; };
  const getRepo = () => { try { return localStorage.getItem('collied_repo') || ''; } catch (e) { return ''; } };
  const ok = r => /^[\w.-]+\/[\w.-]+$/.test(r);
  async function ask(){ const r = ((await asyncPrompt('GitHub repo, like yourname/collied', getRepo())) || '').trim(); if (!ok(r)) return ''; try { localStorage.setItem('collied_repo', r); } catch (e) {} return r; }
  chg.onclick = async () => { const r = await ask(); info.textContent = r ? 'Repo saved: ' + r : 'Not saved. Write it like yourname/collied'; };
  btn.onclick = async () => {
    let repo = getRepo(); if (!ok(repo)) repo = await ask();
    if (!repo){ info.textContent = 'Set the repo first, like yourname/collied'; return; }
    info.textContent = 'Checking...'; btn.disabled = true;
    try {
      const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (r.status === 404){ info.textContent = 'No release found in ' + repo + ' yet.'; return; }
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(), tag = j.tag_name || '', apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
      if (newer(num(tag), num(VERSION))){
        info.innerHTML = '';
        const t = document.createElement('div'); t.textContent = 'New version ' + tag + ' is out (you have ' + VERSION + ').'; info.appendChild(t);
        const a = document.createElement('a'); a.className = 'btn pri'; a.target = '_blank'; a.rel = 'noopener'; a.href = apk ? apk.browser_download_url : j.html_url; a.textContent = apk ? 'Download APK' : 'Open release page'; info.appendChild(a);
        const n = document.createElement('div'); n.className = 'note'; n.textContent = 'Open the downloaded file to install over this app. Your songs and stats stay.'; info.appendChild(n);
      } else info.textContent = 'You are on the latest version (' + VERSION + ').';
    } catch (e) { info.textContent = 'Could not check. Are you online?'; }
    finally { btn.disabled = false; }
  };
})();

// ================= v1.7 Android: system media notification, lock screen, headset buttons =================
(function(){
  if (!NATIVE) return;
  let MC = null, mcErr = ''; try { MC = (Capacitor.Plugins && Capacitor.Plugins.MediaControl) || (Capacitor.registerPlugin ? Capacitor.registerPlugin('MediaControl') : null); } catch (e) { window.__mc = { fail: String(e) }; return; }
  if (!MC){ window.__mc = { fail: 'MediaControl is not on Capacitor.Plugins' }; return; }
  let lastKey = '', asked = false;
  const keyOf = t => t.id + ':' + (t.art ? t.art.length : 0);
  function push(){
    const t = queue[qi]; if (!t) return;
    const o = { playing: !audio.paused, position: audio.currentTime || 0, duration: isFinite(audio.duration) ? audio.duration : (t.dur || 0), speed: prefs.speed || 1, shuffle: !!shuffle, repeat: repeat | 0 };
    const k = keyOf(t);
    if (k !== lastKey){ lastKey = k; o.meta = true; o.title = t.title || ''; o.artist = t.artist || ''; o.album = t.album || ''; o.art = t.art || ''; }
    try { MC.update(o).catch(e => { mcErr = 'update: ' + String((e && e.message) || e); lastKey = ''; }); } catch (e) { mcErr = 'update: ' + e; lastKey = ''; }
  }
  window.__mc = { MC, push: force => { if (force) lastKey = ''; push(); }, err: () => mcErr };
  ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange'].forEach(ev => audio.addEventListener(ev, push));
  audio.addEventListener('play', () => { if (!asked){ asked = true; try { Promise.resolve(MC.requestNotif()).then(() => { lastKey = ''; push(); }).catch(e => { mcErr = 'permission: ' + String((e && e.message) || e); }); } catch (e) {}
    setTimeout(async () => {   // tell the truth on screen if the system notification did not come up
      try { const s = await MC.status(); if (!s.serviceUp || s.posted === false || s.lastError) toast('Media notification problem: ' + (s.lastError || (!s.serviceUp ? 'service not running' : 'not posted')) + '. See Backup > Media notification.'); } catch (e) { toast('Media plugin not reachable. See Backup > Media notification.'); }
    }, 4000); } });
  audio.addEventListener('timeupdate', () => { const t = queue[qi]; if (t && keyOf(t) !== lastKey) push(); });   // cover arrived later
  $('#f-shuf').addEventListener('click', () => setTimeout(push, 30));
  $('#f-rep').addEventListener('click', () => setTimeout(push, 30));
  try {
    MC.addListener('action', e => {
      switch (e && e.name){
        case 'play': if (audio.paused) toggle(); break;
        case 'pause': if (!audio.paused) audio.pause(); break;
        case 'next': next(false); break;
        case 'prev': prev(); break;
        case 'seek': audio.currentTime = Math.max(0, e.position || 0); break;
        case 'shuffle': $('#f-shuf').click(); break;
        case 'repeat': $('#f-rep').click(); break;
      }
    });
  } catch (e) {}
})();

// ================= v1.7.1 lighter drawing while the big player is open =================
(function(){
  const full = $('#full'); let tm = 0;
  const sync = () => {
    clearTimeout(tm);
    if (full.hidden || full.classList.contains('dragging') || full.classList.contains('closing')){ document.body.classList.remove('fullopen'); return; }
    tm = setTimeout(() => { if (!full.hidden && !full.classList.contains('dragging') && !full.classList.contains('closing')) document.body.classList.add('fullopen'); }, 380);
  };
  new MutationObserver(sync).observe(full, { attributes: true, attributeFilter: ['class', 'hidden'] });
  const art = $('#f-art'); art.addEventListener('animationend', () => art.classList.remove('swap', 'dtap'));
})();

// ================= v1.7.2 media notification check (Backup tab) =================
(function(){
  const btn = $('#mcbtn'), out = $('#mcinfo'); if (!btn) return;
  btn.onclick = async () => {
    const L = []; out.textContent = 'Checking...';
    L.push('Native app: ' + (NATIVE ? 'yes' : 'no (this is the browser version, no system notification here)'));
    const m = window.__mc;
    if (!NATIVE){ out.textContent = L.join('\n'); return; }
    if (!m || m.fail || !m.MC){ L.push('Plugin: NOT reachable ' + ((m && m.fail) || '')); out.textContent = L.join('\n'); return; }
    try { if (queue[qi]){ m.push(true); await new Promise(r => setTimeout(r, 900)); } else L.push('Play a song first, then check again.'); } catch (e) {}
    try {
      const s = await m.MC.status();
      L.push('Plugin: reachable');
      L.push('Android: ' + s.sdk + ' | notifications allowed: ' + (s.notifAllowed ? 'yes' : 'NO'));
      L.push('Channel importance: ' + (s.channel === undefined ? '-' : s.channel) + ' (0 = blocked)');
      L.push('Updates received: ' + s.updates + ' | service running: ' + (s.serviceUp ? 'yes' : 'NO') + ' | refreshes: ' + s.refreshes);
      L.push('Notification posted: ' + (s.posted === undefined ? '-' : (s.posted ? 'yes' : 'NO')) + ' | cover in it: ' + (s.hasArt ? 'yes' : 'no'));
      L.push('Headset keys received: ' + s.keys + ' | sent to the app: ' + s.emitted);
      if (s.lastError) L.push('Native error: ' + s.lastError);
    } catch (e) { L.push('Plugin call failed: ' + String((e && e.message) || e)); }
    if (m.err()) L.push('App error: ' + m.err());
    out.textContent = L.join('\n');
  };
})();

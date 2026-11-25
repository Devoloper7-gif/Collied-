'use strict';
// Reads title / artist / album / cover picture from mp3 (ID3v2), flac, m4a/mp4.
const TD = (enc) => new TextDecoder(enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'iso-8859-1');
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const ss = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
const cut = s => s.replace(/\0+$/g, '').replace(/^﻿/, '').trim();
function txt(b, enc){ if (!b.length) return ''; return cut(TD(enc).decode(b)); }
function nul(b, from, enc){ const w = (enc === 1 || enc === 2); for (let i = from; i < b.length - (w ? 1 : 0); i += (w ? 2 : 1)){ if (b[i] === 0 && (!w || b[i + 1] === 0)) return i; } return b.length; }

function id3(b){
  const o = {}; if (!(b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)) return o;
  const ver = b[3], size = ss(b, 6); let p = 10;
  if (b[5] & 0x40){ const ex = ver === 4 ? ss(b, 10) : u32(b, 10) + 4; p += ex; }
  const end = Math.min(b.length, 10 + size), idl = ver === 2 ? 3 : 4, hl = ver === 2 ? 6 : 10;
  while (p + hl <= end){
    const id = String.fromCharCode(...b.subarray(p, p + idl)); if (!/^[A-Z0-9]+$/.test(id)) break;
    const sz = ver === 2 ? (b[p + 3] << 16 | b[p + 4] << 8 | b[p + 5]) : (ver === 4 ? ss(b, p + 4) : u32(b, p + 4));
    const f = b.subarray(p + hl, p + hl + sz); p += hl + sz; if (!sz) continue;
    const enc = f[0];
    if (id === 'TIT2' || id === 'TT2') o.title = txt(f.subarray(1), enc);
    else if (id === 'TPE1' || id === 'TP1') o.artist = txt(f.subarray(1), enc);
    else if (id === 'TALB' || id === 'TAL') o.album = txt(f.subarray(1), enc);
    else if ((id === 'USLT' || id === 'ULT') && !o.lyrics){
      const e = nul(f, 4, enc), q = e + ((enc === 1 || enc === 2) ? 2 : 1), v = txt(f.subarray(q), enc); if (v) o.lyrics = v;
    }
    else if ((id === 'APIC' || id === 'PIC') && !o.pic){
      let q = 1, mime = 'image/jpeg';
      if (id === 'PIC'){ mime = 'image/' + String.fromCharCode(...f.subarray(1, 4)).toLowerCase(); q = 4; }
      else { const e = nul(f, 1, 0); mime = String.fromCharCode(...f.subarray(1, e)) || 'image/jpeg'; q = e + 1; }
      q += 1; const e2 = nul(f, q, enc); q = e2 + ((enc === 1 || enc === 2) ? 2 : 1);
      if (f.length - q > 100) o.pic = new Blob([f.subarray(q)], { type: mime.indexOf('/') > 0 ? mime : 'image/jpeg' });
    }
  }
  return o;
}
function flac(b){
  const o = {}; if (String.fromCharCode(...b.subarray(0, 4)) !== 'fLaC') return o;
  let p = 4;
  while (p + 4 <= b.length){
    const last = b[p] & 128, type = b[p] & 127, len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]; p += 4;
    const d = b.subarray(p, p + len);
    if (type === 4){
      let q = 4 + le32(d, 0); const n = le32(d, q); q += 4;
      for (let i = 0; i < n && q + 4 <= d.length; i++){ const l = le32(d, q); q += 4; const s = new TextDecoder().decode(d.subarray(q, q + l)); q += l; const k = s.indexOf('='); if (k > 0){ const key = s.slice(0, k).toUpperCase(), v = s.slice(k + 1); if (key === 'TITLE') o.title = v; else if (key === 'ARTIST') o.artist = v; else if (key === 'ALBUM') o.album = v; else if ((key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'SYNCEDLYRICS') && v && (!o.lyrics || key === 'SYNCEDLYRICS')) o.lyrics = v; } }
    } else if (type === 6 && !o.pic){
      let q = 4; const ml = u32(d, q); q += 4; const mime = String.fromCharCode(...d.subarray(q, q + ml)); q += ml; const dl = u32(d, q); q += 4 + dl + 16; const pl = u32(d, q); q += 4;
      if (pl > 100) o.pic = new Blob([d.subarray(q, q + pl)], { type: mime || 'image/jpeg' });
    }
    p += len; if (last) break;
  }
  return o;
}
function mp4(b){
  const o = {};
  const walk = (s, e, depth) => {
    let p = s;
    while (p + 8 <= e){
      let sz = u32(b, p); const t = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]); let hd = 8;
      if (sz === 1){ sz = u32(b, p + 12); hd = 16; } else if (sz === 0) sz = e - p;
      if (sz < hd || p + sz > e + 0) { if (p + sz > e) sz = e - p; if (sz < hd) break; }
      const bs = p + hd, be = p + sz;
      if (t === 'moov' || t === 'udta' || t === 'ilst') walk(bs, be, depth + 1);
      else if (t === 'meta') walk(bs + 4, be, depth + 1);
      else if (t === '©nam' || t === '©ART' || t === '©alb' || t === '©lyr' || t === 'covr'){
        let q = bs; while (q + 16 <= be){ const ds = u32(b, q); if (String.fromCharCode(b[q + 4], b[q + 5], b[q + 6], b[q + 7]) === 'data'){ const pl = b.subarray(q + 16, q + ds);
            if (t === 'covr'){ if (!o.pic && pl.length > 100) o.pic = new Blob([pl], { type: (pl[0] === 0x89 ? 'image/png' : 'image/jpeg') }); }
            else { const v = new TextDecoder().decode(pl); if (t === '©nam') o.title = v; else if (t === '©ART') o.artist = v; else if (t === '©lyr') o.lyrics = v; else o.album = v; } break; } if (ds < 8) break; q += ds; }
      }
      p += sz;
    }
  };
  walk(0, b.length, 0); return o;
}
async function readMeta(file){
  try {
    const big = file.size > 60 * 1024 * 1024;
    const hd = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    let b;
    if (hd[0] === 0x49 && hd[1] === 0x44 && hd[2] === 0x33) b = new Uint8Array(await file.slice(0, Math.min(file.size, 10 + ss(hd, 6) + ((hd[5] & 0x10) ? 10 : 0), 40 * 1024 * 1024)).arrayBuffer());
    else b = new Uint8Array(await (big ? file.slice(0, 3 * 1024 * 1024) : file).arrayBuffer());
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let o = {};
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) o = id3(b);
    else if (b[0] === 0x66 && b[1] === 0x4c) o = flac(b);
    else if (/^(m4a|mp4|m4b|aac|alac)$/.test(ext) || String.fromCharCode(...b.subarray(4, 8)) === 'ftyp') o = mp4(b);
    return o;
  } catch (e) { return {}; }
}
async function shrinkCover(blob, px){
  try {
    const bm = await createImageBitmap(blob), r = Math.min(1, px / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas'); c.width = Math.round(bm.width * r); c.height = Math.round(bm.height * r);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch (e) { return ''; }
}

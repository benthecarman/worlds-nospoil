// Cloudflare Worker: CORS proxy for Twitch VOD HLS (playlists + segments).
// Playlists are rewritten so every child URI points back through this proxy
// (hls.js fetch loader otherwise hits CloudFront directly and fails CORS).
const ORIGIN_OK = /^(https:\/\/benthecarman\.github\.io|http:\/\/127\.0\.0\.1:\d+|http:\/\/localhost:\d+)$/;

function corsHeaders(origin) {
  const o = ORIGIN_OK.test(origin || '') ? origin : 'https://benthecarman.github.io';
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function hostOk(u) {
  const h = u.hostname;
  if (/(^|\.)(ttvnw\.net|twitchcdn\.net|jtvnw\.net|twitch\.tv)$/.test(h)) return true;
  if (/(^|\.)cloudfront\.net$/.test(h)) {
    // Twitch VOD/CloudFront objects only — not a general CloudFront open proxy.
    const p = u.pathname;
    return /\.(m3u8|ts|m4s|mp4|aac|vtt)(\?|$)/i.test(p)
      || /index-(dvr|muted)/i.test(p)
      || /\/storyboards\//i.test(p)
      || /_[a-z0-9]+_\d+_\d+\//i.test(p);
  }
  return false;
}

function unwrapTarget(href, selfOrigin) {
  try {
    const u = new URL(href);
    if (u.origin === selfOrigin && u.searchParams.has('u')) {
      return unwrapTarget(u.searchParams.get('u'), selfOrigin);
    }
  } catch {}
  return href;
}

function proxyWrap(selfOrigin, targetHref) {
  const abs = unwrapTarget(targetHref, selfOrigin);
  return `${selfOrigin}/?u=${encodeURIComponent(abs)}`;
}

function rewritePlaylist(body, base, selfOrigin) {
  return body.split('\n').map(l => {
    if (!l) return l;
    if (l.startsWith('#')) {
      return l.replace(/URI="([^"]+)"/g, (_, u) => {
        try { return `URI="${proxyWrap(selfOrigin, new URL(u, base).href)}"` }
        catch { return `URI="${u}"` }
      });
    }
    try { return proxyWrap(selfOrigin, new URL(l, base).href) }
    catch { return l }
  }).join('\n');
}

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    const selfOrigin = new URL(req.url).origin;

    if (req.method === 'OPTIONS') {
      if (origin && !ORIGIN_OK.test(origin)) return new Response('origin not allowed', {status: 403, headers: cors});
      return new Response(null, {status: 204, headers: cors});
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('method not allowed', {status: 405, headers: cors});
    }
    if (origin && !ORIGIN_OK.test(origin)) {
      return new Response('origin not allowed', {status: 403, headers: cors});
    }

    const raw = new URL(req.url).searchParams.get('u');
    let t;
    try { t = new URL(unwrapTarget(raw, selfOrigin)) }
    catch { return new Response('bad url', {status: 400, headers: cors}) }
    if (t.protocol !== 'https:' || !hostOk(t)) {
      return new Response('host not allowed', {status: 403, headers: cors});
    }

    const hdrs = { Accept: '*/*' };
    const range = req.headers.get('range'); if (range) hdrs['Range'] = range;
    const r = await fetch(t.toString(), {headers: hdrs, redirect: 'follow'});
    // After redirects, re-check the final host.
    let finalUrl = t;
    try { finalUrl = new URL(r.url) } catch {}
    if (finalUrl.protocol !== 'https:' || !hostOk(finalUrl)) {
      return new Response('redirect host not allowed', {status: 403, headers: cors});
    }

    const h = new Headers();
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    const ct = r.headers.get('content-type') || '';
    const isPlaylist = finalUrl.pathname.endsWith('.m3u8') || t.pathname.endsWith('.m3u8')
      || /mpegurl|application\/vnd\.apple\.mpegurl|application\/x-mpegURL/i.test(ct);
    if (isPlaylist) {
      const body = rewritePlaylist(await r.text(), finalUrl, selfOrigin);
      h.set('Content-Type', 'application/vnd.apple.mpegurl');
      h.set('Cache-Control', 'no-cache');
      return new Response(body, {status: r.status, headers: h});
    }
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = r.headers.get(k); if (v) h.set(k, v);
    }
    h.set('Cache-Control', 'public, max-age=60');
    return new Response(r.body, {status: r.status, headers: h});
  }
};

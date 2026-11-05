// Cloudflare Worker: CORS proxy for Twitch VOD HLS (playlists + segments).
// Only benthecarman.github.io (and local/dev) may use it; only Twitch CDN hosts are fetched.
const HOST_OK = /(^|\.)(ttvnw\.net|cloudfront\.net|twitchcdn\.net|jtvnw\.net)$/;
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

function absify(body, base) {
  return body.split('\n').map(l => {
    if (!l || l.startsWith('#')) {
      return l.replace(/URI="([^"]+)"/g, (_, u) => {
        try { return `URI="${new URL(u, base).href}"` } catch { return `URI="${u}"` }
      });
    }
    try { return new URL(l, base).href } catch { return l }
  }).join('\n');
}

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') {
      // Preflight: require a browser Origin from our allowlist
      if (origin && !ORIGIN_OK.test(origin)) return new Response('origin not allowed', {status: 403, headers: cors});
      return new Response(null, {status: 204, headers: cors});
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('method not allowed', {status: 405, headers: cors});
    }
    // Non-browser tools may omit Origin; browser calls from other sites are rejected.
    if (origin && !ORIGIN_OK.test(origin)) {
      return new Response('origin not allowed', {status: 403, headers: cors});
    }
    const u = new URL(req.url).searchParams.get('u');
    let t; try { t = new URL(u) } catch { return new Response('bad url', {status: 400, headers: cors}) }
    if (t.protocol !== 'https:' || !HOST_OK.test(t.hostname)) {
      return new Response('host not allowed', {status: 403, headers: cors});
    }
    const hdrs = {};
    const range = req.headers.get('range'); if (range) hdrs['Range'] = range;
    // Identify as a simple fetch; avoid forwarding client UA that triggers odd CDN paths.
    hdrs['Accept'] = '*/*';
    const r = await fetch(t.toString(), {headers: hdrs, redirect: 'follow'});
    const h = new Headers();
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    const ct = r.headers.get('content-type') || '';
    const isPlaylist = t.pathname.endsWith('.m3u8') || ct.includes('mpegurl') || ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegURL');
    if (isPlaylist) {
      const body = absify(await r.text(), t);
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

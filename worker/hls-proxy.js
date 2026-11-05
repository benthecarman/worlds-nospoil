// Cloudflare Worker: CORS proxy for Twitch VOD HLS (playlists + segments).
// Deploy (from repo root, needs CF account token — see worker/README.md):
//   npx wrangler deploy
// Then set data/config.json "hlsProxy" to https://hls-proxy.<your-subdomain>.workers.dev/
const OK = /(^|\.)(ttvnw\.net|cloudfront\.net|twitchcdn\.net|jtvnw\.net|twitch\.tv)$/;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges',
};
function absify(body, base) {
  // Make playlist URIs absolute so hls.js resolves them against the origin, then our xhrSetup re-proxies.
  return body.split('\n').map(l => {
    if (!l || l.startsWith('#')) {
      // Rewrite URI="..." attributes (keys, init segments, etc.)
      return l.replace(/URI="([^"]+)"/g, (_, u) => {
        try { return `URI="${new URL(u, base).href}"` } catch { return `URI="${u}"` }
      });
    }
    try { return new URL(l, base).href } catch { return l }
  }).join('\n');
}
export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    const u = new URL(req.url).searchParams.get('u');
    let t; try { t = new URL(u) } catch { return new Response('bad url', {status: 400, headers: cors}) }
    if (t.protocol !== 'https:' || !OK.test(t.hostname)) return new Response('host not allowed', {status: 403, headers: cors});
    const hdrs = {};
    const range = req.headers.get('range'); if (range) hdrs['Range'] = range;
    const r = await fetch(t, {headers: hdrs});
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    h.set('Cache-Control', t.pathname.endsWith('.m3u8') ? 'no-cache' : 'public, max-age=60');
    if (t.pathname.endsWith('.m3u8') || (r.headers.get('content-type') || '').includes('mpegurl')) {
      const body = absify(await r.text(), t);
      h.delete('content-length');
      h.set('Content-Type', 'application/vnd.apple.mpegurl');
      return new Response(body, {status: r.status, headers: h});
    }
    return new Response(r.body, {status: r.status, headers: h});
  }
};

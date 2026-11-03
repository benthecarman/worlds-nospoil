// Cloudflare Worker: CORS proxy for Twitch VOD HLS (playlists + segments) so Firefox can use the site's own player.
// Deploy: dash.cloudflare.com > Workers > Create > paste this > Deploy. Put the worker URL in data/config.json "hlsProxy".
const OK = /(^|\.)(ttvnw\.net|cloudfront\.net|twitchcdn\.net|jtvnw\.net)$/;
export default {
  async fetch(req) {
    const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'};
    if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
    const u = new URL(req.url).searchParams.get('u');
    let t; try { t = new URL(u) } catch { return new Response('bad url', {status: 400, headers: cors}) }
    if (t.protocol !== 'https:' || !OK.test(t.hostname)) return new Response('host not allowed', {status: 403, headers: cors});
    const r = await fetch(t, {headers: req.headers.get('range') ? {range: req.headers.get('range')} : {}});
    const h = new Headers(r.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v);
    if (t.pathname.endsWith('.m3u8')) {  // make segment/playlist URIs absolute so the player resolves them against the origin, not the proxy
      const body = (await r.text()).split('\n').map(l => l && !l.startsWith('#') ? new URL(l, t).href : l).join('\n');
      h.delete('content-length'); return new Response(body, {status: r.status, headers: h});
    }
    // for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(r.body, {status: r.status, headers: h});
  }
};

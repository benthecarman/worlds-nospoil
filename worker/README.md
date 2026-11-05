# Twitch HLS CORS proxy

Chrome/Firefox need this so the Worlds site can use hls.js (deep forward buffer + locked 1080p). Safari can play Twitch HLS natively, but cannot be told to buffer minutes ahead.

## Deploy (Cloudflare Workers, free)

1. Cloudflare account that owns `benthecarman.workers.dev` (or any workers.dev subdomain).
2. Create an API token: https://dash.cloudflare.com/profile/api-tokens
   - Template **Edit Cloudflare Workers**, or custom with `Account.Cloudflare Workers Scripts:Edit` + `User.User Details:Read`.
3. Give the bot (or run yourself):

```bash
export CLOUDFLARE_API_TOKEN='…'
# optional if you have several accounts:
# export CLOUDFLARE_ACCOUNT_ID='…'
cd /path/to/worlds-nospoil
npx wrangler deploy
```

4. Put the printed URL into `data/config.json`:

```json
{"hlsProxy": "https://hls-proxy.<subdomain>.workers.dev/"}
```

5. Commit + push (or tell the bot the URL and it will wire + publish).

Manual alternative: dash.cloudflare.com → Workers → Create → paste `hls-proxy.js` → Deploy → same config step.

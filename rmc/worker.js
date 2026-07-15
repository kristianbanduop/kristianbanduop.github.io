// ============================================================
// RMC World Cup Sweepstake — data relay (Cloudflare Worker)
//
// football-data.org doesn't allow web pages to call it directly
// (no CORS headers), so this tiny relay sits in between:
//   your page  ->  this worker  ->  api.football-data.org
//
// It also relays ESPN's public World Cup scoreboard feed
// (site.api.espn.com) which supplies the card / own-goal events
// for the Chaos Award — football-data.org's free tier doesn't
// include those.
//
// SETUP (one time, ~5 minutes, free):
//   1. Sign up at https://dash.cloudflare.com (free plan is fine)
//   2. Workers & Pages -> Create -> Create Worker -> Deploy
//   3. Click "Edit code", delete the sample, paste THIS file, Deploy
//   4. Copy the worker URL (https://something.workers.dev)
//   5. Paste that URL into PROXY_BASE in sweepstake.html
// ============================================================

const FD_TOKEN = '584ca0d160bd466c886012532e168e93'; // your football-data.org token
const FD_BASE  = 'https://api.football-data.org/v4';
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

// Only the endpoints the sweepstake page needs.
const ALLOWED = /^\/(competitions\/WC\/(matches|standings)|matches\/\d+)$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    // ESPN scoreboard relay (Chaos Award events: cards + own goals).
    // Only the whitelisted query params are forwarded.
    if (path === '/espn/scoreboard') {
      const qs = new URLSearchParams();
      const dates = url.searchParams.get('dates');
      const limit = url.searchParams.get('limit');
      if (dates && /^\d{8}(-\d{8})?$/.test(dates)) qs.set('dates', dates);
      if (limit && /^\d{1,4}$/.test(limit)) qs.set('limit', limit);
      const espnRes = await fetch(`${ESPN_BASE}/scoreboard${qs.toString() ? '?' + qs.toString() : ''}`, {
        cf: { cacheTtl: 120, cacheEverything: true },
      });
      const out = new Response(espnRes.body, espnRes);
      Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }

    if (!ALLOWED.test(path)) {
      return new Response(JSON.stringify({ message: 'Path not allowed' }), {
        status: 403,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Short edge cache so 40+ colleagues refreshing at once don't burn
    // through football-data.org's 10-requests-per-minute free limit.
    const apiRes = await fetch(`${FD_BASE}${path}`, {
      headers: { 'X-Auth-Token': FD_TOKEN },
      cf: { cacheTtl: 120, cacheEverything: true },
    });

    const res = new Response(apiRes.body, apiRes);
    Object.entries(CORS).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  },
};

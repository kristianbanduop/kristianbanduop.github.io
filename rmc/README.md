# RMC World Cup 2026 Sweepstake 🏆

A single-page dashboard for the office World Cup sweepstake. It shows live scores, group tables, the knockout bracket, and the standings for the side prizes (Biggest Shock, Wooden Spoon, Chaos Award) — all updating automatically from real tournament data.

There is no build step, no framework, and no database. The whole site is **one HTML file**, plus **one tiny Cloudflare Worker** that relays data from the football API.

---

## How it fits together

```
 Colleagues' browsers                Cloudflare (free)              football-data.org (free)
┌─────────────────────┐   GET    ┌──────────────────────┐  GET +  ┌──────────────────────┐
│   sweepstake.html   │ ───────> │  worker.js (relay)   │ ──────> │   /v4 World Cup API  │
│  (all logic + UI)   │ <─────── │  + API token         │ <────── │   (matches, tables,  │
└─────────────────────┘   JSON   │  + CORS headers      │  token  │    match details)    │
                                 │  + 2-min edge cache  │         └──────────────────────┘
                                 └──────────────────────┘
```

**Why the relay exists:** football-data.org does not send CORS headers, so browsers refuse to call it directly from a web page ("Failed to fetch"). The Worker sits in between: the page calls the Worker, the Worker calls the API with the secret token, and replies with the CORS headers browsers need. It also caches each response at Cloudflare's edge for 2 minutes, so 40+ people having the page open share one API call instead of making 40 — essential because the API's free plan allows only **10 requests per minute in total**.

A nice side effect: the API token lives only inside the Worker, not in the HTML file that gets shared around.

---

## The files

| File | What it is |
|---|---|
| `sweepstake.html` | The entire website: styles, sweepstake draw data, and all JavaScript. Share this file (or host it anywhere static — SharePoint, GitHub Pages, a network drive). |
| `worker.js` | The Cloudflare Worker relay. Deployed once; you rarely touch it again. Contains the API token. |
| `README.md` | This file. |

---

## Setting it up from scratch

You only do this once (or when handing over to a new owner — see the checklist at the bottom).

### 1. Get a football-data.org token (free, ~2 min)
1. Register at <https://www.football-data.org/client/register> — no card needed.
2. The token is emailed to you. The free tier permanently includes the World Cup.

### 2. Deploy the Worker (free, ~5 min)
1. Sign up at <https://dash.cloudflare.com> (free plan).
2. Go to **Workers & Pages → Create → Create Worker → Deploy**.
3. Click **Edit code**, delete the sample, paste in the contents of `worker.js`, and **Deploy**.
4. Put your token in the `FD_TOKEN` constant at the top of the Worker code (it's pre-filled if you received this project as a working handover).
5. Copy the Worker's URL — it looks like `https://something.yourname.workers.dev`.

### 3. Point the page at the Worker
Open `sweepstake.html` and near the top of the `<script>` section set:

```js
const PROXY_BASE = 'https://something.yourname.workers.dev';
```

That's the **only** edit the HTML needs. (If it's left as the placeholder, the page shows setup instructions instead of an error.)

---

## What the code does, section by section

All of this lives in the single `<script>` block of `sweepstake.html`, in roughly this order.

### Config
`PROXY_BASE` — the Worker URL. The only required setting.

### Sweepstake data (`sweepstakeData`)
The heart of the sweepstake: one entry per team with the owner's name, the team, its ISO flag code (for flagcdn.com flag images), the office draw rank, the FIFA rank, and the group letter. **Edit this array to change owners or fix names** — everything else (owner labels, upset maths, wooden spoon, chaos table) reads from it.

### Team-name translation (`TEAM_ALIASES` / `canonTeam`)
The API spells some teams differently than we do — it says "USA", "Czech Republic", "Korea Republic"; we say "United States", "Czechia", "South Korea". Every team name coming from the API is passed through `canonTeam()`, which maps known aliases onto our names. **If a team ever shows owner "TBC" on the live site but exists in `sweepstakeData`, it's a naming mismatch — add a line to `TEAM_ALIASES`.**

### Fetching (`fetchTournamentData` / `apiFetch`)
Runs on page load and every 5 minutes. It makes two requests through the Worker:
- `/competitions/WC/matches` — all 104 fixtures with status and scores,
- `/competitions/WC/standings` — the official group tables.

Results are cached in the browser's `localStorage` for 5 minutes, so navigating around or reloading doesn't re-fetch. Empty results are never cached (a guard against one bad response blanking the page for everyone). Any API error is shown in red on the Live Matches card with the real message — nothing fails silently.

### The adapter (`adaptMatch`, `mapStatusShort`)
The render functions were originally written for a different API's data shape, so each match from football-data.org is translated into that shape: status codes become `NS` / `1H` / `HT` / `FT` / `AET` / `PEN`, stages become round names like `Group A` or `Quarter-finals`, and the official `winner` field is carried through (important for penalty shootouts, where the score alone looks like a draw).

### The features
- **Live / Today** (`processLiveMatches`) — anything in play, plus everything kicking off today (UK time). Shows the match minute when the API supplies it, otherwise a LIVE badge.
- **Upcoming** (`processUpcomingMatches`) — the next 5 scheduled fixtures, grouped by date.
- **Group tables** (`processGroups`) — rendered straight from the API's official standings, so points, goal difference, and FIFA's tie-breakers are authoritative. Top 2 in each group are highlighted (8 best third-placed teams also advance in the 48-team format). Until the API has tables, a static all-zeros version is built from `sweepstakeData`.
- **Knockout bracket** (`processKnockouts`) — Round of 32 through to the Final, winners highlighted using the official winner field. The 3rd-place match is kept out of the Final column.
- **Biggest Shock** (`processBiggestUpset`) — for each finished match between two sweepstake teams, computes the FIFA-rank gap when the lower-ranked side won; shows the record holder and the next fixture that could beat it.
- **Wooden Spoon** (`processWoodenSpoon`) — fewest points then worst goal difference, **counting group-stage matches only**, matching the prize rules.
- **Chaos Award** (`processChaosIndex`) — yellow card 1 pt, red / second yellow 5 pts, own goal 3 pts. See below, it works differently from the rest.

### How the Chaos Award gets its data
Cards and own-goals only exist in *per-match* API responses (`/matches/{id}`), and the free plan allows 10 requests/minute. So instead of fetching all matches every time, the page:
1. keeps a permanent per-browser cache of match events in `localStorage` (a finished match's events never change),
2. on each refresh, fetches details for up to **7 newly finished matches**, with a short delay between calls,
3. tallies the chaos table from the cache.

In normal use, chaos points appear within a refresh or two of full time. A brand-new browser opened late in the tournament will show a "still scanning X matches" note and catch up over a few refreshes. Own goals are attributed to the guilty team (the API credits them to the team they counted *for*, so the code flips it).

### Static tabs
The Draw tab (player cards with search) and the Rules/Prizes tab are rendered from `sweepstakeData` and hard-coded HTML — no API involved. The prize amounts and chaos scoring explanation live in the HTML table on the Rules tab; if you change the rules, update both that table and (for chaos) the scoring constants in `processChaosIndex`.

---

## The Worker, briefly

`worker.js` is ~50 lines:
- answers CORS preflight (`OPTIONS`) requests,
- only accepts `GET`, and only for the three endpoint shapes the page uses (`/competitions/WC/matches`, `/competitions/WC/standings`, `/matches/{id}`) — so the token can't be borrowed for anything else,
- forwards the request to football-data.org with the `X-Auth-Token` header added,
- asks Cloudflare to edge-cache the response for 120 seconds,
- returns the response with `Access-Control-Allow-Origin: *`.

---

## Rate limits & caching summary

| Layer | TTL | Protects against |
|---|---|---|
| Cloudflare edge cache (Worker) | 2 min | Many colleagues = many API calls |
| Browser `localStorage` (page data) | 5 min | One person reloading repeatedly |
| Browser `localStorage` (chaos match events) | Forever | Re-fetching events that can't change |
| Chaos detail throttle | Max 7 calls/load, 0.7 s apart | The 10-requests/minute API limit |

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "⚙️ One-time setup needed" screen | `PROXY_BASE` is still the placeholder — paste the Worker URL into it. |
| "Could not fetch match data. Failed to fetch" | The Worker URL is wrong/typo'd, the Worker isn't deployed, or a corporate firewall blocks `*.workers.dev`. Open the Worker URL + `/competitions/WC/matches` directly in a browser — you should see JSON. |
| Red error showing an API message | That message comes straight from football-data.org (e.g. invalid token, rate limit). Token problems are fixed in the **Worker**, not the HTML. |
| A team shows owner "TBC" | Name mismatch — add the API's spelling to `TEAM_ALIASES`. |
| Group tables all zeros | Normal before the API publishes standings; it's the static fallback. |
| Chaos numbers seem behind | It tops up 7 matches per refresh — wait for the next 5-minute cycle, or note in the table footer says how many are left to scan. |
| Stale data after editing the file | Old data may be cached: in DevTools → Application → Local Storage, delete the `rmc_wc26_*` keys, or just wait 5 minutes. |

---

## Handover checklist

When passing this to a new owner, transfer (or have them recreate) two free accounts:

1. **football-data.org account** — owns the API token. A new owner can register their own account and put their token into the Worker's `FD_TOKEN`. If the old token may have leaked, regenerate it from the account dashboard.
2. **Cloudflare account** — owns the Worker. Either add the new owner to the account, or they re-deploy `worker.js` under their own account (5 minutes) and update `PROXY_BASE` in the HTML to the new URL.

For a future tournament, the things to update are: the `sweepstakeData` array (teams, owners, groups, FIFA ranks), the competition code in the Worker's `ALLOWED` list and the page's two fetch paths (`WC` covers the World Cup; football-data.org uses e.g. `EC` for the Euros), the prize/rules HTML, and any round names in `processKnockouts` if the tournament format differs.

Built with plain HTML/CSS/JS — no dependencies to update, nothing to install. Enjoy. ⚽

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

The Worker also relays a second, token-free source: **ESPN's public World Cup scoreboard feed** (`site.api.espn.com`), used only for the Chaos Award. football-data.org's free tier doesn't include card or own-goal events, so those come from ESPN instead (see the Chaos Award section below).

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
- **Chaos Award** (`processChaosIndex`) — yellow card 1 pt, red / second yellow 5 pts, own goal 3 pts. Uses its own data source (ESPN) — see below.

### How the Chaos Award gets its data
football-data.org's **free tier does not include bookings or goalscorer events** — its `/matches/{id}` responses come back without them. So this feature uses a different source: ESPN's public World Cup scoreboard feed, relayed through the same Worker at `/espn/scoreboard`.

One request with a date range covering the whole tournament (`?dates=20260611-20260719&limit=950`) returns every match with a `details` array of key events — yellow cards, red cards, and own goals, updating live during matches. The page:
1. fetches that single response every 5 minutes (cached in `localStorage`, and edge-cached 2 minutes by the Worker so colleagues share one call),
2. slims it down to just the card/own-goal events (the raw feed is huge — odds, broadcasters, etc.),
3. tallies the chaos table from it.

Details worth knowing: ESPN logs a **second yellow** as both a yellow *and* a red for the same player at the same minute, so the code skips the paired yellow to score it as 5 pts (not 1 + 5), matching the prize rules. **Own goals** are attributed to the guilty team (ESPN credits them to the team they counted *for*, so the code flips it). If ESPN is briefly unreachable, the last cached tally is shown, and it runs independently of football-data.org — one source going down doesn't take out the other.

### Static tabs
The Draw tab (player cards with search) and the Rules/Prizes tab are rendered from `sweepstakeData` and hard-coded HTML — no API involved. The prize amounts and chaos scoring explanation live in the HTML table on the Rules tab; if you change the rules, update both that table and (for chaos) the scoring constants in `processChaosIndex`.

---

## The Worker, briefly

`worker.js` is ~70 lines:
- answers CORS preflight (`OPTIONS`) requests,
- only accepts `GET`, and only for the endpoint shapes the page uses (`/competitions/WC/matches`, `/competitions/WC/standings`, `/matches/{id}`, and `/espn/scoreboard`) — so the token can't be borrowed for anything else,
- forwards football-data.org requests with the `X-Auth-Token` header added,
- forwards `/espn/scoreboard` (no token needed) to ESPN's World Cup feed, passing through only validated `dates` and `limit` query params,
- asks Cloudflare to edge-cache responses for 120 seconds,
- returns responses with `Access-Control-Allow-Origin: *`.

---

## Rate limits & caching summary

| Layer | TTL | Protects against |
|---|---|---|
| Cloudflare edge cache (Worker) | 2 min | Many colleagues = many API calls |
| Browser `localStorage` (page data) | 5 min | One person reloading repeatedly |
| Browser `localStorage` (chaos/ESPN events) | 5 min | One person reloading repeatedly |

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "⚙️ One-time setup needed" screen | `PROXY_BASE` is still the placeholder — paste the Worker URL into it. |
| "Could not fetch match data. Failed to fetch" | The Worker URL is wrong/typo'd, the Worker isn't deployed, or a corporate firewall blocks `*.workers.dev`. Open the Worker URL + `/competitions/WC/matches` directly in a browser — you should see JSON. |
| Red error showing an API message | That message comes straight from football-data.org (e.g. invalid token, rate limit). Token problems are fixed in the **Worker**, not the HTML. |
| A team shows owner "TBC" | Name mismatch — add the API's spelling to `TEAM_ALIASES`. |
| Group tables all zeros | Normal before the API publishes standings; it's the static fallback. |
| Chaos table says “data unavailable” | The `/espn/scoreboard` route on the Worker is failing — most likely the Worker hasn't been redeployed with the latest `worker.js`. Open the Worker URL + `/espn/scoreboard?dates=20260611-20260719&limit=950` in a browser; you should see JSON with an `events` array. The last cached tally keeps showing in the meantime. |
| Stale data after editing the file | Old data may be cached: in DevTools → Application → Local Storage, delete the `rmc_wc26_*` keys, or just wait 5 minutes. |

---

## Handover checklist

When passing this to a new owner, transfer (or have them recreate) two free accounts:

1. **football-data.org account** — owns the API token. A new owner can register their own account and put their token into the Worker's `FD_TOKEN`. If the old token may have leaked, regenerate it from the account dashboard.
2. **Cloudflare account** — owns the Worker. Either add the new owner to the account, or they re-deploy `worker.js` under their own account (5 minutes) and update `PROXY_BASE` in the HTML to the new URL.

For a future tournament, the things to update are: the `sweepstakeData` array (teams, owners, groups, FIFA ranks), the competition code in the Worker's `ALLOWED` list and the page's two fetch paths (`WC` covers the World Cup; football-data.org uses e.g. `EC` for the Euros), the ESPN league slug in the Worker's `ESPN_BASE` (`fifa.world` for the World Cup; e.g. `uefa.euro` for the Euros) and the `ESPN_DATE_RANGE` constant in `processChaosIndex`, the prize/rules HTML, and any round names in `processKnockouts` if the tournament format differs.

Built with plain HTML/CSS/JS — no dependencies to update, nothing to install. Enjoy. ⚽

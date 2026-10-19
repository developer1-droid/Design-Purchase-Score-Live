# Purchase & Design Live

Live TV scoreboard for Shazia Rice. It shows the **Purchase MIS** (hr-erp's MIS report, as the CRM shows it at `/purchase-mis`) and the **Designer MIS** (the CRM's `/reports/designer-mis`) as a full-screen animated slideshow, with live updates over Socket.IO, so the page never needs a refresh.

It is a sibling of Score Live (same look, rotation, settings, voice, cartoon announcer and old-TV support) and runs on its own port, **4001**, so both can run on one PC. The CRM and hr-erp are not changed in any way: the TV logs in to the CRM as a normal user and reads what the two pages read.

**Both boards score the MIS way:** a signed miss %, **0% is best** — Score = −(planned − done on time) ÷ planned × 100 (e.g. **−43.4% D**), with the page's grade, on time / late / not done, work not done %, pending now (not done + carried over) and each person's average delay in working hours. Periods: **This week · Last week · This month · Last month** (Monday–Sunday IST weeks, calendar months), the pages' own.

## Setup (one time)

1. Install Node 18 or newer.
2. Copy `.env.example` to `.env` and fill in:
   - `FIREBASE_API_KEY`: the CRM's `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `CRM_EMAIL`, `CRM_PASSWORD`: a CRM login with `purchase_mis.view` and `designer_mis.view` (a Super Admin has both).
3. Run `npm install`.

## Run

- Double-click `Start Purchase Design Live.bat`. It opens Chrome full screen (kiosk mode). If the server is already running it only opens the browser — **after an update, close the server's window first** so the new code starts.
- Or run `npm start` and open http://localhost:4001.
- Demo with sample data: http://localhost:4001/?mock=1
- Pick a period or board from the URL: `?purchase=last-week&design=this-month&board=design`
- To show another TV on the same network: `http://<this-PC-IP>:4001`

**What the TV shows:** the Purchase MIS board (KPI cards + every doer ranked, with their duties), then **each purchaser one by one** (a card per person: score and grade, on time / late / not done, pending, average delay, the step they miss most), then the Purchase leader spotlight; then the same three for the designers. Then it starts again. Order, on/off and time per board are set on the settings page. Whoever is on top has a flame, the last one gets a little "Push!" coach, and while the voice speaks a cartoon announcer with a mic shows what it is saying.

### Where the numbers come from

**Purchase MIS** — hr-erp builds the MIS report on its own server (`lib/mis/load.server.ts` `loadMis`: packaging purchase, sales orders and cylinders, doers from its doer master) — the one place the MIS page, the CRM's `/purchase-mis` frame and `/embed/pc-score` take their numbers from. The TV opens the CRM's `/purchase-mis` page as its login (the CRM signs a 30-minute frame token for it), opens hr-erp's `/embed/mis-report` for each period with that token, and takes the `report` the page is built from (`lib/purchaseSource.js`): the team line (every step once, however many people share it), each doer as ranked, with duties and step counts, and the steps behind them. Nothing is re-scored: the TV prints hr-erp's numbers (`engine/purchaseMis.js`). If the page cannot be read, the CRM's `GET /api/purchase-mis-score` (hr-erp's `/embed/pc-score`, the same `loadMis`) stands in, with the team line added up from the doers, and the rail says a source is using it.

**Designer MIS** — what the CRM's Designer MIS page reads, once per poll: `/api/design-requests`, `/api/rules/resolved`, `/api/work-calendar` (office holidays and clock rules) and `/api/designer-steps` (hr-erp's cylinder design uploads, for the period and the trend's weeks together, as the page asks). Every period is scored here by the CRM's own code (`lib/designer-mis/report.js` `buildDesignRequestMisReport` and what it imports), copied verbatim into `engine/crm/` by `npm run sync-crm`. A finished week or month is shown as the CRM froze it (`GET /api/mis/periods?profile=designer`, read once), exactly as the page shows it. The Avg delay card is the page's (`averageDelayHours`).

Steps fall due through the day and the design desk edits the sheet all day, so two screens a few minutes apart can differ by a step or two; pick the same period on the TV and the page to compare.

### Settings page

Open `/settings.html` (or press **S** / the gear button on the TV). Everything there is saved on the server in `data/settings.json` and applies live to every TV:

theme (dark / light / auto) · default Purchase and Design period · rotate on/off or stay on one board · board order · each board on/off and its seconds on screen (3–300) · animation on/off, style (slide, fade, zoom, flip, wipe) and speed (0.5×–2×) · rows per page (0 = fit the screen) and seconds per page (a one-by-one board's time is shared by its people, at least that many seconds each) · show filter bar · show ticker · voice. Settings saved before this version keep working: old periods are read as the nearest MIS period (7 days → This week, This month / 30 days → This month, Last month → Last month) and the one-by-one boards are added in their place.

**PIN:** set `SETTINGS_PIN=1234` in `.env` and the settings page asks for it before saving. After 5 wrong PINs in 10 minutes from one machine, saving is blocked for the rest of those 10 minutes (HTTP 429).

### Voice

The board reads itself aloud, free (the same voice code as Score Live). On the settings page:

- **Speak automatically** at the chosen times (IST), every day or on chosen days. With **Follow the slides**, at each time the TV goes back to its first slide, the cartoon announcer comes in with the mic, and **every slide stays until its words have been said** — on the one-by-one boards, every person stays until their card has been read — then a bell and the next slide. After one full cycle the slides run on their own timings again. Outside the times, the slides run on the timings set above. **One summary** reads Purchase and Design together without moving the slides; **Non-stop** reads every slide all day.
- **What it says:** who is top, their minus score, grade and average delay (with a fanfare); who is late — how many steps, how late on average, how many pending; the last one with their delay (with a "push" drum roll); the team's score; and on the one-by-one boards each person's place, score, delay, open steps and the step they miss most. Hindi or English, tone of words, who speaks, alert tone, volume, speed and pitch. **Test** plays the draft.
- **Who speaks:** *Online voice (server)* (default, recommended for TVs) — `GET /api/tts` (`lib/tts.js`) makes the MP3 with Microsoft Edge's free online voices, and with Google Translate's voice when Edge refuses; the server PC needs internet. *Auto* / *This screen's voice* use the browser's own voice.

Press **V** on a board to hear it now. Browsers only let a page speak after someone clicks on it once; a kiosk TV can skip that with Chrome's `--autoplay-policy=no-user-gesture-required`. `GET /health` shows the last voice made and the last failure.

### Keys

**1…4** pick a Purchase period · **←/→** previous / next board · **Space** pause · **F** full screen · **S** settings · **T** theme · **V** speak.

## How it works

```
CRM /purchase-mis ─ frame token ─> hr-erp /embed/mis-report (report per period) ─┐
CRM design requests, rules, calendar, designer steps, frozen records ────────────┼─ poll every POLL_SECONDS (min 120)
                                                                                  └─> server.js ─ socket.io 'scores' ─> TV
```

| Part | What it does |
|---|---|
| `lib/crmClient.js` | Firebase login, then `/api/auth/login` for the session cookie. Logs in again on a 401 (and when a page answers with the login page). |
| `lib/purchaseSource.js` | hr-erp's MIS report for a period, read through the CRM's `/purchase-mis` frame; the `/api/purchase-mis-score` fallback. |
| `lib/poller.js` | Each poll: the Designer MIS reads and the four purchase reports. Keeps the last good copy of every source (a closed period's frozen record is read once), builds every period of both boards. |
| `engine/purchaseMis.js` | hr-erp's report as the TV's board (the team line, the doers, each doer's delay and most-missed step). |
| `engine/designMis.js` | The Designer MIS page's report per period, on the CRM's own code; frozen records for closed periods. |
| `engine/misPeriods.js` | This week · Last week · This month · Last month (CRM `lib/mis/period.js`, the same as hr-erp's). |
| `engine/crm/**` | Verbatim copies of the CRM modules (`engine/crm/SOURCE.json` names the commit). |
| `lib/settings.js`, `lib/settingsRoutes.js` | Settings defaults, validation and atomic save; `GET`/`PUT /api/settings`. |
| `public/` | The TV slideshow (`misView.js` boards, `peopleView.js` one-by-one cards, `spotView.js` spotlights, `mascot.js` cartoons, `voice/*` the voice). Plain HTML/CSS/JS, no build step (an ES5 copy is built at start for old TVs). |

**Payload** (`GET /api/scores`, socket event `scores`): `{ updatedAt, pollSeconds, status: { ok, errors[], sources }, purchase: { periods, byPeriod: { 'this-week' | 'last-week' | 'this-month' | 'last-month': Board } }, design: { periods, byPeriod } }`, where a Board is `{ title, kind, period: { key, label, from, to, dates, frozenAt? }, summary, people: [{ id, rank, name, tags, score, scoreText, scoreTone, grade, steps, onTime, late, overdue, pending, carryover, upcoming, notDonePct, avgDelayMin, avgDelayLabel, worstStep, topReason }], idle, warnings }`. The `…Text` / `…Label` strings are what the pages print, so the TV never re-rounds a number.

## Checks

- `npm test` — settings contract, the voice (what it says, the schedule), the demo data, and the narration: a slide, and each person on a one-by-one slide, stays until its last line has played.
- `npm run selftest` — builds every period from the answers saved in `engine/sample/` (clock pinned to `meta.json`) and checks that hr-erp's report comes through unchanged (team line, ranks, counts, the signed %), that the designer boards follow the MIS rules, and compares each closed period with the record the CRM froze for it. Refresh the samples with `node tools/fetch-crm.mjs samples` (or into another folder and run with `LIVE_DIR=<dir>`).
- One response to a file: `MSYS_NO_PATHCONV=1 node tools/fetch-crm.mjs "/api/rules/resolved" out.json`.

**When the CRM's Designer MIS code changes:** pull the CRM checkout, run `npm run sync-crm` (reads `C:/Users/xyz/Desktop/CRM-APP-HRE-16`, or `CRM_SRC`, or a path argument; it rewrites `engine/crm/` and stops with an error naming any import it cannot copy), then `npm run selftest` and restart the server. The Purchase MIS needs nothing: hr-erp's report is read as built.

A second test server can keep its own settings: `PORT=4011 SETTINGS_FILE=/tmp/test-settings.json npm start`.

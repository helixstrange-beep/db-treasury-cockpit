# Meesho Treasury Cockpit

A database-backed, responsive treasury dashboard for the Meesho group. It shows
portfolio distribution with instrument drill-down, a credit / negative-media
monitor, live market yields, and a maturity-and-liquidity view — with an admin UI
to add, edit and delete holdings. Built with **Next.js (App Router)**,
**Postgres via Prisma**, and **Recharts**. Designed to deploy on **Vercel** from
**GitHub**.

> **This build has no authentication** — it deploys with just a database, so you
> can get it live without any Google OAuth / SSO setup. (Auth can be layered back
> on later.)

## Screens

- **Portfolio** — total AUM, weighted-avg YTM & maturity, allocation donut
  (toggle by instrument / MF category / entity / IPO / issuer), top-exposure
  concentration, and a searchable, sortable holdings table with a detail drawer.
- **Credit & Media** — issuer/counterparty news sorted worst-first, severity
  filters, and a watchlist auto-built from live holdings with exposure sizing.
- **Live Market** — benchmark yield history (INR rates / USD curve / USD-INR),
  portfolio YTM vs 10Y G-sec, and a live yield monitor (simulated ticks).
- **Maturity & Liquidity** — maturity ladder, maturities by month, and a 90-day
  upcoming-maturity calendar with ≤14-day reinvestment flags.

The UI is fully responsive: a sidebar layout on desktop collapses to a mobile
top bar + bottom tab navigation on phones (breakpoint 760px).

## Tech / architecture

```
src/app            App Router pages: / (dashboard), /admin
src/app/api        Route handlers: holdings (CRUD), market, maturity, media, candidates
src/lib            prisma client, compliance + screener engines, formatting helpers
prisma/schema.prisma   Holding, MarketPoint, MaturityBucket, MediaItem models
prisma/seed.ts     Loads data/seed.json (your 23-Jun statement) into the DB
data/seed.json     145 real holdings + market history + maturity buckets + media
```

All external data flows through the API routes, so swapping the simulated live
feed for real sources (AMFI NAVs, CCIL/RBI rates, treasury.gov, a market terminal,
or a news/ratings API) is localized to the API layer and the client tick loop.

## Local development

```bash
npm install
cp .env.example .env         # then fill in the values (see below)
npm run db:push              # create tables in your Postgres db
npm run db:seed              # load the initial data
npm run dev                  # http://localhost:3000
```

### Environment variables (`.env`)

| Variable | What it is |
| --- | --- |
| `POSTGRES_PRISMA_URL` | Pooled Postgres URL (Prisma). From Vercel Postgres. |
| `POSTGRES_URL_NON_POOLING` | Direct Postgres URL (for migrations/seed). |

That's the whole list — no auth secrets are needed for this build.

## Deploy to Vercel via GitHub

1. **Push to GitHub**
   ```bash
   git init && git add . && git commit -m "Treasury cockpit"
   git branch -M main
   git remote add origin https://github.com/<you>/meesho-treasury-cockpit.git
   git push -u origin main
   ```
2. **Import into Vercel** — New Project → import the GitHub repo. Framework
   auto-detects as Next.js.
3. **Add a database** — in the Vercel project: **Storage → Create → Postgres**.
   Vercel injects `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING` automatically.
   No other environment variables are required.
4. **Deploy.** The build runs `prisma generate && prisma db push && next build`,
   so your tables are created automatically on the first build.
5. **Seed the data once.** Open your database's SQL editor (Neon / Vercel Postgres
   dashboard) and run the provided `treasury-seed.sql`, or from your machine with
   the production non-pooling URL in `.env`:
   ```bash
   npm run db:seed
   ```

The dashboard is then live for anyone with the URL, and holdings can be managed
from the **Manage holdings** page — no sign-in required.

## Daily news refresh (automated)

`/api/cron/refresh-news` refreshes the Credit & Media feed on its own, driven by
a **Vercel Cron Job** (defined in `vercel.json`). On each run it:

1. reads the distinct issuers from your holdings book,
2. asks OpenAI (with its web-search tool) for material 2-day news per issuer
   (rating actions, defaults, regulatory/fraud, liquidity events),
3. classifies each item as `high` / `medium` / `low` / `positive`,
4. de-duplicates against recent items and inserts only what's new (add-only;
   it never deletes), capped per issuer.

Because it runs on Vercel — same place as the database — there is no external
network dependency and nothing to schedule outside the project.

### Setup

1. In the Vercel project, add environment variables (Settings → Environment
   Variables):
   - `OPENAI_API_KEY` — your OpenAI key
   - `CRON_SECRET` — a long random string (`openssl rand -hex 32`). Vercel
     automatically sends this as `Authorization: Bearer <CRON_SECRET>` on cron
     invocations, and the route rejects any request without it.
   - *(optional)* `OPENAI_MODEL`, `NEWS_LOOKBACK_DAYS`, `NEWS_MAX_PER_ISSUER`,
     `NEWS_MAX_ISSUERS` — see `.env.example`.
2. Redeploy. Vercel registers the cron from `vercel.json`.
3. The schedule `30 1 * * *` (UTC) = **07:00 IST daily**. Edit `vercel.json` to
   change it. (Vercel Cron uses UTC; IST is UTC+5:30.)

> **Plan note:** Vercel **Hobby** allows once-daily crons and caps function
> runtime at 60s — keep `NEWS_MAX_ISSUERS` low there. **Pro** allows more
> frequent schedules and up to 300s (`maxDuration` in the route).

Trigger a run manually to test:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://db-treasury-cockpit.vercel.app/api/cron/refresh-news
```

## Notes

- Media/credit items are refreshed automatically by the cron above, and remain
  editable via `src/app/api/media` and the Manage-media page.
- Amounts are stored in absolute rupees and displayed in ₹ crore.
- Two NCDs seed without a mapped issuer (their full name is used) — set the
  issuer field on those rows in Manage holdings.

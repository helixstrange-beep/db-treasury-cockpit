import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Daily live market-data refresh. Designed to run as a Vercel Cron Job (see
// vercel.json). Vercel attaches "Authorization: Bearer <CRON_SECRET>" to cron
// invocations, which we verify before doing any work. Can also be triggered
// manually with the same bearer token:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/refresh-market
//
// TIER 1 sources (free, no API key, run from the Vercel runtime which has open
// egress — NOT from a restricted sandbox):
//   1. USD-INR       -> Frankfurter / ECB reference rates (api.frankfurter.app)
//   2. US Treasury   -> Treasury daily par yield curve XML (home.treasury.gov)
//   3. MF NAVs       -> AMFI NAVAll.txt (www.amfiindia.com), matched by ISIN
//
// Each source writes into the existing MarketPoint table (usdinr, ust1m, ust3m,
// ust6m, ust1y) except NAVs, which reprice the `amount` of Mutual Fund holdings
// by NAV ratio (value scales with NAV since units are constant).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Refuse to run rather than expose a write path when no secret is configured.
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

function enabled(name: string): boolean {
  // Each source is on by default; set MARKET_FX/MARKET_UST/MARKET_NAV="false" to skip.
  return (process.env[name] || "").toLowerCase() !== "false";
}

// Normalise any date to midnight UTC so MarketPoint's @@unique([date, series])
// treats one calendar day as one row.
function dayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function upsertPoint(date: Date, series: string, value: number): Promise<void> {
  const d = dayUTC(date);
  await prisma.marketPoint.upsert({
    where: { date_series: { date: d, series } },
    update: { value },
    create: { date: d, series, value },
  });
}

// ---- 1. USD-INR via Frankfurter (ECB reference rates) ----
async function refreshFx(): Promise<{ series: string; value: number; date: string }> {
  const url = "https://api.frankfurter.app/latest?from=USD&to=INR";
  const res = await fetch(url, { headers: { "User-Agent": "TreasuryCockpit/1.0" } });
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
  const j: any = await res.json();
  const rate = Number(j?.rates?.INR);
  if (!isFinite(rate) || rate <= 0) throw new Error("Frankfurter: no INR rate in payload");
  const date = j?.date ? new Date(j.date) : new Date();
  // usdinr is stored as a plain rate (e.g. 86.35), matching the dashboard's usage.
  await upsertPoint(date, "usdinr", rate);
  return { series: "usdinr", value: rate, date: dayUTC(date).toISOString().slice(0, 10) };
}

// ---- 2. US Treasury daily par yield curve (home.treasury.gov XML feed) ----
// Values in the feed are in percent (e.g. 5.37); we store fractions (0.0537)
// because the dashboard's pct() multiplies yields by 100.
const UST_MAP: Record<string, string> = {
  BC_1MONTH: "ust1m",
  BC_3MONTH: "ust3m",
  BC_6MONTH: "ust6m",
  BC_1YEAR: "ust1y",
};

function pickTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<d:${tag}[^>]*>([\\s\\S]*?)</d:${tag}>`));
  return m ? m[1].trim() : null;
}

async function refreshUST(): Promise<{ date: string; points: Record<string, number> }> {
  const year = new Date().getUTCFullYear();
  const url =
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml" +
    `?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const res = await fetch(url, { headers: { "User-Agent": "TreasuryCockpit/1.0" } });
  if (!res.ok) throw new Error(`Treasury ${res.status}`);
  const xml = await res.text();
  // Each <entry> is one date's curve; the feed is chronological, so take the last.
  const entries = xml.split(/<entry>/).slice(1).map((c) => c.split("</entry>")[0]);
  if (!entries.length) throw new Error("Treasury: no entries in feed");
  const last = entries[entries.length - 1];
  const rawDate = pickTag(last, "NEW_DATE");
  const date = rawDate ? new Date(rawDate) : new Date();
  const points: Record<string, number> = {};
  for (const [tag, series] of Object.entries(UST_MAP)) {
    const raw = pickTag(last, tag);
    if (raw == null || raw === "") continue;
    const pctVal = Number(raw);
    if (!isFinite(pctVal)) continue;
    const frac = pctVal / 100;
    await upsertPoint(date, series, frac);
    points[series] = frac;
  }
  if (!Object.keys(points).length) throw new Error("Treasury: no tenor values parsed");
  return { date: dayUTC(date).toISOString().slice(0, 10), points };
}

// ---- 3. AMFI mutual-fund NAVs (NAVAll.txt), matched by ISIN ----
// File format (semicolon-delimited), interspersed with AMC header lines:
//   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
function parseAmfiDate(s: string): Date | null {
  // e.g. "10-Jul-2026"
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const mon = months[m[2].toLowerCase()];
  if (mon == null) return null;
  return new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
}

async function refreshNav(): Promise<{ marked: number; repriced: number; unmatched: number }> {
  // Only Mutual Fund holdings that carry an ISIN can be marked.
  const holdings = await prisma.holding.findMany({
    where: { type: "Mutual Fund", isin: { not: null } },
    select: { id: true, isin: true, amount: true, nav: true },
  });
  if (!holdings.length) return { marked: 0, repriced: 0, unmatched: 0 };
  const wanted = new Map<string, { id: string; amount: number; nav: number | null }>();
  for (const h of holdings as { id: string; isin: string | null; amount: number; nav: number | null }[]) {
    const isin = (h.isin || "").trim().toUpperCase();
    if (isin) wanted.set(isin, { id: h.id, amount: h.amount, nav: h.nav });
  }

  const url = process.env.AMFI_NAV_URL || "https://www.amfiindia.com/spages/NAVAll.txt";
  const res = await fetch(url, { headers: { "User-Agent": "TreasuryCockpit/1.0" } });
  if (!res.ok) throw new Error(`AMFI ${res.status}`);
  const text = await res.text();

  // Build ISIN -> { nav, date } from the file (both the payout and growth ISIN columns).
  const navByIsin = new Map<string, { nav: number; date: Date | null }>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(";");
    if (parts.length < 6) continue; // skip AMC headers / blank / section lines
    const isin1 = parts[1]?.trim().toUpperCase();
    const isin2 = parts[2]?.trim().toUpperCase();
    const nav = Number(parts[4]?.trim());
    if (!isFinite(nav) || nav <= 0) continue;
    const date = parseAmfiDate(parts[5] || "");
    for (const isin of [isin1, isin2]) {
      if (isin && /^INF/.test(isin)) navByIsin.set(isin, { nav, date });
    }
  }

  let marked = 0;
  let repriced = 0;
  let unmatched = 0;
  for (const [isin, h] of wanted) {
    const hit = navByIsin.get(isin);
    if (!hit) {
      unmatched++;
      continue;
    }
    const data: { nav: number; navDate: Date; amount?: number } = {
      nav: hit.nav,
      navDate: hit.date || new Date(),
    };
    // Reprice only when we have a prior NAV to compare against; the first mark
    // just records the baseline so we never move `amount` on incomplete data.
    if (h.nav && h.nav > 0 && hit.nav !== h.nav) {
      data.amount = h.amount * (hit.nav / h.nav);
      repriced++;
    }
    await prisma.holding.update({ where: { id: h.id }, data });
    marked++;
  }
  return { marked, repriced, unmatched };
}

async function run() {
  const out: {
    ok: boolean;
    ranAt: string;
    fx?: unknown;
    ust?: unknown;
    nav?: unknown;
    errors: Record<string, string>;
  } = { ok: true, ranAt: new Date().toISOString(), errors: {} };

  if (enabled("MARKET_FX")) {
    try {
      out.fx = await refreshFx();
    } catch (e: any) {
      out.errors.fx = String(e?.message || e).slice(0, 300);
    }
  }
  if (enabled("MARKET_UST")) {
    try {
      out.ust = await refreshUST();
    } catch (e: any) {
      out.errors.ust = String(e?.message || e).slice(0, 300);
    }
  }
  if (enabled("MARKET_NAV")) {
    try {
      out.nav = await refreshNav();
    } catch (e: any) {
      out.errors.nav = String(e?.message || e).slice(0, 300);
    }
  }

  return out;
}

export async function GET(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await run());
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// Allow manual POST triggers with the same bearer token.
export async function POST(req: NextRequest) {
  return GET(req);
}

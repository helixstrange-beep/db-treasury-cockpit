import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ONE-TIME historical backfill for the market chart. Unlike refresh-market
// (which writes today's point), this fills a date RANGE with real daily data so
// the "Benchmark yield history" chart has no gap between the seeded demo history
// and the live cron data.
//
// It backfills the two series that have free historical sources:
//   - usdinr           -> Frankfurter time-series (api.frankfurter.app/{from}..{to})
//   - ust1m/3m/6m/1y   -> US Treasury yearly par-yield feeds (all trading days)
// India benchmarks (tb91/tb364/g10y) have no free daily historical API and are
// NOT backfilled here — that needs the Tier-2 FBIL/CCIL feed.
//
// This route is intentionally NOT in vercel.json (it must not run on a schedule).
// Trigger it once, from a browser, with the CRON_SECRET as a query key:
//   https://<app>/api/cron/backfill-market?key=<CRON_SECRET>
// Optional range override (defaults to the last ~480 days up to yesterday):
//   ...&from=2025-03-19&to=2026-07-11

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Accept the secret either as a Bearer header (like the crons) or as a ?key=
// query param, so it can be run once from a browser on the web-only setup.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("key") === secret;
}

async function fetchWithTimeout(url: string, ms = 45000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "TreasuryCockpit/1.0" } });
  } finally {
    clearTimeout(timer);
  }
}

function dayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Point = { date: Date; series: string; value: number };

// Upsert in small parallel chunks so a multi-hundred-row backfill stays well
// inside the function time budget without hammering the connection pool.
async function upsertMany(points: Point[]): Promise<number> {
  const chunk = 20;
  let n = 0;
  for (let i = 0; i < points.length; i += chunk) {
    const slice = points.slice(i, i + chunk);
    await Promise.all(
      slice.map((p) => {
        const d = dayUTC(p.date);
        return prisma.marketPoint.upsert({
          where: { date_series: { date: d, series: p.series } },
          update: { value: p.value },
          create: { date: d, series: p.series, value: p.value },
        });
      })
    );
    n += slice.length;
  }
  return n;
}

// ---- USD-INR daily history (Frankfurter time-series) ----
async function backfillFx(from: string, to: string): Promise<Point[]> {
  const url = `https://api.frankfurter.app/${from}..${to}?from=USD&to=INR`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
  const j: any = await res.json();
  const rates = j?.rates || {};
  const pts: Point[] = [];
  for (const [d, obj] of Object.entries(rates)) {
    const v = Number((obj as any)?.INR);
    if (isFinite(v) && v > 0) pts.push({ date: new Date(d), series: "usdinr", value: v });
  }
  return pts;
}

// ---- US Treasury curve daily history (yearly feeds, all trading days) ----
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

async function fetchUstEntries(year: number): Promise<string[]> {
  const url =
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml" +
    `?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Treasury ${res.status}`);
  const xml = await res.text();
  return xml.split(/<entry>/).slice(1).map((c) => c.split("</entry>")[0]);
}

async function backfillUst(fromMs: number, toMs: number): Promise<Point[]> {
  const years = new Set<number>();
  for (let y = new Date(fromMs).getUTCFullYear(); y <= new Date(toMs).getUTCFullYear(); y++) years.add(y);
  const pts: Point[] = [];
  for (const year of years) {
    const entries = await fetchUstEntries(year);
    for (const e of entries) {
      const rawDate = pickTag(e, "NEW_DATE");
      if (!rawDate) continue;
      const t = new Date(rawDate).getTime();
      if (isNaN(t) || t < fromMs || t > toMs) continue;
      for (const [tag, series] of Object.entries(UST_MAP)) {
        const raw = pickTag(e, tag);
        if (raw == null || raw === "") continue;
        const v = Number(raw) / 100; // feed is percent; store fraction
        if (isFinite(v)) pts.push({ date: new Date(rawDate), series, value: v });
      }
    }
  }
  return pts;
}

async function run(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ? new Date(sp.get("to")!) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const from = sp.get("from")
    ? new Date(sp.get("from")!)
    : new Date(to.getTime() - 480 * 24 * 60 * 60 * 1000);
  const fromMs = dayUTC(from).getTime();
  const toMs = dayUTC(to).getTime();

  const out: {
    ok: boolean;
    from: string;
    to: string;
    fxInserted: number;
    ustInserted: number;
    errors: Record<string, string>;
  } = { ok: true, from: iso(dayUTC(from)), to: iso(dayUTC(to)), fxInserted: 0, ustInserted: 0, errors: {} };

  try {
    out.fxInserted = await upsertMany(await backfillFx(out.from, out.to));
  } catch (e: any) {
    out.errors.fx = String(e?.message || e).slice(0, 300);
  }
  try {
    out.ustInserted = await upsertMany(await backfillUst(fromMs, toMs));
  } catch (e: any) {
    out.errors.ust = String(e?.message || e).slice(0, 300);
  }

  return out;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await run(req));
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

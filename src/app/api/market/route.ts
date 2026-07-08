import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Point = { date: Date; series: string; value: number };

// GET /api/market — returns { dates, series:{...}, current:{...} }
export async function GET() {
  const points: Point[] = await prisma.marketPoint.findMany({ orderBy: { date: "asc" } });
  const dateSet: string[] = Array.from(
    new Set(points.map((p: Point) => p.date.toISOString().slice(0, 10)))
  ).sort();
  const series: Record<string, (number | null)[]> = {};
  const idx = new Map<string, number>(dateSet.map((d, i) => [d, i] as [string, number]));
  for (const p of points) {
    if (!series[p.series]) series[p.series] = dateSet.map(() => null);
    series[p.series][idx.get(p.date.toISOString().slice(0, 10))!] = p.value;
  }
  const current: Record<string, number> = {};
  for (const [k, arr] of Object.entries(series)) {
    const last = [...arr].reverse().find((v) => v != null);
    if (last != null) current[k] = last;
  }
  return NextResponse.json({ dates: dateSet, series, current });
}

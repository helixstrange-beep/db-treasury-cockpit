import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Row = {
  id: string; issuer: string; name: string; isin: string; sector: string;
  rating: string; ytm: number; maturity: Date; lot: number; sample: boolean;
};

// GET /api/candidates — bond-screener candidate universe
export async function GET() {
  const rows: Row[] = await prisma.bondCandidate.findMany({ orderBy: { ytm: "desc" } });
  return NextResponse.json(
    rows.map((c: Row) => ({
      id: c.id, issuer: c.issuer, name: c.name, isin: c.isin, sector: c.sector,
      rating: c.rating, ytm: c.ytm, maturity: c.maturity.toISOString().slice(0, 10),
      lot: c.lot, sample: c.sample,
    }))
  );
}

// POST /api/candidates — add a candidate bond
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.issuer || !b.name || !b.isin || !b.rating || b.ytm == null || !b.maturity)
    return NextResponse.json({ error: "issuer, name, isin, rating, ytm and maturity are required" }, { status: 400 });
  const created = await prisma.bondCandidate.create({
    data: {
      issuer: b.issuer, name: b.name, isin: b.isin, sector: b.sector || "PSU",
      rating: b.rating, ytm: Number(b.ytm), maturity: new Date(b.maturity),
      lot: b.lot != null ? Number(b.lot) : 1.0, sample: b.sample ?? false,
    },
  });
  return NextResponse.json(created, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/holdings — list all holdings
export async function GET() {
  const holdings = await prisma.holding.findMany({ orderBy: { amount: "desc" } });
  return NextResponse.json(holdings);
}

// POST /api/holdings — create a holding
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.name || !b.type || b.amount == null)
    return NextResponse.json({ error: "name, type and amount are required" }, { status: 400 });
  const created = await prisma.holding.create({
    data: {
      name: b.name,
      issuer: b.issuer || null,
      type: b.type,
      category: b.category || null,
      amount: Number(b.amount),
      ytm: b.ytm != null && b.ytm !== "" ? Number(b.ytm) : null,
      deposit: b.deposit ? new Date(b.deposit) : null,
      maturity: b.maturity ? new Date(b.maturity) : null,
      maturityAmount: b.maturityAmount != null && b.maturityAmount !== "" ? Number(b.maturityAmount) : null,
      entity: b.entity || null,
      ipo: b.ipo || "Non-IPO",
      geo: b.geo || "India",
    },
  });
  return NextResponse.json(created, { status: 201 });
}

// PUT /api/holdings?id=<id> — update a holding
export async function PUT(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  const b = await req.json();
  const updated = await prisma.holding.update({
    where: { id },
    data: {
      name: b.name,
      issuer: b.issuer || null,
      type: b.type,
      category: b.category || null,
      amount: Number(b.amount),
      ytm: b.ytm != null && b.ytm !== "" ? Number(b.ytm) : null,
      deposit: b.deposit ? new Date(b.deposit) : null,
      maturity: b.maturity ? new Date(b.maturity) : null,
      maturityAmount: b.maturityAmount != null && b.maturityAmount !== "" ? Number(b.maturityAmount) : null,
      entity: b.entity || null,
      ipo: b.ipo || "Non-IPO",
      geo: b.geo || "India",
    },
  });
  return NextResponse.json(updated);
}

// DELETE /api/holdings?id=<id> — delete a holding
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  await prisma.holding.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/media — credit / negative-media items
export async function GET() {
  const items = await prisma.mediaItem.findMany({ orderBy: { date: "desc" } });
  return NextResponse.json(items);
}

// POST /api/media — add an item
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.issuer || !b.severity || !b.headline)
    return NextResponse.json({ error: "issuer, severity and headline are required" }, { status: 400 });
  const created = await prisma.mediaItem.create({
    data: {
      issuer: b.issuer,
      severity: b.severity,
      date: b.date ? new Date(b.date) : new Date(),
      source: b.source || "Manual",
      headline: b.headline,
      summary: b.summary || "",
    },
  });
  return NextResponse.json(created, { status: 201 });
}

// DELETE /api/media?id=<id> — remove an item
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  await prisma.mediaItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

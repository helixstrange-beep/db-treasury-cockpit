import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/maturity — maturity buckets in order
export async function GET() {
  const buckets = await prisma.maturityBucket.findMany({ orderBy: { order: "asc" } });
  return NextResponse.json(buckets);
}

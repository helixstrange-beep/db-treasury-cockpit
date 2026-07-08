import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

type SeedHolding = {
  name: string; issuer?: string | null; type: string; category?: string | null;
  amount: number; ytm?: number | null; deposit?: string | null; maturity?: string | null;
  maturityAmount?: number | null; entity?: string | null; ipo?: string; geo?: string;
};

async function main() {
  const raw = readFileSync(join(process.cwd(), "data", "seed.json"), "utf-8");
  const data = JSON.parse(raw) as {
    holdings: SeedHolding[];
    marketPoints: { date: string; series: string; value: number }[];
    maturityBuckets: { period: string; debts: number; mutualFunds: number; order: number }[];
    mediaItems: { issuer: string; severity: string; date: string; source: string; headline: string; summary: string }[];
    candidates?: { issuer: string; name: string; isin: string; sector: string; rating: string; ytm: number; maturity: string; lot: number; sample?: boolean }[];
  };

  console.log("Clearing existing rows…");
  await prisma.holding.deleteMany();
  await prisma.marketPoint.deleteMany();
  await prisma.maturityBucket.deleteMany();
  await prisma.mediaItem.deleteMany();
  await prisma.bondCandidate.deleteMany();

  console.log(`Seeding ${data.holdings.length} holdings…`);
  await prisma.holding.createMany({
    data: data.holdings.map((h) => ({
      name: h.name,
      issuer: h.issuer ?? null,
      type: h.type,
      category: h.category ?? null,
      amount: h.amount,
      ytm: h.ytm ?? null,
      deposit: h.deposit ? new Date(h.deposit) : null,
      maturity: h.maturity ? new Date(h.maturity) : null,
      maturityAmount: h.maturityAmount ?? null,
      entity: h.entity ?? null,
      ipo: h.ipo ?? "Non-IPO",
      geo: h.geo ?? "India",
    })),
  });

  console.log(`Seeding ${data.marketPoints.length} market points…`);
  await prisma.marketPoint.createMany({
    data: data.marketPoints.map((m) => ({ date: new Date(m.date), series: m.series, value: m.value })),
    skipDuplicates: true,
  });

  console.log(`Seeding ${data.maturityBuckets.length} maturity buckets…`);
  for (const b of data.maturityBuckets) {
    await prisma.maturityBucket.upsert({
      where: { period: b.period },
      update: { debts: b.debts, mutualFunds: b.mutualFunds, order: b.order },
      create: b,
    });
  }

  console.log(`Seeding ${data.mediaItems.length} media items…`);
  await prisma.mediaItem.createMany({
    data: data.mediaItems.map((m) => ({
      issuer: m.issuer, severity: m.severity, date: new Date(m.date),
      source: m.source, headline: m.headline, summary: m.summary,
    })),
  });

  const candidates = data.candidates ?? [];
  console.log(`Seeding ${candidates.length} bond candidates…`);
  if (candidates.length) {
    await prisma.bondCandidate.createMany({
      data: candidates.map((c) => ({
        issuer: c.issuer, name: c.name, isin: c.isin, sector: c.sector, rating: c.rating,
        ytm: c.ytm, maturity: new Date(c.maturity), lot: c.lot, sample: c.sample ?? true,
      })),
      skipDuplicates: true,
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

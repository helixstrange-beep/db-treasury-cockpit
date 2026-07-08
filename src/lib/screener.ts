import { cr, CR, daysTo, sum, AS_OF, type Holding } from "./format";
import { POLICY, canonIssuer, isScheduled, REC_PFC } from "./compliance";

/* ===================== BOND SCREENER ===================== */

export type BondCandidate = {
  id?: string;
  issuer: string;
  name: string;
  isin: string;
  sector: string; // PSU | NBFC
  rating: string; // AAA | AA+ ...
  ytm: number; // fraction, e.g. 0.0745
  maturity: string; // ISO date
  lot: number; // in Cr
  sample?: boolean;
};

export type ScreenRow = {
  issuer: string;
  recpfc: boolean;
  name: string;
  isin: string;
  sector: string;
  rating: string;
  ratingOk: boolean;
  ytm: number;
  maturity: string;
  tenureM: number;
  lot: number;
  headroom: number | null; // Cr amount (raw), null if not approved
  pass: boolean;
  reasons: string[];
};

export type LadderRow = { issuer: string; name: string; ytm: number; amount: number };

export type ScreenerResult = {
  windowMonths: number | "all";
  windowLabel: string;
  matCash: number;
  maturingCount: number;
  nEligible: number;
  deployable: number;
  rows: ScreenRow[];
  ladder: LadderRow[];
  ladderNote: string;
};

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function runScreener(
  holdings: Holding[],
  candidates: BondCandidate[],
  windowMonths: number | "all" = 12
): ScreenerResult {
  const totalAUM = holdings.reduce((s, h) => s + h.amount, 0);
  const cap10 = POLICY.corpSingleIssuerCap * totalAUM;
  const today = AS_OF;

  // current corporate single-issuer exposure (alias-merged), incl. corporate/NBFC FDs
  const corp = holdings.filter(
    (h) => h.type === "Corporate Bond" || (h.type === "Bank Deposit" && !isScheduled(h.issuer))
  );
  const curExp: Record<string, number> = {};
  corp.forEach((h) => {
    const k = canonIssuer(h.issuer) || h.issuer || "-";
    curExp[k] = (curExp[k] || 0) + h.amount;
  });
  const recpfcExp = (curExp["REC Limited"] || 0) + (curExp["Power Finance Corp (PFC)"] || 0);
  const headroomKey = (canon: string) =>
    canon === "REC Limited" || canon === "Power Finance Corp (PFC)" ? REC_PFC : canon;
  const issuerExpFor = (canon: string) => {
    const hk = headroomKey(canon);
    return hk === REC_PFC ? recpfcExp : curExp[canon] || 0;
  };

  // maturing cash within window
  const maturing = holdings.filter((h) => {
    const d = daysTo(h.maturity);
    return d != null && d > 0 && (windowMonths === "all" || d <= windowMonths * 30.4);
  });
  const matCash = sum(maturing, (h) => h.maturityAmount || h.amount);

  // screen candidates
  const scored = candidates
    .map((c) => {
      const canon = canonIssuer(c.issuer);
      const approved = !!canon;
      const aaa = c.rating === "AAA";
      const tM = monthsBetween(today, new Date(c.maturity));
      const tenureOk = tM > 0 && tM <= POLICY.tenureMaxMonths;
      const hk = approved ? headroomKey(canon!) : null;
      const headroom = approved ? Math.max(0, cap10 - issuerExpFor(canon!)) : 0;
      const headOk = approved && headroom > 0;
      const pass = approved && aaa && tenureOk && headOk;
      const reasons: string[] = [];
      if (!approved) reasons.push("issuer not on approved list");
      if (!aaa) reasons.push(`rating ${c.rating} < AAA`);
      if (!tenureOk) reasons.push(`tenure ${tM}m > 36m`);
      if (approved && !headOk) reasons.push("issuer at 10% cap");
      return { c, canon, hk, tM, headroom, headOk, pass, reasons };
    })
    .sort((a, b) => Number(b.pass) - Number(a.pass) || b.c.ytm - a.c.ytm);

  const nEligible = scored.filter((s) => s.pass).length;

  // total deployable headroom across distinct eligible issuers
  const seen: Record<string, boolean> = {};
  let totHead = 0;
  scored
    .filter((s) => s.pass)
    .forEach((s) => {
      const hk = s.hk!;
      if (!seen[hk]) {
        seen[hk] = true;
        totHead += s.headroom;
      }
    });
  const deployable = Math.min(matCash, totHead);

  const rows: ScreenRow[] = scored.map((s) => ({
    issuer: s.c.issuer,
    recpfc: s.hk === REC_PFC,
    name: s.c.name,
    isin: s.c.isin,
    sector: s.c.sector,
    rating: s.c.rating,
    ratingOk: s.c.rating === "AAA",
    ytm: s.c.ytm,
    maturity: s.c.maturity,
    tenureM: s.tM,
    lot: s.c.lot,
    headroom: s.canon ? s.headroom : null,
    pass: s.pass,
    reasons: s.reasons,
  }));

  // suggested ladder (greedy fit, sized to single-issuer headroom)
  let remaining = matCash;
  const ladder: LadderRow[] = [];
  const usedHead: Record<string, number> = {};
  for (const s of scored) {
    if (!s.pass || remaining <= 0) continue;
    const hk = s.hk!;
    const avail = s.headroom - (usedHead[hk] || 0);
    if (avail <= 0) continue;
    const put = Math.min(remaining, avail);
    if (put <= 0) continue;
    usedHead[hk] = (usedHead[hk] || 0) + put;
    remaining -= put;
    ladder.push({ issuer: s.c.issuer, name: s.c.name, ytm: s.c.ytm, amount: put });
  }

  let ladderNote = "";
  if (!ladder.length) {
    ladderNote = "No maturing cash in this window, or no eligible names with headroom.";
  } else if (remaining > 1e6) {
    ladderNote =
      "₹" +
      cr(remaining) +
      " Cr of maturing cash still to place (issuer headroom exhausted in the eligible set — widen the approved universe or use MFs/bank FDs).";
  } else {
    ladderNote = "Illustrative fit; sized to single-issuer headroom, not to lot multiples.";
  }

  return {
    windowMonths,
    windowLabel: windowMonths === "all" ? "all upcoming" : `next ${windowMonths}m`,
    matCash,
    maturingCount: maturing.length,
    nEligible,
    deployable,
    rows,
    ladder,
    ladderNote,
  };
}

export const DATA_SOURCES: { title: string; body: string }[] = [
  {
    title: "Exchanges — debt segment",
    body: "NSE (NSE Bond / RFQ, EBP), BSE (BSE-Bond, BSE Direct). Primary bidding, traded prices, ISIN-level trade data.",
  },
  {
    title: "Online Bond Platform Providers (SEBI-regd OBPPs)",
    body: "GoldenPi, IndiaBonds, Wint Wealth, Bondbazaar, Harmoney — live secondary offers, YTM and available lots via their APIs.",
  },
  {
    title: "FIMMDA / CCIL / F-TRAC",
    body: "Reported OTC corporate-bond trades, valuation matrices and benchmark spreads used for MTM.",
  },
  {
    title: "Rating agencies",
    body: "CRISIL, ICRA, CARE, India Ratings & Research — ratings, outlooks and rating-action/watch feeds (drives the AAA and post-downgrade checks).",
  },
  {
    title: "Depositories & regulator",
    body: "NSDL / CDSL ISIN master & corporate actions; SEBI bond database; RBI NDS-OM & Retail Direct for G-secs / SDLs / T-bills.",
  },
  {
    title: "Market terminals & primary DB",
    body: "Bloomberg (Terminal, DEBT<GO>), LSEG/Refinitiv Eikon, Prime Database (primary issuances). Institutional coverage of the full universe.",
  },
];

export { CR };

import { cr, AS_OF, type Holding } from "./format";

/* ===================== INVESTMENT POLICY COMPLIANCE ===================== */

export type CheckStatus = "pass" | "breach" | "warn" | "info";
export type Cell = { text?: string; num?: boolean; badge?: { label: string; cls: CheckStatus } };
export type CheckTable = { head: { t: string; num?: boolean }[]; rows: Cell[][] };
export type Check = { section: string; title: string; status: CheckStatus; desc: string; table?: CheckTable };

export const POLICY = {
  version: "June 2026",
  geography: "India",
  approvedTypes: ["Corporate Bond", "Mutual Fund", "Bank Deposit", "Commercial Paper"],
  tenureMaxMonths: 36,
  largeBankKeys: ["SBI", "PNB", "BOB", "BOI", "AXIS", "ICICI", "KOTAK", "HDFC"],
  largeBankAggCap: 0.5,
  otherBankCapPct: 0.05,
  otherBankCapCr: 150,
  corpSingleIssuerCap: 0.1,
  mfHouseCap: 0.25,
  mfSchemeCap: 0.15,
  scheduledTokens: ["sbi", "pnb", "baroda", "bank of india", "axis", "icici", "kotak bank", "hdfc bank", "idfc", "rbl", "yes bank", "indusind", "federal"],
  approvedIssuers: [
    { n: "NABARD", a: ["nabard"] },
    { n: "Indian Railway Finance Corp (IRFC)", a: ["irfc", "railway finance"] },
    { n: "National Highway Authority (NHAI)", a: ["nhai", "highway authority"] },
    { n: "NHPC", a: ["nhpc"] },
    { n: "NTPC", a: ["ntpc"] },
    { n: "Power Grid Corp", a: ["power grid"] },
    { n: "M&M Financial Services", a: ["m&m finance", "mahindra finance", "mahindra & mahindra financial"] },
    { n: "Aditya Birla Capital (ABFL)", a: ["aditya birla finance", "aditya birla capital", "abfl"] },
    { n: "Sundaram Finance", a: ["sundaram finance"] },
    { n: "Tata Capital Housing Finance", a: ["tata capital housing"] },
    { n: "Bajaj Finance", a: ["bajaj finance"] },
    { n: "Bajaj Housing Finance", a: ["bajaj housing"] },
    { n: "HDB Financial Services", a: ["hdb financial", "hdb fin"] },
    { n: "HDFC Bank", a: ["hdfc bank"] },
    { n: "Kotak Mahindra Investments", a: ["kotak mahindra investments"] },
    { n: "Kotak Mahindra Prime", a: ["kotak mahindra prime", "kotak mahindra (kml)", "(kml)"] },
    { n: "LIC Housing Finance", a: ["lic housing"] },
    { n: "Tata Capital", a: ["tata capital", "tata cap"] },
    { n: "REC Limited", a: ["rec limited", "rec ltd"] },
    { n: "Power Finance Corp (PFC)", a: ["power finance", "pfc"] },
    { n: "SIDBI", a: ["sidbi", "small industries development"] },
  ] as { n: string; a: string[] }[],
};

export function canonIssuer(iss: string | null): string | null {
  const s = (iss || "").toLowerCase();
  for (const x of POLICY.approvedIssuers) if (x.a.some((t) => s.includes(t))) return x.n;
  return null;
}
export function isLargeBank(iss: string | null): boolean {
  const u = (iss || "").toUpperCase();
  return POLICY.largeBankKeys.some((k) => u.includes(k));
}
export function isScheduled(iss: string | null): boolean {
  const s = (iss || "").toLowerCase();
  return POLICY.scheduledTokens.some((t) => s.includes(t));
}
export function tenureMonths(dep: string | Date | null, mat: string | Date | null): number | null {
  if (!dep || !mat) return null;
  const d = new Date(dep), m = new Date(mat);
  return (m.getFullYear() - d.getFullYear()) * 12 + (m.getMonth() - d.getMonth());
}
function grp<T>(arr: T[], key: (x: T) => string, val: (x: T) => number): Record<string, number> {
  const m: Record<string, number> = {};
  arr.forEach((x) => { const k = key(x); m[k] = (m[k] || 0) + val(x); });
  return m;
}
const REC_PFC = "REC/PFC (combined)";

export function runCompliance(holdings: Holding[]): { checks: Check[]; totalAUM: number } {
  const total = holdings.reduce((s, h) => s + h.amount, 0);
  const P = (v: number) => (v / total * 100).toFixed(1) + "%";
  const cap10 = POLICY.corpSingleIssuerCap * total;
  const otherCap = Math.min(POLICY.otherBankCapPct * total, POLICY.otherBankCapCr * 1e7);
  const C: Check[] = [];

  // §3 Approved instruments
  const badType = holdings.filter((h) => !POLICY.approvedTypes.includes(h.type));
  const tg = grp(holdings, (h) => h.type, (h) => h.amount);
  C.push({
    section: "3", title: "Approved instrument types", status: badType.length ? "breach" : "pass",
    desc: "Only Debt Mutual Funds, Bank/Corporate Deposits, Commercial Papers and Corporate Bonds are approved.",
    table: {
      head: [{ t: "Instrument" }, { t: "Exposure", num: true }, { t: "Share", num: true }],
      rows: Object.entries(tg).sort((a, b) => b[1] - a[1]).map(([k, v]) => [
        { text: k, badge: { label: "approved", cls: "pass" as CheckStatus } },
        { text: "₹" + cr(v) + " Cr", num: true }, { text: P(v), num: true },
      ]),
    },
  });

  // §2 Geography
  const badGeo = holdings.filter((h) => (h.geo || "") !== "India");
  C.push({
    section: "2", title: "Geography of investment", status: badGeo.length ? "breach" : "pass",
    desc: "All investments must be INR / India. " + (badGeo.length ? badGeo.length + " holding(s) outside India." : `All ${holdings.length} holdings are booked in India.`),
  });

  // §5 Large-bank FD aggregate <=50%
  const lb = holdings.filter((h) => h.type === "Bank Deposit" && isLargeBank(h.issuer));
  const lbBy = grp(lb, (h) => h.issuer || "-", (h) => h.amount);
  const lbAgg = lb.reduce((s, h) => s + h.amount, 0);
  const lbBreach = lbAgg / total > POLICY.largeBankAggCap;
  C.push({
    section: "5", title: "Large-bank FD concentration (SBI/PNB/BOB/BOI/Axis/ICICI/Kotak/HDFC)",
    status: lbBreach ? "breach" : "pass",
    desc: "Combined FDs with the eight named large banks must be \u2264 50% of the total portfolio.",
    table: {
      head: [{ t: "Named large bank" }, { t: "FD exposure", num: true }, { t: "% of portfolio", num: true }],
      rows: [
        ...Object.entries(lbBy).sort((a, b) => b[1] - a[1]).map((e) => [
          { text: e[0] }, { text: "₹" + cr(e[1]) + " Cr", num: true }, { text: P(e[1]), num: true },
        ]),
        [{ text: "Aggregate vs 50% cap" }, { text: "₹" + cr(lbAgg) + " Cr", num: true },
          { text: P(lbAgg), num: true, badge: { label: lbBreach ? "Breach" : "OK", cls: (lbBreach ? "breach" : "pass") as CheckStatus } }],
      ],
    },
  });

  // §5 Other banks: lower of 5% or Rs150 Cr per bank
  const ob = holdings.filter((h) => h.type === "Bank Deposit" && !isLargeBank(h.issuer) && isScheduled(h.issuer));
  const obBy = grp(ob, (h) => h.issuer || "-", (h) => h.amount);
  const obBreaches = Object.entries(obBy).filter(([, v]) => v > otherCap);
  C.push({
    section: "5", title: "Other-bank FD limit (single bank)", status: obBreaches.length ? "breach" : "pass",
    desc: `Each non-named scheduled bank is capped at the lower of 5% of portfolio (₹${cr(POLICY.otherBankCapPct * total)} Cr) or ₹150 Cr \u2014 i.e. ₹${cr(otherCap)} Cr per bank.`,
    table: {
      head: [{ t: "Bank" }, { t: "FD exposure", num: true }, { t: "% of portfolio", num: true }, { t: "vs cap", num: true }],
      rows: Object.entries(obBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const br = v > otherCap;
        return [{ text: k }, { text: "₹" + cr(v) + " Cr", num: true }, { text: P(v), num: true },
          { num: true, badge: { label: br ? "Breach" : "OK", cls: (br ? "breach" : "pass") as CheckStatus } }];
      }),
    },
  });

  // §4 Scheduled banks only
  const nonSched = holdings.filter((h) => h.type === "Bank Deposit" && !isScheduled(h.issuer));
  const nsBy = grp(nonSched, (h) => h.issuer || "-", (h) => h.amount);
  C.push({
    section: "4", title: "Bank FDs with scheduled banks only (no cooperative banks)",
    status: nonSched.length ? "warn" : "pass",
    desc: nonSched.length
      ? "The following counterpart(ies) are booked under Bank Deposits but are not scheduled commercial banks \u2014 they appear to be corporate/NBFC deposits and should be governed by the corporate single-issuer rule, not the bank-FD rule."
      : "All bank-FD counterparties are scheduled commercial banks; no cooperative banks detected.",
    table: nonSched.length ? {
      head: [{ t: "Counterparty" }, { t: "Exposure", num: true }],
      rows: Object.entries(nsBy).map(([k, v]) => [
        { text: k, badge: { label: "not a scheduled bank", cls: "warn" as CheckStatus } },
        { text: "₹" + cr(v) + " Cr", num: true }]),
    } : undefined,
  });

  // §5 Corporate single-issuer <=10% (bonds + corporate/NBFC FDs, alias-merged)
  const corp = holdings.filter((h) => h.type === "Corporate Bond" || (h.type === "Bank Deposit" && !isScheduled(h.issuer)));
  const corpBy = grp(corp, (h) => canonIssuer(h.issuer) || h.issuer || "-", (h) => h.amount);
  const corpBreaches = Object.entries(corpBy).filter(([, v]) => v > cap10);
  const merged = corp.some((h) => h.issuer === "Mahindra Finance") && corp.some((h) => h.issuer === "M&M Finance");
  C.push({
    section: "5", title: "Single-issuer concentration \u2264 10% (Corporate Bonds, CPs & corporate FDs)",
    status: corpBreaches.length ? "breach" : "pass",
    desc: `No single corporate issuer may exceed 10% of the portfolio (₹${cr(cap10)} Cr). Exposures are alias-merged per issuer.` +
      (merged ? " Note: \u2018Mahindra Finance\u2019 and \u2018M&M Finance\u2019 are merged into one issuer (M&M Financial Services)." : ""),
    table: {
      head: [{ t: "Issuer (merged)" }, { t: "Exposure", num: true }, { t: "% of portfolio", num: true }, { t: "vs 10%", num: true }],
      rows: Object.entries(corpBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const br = v > cap10;
        return [{ text: k }, { text: "₹" + cr(v) + " Cr", num: true }, { text: P(v), num: true },
          { num: true, badge: { label: br ? "Breach" : "OK", cls: (br ? "breach" : "pass") as CheckStatus } }];
      }),
    },
  });

  // §7 Approved bond-issuer list
  const bonds = holdings.filter((h) => h.type === "Corporate Bond");
  const bondBy = grp(bonds, (h) => h.issuer || "-", (h) => h.amount);
  const unmatched = Object.keys(bondBy).filter((k) => !canonIssuer(k));
  C.push({
    section: "7", title: "Corporate bonds only from the approved issuer list",
    status: unmatched.length ? "warn" : "pass",
    desc: unmatched.length
      ? `${unmatched.length} bond line(s) could not be matched to an approved issuer by name and need manual verification against item 7.`
      : "All corporate-bond issuers map to the approved list in item 7.",
    table: {
      head: [{ t: "Bond issuer (as booked)" }, { t: "Exposure", num: true }, { t: "Maps to approved issuer" }],
      rows: Object.entries(bondBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const c = canonIssuer(k);
        return [{ text: k }, { text: "₹" + cr(v) + " Cr", num: true },
          { badge: c ? { label: c, cls: "pass" as CheckStatus } : { label: "Needs review", cls: "warn" as CheckStatus } }];
      }),
    },
  });

  // §4 Credit quality
  C.push({
    section: "4", title: "Credit quality \u2013 AAA (India) / scheduled banks", status: "warn",
    desc: `A per-instrument credit-rating field is not present in the current dataset. Mapped corporate-bond issuers are all AAA on the approved list (proxy pass); bank FDs are governed by the scheduled-bank test above. Still requires manual confirmation: (a) MF underlying \u2265 90% AAA, and (b) the ${unmatched.length} unidentified bond line(s) above.`,
  });

  // §5 MF diversification
  const mf = holdings.filter((h) => h.type === "Mutual Fund");
  const mfHouse = grp(mf, (h) => h.issuer || "-", (h) => h.amount);
  const mfHouseBreaches = Object.entries(mfHouse).filter(([, v]) => v > POLICY.mfHouseCap * total);
  const mfSchemeBreaches = mf.filter((h) => h.amount > POLICY.mfSchemeCap * total);
  C.push({
    section: "5", title: "Mutual-fund diversification (\u2264 25% per house, \u2264 15% per scheme)",
    status: mfHouseBreaches.length || mfSchemeBreaches.length ? "breach" : "pass",
    desc: `No more than 25% of the portfolio (₹${cr(POLICY.mfHouseCap * total)} Cr) in a single MF house, and no more than 15% (₹${cr(POLICY.mfSchemeCap * total)} Cr) in a single scheme.`,
    table: {
      head: [{ t: "MF house" }, { t: "Exposure", num: true }, { t: "% of portfolio", num: true }, { t: "vs 25%", num: true }],
      rows: Object.entries(mfHouse).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const br = v > POLICY.mfHouseCap * total;
        return [{ text: k }, { text: "₹" + cr(v) + " Cr", num: true }, { text: P(v), num: true },
          { num: true, badge: { label: br ? "Breach" : "OK", cls: (br ? "breach" : "pass") as CheckStatus } }];
      }),
    },
  });

  // §5 MF AUM cut-offs
  C.push({
    section: "5", title: "MF scheme AUM cut-offs (Liquid > ₹10,000 Cr; UST/LD/MMkt/Overnight > ₹5,000 Cr)",
    status: "info",
    desc: "Scheme-level AUM is not in the current dataset, so this size-eligibility test must be confirmed against the fund fact-sheets at the time of investment.",
  });

  // §6 Tenure <=36m
  const overT = holdings.filter((h) => { const m = tenureMonths(h.deposit, h.maturity); return m != null && m > POLICY.tenureMaxMonths; });
  const maxT = holdings.reduce((mx, h) => { const m = tenureMonths(h.deposit, h.maturity); return m != null && m > mx ? m : mx; }, 0);
  C.push({
    section: "6", title: "Investment tenure \u2264 36 months", status: overT.length ? "breach" : "pass",
    desc: `Funds may be invested for a tenure up to 36 months. Longest tenure in the book is ${maxT} months. ` +
      (overT.length ? `${overT.length} holding(s) exceed 36 months.` : "No holdings exceed the 36-month limit."),
    table: overT.length ? {
      head: [{ t: "Instrument" }, { t: "Tenure (months)", num: true }],
      rows: overT.map((h) => [{ text: h.name }, { text: String(tenureMonths(h.deposit, h.maturity)), num: true }]),
    } : undefined,
  });

  return { checks: C, totalAUM: total };
}

export { REC_PFC };
export const AS_OF_DATE = AS_OF;

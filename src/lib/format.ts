export const CR = 1e7;

export const cr = (v: number | null | undefined): string =>
  v == null ? "-" : (v / CR).toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const pct = (v: number | null | undefined): string =>
  v == null ? "-" : (v * 100).toFixed(2) + "%";

export const AS_OF = new Date("2026-06-30");

export const daysTo = (d: string | Date | null | undefined): number | null =>
  d ? Math.round((new Date(d).getTime() - AS_OF.getTime()) / 86400000) : null;

export const sum = <T,>(a: T[], f: (x: T) => number | null | undefined): number =>
  a.reduce((s, x) => s + (f(x) || 0), 0);

export const pillClass = (t: string): string =>
  t === "Corporate Bond" ? "bond" : t === "Mutual Fund" ? "mf" : "bank";

export const SEVRANK: Record<string, number> = { high: 0, medium: 1, low: 2, positive: 3 };

export type Holding = {
  id: string; name: string; issuer: string | null; type: string; category: string | null;
  amount: number; ytm: number | null; deposit: string | null; maturity: string | null;
  maturityAmount: number | null; entity: string | null; ipo: string; geo: string;
};

export type MediaItem = {
  id: string; issuer: string; severity: string; date: string; source: string; headline: string; summary: string;
};

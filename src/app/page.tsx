"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
  BarChart, Bar,
} from "recharts";
import {
  cr, pct, daysTo, sum, pillClass, SEVRANK, CR,
  type Holding, type MediaItem,
} from "@/lib/format";
import { runCompliance, type Check, type CheckStatus } from "@/lib/compliance";
import { runScreener, DATA_SOURCES, type BondCandidate } from "@/lib/screener";

type Market = { dates: string[]; series: Record<string, (number | null)[]>; current: Record<string, number> };
type Bucket = { period: string; debts: number; mutualFunds: number; order: number };

const PALETTE = ["#7c5cff","#36c2ce","#3fb950","#d29922","#f85149","#58a6ff","#bc8cff","#ff9bce","#56d364","#e3b341","#79c0ff","#ffa657"];
type View = "overview" | "policy" | "media" | "market" | "maturity" | "screener";
const NAV: { id: View; ic: string; label: string }[] = [
  { id: "overview", ic: "◧", label: "Portfolio" },
  { id: "policy", ic: "⚖", label: "Policy" },
  { id: "media", ic: "⚠", label: "Credit" },
  { id: "market", ic: "📈", label: "Market" },
  { id: "maturity", ic: "🗓", label: "Liquidity" },
  { id: "screener", ic: "🔎", label: "Screener" },
];
const STATUS_LABEL: Record<CheckStatus, string> = { pass: "OK", breach: "Breach", warn: "Review", info: "Info" };

export default function Dashboard() {
  const [view, setView] = useState<View>("overview");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [candidates, setCandidates] = useState<BondCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<Record<string, number>>({});
  const [tick, setTick] = useState({ t: "", fx: "", g10: "" });

  useEffect(() => {
    Promise.all([
      fetch("/api/holdings").then((r) => r.json()),
      fetch("/api/media").then((r) => r.json()),
      fetch("/api/market").then((r) => r.json()),
      fetch("/api/maturity").then((r) => r.json()),
      fetch("/api/candidates").then((r) => r.json()),
    ]).then(([h, m, mk, b, c]) => {
      setHoldings(h); setMedia(m); setMarket(mk); setBuckets(b);
      setCandidates(Array.isArray(c) ? c : []); setLoading(false);
    });
  }, []);

  // live-tick simulation (feed adapter equivalent, client side)
  useEffect(() => {
    if (!holdings.length || !market) return;
    const run = () => {
      const next: Record<string, number> = {};
      holdings.forEach((h, i) => {
        const base = h.ytm ?? 0;
        const drift = Math.sin(Date.now() / 9000 + i * 0.7) * 0.0009;
        next[h.id] = Math.max(0, base + drift + (Math.random() - 0.5) * 0.0006);
      });
      setLive(next);
      const fx = (market.current.usdinr ?? 86) + Math.sin(Date.now() / 12000) * 0.04;
      const g10 = (market.current.g10y ?? 0.066) + Math.sin(Date.now() / 12000 + 7) * 0.0004;
      setTick({ t: new Date().toLocaleTimeString(), fx: fx.toFixed(2), g10: pct(g10) });
    };
    run();
    const id = setInterval(run, 2000);
    return () => clearInterval(id);
  }, [holdings, market]);

  const totalAUM = useMemo(() => sum(holdings, (h) => h.amount), [holdings]);
  const wAvgYtm = useMemo(
    () => sum(holdings, (h) => h.amount * (h.ytm || 0)) / (sum(holdings, (h) => (h.ytm ? h.amount : 0)) || 1),
    [holdings]
  );
  const wAvgMat = useMemo(() => {
    const w = holdings.filter((h) => daysTo(h.maturity) != null);
    return sum(w, (h) => h.amount * (daysTo(h.maturity) as number)) / (sum(w, (h) => h.amount) || 1);
  }, [holdings]);
  const issuerExp = useMemo(() => {
    const m: Record<string, number> = {};
    holdings.forEach((h) => { const k = h.issuer || h.name; m[k] = (m[k] || 0) + h.amount; });
    return m;
  }, [holdings]);
  const compliance = useMemo(() => runCompliance(holdings), [holdings]);
  const breachN = compliance.checks.filter((c) => c.status === "breach").length;
  const warnN = compliance.checks.filter((c) => c.status === "warn").length;

  if (loading) return <div style={{ padding: 40 }} className="small">Loading treasury data…</div>;

  const title: Record<View, [string, string]> = {
    overview: ["Portfolio Distribution", "Group-wide treasury holdings across entities and instruments"],
    policy: ["Investment Policy Compliance", "Automated checks against the June 2026 Investment Policy"],
    media: ["Credit & Negative-Media Monitor", "Issuer and counterparty news, sorted worst-first"],
    market: ["Live Market & Yields", "Benchmark curves and portfolio yield vs market"],
    maturity: ["Maturity Ladder & Liquidity", "Maturity buckets, calendar and reinvestment alerts"],
    screener: ["Bond Screener", "Policy-compliant reinvestment ideas for maturing cash"],
  };
  const highN = media.filter((m) => m.severity === "high").length;

  return (
    <div className="app">
      {/* Desktop sidebar */}
      <aside className="side">
        <div className="brand"><div className="dot">M</div><div><b>Treasury Cockpit</b><small>Meesho Group</small></div></div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={"navbtn" + (view === n.id ? " active" : "")} onClick={() => setView(n.id)}>
              <span className="ic">{n.ic}</span> {n.id === "media" ? "Credit & Media" : n.id === "maturity" ? "Maturity & Liquidity" : n.id === "market" ? "Live Market" : n.id === "policy" ? "Policy Check" : n.id === "screener" ? "Bond Screener" : "Portfolio"}
              {n.id === "media" && highN > 0 && <span className="badge">{highN}</span>}
              {n.id === "policy" && breachN > 0 && <span className="badge">{breachN}</span>}
            </button>
          ))}
          <Link href="/admin" className="navbtn"><span className="ic">✎</span> Manage holdings</Link>
        </nav>
        <div className="foot">
          <div className="u">Group Treasury</div>
          <div><span className="live-dot" />Live feed: <b>Simulated</b></div>
          <div style={{ marginTop: 6 }}>Statement as of <b>23 Jun 2026</b></div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="mtop">
        <div className="brand"><div className="dot">M</div><div><b>Treasury</b></div></div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/admin" className="linkbtn">Manage</Link>
        </div>
      </div>

      <main className="main">
        <div className="topbar">
          <div><h1>{title[view][0]}</h1><div className="sub">{title[view][1]}</div></div>
          <div className="tick">Last tick <b>{tick.t || "--"}</b> · USD-INR <b>{tick.fx || "--"}</b> · 10Y <b>{tick.g10 || "--"}</b></div>
        </div>

        {view === "overview" && <Overview holdings={holdings} media={media} totalAUM={totalAUM} wAvgYtm={wAvgYtm} wAvgMat={wAvgMat} issuerExp={issuerExp} live={live} checks={compliance.checks} onNav={setView} />}
        {view === "policy" && <PolicyView checks={compliance.checks} totalAUM={compliance.totalAUM} />}
        {view === "media" && <MediaView media={media} issuerExp={issuerExp} totalAUM={totalAUM} />}
        {view === "market" && market && <MarketView holdings={holdings} market={market} wAvgYtm={wAvgYtm} live={live} />}
        {view === "maturity" && <MaturityView holdings={holdings} buckets={buckets} totalAUM={totalAUM} />}
        {view === "screener" && <ScreenerView holdings={holdings} candidates={candidates} />}
      </main>

      {/* Mobile bottom nav */}
      <nav className="mbottom">
        {NAV.map((n) => (
          <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}>
            <span className="ic">{n.ic}</span>{n.label}
            {n.id === "media" && highN > 0 && <span className="badge">{highN}</span>}
            {n.id === "policy" && breachN > 0 && <span className="badge">{breachN}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ holdings, media, totalAUM, wAvgYtm, wAvgMat, issuerExp, live, checks, onNav }: {
  holdings: Holding[]; media: MediaItem[]; totalAUM: number; wAvgYtm: number; wAvgMat: number;
  issuerExp: Record<string, number>; live: Record<string, number>;
  checks: Check[]; onNav: (v: View) => void;
}) {
  const [allocKey, setAllocKey] = useState<keyof Holding>("type");
  const [q, setQ] = useState(""); const [ft, setFt] = useState(""); const [fe, setFe] = useState(""); const [fi, setFi] = useState("");
  const [sortKey, setSortKey] = useState<string>("amount"); const [dir, setDir] = useState(-1);
  const [sel, setSel] = useState<Holding | null>(null);

  const ipoTotal = sum(holdings.filter((h) => h.ipo === "IPO"), (h) => h.amount);
  const groups = useMemo(() => {
    const m: Record<string, number> = {};
    holdings.forEach((h) => { const g = (h[allocKey] as string) || "(n/a)"; m[g] = (m[g] || 0) + h.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [holdings, allocKey]);

  const types = Array.from(new Set(holdings.map((h) => h.type)));
  const ents = Array.from(new Set(holdings.map((h) => h.entity).filter(Boolean))) as string[];

  const rows = useMemo(() => holdings
    .filter((h) => (!q || h.name.toLowerCase().includes(q.toLowerCase()) || (h.issuer || "").toLowerCase().includes(q.toLowerCase()))
      && (!ft || h.type === ft) && (!fe || h.entity === fe) && (!fi || h.ipo === fi))
    .sort((a, b) => {
      const x = (a as any)[sortKey], y = (b as any)[sortKey];
      if (typeof x === "string") return dir * (x || "").localeCompare(y || "");
      return dir * (((x as number) || 0) - ((y as number) || 0));
    }), [holdings, q, ft, fe, fi, sortKey, dir]);

  const topExp = Object.entries(issuerExp).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const kpis: [string, string][] = [
    ["Total AUM", "₹" + cr(totalAUM) + " Cr"],
    ["Weighted avg YTM", pct(wAvgYtm)],
    ["Weighted avg maturity", (wAvgMat / 365).toFixed(2) + " yrs"],
    ["Holdings", String(holdings.length)],
    ["IPO ring-fenced", "₹" + cr(ipoTotal) + " Cr"],
  ];
  const setSort = (k: string) => { if (sortKey === k) setDir(-dir); else { setSortKey(k); setDir(k === "name" || k === "issuer" ? 1 : -1); } };

  // homepage compliance banner
  const breaches = checks.filter((c) => c.status === "breach");
  const warns = checks.filter((c) => c.status === "warn");
  const compClean = breaches.length === 0 && warns.length === 0;
  // homepage negative-news banner
  const highItems = media.filter((m) => m.severity === "high");
  const medItems = media.filter((m) => m.severity === "medium");
  const flaggedNames = Array.from(new Set([...highItems, ...medItems].map((m) => m.issuer)));
  const flaggedExp = flaggedNames.reduce((s, i) => s + (issuerExp[i] || 0), 0);

  return (
    <>
      <div className={"comp-banner " + (breaches.length ? "breach" : warns.length ? "warn" : "ok")}>
        <div className="big">{breaches.length ? "⛔" : warns.length ? "⚠️" : "✅"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Investment Policy: {compClean ? "fully compliant" : `${breaches.length} breach${breaches.length === 1 ? "" : "es"} · ${warns.length} to review`}
          </div>
          <div className="small" style={{ marginTop: 3 }}>
            {compClean
              ? `All ${checks.length} automated checks pass against the June 2026 Investment Policy.`
              : [...breaches, ...warns].slice(0, 3).map((c) => `§${c.section} ${c.title}`).join(" · ")}
            {[...breaches, ...warns].length > 3 && " …"}
          </div>
        </div>
        <button className="linkbtn" onClick={() => onNav("policy")}>View policy check →</button>
      </div>
      {(highItems.length > 0 || medItems.length > 0) && (
        <div className="comp-banner warn" style={{ marginTop: -6 }}>
          <div className="big">📰</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {highItems.length} high · {medItems.length} medium negative-news alert{highItems.length + medItems.length === 1 ? "" : "s"}
            </div>
            <div className="small" style={{ marginTop: 3 }}>
              Exposure to flagged names: <b style={{ color: "var(--txt)" }}>₹{cr(flaggedExp)} Cr</b> ({(flaggedExp / totalAUM * 100).toFixed(1)}% of AUM).
              {highItems.length > 0 && <> Highest priority: {highItems.map((m) => m.issuer).join(", ")}.</>}
            </div>
          </div>
          <button className="linkbtn" onClick={() => onNav("media")}>View credit monitor →</button>
        </div>
      )}
      <div className="kpis">{kpis.map((k) => <div className="kpi" key={k[0]}><div className="lab">{k[0]}</div><div className="val">{k[1]}</div></div>)}</div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="ph">
            <div><h3>Allocation</h3><small>By {String(allocKey)}</small></div>
            <div className="seg">
              {([["type", "Instrument"], ["category", "MF Cat"], ["entity", "Entity"], ["ipo", "IPO"], ["issuer", "Issuer"]] as [keyof Holding, string][]).map(([k, l]) => (
                <button key={k} className={allocKey === k ? "active" : ""} onClick={() => setAllocKey(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={groups.map(([name, value]) => ({ name, value }))} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={1}>
                  {groups.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="#161b22" />)}
                </Pie>
                <Tooltip formatter={(v: number) => "₹" + cr(v) + " Cr (" + (v / totalAUM * 100).toFixed(1) + "%)"} contentStyle={tipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="legend">{groups.map(([l, v], i) => <div className="li" key={l}><span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />{l} · {(v / totalAUM * 100).toFixed(1)}%</div>)}</div>
        </div>
        <div className="panel">
          <div className="ph"><div><h3>Top exposures</h3><small>Single-name concentration</small></div></div>
          {topExp.map(([n, v]) => (
            <div className="bar-row" key={n}><div className="nm" title={n}>{n}</div>
              <div className="track"><div className="fill" style={{ width: (v / topExp[0][1] * 100) + "%" }} /></div>
              <div className="vv">{(v / totalAUM * 100).toFixed(1)}%</div></div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="ph"><div><h3>Holdings</h3><small>{rows.length} of {holdings.length} · ₹{cr(sum(rows, (h) => h.amount))} Cr</small></div></div>
        <div className="filters">
          <input placeholder="Search instrument or issuer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={ft} onChange={(e) => setFt(e.target.value)}><option value="">All instruments</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
          <select value={fe} onChange={(e) => setFe(e.target.value)} className="hide-sm"><option value="">All entities</option>{ents.map((t) => <option key={t}>{t}</option>)}</select>
          <select value={fi} onChange={(e) => setFi(e.target.value)}><option value="">IPO + Non-IPO</option><option>IPO</option><option>Non-IPO</option></select>
        </div>
        <div className="tablebox">
          <table>
            <thead><tr>
              <th onClick={() => setSort("name")}>Instrument</th>
              <th onClick={() => setSort("issuer")} className="hide-sm">Issuer</th>
              <th onClick={() => setSort("type")}>Type</th>
              <th onClick={() => setSort("entity")} className="hide-sm">Entity</th>
              <th onClick={() => setSort("amount")} className="num">Amount (Cr)</th>
              <th onClick={() => setSort("ytm")} className="num">YTM</th>
              <th className="num hide-sm">Live yield</th>
              <th className="hide-sm">Maturity</th>
            </tr></thead>
            <tbody>
              {rows.map((h) => {
                const ly = live[h.id] ?? h.ytm ?? 0;
                return (
                  <tr key={h.id} onClick={() => setSel(h)}>
                    <td>{h.name}{h.ipo === "IPO" && <span className="pill ipo" style={{ marginLeft: 6 }}>IPO</span>}</td>
                    <td className="hide-sm">{h.issuer || "-"}</td>
                    <td data-label="Type"><span className={"pill " + pillClass(h.type)}>{h.type}</span></td>
                    <td className="small hide-sm">{h.entity || "-"}</td>
                    <td className="num" data-label="Amount (Cr)">{cr(h.amount)}</td>
                    <td className="num" data-label="YTM">{pct(h.ytm)}</td>
                    <td className="num hide-sm" style={{ color: ly > (h.ytm || 0) ? "var(--good)" : ly < (h.ytm || 0) ? "var(--bad)" : undefined }}>{pct(ly)}</td>
                    <td className="small hide-sm">{h.maturity ? h.maturity.slice(0, 10) : "Open"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {sel && <Drawer h={sel} media={media} issuerExp={issuerExp} totalAUM={totalAUM} live={live} onClose={() => setSel(null)} />}
    </>
  );
}

function Drawer({ h, media, issuerExp, totalAUM, live, onClose }: {
  h: Holding; media: MediaItem[]; issuerExp: Record<string, number>; totalAUM: number; live: Record<string, number>; onClose: () => void;
}) {
  const d = daysTo(h.maturity);
  const news = media.filter((m) => m.issuer === (h.issuer || ""));
  const row = (k: string, v: React.ReactNode) => <div className="detrow"><span className="k">{k}</span><span className="v">{v}</span></div>;
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className="drawer">
        <button className="close" onClick={onClose}>×</button>
        <h2>{h.name}</h2>
        <div className="small" style={{ marginBottom: 14 }}>{h.issuer} · <span className={"pill " + pillClass(h.type)}>{h.type}</span> {h.ipo === "IPO" && <span className="pill ipo">IPO fund</span>}</div>
        {row("Invested amount", "₹" + cr(h.amount) + " Cr")}
        {row("Book YTM", pct(h.ytm))}
        {row("Live yield (sim)", pct(live[h.id] ?? h.ytm))}
        {row("Legal entity", h.entity || "-")}
        {row("Date of deposit", h.deposit ? h.deposit.slice(0, 10) : "-")}
        {row("Maturity date", h.maturity ? h.maturity.slice(0, 10) : "Open-ended")}
        {row("Residual", d != null ? d + " days" : "-")}
        {row("Maturity amount", h.maturityAmount ? "₹" + cr(h.maturityAmount) + " Cr" : "-")}
        {row("% of AUM", (h.amount / totalAUM * 100).toFixed(2) + "%")}
        {row("Issuer exposure (total)", "₹" + cr(issuerExp[h.issuer || h.name]) + " Cr")}
        {news.length > 0 && <h3 style={{ margin: "18px 0 8px", fontSize: 13 }}>Issuer news</h3>}
        {news.map((n) => (
          <div className={"mcard " + n.severity} style={{ marginBottom: 8 }} key={n.id}>
            <div className="mh"><div className="issuer" style={{ fontSize: 12.5 }}>{n.headline}</div><span className={"sev " + n.severity}>{n.severity}</span></div>
            <div className="meta">{n.source} · {n.date.slice(0, 10)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Media ---------------- */
function MediaView({ media, issuerExp, totalAUM }: { media: MediaItem[]; issuerExp: Record<string, number>; totalAUM: number }) {
  const [sev, setSev] = useState("all");
  const items = [...media].sort((a, b) => SEVRANK[a.severity] - SEVRANK[b.severity] || +new Date(b.date) - +new Date(a.date))
    .filter((m) => sev === "all" || m.severity === sev);
  const highN = media.filter((m) => m.severity === "high").length;
  const medN = media.filter((m) => m.severity === "medium").length;
  const flagged = Array.from(new Set(media.filter((m) => m.severity === "high" || m.severity === "medium").map((m) => m.issuer)))
    .reduce((s, i) => s + (issuerExp[i] || 0), 0);
  const wl = Object.entries(issuerExp).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="alert-banner">
        <div className="big">⚠️</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{highN} high-severity · {medN} medium-severity items need attention</div>
          <div className="small" style={{ marginTop: 3 }}>Exposure to flagged names: <b style={{ color: "var(--txt)" }}>₹{cr(flagged)} Cr</b> ({(flagged / totalAUM * 100).toFixed(1)}% of AUM). Highest priority: {media.filter((m) => m.severity === "high").map((m) => m.issuer).join(", ") || "none"}.</div>
        </div>
      </div>
      <div className="filters">
        <span className="small" style={{ marginRight: 4 }}>Severity:</span>
        {["all", "high", "medium", "low", "positive"].map((s) => (
          <span key={s} className={"chip" + (sev === s ? " on" : "")} onClick={() => setSev(s)}>{s[0].toUpperCase() + s.slice(1)}</span>
        ))}
      </div>
      <div className="grid g2">
        <div className="media">
          {items.map((m) => {
            const e = issuerExp[m.issuer];
            return (
              <div className={"mcard " + m.severity} key={m.id}>
                <div className="mh"><div><div className="issuer">{m.issuer}</div><div className="meta">{m.source} · {m.date.slice(0, 10)}</div></div><span className={"sev " + m.severity}>{m.severity}</span></div>
                <div className="head">{m.headline}</div><div className="sum">{m.summary}</div>
                {e && <div className="exp-tag">Exposure: <b>₹{cr(e)} Cr</b> · {(e / totalAUM * 100).toFixed(1)}% of AUM</div>}
              </div>
            );
          })}
        </div>
        <div className="panel" style={{ alignSelf: "start" }}>
          <div className="ph"><div><h3>Watchlist exposure</h3><small>Auto-built from current holdings</small></div></div>
          {wl.map(([n, v]) => {
            const it = media.filter((m) => m.issuer === n).sort((a, b) => SEVRANK[a.severity] - SEVRANK[b.severity])[0];
            const c = it?.severity === "high" ? "var(--bad)" : it?.severity === "medium" ? "var(--warn)" : it?.severity === "positive" ? "var(--pos)" : "var(--mut)";
            return <div className="bar-row" key={n}><div className="nm" title={n}>{it && <span style={{ color: c }}>● </span>}{n}</div><div className="track"><div className="fill" style={{ width: (v / wl[0][1] * 100) + "%" }} /></div><div className="vv">₹{cr(v)}</div></div>;
          })}
          <div className="small" style={{ marginTop: 10, fontStyle: "italic" }}>Items are editable in Manage holdings. Connect a news/ratings feed to populate automatically — the watchlist is generated from live holdings.</div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Market ---------------- */
function MarketView({ holdings, market, wAvgYtm, live }: { holdings: Holding[]; market: Market; wAvgYtm: number; live: Record<string, number> }) {
  const [mk, setMk] = useState<"inr" | "usd" | "fx">("inr");
  const c = market.current;
  const kpis: [string, string][] = [
    ["91-day T-Bill", pct(c.tb91)], ["10Y G-Sec", pct(c.g10y)], ["USD-INR", String(c.usdinr ?? "-")],
    ["1Y US Treasury", pct(c.ust1y)], ["Portfolio YTM", pct(wAvgYtm)],
  ];
  const seriesMap = {
    inr: [["91D T-Bill", "tb91", "#36c2ce"], ["364D T-Bill", "tb364", "#58a6ff"], ["10Y G-Sec", "g10y", "#7c5cff"]],
    usd: [["1M UST", "ust1m", "#3fb950"], ["3M UST", "ust3m", "#d29922"], ["1Y UST", "ust1y", "#f85149"]],
    fx: [["USD-INR", "usdinr", "#bc8cff"]],
  } as const;
  const chartData = market.dates.map((d, i) => {
    const row: any = { date: d };
    seriesMap[mk].forEach(([, key]) => { const v = market.series[key]?.[i]; row[key] = v == null ? null : (mk === "fx" ? v : v * 100); });
    return row;
  });
  const types = Array.from(new Set(holdings.map((h) => h.type)));
  const spreadData = types.map((t) => {
    const g = holdings.filter((h) => h.type === t);
    return { type: t, ytm: +(sum(g, (h) => h.amount * (h.ytm || 0)) / (sum(g, (h) => h.amount) || 1) * 100).toFixed(2), bench: +((c.g10y ?? 0) * 100).toFixed(2) };
  });
  const rows = [...holdings].sort((a, b) => b.amount - a.amount).slice(0, 40);
  return (
    <>
      <div className="kpis">{kpis.map((k) => <div className="kpi" key={k[0]}><div className="lab">{k[0]}</div><div className="val">{k[1]}</div></div>)}</div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="ph"><div><h3>Benchmark yield history</h3><small>Weekly, from market data</small></div>
            <div className="seg">{(["inr", "usd", "fx"] as const).map((k) => <button key={k} className={mk === k ? "active" : ""} onClick={() => setMk(k)}>{k === "inr" ? "INR rates" : k === "usd" ? "USD curve" : "USD-INR"}</button>)}</div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ left: -8, right: 8, top: 6 }}>
                <CartesianGrid stroke="#1c232d" /><XAxis dataKey="date" tick={{ fill: "#6b7686", fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fill: "#8b97a7", fontSize: 11 }} tickFormatter={(v) => mk === "fx" ? v : v + "%"} domain={["auto", "auto"]} />
                <Tooltip contentStyle={tipStyle} /><Legend wrapperStyle={{ fontSize: 11, color: "#8b97a7" }} />
                {seriesMap[mk].map(([label, key, col]) => <Line key={key} type="monotone" dataKey={key} name={label} stroke={col} dot={false} strokeWidth={2} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <div className="ph"><div><h3>Portfolio YTM vs benchmark</h3><small>By instrument type vs 10Y G-sec</small></div></div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart data={spreadData} margin={{ left: -8, right: 8, top: 6 }}>
                <CartesianGrid stroke="#1c232d" /><XAxis dataKey="type" tick={{ fill: "#8b97a7", fontSize: 10 }} /><YAxis tick={{ fill: "#8b97a7", fontSize: 11 }} tickFormatter={(v) => v + "%"} />
                <Tooltip contentStyle={tipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ytm" name="Portfolio YTM %" fill="#7c5cff" radius={[4, 4, 0, 0]} />
                <Line dataKey="bench" name="10Y G-Sec %" stroke="#f85149" dot={false} strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="ph"><div><h3>Live yield monitor</h3><small>Simulated ticks around each holding&apos;s YTM</small></div></div>
        <div className="tablebox" style={{ maxHeight: 360 }}>
          <table>
            <thead><tr><th>Instrument</th><th className="hide-sm">Type</th><th className="num">Book YTM</th><th className="num">Live yield</th><th className="num">Δ bps</th></tr></thead>
            <tbody>
              {rows.map((h) => {
                const ly = live[h.id] ?? h.ytm ?? 0; const bps = (ly - (h.ytm || 0)) * 10000;
                return <tr key={h.id}><td>{h.name}</td><td className="hide-sm"><span className={"pill " + pillClass(h.type)}>{h.type}</span></td>
                  <td className="num" data-label="Book YTM">{pct(h.ytm)}</td><td className="num" data-label="Live yield">{pct(ly)}</td><td className={"num " + (bps >= 0 ? "up" : "down")} data-label="Δ bps">{bps >= 0 ? "+" : ""}{bps.toFixed(1)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------------- Maturity ---------------- */
function MaturityView({ holdings, buckets, totalAUM }: { holdings: Holding[]; buckets: Bucket[]; totalAUM: number }) {
  const ladder = buckets.map((b) => ({ period: b.period, Debt: +b.debts.toFixed(0), MutualFunds: +b.mutualFunds.toFixed(0) }));
  const byMonth = useMemo(() => {
    const m: Record<string, number> = {};
    holdings.forEach((h) => { if (h.maturity) { const d = new Date(h.maturity); const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); m[k] = (m[k] || 0) + (h.maturityAmount || h.amount); } });
    return Object.keys(m).sort().slice(0, 24).map((k) => ({ month: k, cr: +(m[k] / CR).toFixed(0) }));
  }, [holdings]);
  const upcoming = holdings.filter((h) => { const d = daysTo(h.maturity); return d != null && d >= 0 && d <= 90; }).sort((a, b) => +new Date(a.maturity!) - +new Date(b.maturity!));
  const mfTotal = sum(holdings.filter((h) => h.type === "Mutual Fund"), (h) => h.amount);
  const le3 = sum(buckets.slice(0, 3), (b) => b.debts + b.mutualFunds);
  const le12 = sum(buckets.slice(0, 5), (b) => b.debts + b.mutualFunds);
  const kpis: [string, string][] = [
    ["Available funds", "₹" + cr(totalAUM) + " Cr"], ["Maturing ≤3 months", "₹" + le3.toFixed(0) + " Cr"],
    ["Maturing ≤12 months", "₹" + le12.toFixed(0) + " Cr"], ["Next 90d maturities", String(upcoming.length)],
    ["Open MF (liquid)", "₹" + cr(mfTotal) + " Cr"],
  ];
  return (
    <>
      <div className="kpis">{kpis.map((k) => <div className="kpi" key={k[0]}><div className="lab">{k[0]}</div><div className="val">{k[1]}</div></div>)}</div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="ph"><div><h3>Maturity ladder</h3><small>Available funds by bucket (₹ Cr)</small></div></div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart data={ladder} margin={{ left: -8, right: 8, top: 6 }}>
                <CartesianGrid stroke="#1c232d" /><XAxis dataKey="period" tick={{ fill: "#8b97a7", fontSize: 9 }} interval={0} angle={-12} textAnchor="end" height={54} /><YAxis tick={{ fill: "#8b97a7", fontSize: 11 }} />
                <Tooltip contentStyle={tipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Debt" stackId="a" fill="#7c5cff" /><Bar dataKey="MutualFunds" stackId="a" fill="#36c2ce" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <div className="ph"><div><h3>Maturities by month</h3><small>Principal maturing (₹ Cr)</small></div></div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart data={byMonth} margin={{ left: -8, right: 8, top: 6 }}>
                <CartesianGrid stroke="#1c232d" /><XAxis dataKey="month" tick={{ fill: "#6b7686", fontSize: 9 }} minTickGap={12} /><YAxis tick={{ fill: "#8b97a7", fontSize: 11 }} />
                <Tooltip contentStyle={tipStyle} /><Bar dataKey="cr" name="₹ Cr" fill="#3fb950" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="ph"><div><h3>Upcoming maturities &amp; reinvestment alerts</h3><small>Next 90 days</small></div></div>
        <div className="tablebox" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th>Instrument</th><th>Maturity</th><th>Days</th><th className="hide-sm">Issuer</th><th className="hide-sm">Entity</th><th className="num">Amt (Cr)</th><th className="num">YTM</th></tr></thead>
            <tbody>
              {upcoming.length === 0 && <tr><td colSpan={7} className="small">No maturities in the next 90 days.</td></tr>}
              {upcoming.map((h) => { const d = daysTo(h.maturity)!; return (
                <tr key={h.id}><td>{h.name}</td><td data-label="Maturity">{h.maturity!.slice(0, 10)}</td><td className={d <= 14 ? "flag" : ""} data-label="Days">{d}{d <= 14 ? " ⚠" : ""}</td>
                  <td className="hide-sm">{h.issuer}</td><td className="small hide-sm">{h.entity}</td><td className="num" data-label="Amt (Cr)">{cr(h.maturityAmount || h.amount)}</td><td className="num" data-label="YTM">{pct(h.ytm)}</td></tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------------- Policy Check ---------------- */
function PolicyView({ checks, totalAUM }: { checks: Check[]; totalAUM: number }) {
  const [filter, setFilter] = useState<"all" | CheckStatus>("all");
  const counts = {
    breach: checks.filter((c) => c.status === "breach").length,
    warn: checks.filter((c) => c.status === "warn").length,
    pass: checks.filter((c) => c.status === "pass").length,
    info: checks.filter((c) => c.status === "info").length,
  };
  const shown = checks.filter((c) => filter === "all" || c.status === filter);
  const ckpis: [string, number, CheckStatus | ""][] = [
    ["Checks run", checks.length, ""],
    ["Breaches", counts.breach, "breach"],
    ["To review", counts.warn, "warn"],
    ["Passing", counts.pass, "pass"],
  ];
  return (
    <>
      <div className="ckpis">
        {ckpis.map(([l, n, cls]) => (
          <div className={"ckpi " + cls} key={l}><div className="n">{n}</div><div className="l">{l}</div></div>
        ))}
      </div>
      <div className="filters">
        <span className="small" style={{ marginRight: 4 }}>Show:</span>
        {(["all", "breach", "warn", "pass", "info"] as const).map((s) => (
          <span key={s} className={"chip" + (filter === s ? " on" : "")} onClick={() => setFilter(s)}>
            {s === "all" ? "All" : STATUS_LABEL[s]}
          </span>
        ))}
        <span className="small" style={{ marginLeft: "auto", fontStyle: "italic" }}>
          Policy: June 2026 · Portfolio ₹{cr(totalAUM)} Cr
        </span>
      </div>
      <div className="checks">
        {shown.map((c, i) => (
          <div className={"check " + c.status} key={i}>
            <div className="chead">
              <div>
                <span className="policy-ref">§{c.section}</span>
                <span className="ctitle">{c.title}</span>
              </div>
              <span className={"st " + c.status}>{STATUS_LABEL[c.status]}</span>
            </div>
            <div className="cdesc">{c.desc}</div>
            {c.table && (
              <div className="ctab">
                <table>
                  <thead><tr>{c.table.head.map((h, j) => <th key={j} className={h.num ? "num" : ""}>{h.t}</th>)}</tr></thead>
                  <tbody>
                    {c.table.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, k) => (
                          <td key={k} className={cell.num ? "num" : ""}>
                            {cell.text}
                            {cell.badge && <span className={"st " + cell.badge.cls} style={{ marginLeft: cell.text ? 6 : 0 }}>{cell.badge.label}</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Bond Screener ---------------- */
function ScreenerView({ holdings, candidates }: { holdings: Holding[]; candidates: BondCandidate[] }) {
  const [win, setWin] = useState<number | "all">(12);
  const res = useMemo(() => runScreener(holdings, candidates, win), [holdings, candidates, win]);
  const hasSample = candidates.some((c) => c.sample);
  const ckpis: [string, string, CheckStatus | ""][] = [
    ["₹" + cr(res.matCash), "Cr maturing (" + res.windowLabel + ")", "pass"],
    [String(res.maturingCount), "Instruments maturing", ""],
    [String(res.nEligible), "Eligible bond ideas", "pass"],
    ["₹" + cr(res.deployable), "Cr deployable (capacity ∩ headroom)", ""],
  ];
  return (
    <>
      {hasSample && (
        <div className="sample-tag">
          Candidate universe below is <b>SAMPLE data</b>, clearly marked — wire in a live feed (see data sources) before acting.
        </div>
      )}
      <div className="ckpis">
        {ckpis.map(([n, l, cls]) => (
          <div className={"ckpi " + cls} key={l}><div className="n">{n}</div><div className="l">{l}</div></div>
        ))}
      </div>
      <div className="filters">
        <span className="small" style={{ marginRight: 4 }}>Reinvestment window:</span>
        {([3, 6, 12, "all"] as const).map((w) => (
          <span key={String(w)} className={"chip" + (win === w ? " on" : "")} onClick={() => setWin(w)}>
            {w === "all" ? "All upcoming" : "Next " + w + "m"}
          </span>
        ))}
      </div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="ph"><div><h3>Candidate bonds</h3><small>Ranked eligible-first, then by YTM · policy-filtered (approved issuer + AAA + ≤36m + single-issuer headroom)</small></div></div>
          <div className="tablebox" style={{ maxHeight: 460 }}>
            <table>
              <thead><tr>
                <th>Issuer</th><th>Bond</th><th className="hide-sm">Sector</th><th>Rating</th>
                <th className="num">YTM</th><th className="hide-sm">Maturity</th><th className="num">Tenure</th>
                <th className="num hide-sm">Lot</th><th className="num">Headroom</th><th>Status</th>
              </tr></thead>
              <tbody>
                {res.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.issuer}{r.recpfc && <span className="small"> (REC/PFC combined)</span>}</td>
                    <td data-label="Bond">{r.name}<div className="small">{r.isin}</div></td>
                    <td className="small hide-sm">{r.sector}</td>
                    <td data-label="Rating"><span className={"st " + (r.ratingOk ? "pass" : "warn")}>{r.rating}</span></td>
                    <td className="num" data-label="YTM">{pct(r.ytm)}</td>
                    <td className="small hide-sm">{r.maturity}</td>
                    <td className="num" data-label="Tenure">{r.tenureM}m</td>
                    <td className="num hide-sm">{r.lot.toFixed(2)} Cr</td>
                    <td className="num" data-label="Headroom">{r.headroom != null ? "₹" + cr(r.headroom) + " Cr" : "–"}</td>
                    <td data-label="Status">{r.pass
                      ? <span className="st pass">Eligible</span>
                      : <><span className="st breach">Excluded</span><div className="small">{r.reasons.join("; ")}</div></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="ph"><div><h3>Suggested reinvestment ladder</h3><small>Greedy fit of maturing cash into eligible names, sized to single-issuer headroom</small></div></div>
          {res.ladder.map((a, i) => (
            <div className="ladder" key={i}>
              <div><b>{a.issuer}</b> <span className="small">{a.name} · {pct(a.ytm)}</span></div>
              <div><b>₹{cr(a.amount)} Cr</b></div>
            </div>
          ))}
          <div className="small" style={{ marginTop: 6 }}>{res.ladderNote}</div>
        </div>
        <div className="panel" id="scrSources">
          <h3 style={{ margin: 0 }}>Potential data sources to wire in</h3>
          <p className="small" style={{ marginTop: 6 }}>Swap the sample candidate list for one of these feeds. Most expose primary-issuance calendars (via the exchange Electronic Bidding Platform), secondary quotes, ISIN masters and rating actions.</p>
          <div className="src-grid">
            {DATA_SOURCES.map((s, i) => (
              <div className="src-card" key={i}><h5>{s.title}</h5><p>{s.body}</p></div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const tipStyle = { background: "#161b22", border: "1px solid #2a323d", borderRadius: 8, color: "#e6edf3", fontSize: 12 } as const;

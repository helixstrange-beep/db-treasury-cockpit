"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { cr, pct, type Holding } from "@/lib/format";

const TYPES = ["Corporate Bond", "Mutual Fund", "Bank Deposit"];
const empty = { name: "", issuer: "", type: "Bank Deposit", category: "", amount: "", ytm: "", deposit: "", maturity: "", maturityAmount: "", entity: "", ipo: "Non-IPO", geo: "India" };

export default function Admin() {
  const [rows, setRows] = useState<Holding[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => fetch("/api/holdings").then((r) => r.json()).then(setRows);
  useEffect(() => { load(); }, []);

  const openNew = () => setEditing({ ...empty });
  const openEdit = (h: Holding) => setEditing({
    ...h, amount: String(h.amount), ytm: h.ytm ?? "", maturityAmount: h.maturityAmount ?? "",
    deposit: h.deposit ? h.deposit.slice(0, 10) : "", maturity: h.maturity ? h.maturity.slice(0, 10) : "",
    issuer: h.issuer ?? "", category: h.category ?? "", entity: h.entity ?? "",
  });

  const save = async () => {
    setSaving(true);
    const isEdit = !!editing.id;
    const res = await fetch(isEdit ? `/api/holdings?id=${editing.id}` : "/api/holdings", {
      method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing),
    });
    setSaving(false);
    if (res.ok) { setEditing(null); load(); } else { alert("Save failed: " + (await res.json()).error); }
  };
  const del = async (h: Holding) => {
    if (!confirm(`Delete "${h.name}"?`)) return;
    const res = await fetch(`/api/holdings?id=${h.id}`, { method: "DELETE" });
    if (res.ok) load();
  };

  const filtered = rows.filter((h) => !q || h.name.toLowerCase().includes(q.toLowerCase()) || (h.issuer || "").toLowerCase().includes(q.toLowerCase()));
  const set = (k: string, v: string) => setEditing((e: any) => ({ ...e, [k]: v }));

  return (
    <div className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="topbar">
        <div><h1>Manage Holdings</h1><div className="sub">Add, edit and remove instruments. Changes persist to the database.</div></div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/" className="btn sec">← Dashboard</Link>
          <button className="btn" onClick={openNew}>+ Add holding</button>
        </div>
      </div>
      <div className="panel">
        <div className="filters"><input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="small">{filtered.length} holdings</span></div>
        <div className="tablebox" style={{ maxHeight: "70vh" }}>
          <table>
            <thead><tr><th>Instrument</th><th className="hide-sm">Issuer</th><th>Type</th><th className="hide-sm">Entity</th><th className="num">Amount (Cr)</th><th className="num">YTM</th><th className="hide-sm">Maturity</th><th></th></tr></thead>
            <tbody>
              {filtered.map((h) => (
                <tr key={h.id}>
                  <td>{h.name}{h.ipo === "IPO" && <span className="pill ipo" style={{ marginLeft: 6 }}>IPO</span>}</td>
                  <td className="hide-sm">{h.issuer || "-"}</td>
                  <td>{h.type}</td>
                  <td className="small hide-sm">{h.entity || "-"}</td>
                  <td className="num">{cr(h.amount)}</td>
                  <td className="num">{pct(h.ytm)}</td>
                  <td className="small hide-sm">{h.maturity ? h.maturity.slice(0, 10) : "Open"}</td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <button className="btn sec" style={{ padding: "5px 10px", marginRight: 6 }} onClick={() => openEdit(h)}>Edit</button>
                    <button className="btn danger" style={{ padding: "5px 10px" }} onClick={() => del(h)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal">
            <h2 style={{ marginBottom: 16 }}>{editing.id ? "Edit holding" : "Add holding"}</h2>
            <div className="form-grid">
              <div className="field" style={{ gridColumn: "1 / -1" }}><label>Instrument name *</label><input value={editing.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="field"><label>Issuer / counterparty</label><input value={editing.issuer} onChange={(e) => set("issuer", e.target.value)} /></div>
              <div className="field"><label>Type *</label><select value={editing.type} onChange={(e) => set("type", e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Category (MF)</label><input value={editing.category} onChange={(e) => set("category", e.target.value)} placeholder="Liquid / Overnight …" /></div>
              <div className="field"><label>Legal entity</label><input value={editing.entity} onChange={(e) => set("entity", e.target.value)} /></div>
              <div className="field"><label>Amount (₹, absolute) *</label><input type="number" value={editing.amount} onChange={(e) => set("amount", e.target.value)} /></div>
              <div className="field"><label>YTM (decimal, e.g. 0.072)</label><input type="number" step="0.0001" value={editing.ytm} onChange={(e) => set("ytm", e.target.value)} /></div>
              <div className="field"><label>Date of deposit</label><input type="date" value={editing.deposit} onChange={(e) => set("deposit", e.target.value)} /></div>
              <div className="field"><label>Maturity date</label><input type="date" value={editing.maturity} onChange={(e) => set("maturity", e.target.value)} /></div>
              <div className="field"><label>Maturity amount (₹)</label><input type="number" value={editing.maturityAmount} onChange={(e) => set("maturityAmount", e.target.value)} /></div>
              <div className="field"><label>IPO?</label><select value={editing.ipo} onChange={(e) => set("ipo", e.target.value)}><option>Non-IPO</option><option>IPO</option></select></div>
              <div className="field"><label>Geography</label><select value={editing.geo} onChange={(e) => set("geo", e.target.value)}><option>India</option><option>US</option></select></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button className="btn sec" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" onClick={save} disabled={saving || !editing.name || !editing.amount}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

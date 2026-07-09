import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// This route runs the daily issuer-news refresh. It is designed to be invoked
// by a Vercel Cron Job (see vercel.json). Vercel automatically attaches an
// "Authorization: Bearer <CRON_SECRET>" header to cron invocations when the
// CRON_SECRET env var is set, so we verify that before doing any work.
//
// It can also be triggered manually with the same bearer token:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/refresh-news

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Pro plans allow up to 300s; Hobby caps at 60s. If you are on Hobby, keep
// NEWS_MAX_ISSUERS small so the run finishes inside the limit.
export const maxDuration = 300;

const SEVERITIES = ["high", "medium", "low", "positive"] as const;
type Severity = (typeof SEVERITIES)[number];

type NewsItem = {
  headline: string;
  summary: string;
  source: string;
  url?: string;
  date?: string;
  severity: Severity;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured we refuse to run rather than exposing the write path.
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Pull all output_text fragments out of an OpenAI Responses API payload.
function extractText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const out = payload?.output;
  if (!Array.isArray(out)) return "";
  const parts: string[] = [];
  for (const item of out) {
    const content = item?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c?.text === "string") parts.push(c.text);
      }
    }
  }
  return parts.join("\n");
}

// Best-effort parse of a JSON array out of a model response that may include prose.
function parseItems(text: string): NewsItem[] {
  if (!text) return [];
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.headline === "string")
      .map((x) => ({
        headline: String(x.headline).trim(),
        summary: String(x.summary ?? "").trim(),
        source: String(x.source ?? "").trim() || "Web",
        url: x.url ? String(x.url).trim() : undefined,
        date: x.date ? String(x.date).trim() : undefined,
        severity: (SEVERITIES.includes(x.severity) ? x.severity : "low") as Severity,
      }));
  } catch {
    return [];
  }
}

function buildPrompt(issuer: string, lookbackDays: number): string {
  return `You are a fixed-income credit analyst monitoring counterparty risk for a corporate treasury in India.
Search the web for MATERIAL news about the debt issuer "${issuer}" published in the last ${lookbackDays} days.

Only report items that matter to a bondholder / depositor, such as:
- credit rating actions (upgrade, downgrade, watch, outlook change)
- defaults, delayed payments, debt restructuring
- regulatory or enforcement action, fraud, governance concerns
- major results, capital raises, M&A, or liquidity events that affect creditworthiness

Ignore routine PR, product launches, and generic market commentary.
If there is no material news in the window, return an empty array.

Return ONLY a JSON array (no prose) where each element is:
{
  "headline": string,        // concise, factual
  "summary": string,         // 1-2 sentences, what happened and why it matters to a creditor
  "source": string,          // publication name
  "url": string,             // link to the article
  "date": string,            // ISO date (YYYY-MM-DD) of publication
  "severity": "high" | "medium" | "low" | "positive"
}
Severity guide: high = default/downgrade-to-junk/fraud; medium = negative watch/outlook, minor downgrade, regulatory probe; low = mild/uncertain negative; positive = upgrade or clearly credit-positive event.`;
}

// Base URL for an OpenAI-compatible API. Point this at a gateway/proxy if needed,
// e.g. OPENAI_BASE_URL="https://gateway-buildathon.ltl.sh/v1". Defaults to OpenAI.
function baseUrl(): string {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function webSearchEnabled(): boolean {
  // On by default; set OPENAI_WEB_SEARCH="false" for gateways/models without web search.
  return process.env.OPENAI_WEB_SEARCH !== "false";
}

// OpenAI Responses API — has the built-in web_search tool.
async function viaResponses(apiKey: string, model: string, prompt: string): Promise<string> {
  const body: any = { model, input: prompt };
  if (webSearchEnabled()) body.tools = [{ type: "web_search_preview" }];
  const res = await fetch(`${baseUrl()}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return extractText(await res.json());
}

// OpenAI-compatible Chat Completions API (e.g. the buildathon gateway).
async function viaChat(apiKey: string, model: string, prompt: string): Promise<string> {
  const body: any = {
    model,
    messages: [
      { role: "system", content: "You are a fixed-income credit analyst. Reply with ONLY a JSON array and no prose." },
      { role: "user", content: prompt },
    ],
  };
  // web_search_options is only honoured by search-capable models (e.g. *-search-preview).
  // It is ignored/rejected by plain models, so gate it behind the env toggle.
  if (webSearchEnabled()) body.web_search_options = {};
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const payload = await res.json();
  return String(payload?.choices?.[0]?.message?.content ?? "");
}

async function fetchIssuerNews(issuer: string, lookbackDays: number): Promise<NewsItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const style = (process.env.OPENAI_API_STYLE || "responses").toLowerCase();
  const prompt = buildPrompt(issuer, lookbackDays);
  const text =
    style === "chat"
      ? await viaChat(apiKey, model, prompt)
      : await viaResponses(apiKey, model, prompt);
  return parseItems(text);
}

async function run() {
  const lookbackDays = Number(process.env.NEWS_LOOKBACK_DAYS || 2);
  const maxPerIssuer = Number(process.env.NEWS_MAX_PER_ISSUER || 3);
  const maxIssuers = Number(process.env.NEWS_MAX_ISSUERS || 40);

  // Distinct issuers from the holdings book.
  const rows = await prisma.holding.findMany({
    where: { issuer: { not: null } },
    select: { issuer: true },
    distinct: ["issuer"],
  });
  const issuers = rows
    .map((r: { issuer: string | null }) => (r.issuer || "").trim())
    .filter(Boolean)
    .slice(0, maxIssuers);

  // Existing media in the last 45 days, for de-duplication.
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const existing = await prisma.mediaItem.findMany({
    where: { createdAt: { gte: since } },
    select: { issuer: true, headline: true },
  });
  const seen = new Set(
    existing.map((e: { issuer: string; headline: string }) => `${norm(e.issuer)}::${norm(e.headline)}`)
  );

  const summary: Record<string, number> = {};
  const errors: Record<string, string> = {};
  let inserted = 0;

  for (const issuer of issuers) {
    try {
      const items = await fetchIssuerNews(issuer, lookbackDays);
      let added = 0;
      for (const it of items) {
        if (added >= maxPerIssuer) break;
        const key = `${norm(issuer)}::${norm(it.headline)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const source = it.url ? `${it.source} — ${it.url}` : it.source;
        await prisma.mediaItem.create({
          data: {
            issuer,
            severity: it.severity,
            date: it.date ? new Date(it.date) : new Date(),
            source: source.slice(0, 500),
            headline: it.headline.slice(0, 300),
            summary: it.summary.slice(0, 2000),
          },
        });
        added++;
        inserted++;
      }
      if (added > 0) summary[issuer] = added;
    } catch (e: any) {
      errors[issuer] = String(e?.message || e).slice(0, 300);
    }
  }

  return {
    ok: true,
    ranAt: new Date().toISOString(),
    issuersChecked: issuers.length,
    inserted,
    perIssuer: summary,
    errors,
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await run());
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// Allow manual POST triggers with the same bearer token.
export async function POST(req: NextRequest) {
  return GET(req);
}

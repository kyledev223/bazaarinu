// SOL/USD: CoinGecko, then Coinbase, then Kraken. The latest good value is kept
// in the KV table so USD figures keep working when all three are briefly down.
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface SolPrice {
  usd: number;
  source: string;
  at: string; // ISO time it was fetched
}

const STALE_MS = 60_000;
let memo: SolPrice | null = null;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(6_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

const sane = (n: unknown): number | null => (typeof n === "number" && n > 1 && n < 100_000 ? n : null);

export const SOURCES: { name: string; fetch: () => Promise<number | null> }[] = [
  {
    name: "coingecko",
    fetch: async () => {
      const key = process.env.COINGECKO_API_KEY;
      const pro = process.env.COINGECKO_API_PLAN === "pro";
      const base = key && pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
      const headers: Record<string, string> = key ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {};
      const j = (await getJson(`${base}/simple/price?ids=solana&vs_currencies=usd`, headers)) as { solana?: { usd?: number } };
      return sane(j.solana?.usd);
    },
  },
  {
    name: "coinbase",
    fetch: async () => {
      const j = (await getJson("https://api.coinbase.com/v2/prices/SOL-USD/spot")) as { data?: { amount?: string } };
      return sane(Number(j.data?.amount));
    },
  },
  {
    name: "kraken",
    fetch: async () => {
      const j = (await getJson("https://api.kraken.com/0/public/Ticker?pair=SOLUSD")) as { result?: Record<string, { c?: string[] }> };
      const first = j.result ? Object.values(j.result)[0] : undefined;
      return sane(Number(first?.c?.[0]));
    },
  },
];

export async function fetchSolPrice(): Promise<SolPrice> {
  const errors: string[] = [];
  for (const s of SOURCES) {
    try {
      const usd = await s.fetch();
      if (usd) return { usd, source: s.name, at: new Date().toISOString() };
      errors.push(`${s.name}: bad value`);
    } catch (e) {
      errors.push(`${s.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new AppError("price-unavailable", { detail: errors.join("; ") });
}

/** Refresh and persist (used by the background tick). */
export async function refreshSolPrice(): Promise<SolPrice> {
  const p = await fetchSolPrice();
  memo = p;
  await db().kV.upsert({ where: { key: "solUsd" }, create: { key: "solUsd", value: p as object }, update: { value: p as object } });
  return p;
}

/** Latest known price: memory, then DB, then a live fetch. Null if nothing is known at all. */
export async function getSolPrice(): Promise<SolPrice | null> {
  if (memo && Date.now() - Date.parse(memo.at) < STALE_MS) return memo;
  try {
    const row = await db().kV.findUnique({ where: { key: "solUsd" } });
    const v = row?.value as SolPrice | undefined;
    if (v && Date.now() - Date.parse(v.at) < 10 * 60_000) return (memo = v);
    return await refreshSolPrice().catch(() => v ?? memo);
  } catch {
    return memo ?? (await fetchSolPrice().catch(() => null));
  }
}

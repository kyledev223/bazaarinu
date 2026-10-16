// Real hourly price history for the backtester.
// Primary: GeckoTerminal's public API (no key). Optional fallback: Birdeye,
// when BIRDEYE_API_KEY is set. Results are cached in the KV table for an hour.
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Candle } from "@/lib/backtest/engine";

export const MARKETS = [
  { id: "BONK", label: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { id: "WIF", label: "dogwifhat (WIF)", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { id: "JUP", label: "Jupiter (JUP)", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { id: "SOL", label: "SOL", mint: "So11111111111111111111111111111111111111112" },
] as const;

export const PAIRS = [
  { id: "SOL", mint: "So11111111111111111111111111111111111111112" },
  { id: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { id: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
] as const;

export type MarketId = (typeof MARKETS)[number]["id"];
export type PairId = (typeof PAIRS)[number]["id"];

export interface History {
  market: MarketId;
  pair: PairId;
  days: number;
  source: "geckoterminal" | "birdeye";
  pool: string | null;
  poolName: string | null;
  poolLiquidity: number; // in quote units
  candles: Candle[];
  fetchedAt: string;
}

const GT = "https://api.geckoterminal.com/api/v2";
const TTL_MS = 3600_000;

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json() as Promise<any>;
}

const idMint = (id: string | undefined) => (id ?? "").replace(/^solana_/, "");

async function fromGecko(base: string, quote: string, days: number): Promise<Omit<History, "market" | "pair" | "days" | "fetchedAt">> {
  const list = await getJson(`${GT}/networks/solana/tokens/${base}/pools?page=1`);
  type Pool = { attributes: { address: string; name: string; reserve_in_usd: string }; relationships: { base_token: { data: { id: string } }; quote_token: { data: { id: string } } } };
  const pools = ((list.data ?? []) as Pool[])
    .map((p) => ({
      address: p.attributes.address,
      name: p.attributes.name,
      tvlUsd: Number(p.attributes.reserve_in_usd) || 0,
      base: idMint(p.relationships.base_token?.data?.id),
      quote: idMint(p.relationships.quote_token?.data?.id),
    }))
    .filter((p) => (p.base === base && p.quote === quote) || (p.base === quote && p.quote === base))
    .sort((a, b) => b.tvlUsd - a.tvlUsd);
  const pool = pools[0];
  if (!pool) throw new Error("no pool for this pair");
  const inverted = pool.base !== base;
  const limit = Math.min(1000, days * 24);
  const ohlcv = (currency: "usd" | "token") =>
    getJson(`${GT}/networks/solana/pools/${pool.address}/ohlcv/hour?aggregate=1&limit=${limit}&currency=${currency}&token=${inverted ? "quote" : "base"}`);
  const [tok, usd] = await Promise.all([ohlcv("token"), ohlcv("usd")]);
  const tokRows = (tok.data?.attributes?.ohlcv_list ?? []) as number[][];
  const usdByTs = new Map(((usd.data?.attributes?.ohlcv_list ?? []) as number[][]).map((r) => [r[0], r]));

  const candles: Candle[] = tokRows
    .map(([t, , , , close]) => {
      const u = usdByTs.get(t);
      // Volume comes in USD; convert to quote units with this hour's quote price.
      const quoteUsd = u && close > 0 ? u[4] / close : 0;
      return { t, close, volume: u && quoteUsd > 0 ? u[5] / quoteUsd : 0 };
    })
    .filter((c) => c.close > 0)
    .sort((a, b) => a.t - b.t);
  if (candles.length < 24) throw new Error("not enough history");
  const last = candles[candles.length - 1];
  const lastUsd = usdByTs.get(last.t);
  const quoteUsd = lastUsd ? lastUsd[4] / last.close : 1;
  return { source: "geckoterminal", pool: pool.address, poolName: pool.name, poolLiquidity: pool.tvlUsd / (quoteUsd || 1), candles };
}

async function fromBirdeye(base: string, quote: string, days: number): Promise<Omit<History, "market" | "pair" | "days" | "fetchedAt">> {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key) throw new Error("BIRDEYE_API_KEY not set");
  const headers = { "X-API-KEY": key, "x-chain": "solana" };
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86_400;
  const series = async (mint: string) => {
    const j = await getJson(`https://public-api.birdeye.so/defi/ohlcv?address=${mint}&type=1H&time_from=${from}&time_to=${to}`, headers);
    return new Map(((j.data?.items ?? []) as { unixTime: number; c: number; v: number }[]).map((i) => [i.unixTime, i]));
  };
  const [b, q] = await Promise.all([series(base), series(quote)]);
  const candles: Candle[] = [...b.entries()]
    .filter(([t]) => q.has(t))
    .map(([t, bi]) => {
      const qi = q.get(t)!;
      const close = qi.c > 0 ? bi.c / qi.c : 0;
      return { t, close, volume: close > 0 ? bi.v * close : 0 };
    })
    .filter((c) => c.close > 0)
    .sort((a, b2) => a.t - b2.t);
  if (candles.length < 24) throw new Error("not enough history");
  const ov = await getJson(`https://public-api.birdeye.so/defi/token_overview?address=${base}`, headers).catch(() => null);
  const liqUsd = Number(ov?.data?.liquidity) || 0;
  const quoteUsd = q.get(candles[candles.length - 1].t)?.c || 1;
  return { source: "birdeye", pool: null, poolName: null, poolLiquidity: liqUsd / quoteUsd, candles };
}

export async function getHistory(market: MarketId, pair: PairId, days: number): Promise<History> {
  const m = MARKETS.find((x) => x.id === market);
  const p = PAIRS.find((x) => x.id === pair);
  if (!m || !p || m.mint === p.mint) throw new AppError("validation", { fields: { pair: "Pick a pair that differs from the market." } });
  const d = days === 7 ? 7 : 30;
  const key = `hist:${market}:${pair}:${d}`;

  const cached = await db().kV.findUnique({ where: { key } }).catch(() => null);
  const hit = cached?.value as History | undefined;
  if (hit && Date.now() - Date.parse(hit.fetchedAt) < TTL_MS) return hit;

  const errors: string[] = [];
  for (const source of [fromGecko, fromBirdeye]) {
    try {
      const h: History = { market, pair, days: d, fetchedAt: new Date().toISOString(), ...(await source(m.mint, p.mint, d)) };
      await db().kV.upsert({ where: { key }, create: { key, value: h as object }, update: { value: h as object } }).catch(() => {});
      return h;
    } catch (e) {
      errors.push(`${source.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (hit) return hit; // stale beats nothing
  throw new AppError("history-unavailable", { detail: errors.join("; ") });
}

/** Health check probe. */
export async function geckoReachable(): Promise<boolean> {
  const j = await getJson(`${GT}/networks/solana/tokens/${MARKETS[0].mint}`);
  return !!j?.data;
}

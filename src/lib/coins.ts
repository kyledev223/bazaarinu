// Read models for the Market, coin dashboards, "My shops" and the launch log.
// USD values are computed at read time from the latest SOL price.
import { db } from "@/lib/db";
import { getSolPrice } from "@/lib/price";
import { curvePriceSol, lamportsToSol } from "@/lib/solana/curve";
import type { Coin, Trade } from "@/generated/prisma/client";

export interface CoinView {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  creator: string;
  createdAt: string;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  signature: string;
  marketCapSol: number | null;
  marketCapUsd: number | null;
  priceSol: number | null;
  progressPct: number | null;
  complete: boolean;
  graduated: boolean;
  holders: number | null;
  statsUpdatedAt: string | null;
}

export interface TradeView {
  signature: string;
  isBuy: boolean;
  sol: number;
  tokens: number;
  trader: string;
  venue: string;
  at: string;
}

export function coinView(c: Coin, solUsd: number | null): CoinView {
  const mcSol = c.marketCapLamports !== null ? lamportsToSol(c.marketCapLamports) : null;
  let price: number | null = null;
  if (c.graduated && c.poolBaseReserve && c.poolQuoteReserve) price = (Number(c.poolQuoteReserve) / 1e9) / (Number(c.poolBaseReserve) / 1e6);
  else if (c.virtualSolReserves && c.virtualTokenReserves) price = curvePriceSol(c.virtualSolReserves, c.virtualTokenReserves);
  return {
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    description: c.description,
    imageUri: c.imageUri,
    creator: c.creator,
    createdAt: c.createdAt.toISOString(),
    twitter: c.twitter,
    telegram: c.telegram,
    website: c.website,
    signature: c.signature,
    marketCapSol: mcSol,
    marketCapUsd: mcSol !== null && solUsd ? mcSol * solUsd : null,
    priceSol: price,
    progressPct: c.progressBps !== null ? c.progressBps / 100 : null,
    complete: c.complete,
    graduated: c.graduated,
    holders: c.holders,
    statsUpdatedAt: c.statsUpdatedAt?.toISOString() ?? null,
  };
}

export function tradeView(t: Trade): TradeView {
  return {
    signature: t.signature,
    isBuy: t.isBuy,
    sol: lamportsToSol(t.solLamports),
    tokens: Number(t.tokenAmount) / 1e6,
    trader: t.trader,
    venue: t.venue,
    at: t.blockTime.toISOString(),
  };
}

export async function listCoins(opts: { creator?: string; limit?: number } = {}) {
  const [coins, price] = await Promise.all([
    db().coin.findMany({ where: opts.creator ? { creator: opts.creator } : {}, orderBy: { createdAt: "desc" }, take: opts.limit ?? 60 }),
    getSolPrice(),
  ]);
  return { coins: coins.map((c) => coinView(c, price?.usd ?? null)), solUsd: price?.usd ?? null, solUsdSource: price?.source ?? null };
}

export async function getCoin(mint: string) {
  const [coin, price] = await Promise.all([db().coin.findUnique({ where: { mint } }), getSolPrice()]);
  if (!coin) return null;
  const trades = await db().trade.findMany({ where: { mint }, orderBy: { blockTime: "desc" }, take: 25 });
  return { coin: coinView(coin, price?.usd ?? null), trades: trades.map(tradeView), solUsd: price?.usd ?? null };
}

export interface LogLine {
  at: string;
  kind: "launch" | "buy" | "sell";
  symbol: string;
  mint: string;
  sol: number | null;
  who: string;
  signature: string;
}

export async function launchLog(limit = 30): Promise<LogLine[]> {
  const [coins, trades] = await Promise.all([
    db().coin.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { mint: true, symbol: true, creator: true, createdAt: true, signature: true } }),
    db().trade.findMany({ orderBy: { blockTime: "desc" }, take: limit, include: { coin: { select: { symbol: true } } } }),
  ]);
  const lines: LogLine[] = [
    ...coins.map((c) => ({ at: c.createdAt.toISOString(), kind: "launch" as const, symbol: c.symbol, mint: c.mint, sol: null, who: c.creator, signature: c.signature })),
    ...trades.map((t) => ({ at: t.blockTime.toISOString(), kind: t.isBuy ? ("buy" as const) : ("sell" as const), symbol: t.coin.symbol, mint: t.mint, sol: lamportsToSol(t.solLamports), who: t.trader, signature: t.signature })),
  ];
  return lines.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

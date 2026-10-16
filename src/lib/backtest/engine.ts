// Replays a real price history through a liquidity strategy.
//
// Prices are quote per base (e.g. SOL per BONK). The position uses the usual
// concentrated-liquidity maths: a range [pa, pb] and a liquidity L hold
//   x = L(1/√P − 1/√pb), y = L(√P − √pa)   inside the range,
// all base below it and all quote above it. Constant product is the full range
// (pa → 0, pb → ∞), where the value is 2L√P.
//
// Fees: each candle the position earns  fee × volume × share  while in range,
// with share = L / (L + L_pool) and the pool treated as full-range liquidity
// holding the pool's TVL. That is a simplification, and the UI says so: it does
// not model traders reacting to a different fee or other LPs moving.

export type Strategy = "constant" | "concentrated" | "dynamic" | "volatility";

export const STRATEGIES: { id: Strategy; label: string; blurb: string }[] = [
  { id: "constant", label: "Constant product", blurb: "Classic x·y=k. Liquidity at every price, never out of range." },
  { id: "concentrated", label: "Concentrated", blurb: "All liquidity inside one fixed range. More fees, more risk." },
  { id: "dynamic", label: "Dynamic", blurb: "Re-centres the range whenever price walks out of it." },
  { id: "volatility", label: "Volatility-adjusted", blurb: "Widens the range and raises the fee when the market gets choppy." },
];

export interface Candle {
  t: number; // unix seconds
  close: number; // quote per base
  volume: number; // traded volume in quote units
}

export interface BacktestInput {
  candles: Candle[];
  strategy: Strategy;
  feeTier: number; // 0.003 = 0.3%
  rangePct: number; // ±% around the price, ignored for constant product
  buybackShare: number; // 0..1 of fee income
  seed: number; // starting capital in quote units
  poolLiquidity: number; // the real pool's TVL in quote units
}

export interface BacktestPoint {
  t: number;
  price: number;
  strategy: number; // position value + fees collected so far
  hold: number; // value of just holding the starting amounts
  inRange: boolean;
}

export interface BacktestResult {
  fees: number;
  impermanentLoss: number; // position value − hold value, before fees (≤ 0 for a static range)
  rebalanceCost: number;
  netVsHold: number; // position + fees − rebalance cost − hold
  timeInRange: number; // 0..1
  buybackSpend: number; // quote spent on buybacks
  buybackCoins: number; // base coins those buybacks bought
  rebalances: number;
  startPrice: number;
  endPrice: number;
  endValue: number;
  holdValue: number;
  points: BacktestPoint[];
}

interface Range {
  pa: number;
  pb: number; // Infinity for full range
}

const sqrt = Math.sqrt;

/** Base and quote amounts held by liquidity L in a range at price P. */
export function amounts(L: number, P: number, { pa, pb }: Range): { x: number; y: number } {
  const sa = sqrt(pa);
  const sb = pb === Infinity ? Infinity : sqrt(pb);
  if (P <= pa) return { x: L * (1 / sa - 1 / sb), y: 0 };
  if (P >= pb) return { x: 0, y: L * (sb - sa) };
  const sp = sqrt(P);
  return { x: L * (1 / sp - (sb === Infinity ? 0 : 1 / sb)), y: L * (sp - sa) };
}

export function positionValue(L: number, P: number, r: Range): number {
  const { x, y } = amounts(L, P, r);
  return x * P + y;
}

/** Liquidity that `capital` (in quote) buys in range r at price P. */
export function liquidityFor(capital: number, P: number, r: Range): number {
  const perL = positionValue(1, P, r);
  return perL > 0 ? capital / perL : 0;
}

export function rangeAround(P: number, pct: number): Range {
  const w = Math.min(Math.max(pct, 0.5), 100) / 100;
  return { pa: P * (1 - w), pb: P * (1 + w) };
}

const FULL: Range = { pa: 0, pb: Infinity };

/** Std-dev of log returns over the last `n` candles up to index i. */
function rollingVol(prices: number[], i: number, n: number): number {
  const start = Math.max(1, i - n + 1);
  const rets: number[] = [];
  for (let j = start; j <= i; j++) rets.push(Math.log(prices[j] / prices[j - 1]));
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const candles = input.candles.filter((c) => c.close > 0 && Number.isFinite(c.close));
  if (candles.length < 2) throw new Error("Need at least two candles");
  if (!(input.seed > 0)) throw new Error("Seed must be positive");

  const prices = candles.map((c) => c.close);
  const P0 = prices[0];
  const isFull = input.strategy === "constant";
  const adaptive = input.strategy === "dynamic" || input.strategy === "volatility";

  // Baseline volatility from the first day, so "choppy" is relative to this market.
  const VOL_WINDOW = 24;
  const baseVol = Math.max(rollingVol(prices, Math.min(VOL_WINDOW, prices.length - 1), VOL_WINDOW), 1e-6);

  const widthFor = (i: number) => {
    if (input.strategy !== "volatility") return input.rangePct;
    const ratio = rollingVol(prices, i, VOL_WINDOW) / baseVol;
    return Math.min(100, input.rangePct * Math.max(1, ratio));
  };
  const feeFor = (i: number) => {
    if (input.strategy !== "volatility") return input.feeTier;
    const ratio = rollingVol(prices, i, VOL_WINDOW) / baseVol;
    return input.feeTier * Math.min(3, Math.max(1, ratio));
  };

  let range: Range = isFull ? FULL : rangeAround(P0, widthFor(0));
  let L = liquidityFor(input.seed, P0, range);
  const start = amounts(L, P0, range);
  const holdAt = (P: number) => start.x * P + start.y;

  let fees = 0;
  let rebalanceCost = 0;
  let rebalances = 0;
  let inRangeCount = 0;
  let buybackSpend = 0;
  let buybackCoins = 0;
  const points: BacktestPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const P = prices[i];

    // Adaptive strategies re-centre once price leaves the range. Rebalancing
    // swaps roughly half the position, which pays the pool fee on that half.
    if (adaptive && !isFull && (P <= range.pa || P >= range.pb)) {
      const value = positionValue(L, P, range);
      const cost = value * 0.5 * input.feeTier;
      rebalanceCost += cost;
      range = rangeAround(P, widthFor(i));
      L = liquidityFor(value - cost, P, range);
      rebalances++;
    }

    const inRange = isFull || (P > range.pa && P < range.pb);
    if (inRange) inRangeCount++;

    if (i > 0 && inRange) {
      const poolL = input.poolLiquidity > 0 ? input.poolLiquidity / (2 * sqrt(P)) : 0;
      const share = L / (L + poolL);
      const earned = feeFor(i) * Math.max(0, candles[i].volume) * share;
      fees += earned;
      const spend = earned * input.buybackShare;
      buybackSpend += spend;
      buybackCoins += spend / P;
    }

    // The rebalance cost already came out of L, so the position value is net of it.
    points.push({ t: candles[i].t, price: P, strategy: positionValue(L, P, range) + fees, hold: holdAt(P), inRange });
  }

  const endPrice = prices[prices.length - 1];
  const endValue = positionValue(L, endPrice, range);
  const holdValue = holdAt(endPrice);
  return {
    fees,
    // Reported separately from the rebalance cost: net = IL + fees − rebalanceCost.
    impermanentLoss: endValue + rebalanceCost - holdValue,
    rebalanceCost,
    netVsHold: endValue + fees - holdValue,
    timeInRange: inRangeCount / candles.length,
    buybackSpend,
    buybackCoins,
    rebalances,
    startPrice: P0,
    endPrice,
    endValue,
    holdValue,
    points,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function summarize(r: BacktestResult, o: { strategy: Strategy; quote: string; base: string; days: number }): string {
  const q = (n: number) => `${Math.abs(n) < 1 ? n.toFixed(4) : n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${o.quote}`;
  const move = r.endPrice / r.startPrice - 1;
  const label = STRATEGIES.find((s) => s.id === o.strategy)?.label ?? o.strategy;
  const parts = [
    `Over the last ${o.days} days ${o.base} moved ${move >= 0 ? "up" : "down"} ${pct(Math.abs(move))} against ${o.quote}.`,
    `A ${label.toLowerCase()} position would have earned ${q(r.fees)} in fees`,
  ];
  if (o.strategy !== "constant") parts[1] += ` while in range ${pct(r.timeInRange)} of the time`;
  parts[1] +=
    r.impermanentLoss <= 0
      ? `, against ${q(Math.abs(r.impermanentLoss))} of impermanent loss.`
      : `, and the position itself gained ${q(r.impermanentLoss)} on holding.`;
  if (r.rebalances) parts.push(`It re-centred ${r.rebalances} time${r.rebalances === 1 ? "" : "s"}, costing about ${q(r.rebalanceCost)}.`);
  parts.push(
    r.netVsHold >= 0
      ? `Net, it beat simply holding by ${q(r.netVsHold)}.`
      : `Net, it did ${q(Math.abs(r.netVsHold))} worse than simply holding.`,
  );
  if (r.buybackSpend > 0)
    parts.push(`The buyback share would have spent ${q(r.buybackSpend)} buying back about ${Math.round(r.buybackCoins).toLocaleString("en-US")} ${o.base}.`);
  return parts.join(" ");
}

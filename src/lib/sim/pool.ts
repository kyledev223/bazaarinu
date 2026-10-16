// Constant-product (x·y = k) pool used by the "Run the shop" simulator.
//
// x = coin reserve, y = SOL reserve. Fees are always taken in SOL and kept
// outside the reserves (in `feePot`), so swaps keep k exactly constant and the
// fee income is easy to read off. All functions are pure: they return a new
// state and never mutate their input.

export interface PoolState {
  x: number; // coin in the pool
  y: number; // SOL in the pool
  x0: number; // starting coin, for the "vs. holding" comparison
  y0: number;
  marketPrice: number; // SOL per coin on outside markets
  fee: number; // e.g. 0.003 for 0.3%
  feePot: number; // SOL fees not yet spent on buybacks
  feesTotal: number; // SOL fees earned since reset
  arbLoss: number; // SOL arbitrage bots extracted from the pool
  burned: number; // coins bought back and burned
}

export interface TradeResult {
  state: PoolState;
  coinDelta: number; // coins the trader received (+) or paid (-)
  solDelta: number; // SOL the trader received (+) or paid (-)
  fee: number; // SOL fee the pool kept
}

export interface ArbResult extends TradeResult {
  side: "buy" | "sell";
  profit: number; // SOL the arbitrageur made, measured at the market price
}

export const FEE_TIERS = [0.0005, 0.003, 0.01] as const;
export const VOLATILITY = { calm: 0.004, normal: 0.01, wild: 0.025 } as const;
export type Volatility = keyof typeof VOLATILITY;

export function createPool(coin = 1_000_000, sol = 100, fee = 0.003): PoolState {
  if (!(coin > 0 && sol > 0)) throw new Error("Reserves must be positive");
  return {
    x: coin,
    y: sol,
    x0: coin,
    y0: sol,
    marketPrice: sol / coin,
    fee,
    feePot: 0,
    feesTotal: 0,
    arbLoss: 0,
    burned: 0,
  };
}

export const poolPrice = (s: PoolState) => s.y / s.x;
export const k = (s: PoolState) => s.x * s.y;

/** Pay `sol` SOL (fee included) and receive coins. */
export function buyWithSol(s: PoolState, sol: number): TradeResult {
  if (!(sol > 0)) throw new Error("Amount must be positive");
  const fee = sol * s.fee;
  const solIn = sol - fee;
  const coinsOut = (s.x * solIn) / (s.y + solIn);
  return {
    state: { ...s, x: s.x - coinsOut, y: s.y + solIn, feePot: s.feePot + fee, feesTotal: s.feesTotal + fee },
    coinDelta: coinsOut,
    solDelta: -sol,
    fee,
  };
}

/** Sell `coins` coins and receive SOL (fee deducted from the SOL out). */
export function sellCoins(s: PoolState, coins: number): TradeResult {
  if (!(coins > 0)) throw new Error("Amount must be positive");
  const grossOut = (s.y * coins) / (s.x + coins);
  const fee = grossOut * s.fee;
  return {
    state: { ...s, x: s.x + coins, y: s.y - grossOut, feePot: s.feePot + fee, feesTotal: s.feesTotal + fee },
    coinDelta: -coins,
    solDelta: grossOut - fee,
    fee,
  };
}

/**
 * The arbitrage bot trades until the pool price, after fees, matches the
 * market. Buying from the pool costs p/(1-f) at the margin, selling earns
 * p·(1-f), so the bot stops at p = m·(1-f) or p = m/(1-f). Inside that band
 * there is nothing to take and it returns null.
 */
export function arbitrage(s: PoolState): ArbResult | null {
  const p = poolPrice(s);
  const m = s.marketPrice;
  const f = s.fee;
  const kk = k(s);
  // Relative tolerance so a pool sitting exactly on the band edge isn't "arbitraged" by float noise.
  const EPS = 1e-9;

  if (p < m * (1 - f) * (1 - EPS)) {
    const target = m * (1 - f);
    const y1 = Math.sqrt(kk * target);
    const x1 = Math.sqrt(kk / target);
    const solIn = (y1 - s.y) / (1 - f);
    const fee = solIn * f;
    const coinsOut = s.x - x1;
    const profit = coinsOut * m - solIn;
    return {
      side: "buy",
      state: { ...s, x: x1, y: y1, feePot: s.feePot + fee, feesTotal: s.feesTotal + fee, arbLoss: s.arbLoss + Math.max(0, profit) },
      coinDelta: coinsOut,
      solDelta: -solIn,
      fee,
      profit,
    };
  }

  if (p > (m / (1 - f)) * (1 + EPS)) {
    const target = m / (1 - f);
    const y1 = Math.sqrt(kk * target);
    const x1 = Math.sqrt(kk / target);
    const coinsIn = x1 - s.x;
    const grossOut = s.y - y1;
    const fee = grossOut * f;
    const profit = grossOut - fee - coinsIn * m;
    return {
      side: "sell",
      state: { ...s, x: x1, y: y1, feePot: s.feePot + fee, feesTotal: s.feesTotal + fee, arbLoss: s.arbLoss + Math.max(0, profit) },
      coinDelta: -coinsIn,
      solDelta: grossOut - fee,
      fee,
      profit,
    };
  }
  return null;
}

/** Spend every SOL in the fee pot buying coins from the pool, then burn them. */
export function buyback(s: PoolState): { state: PoolState; burned: number; spent: number } {
  const sol = s.feePot;
  if (sol <= 0) return { state: s, burned: 0, spent: 0 };
  const coins = (s.x * sol) / (s.y + sol);
  return { state: { ...s, x: s.x - coins, y: s.y + sol, feePot: 0, burned: s.burned + coins }, burned: coins, spent: sol };
}

/** Move the outside market price one step of geometric Brownian motion. `z` is a standard normal draw. */
export function marketStep(s: PoolState, vol: number, z: number): PoolState {
  return { ...s, marketPrice: s.marketPrice * Math.exp(vol * z - (vol * vol) / 2) };
}

export function shock(s: PoolState, factor: number): PoolState {
  return { ...s, marketPrice: s.marketPrice * factor };
}

export function setFee(s: PoolState, fee: number): PoolState {
  return { ...s, fee };
}

export interface PoolStats {
  poolPrice: number;
  marketPrice: number;
  feesTotal: number;
  arbLoss: number;
  /** Pool reserves at the market price, plus unspent fees, minus the starting reserves at the market price. */
  vsHold: number;
  /** Reserves-only loss against holding (impermanent loss), at the market price. Always <= 0 for a fresh pool. */
  impermanentLoss: number;
  burned: number;
}

export function stats(s: PoolState): PoolStats {
  const m = s.marketPrice;
  const lpValue = s.x * m + s.y;
  const holdValue = s.x0 * m + s.y0;
  return {
    poolPrice: poolPrice(s),
    marketPrice: m,
    feesTotal: s.feesTotal,
    arbLoss: s.arbLoss,
    vsHold: lpValue + s.feePot - holdValue,
    impermanentLoss: lpValue - holdValue,
    burned: s.burned,
  };
}

/** Small seeded PRNG so simulator runs are reproducible in tests. */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rand: () => number): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

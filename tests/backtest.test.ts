import { describe, expect, it } from "vitest";
import { amounts, liquidityFor, positionValue, rangeAround, runBacktest, summarize, type Candle } from "@/lib/backtest/engine";

const flat = (n: number, price = 1, volume = 0): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * 3600, close: price, volume }));
const base = { feeTier: 0.003, rangePct: 25, buybackShare: 0, seed: 100, poolLiquidity: 10_000 };

describe("position maths", () => {
  it("full range value is 2L√P", () => {
    const r = { pa: 0, pb: Infinity };
    expect(positionValue(5, 4, r)).toBeCloseTo(2 * 5 * 2, 12);
  });

  it("is all base below the range and all quote above it", () => {
    const r = { pa: 0.8, pb: 1.25 };
    const below = amounts(10, 0.5, r);
    expect(below.y).toBe(0);
    expect(below.x).toBeGreaterThan(0);
    const above = amounts(10, 2, r);
    expect(above.x).toBe(0);
    expect(above.y).toBeCloseTo(10 * (Math.sqrt(1.25) - Math.sqrt(0.8)), 12);
  });

  it("value is continuous at the range edges", () => {
    const r = { pa: 0.8, pb: 1.25 };
    expect(positionValue(7, 0.8 + 1e-12, r)).toBeCloseTo(positionValue(7, 0.8 - 1e-12, r), 6);
    expect(positionValue(7, 1.25 - 1e-12, r)).toBeCloseTo(positionValue(7, 1.25 + 1e-12, r), 6);
  });

  it("liquidityFor inverts positionValue", () => {
    const r = rangeAround(2, 10);
    const L = liquidityFor(500, 2, r);
    expect(positionValue(L, 2, r)).toBeCloseTo(500, 9);
  });
});

describe("runBacktest", () => {
  it("flat price and no volume: no fees, no loss, always in range", () => {
    const r = runBacktest({ ...base, candles: flat(48), strategy: "constant" });
    expect(r.fees).toBe(0);
    expect(r.impermanentLoss).toBeCloseTo(0, 9);
    expect(r.netVsHold).toBeCloseTo(0, 9);
    expect(r.timeInRange).toBe(1);
  });

  it("constant product loses 20% to holding when price quadruples", () => {
    const candles: Candle[] = [{ t: 0, close: 1, volume: 0 }, { t: 1, close: 4, volume: 0 }];
    const r = runBacktest({ ...base, candles, strategy: "constant" });
    expect(r.endValue / r.holdValue).toBeCloseTo(0.8, 9);
  });

  it("a tighter range earns more fees than full range on the same volume", () => {
    const candles = flat(24, 1, 1_000);
    const full = runBacktest({ ...base, candles, strategy: "constant" });
    const tight = runBacktest({ ...base, candles, strategy: "concentrated", rangePct: 5 });
    expect(full.fees).toBeGreaterThan(0);
    expect(tight.fees).toBeGreaterThan(full.fees * 5);
  });

  it("fees scale with the fee tier", () => {
    const candles = flat(24, 1, 1_000);
    const lo = runBacktest({ ...base, candles, strategy: "constant", feeTier: 0.0005 });
    const hi = runBacktest({ ...base, candles, strategy: "constant", feeTier: 0.01 });
    expect(hi.fees / lo.fees).toBeCloseTo(20, 6);
  });

  it("a static concentrated range stops earning once out of range", () => {
    const candles: Candle[] = [...flat(10, 1, 1_000), ...flat(10, 3, 1_000).map((c, i) => ({ ...c, t: (10 + i) * 3600 }))];
    const r = runBacktest({ ...base, candles, strategy: "concentrated", rangePct: 10 });
    expect(r.timeInRange).toBeCloseTo(0.5, 9);
    expect(r.rebalances).toBe(0);
  });

  it("dynamic re-centres when price leaves the range", () => {
    const candles: Candle[] = [...flat(10, 1, 1_000), ...flat(10, 3, 1_000).map((c, i) => ({ ...c, t: (10 + i) * 3600 }))];
    const r = runBacktest({ ...base, candles, strategy: "dynamic", rangePct: 10 });
    expect(r.rebalances).toBe(1);
    expect(r.timeInRange).toBeGreaterThan(0.9);
    expect(r.rebalanceCost).toBeGreaterThan(0);
    // net = IL + fees − rebalance cost
    expect(r.netVsHold).toBeCloseTo(r.impermanentLoss + r.fees - r.rebalanceCost, 9);
  });

  it("buybacks spend their share of fees at the market price", () => {
    const r = runBacktest({ ...base, candles: flat(24, 2, 1_000), strategy: "constant", buybackShare: 0.4 });
    expect(r.buybackSpend).toBeCloseTo(r.fees * 0.4, 9);
    expect(r.buybackCoins).toBeCloseTo((r.fees * 0.4) / 2, 9);
  });

  it("volatility-adjusted raises the fee in a choppy market", () => {
    const calm = Array.from({ length: 30 }, (_, i) => ({ t: i, close: 1 + (i % 2 ? 0.001 : 0), volume: 1_000 }));
    const choppy = Array.from({ length: 60 }, (_, i) => ({ t: 30 + i, close: 1 + (i % 2 ? 0.05 : 0), volume: 1_000 }));
    const candles = [...calm, ...choppy];
    const vol = runBacktest({ ...base, candles, strategy: "volatility", rangePct: 30 });
    const conc = runBacktest({ ...base, candles, strategy: "concentrated", rangePct: 30 });
    expect(vol.fees).toBeGreaterThan(conc.fees);
  });

  it("validates input and writes a summary", () => {
    expect(() => runBacktest({ ...base, candles: flat(1), strategy: "constant" })).toThrow();
    const r = runBacktest({ ...base, candles: flat(24, 1, 100), strategy: "constant", buybackShare: 0.5 });
    const text = summarize(r, { strategy: "constant", quote: "SOL", base: "BONK", days: 1 });
    expect(text).toMatch(/earned/);
    expect(text).toMatch(/buying back/);
  });
});

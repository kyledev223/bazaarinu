import { describe, expect, it } from "vitest";
import { arbitrage, buyWithSol, buyback, createPool, k, marketStep, normal, poolPrice, rng, sellCoins, shock, stats } from "@/lib/sim/pool";

const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-12);

describe("constant-product pool", () => {
  it("keeps k constant on swaps (fees sit outside the reserves)", () => {
    const s0 = createPool(1_000_000, 100, 0.003);
    const a = buyWithSol(s0, 5);
    close(k(a.state), k(s0));
    const b = sellCoins(a.state, 20_000);
    close(k(b.state), k(s0));
  });

  it("buy output matches x·y=k by hand", () => {
    const s0 = createPool(1_000_000, 100, 0.01);
    const r = buyWithSol(s0, 10);
    // 9.9 SOL in after the 1% fee: dx = 1e6 × 9.9 / 109.9
    close(r.coinDelta, (1_000_000 * 9.9) / 109.9);
    close(r.fee, 0.1);
    expect(r.state.feePot).toBeCloseTo(0.1, 12);
  });

  it("a round trip loses exactly the fees", () => {
    const s0 = createPool(1_000_000, 100, 0.003);
    const a = buyWithSol(s0, 1);
    const b = sellCoins(a.state, a.coinDelta);
    // Reserves return to the start; the trader paid fee on the way in and out.
    close(b.state.x, s0.x);
    close(b.state.y, s0.y, 1e-9);
    close(1 - b.solDelta, b.state.feesTotal, 1e-9);
  });

  it("is pure: inputs are never mutated", () => {
    const s0 = createPool();
    const copy = { ...s0 };
    buyWithSol(s0, 3);
    sellCoins(s0, 3000);
    buyback(s0);
    expect(s0).toEqual(copy);
  });

  it("arbitrage closes the gap to the edge of the fee band, and earns the bot money", () => {
    let s = createPool(1_000_000, 100, 0.003);
    s = shock(s, 0.65); // market drops 35%
    const r = arbitrage(s);
    expect(r?.side).toBe("sell");
    close(poolPrice(r!.state), s.marketPrice / (1 - s.fee), 1e-9);
    expect(r!.profit).toBeGreaterThan(0);
    expect(r!.state.arbLoss).toBeCloseTo(r!.profit, 12);
    // Nothing left to take afterwards.
    expect(arbitrage(r!.state)).toBeNull();
  });

  it("arbitrage buys when the pool is cheap", () => {
    let s = createPool(1_000_000, 100, 0.003);
    s = shock(s, 1.2);
    const r = arbitrage(s)!;
    expect(r.side).toBe("buy");
    close(poolPrice(r.state), s.marketPrice * (1 - s.fee), 1e-9);
  });

  it("no arbitrage inside the fee band", () => {
    const s = shock(createPool(1_000_000, 100, 0.01), 1.005);
    expect(arbitrage(s)).toBeNull();
  });

  it("impermanent loss matches 2√r/(1+r) − 1 after arbitrage with no fee", () => {
    let s = createPool(1_000_000, 100, 0);
    s = shock(s, 4);
    s = arbitrage(s)!.state;
    const st = stats(s);
    const hold = s.x0 * s.marketPrice + s.y0;
    close(st.impermanentLoss / hold, (2 * Math.sqrt(4)) / 5 - 1, 1e-9);
  });

  it("buyback spends the fee pot and burns coins", () => {
    let s = createPool(1_000_000, 100, 0.01);
    s = buyWithSol(s, 10).state;
    const pot = s.feePot;
    const b = buyback(s);
    expect(b.spent).toBeCloseTo(pot, 12);
    expect(b.state.feePot).toBe(0);
    expect(b.state.burned).toBeGreaterThan(0);
    expect(buyback(b.state).burned).toBe(0);
  });

  it("vs. holding counts unspent fees", () => {
    let s = createPool(1_000_000, 100, 0.003);
    s = buyWithSol(s, 2).state;
    s = sellCoins(s, 15_000).state;
    const st = stats(s);
    close(st.vsHold - st.impermanentLoss, s.feePot);
  });

  it("market steps are reproducible with a seed", () => {
    const a = rng(42);
    const b = rng(42);
    let s1 = createPool();
    let s2 = createPool();
    for (let i = 0; i < 50; i++) {
      s1 = marketStep(s1, 0.01, normal(a));
      s2 = marketStep(s2, 0.01, normal(b));
    }
    expect(s1.marketPrice).toBe(s2.marketPrice);
    expect(s1.marketPrice).not.toBe(createPool().marketPrice);
  });

  it("rejects bad amounts", () => {
    expect(() => buyWithSol(createPool(), 0)).toThrow();
    expect(() => sellCoins(createPool(), -1)).toThrow();
    expect(() => createPool(0, 1)).toThrow();
  });
});

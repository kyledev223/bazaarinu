import { describe, expect, it } from "vitest";
import {
  DEFAULT_INITIAL_REAL_TOKEN_RESERVES,
  DEFAULT_TOKEN_TOTAL_SUPPLY,
  curveMarketCapLamports,
  curvePriceSol,
  curveProgressBps,
  formatSol,
  poolMarketCapLamports,
  solToLamports,
} from "@/lib/solana/curve";

describe("bonding curve maths", () => {
  // A fresh pump.fun curve: 30 SOL virtual, 1,073,000,000 virtual tokens.
  const vSol = 30_000_000_000n;
  const vTok = 1_073_000_000_000_000n;

  it("market cap = supply × vSol / vTok", () => {
    const mc = curveMarketCapLamports(DEFAULT_TOKEN_TOTAL_SUPPLY, vSol, vTok);
    // 1e9 tokens × 30 / 1.073e9 ≈ 27.96 SOL
    expect(Number(mc) / 1e9).toBeCloseTo(27.958993, 5);
  });

  it("matches the SDK's bondingCurveMarketCap", async () => {
    const { pumpSdk } = await import("@/lib/pump/load");
    const BN = (await import("bn.js")).default;
    const sdkMc = pumpSdk().bondingCurveMarketCap({
      mintSupply: new BN(DEFAULT_TOKEN_TOTAL_SUPPLY.toString()),
      virtualQuoteReserves: new BN(vSol.toString()),
      virtualTokenReserves: new BN(vTok.toString()),
    });
    expect(sdkMc.toString()).toBe(curveMarketCapLamports(DEFAULT_TOKEN_TOTAL_SUPPLY, vSol, vTok).toString());
  });

  it("refuses zero token reserves", () => {
    expect(() => curveMarketCapLamports(1n, 1n, 0n)).toThrow();
    expect(() => poolMarketCapLamports(1n, 1n, 0n)).toThrow();
  });

  it("pool market cap from reserves", () => {
    // 85 SOL against 206.9M tokens in the pool → price × 1B supply.
    const mc = poolMarketCapLamports(DEFAULT_TOKEN_TOTAL_SUPPLY, 85_000_000_000n, 206_900_000_000_000n);
    expect(Number(mc) / 1e9).toBeCloseTo(410.826, 2);
  });

  it("progress from real token reserves", () => {
    expect(curveProgressBps(DEFAULT_INITIAL_REAL_TOKEN_RESERVES, DEFAULT_INITIAL_REAL_TOKEN_RESERVES)).toBe(0);
    expect(curveProgressBps(DEFAULT_INITIAL_REAL_TOKEN_RESERVES / 2n, DEFAULT_INITIAL_REAL_TOKEN_RESERVES)).toBe(5000);
    expect(curveProgressBps(0n, DEFAULT_INITIAL_REAL_TOKEN_RESERVES)).toBe(10_000);
    expect(curveProgressBps(123n, DEFAULT_INITIAL_REAL_TOKEN_RESERVES, true)).toBe(10_000);
    expect(curveProgressBps(5n, 0n)).toBe(0);
  });

  it("price per token", () => {
    expect(curvePriceSol(vSol, vTok)).toBeCloseTo(2.7959e-8, 11);
  });

  it("SOL ↔ lamports without float artefacts", () => {
    expect(solToLamports(0.1)).toBe(100_000_000n);
    expect(solToLamports(1.000000001)).toBe(1_000_000_001n);
    expect(solToLamports(0)).toBe(0n);
    expect(() => solToLamports(-1)).toThrow();
    expect(formatSol(1_500_000_000n)).toBe("1.50 SOL");
  });
});

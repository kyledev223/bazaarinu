// Pure maths on pump.fun bonding-curve and PumpSwap pool numbers. Everything is
// bigint in base units (lamports, token base units) so nothing loses precision.

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const PUMP_TOKEN_DECIMALS = 6;
// pump.fun's standard curve parameters. The live values come from the Global
// account when available; these are the fallbacks.
export const DEFAULT_TOKEN_TOTAL_SUPPLY = 1_000_000_000_000_000n; // 1B tokens × 10^6
export const DEFAULT_INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;

/** Market cap in lamports = supply × virtualSolReserves / virtualTokenReserves. */
export function curveMarketCapLamports(supply: bigint, virtualSolReserves: bigint, virtualTokenReserves: bigint): bigint {
  if (virtualTokenReserves <= 0n) throw new Error("virtualTokenReserves must be positive");
  return (supply * virtualSolReserves) / virtualTokenReserves;
}

/** Graduated coins: market cap from the PumpSwap pool reserves. */
export function poolMarketCapLamports(supply: bigint, quoteReserve: bigint, baseReserve: bigint): bigint {
  if (baseReserve <= 0n) throw new Error("baseReserve must be positive");
  return (supply * quoteReserve) / baseReserve;
}

/** Share of the sellable supply already bought off the curve, in basis points (0..10000). */
export function curveProgressBps(realTokenReserves: bigint, initialRealTokenReserves: bigint, complete = false): number {
  if (complete) return 10_000;
  if (initialRealTokenReserves <= 0n) return 0;
  if (realTokenReserves >= initialRealTokenReserves) return 0;
  if (realTokenReserves <= 0n) return 10_000;
  const sold = initialRealTokenReserves - realTokenReserves;
  return Number((sold * 10_000n) / initialRealTokenReserves);
}

/** Price of one whole token in SOL, from virtual reserves. */
export function curvePriceSol(virtualSolReserves: bigint, virtualTokenReserves: bigint): number {
  if (virtualTokenReserves <= 0n) return 0;
  return (Number(virtualSolReserves) / 1e9) / (Number(virtualTokenReserves) / 10 ** PUMP_TOKEN_DECIMALS);
}

export function lamportsToSol(l: bigint | number): number {
  return Number(l) / 1e9;
}

export function solToLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol < 0) throw new Error("Invalid SOL amount");
  // Round to whole lamports via a string to avoid float artefacts like 0.1 * 1e9 = 100000000.00000001.
  const [whole, frac = ""] = sol.toFixed(9).split(".");
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

export function formatSol(lamports: bigint | number | null | undefined, digits = 3): string {
  if (lamports === null || lamports === undefined) return "—";
  const sol = lamportsToSol(lamports);
  if (sol !== 0 && Math.abs(sol) < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)} SOL`;
  return `${sol.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits })} SOL`;
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
}

export function formatTokens(baseUnits: bigint | number, decimals = PUMP_TOKEN_DECIMALS): string {
  const n = Number(baseUnits) / 10 ** decimals;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

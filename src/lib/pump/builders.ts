// Instruction builders, all through the installed @pump-fun SDKs.
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { AppError } from "@/lib/errors";
import { pumpSdk, pumpSwapSdk } from "@/lib/pump/load";
import { withRpc } from "@/lib/solana/rpc";

const bn = (n: bigint) => new BN(n.toString());

function sdkError(e: unknown, what: string): AppError {
  if (e instanceof AppError) return e;
  return new AppError("pump-sdk-error", { detail: `${what}: ${e instanceof Error ? e.message : String(e)}`, cause: e });
}

/** create_v2 only, or create_v2 + Token-2022 ATA + legacy buy when there is a dev buy. */
export async function launchInstructions(o: {
  user: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  devBuyLamports: bigint;
}): Promise<TransactionInstruction[]> {
  const sdk = pumpSdk();
  if (o.devBuyLamports === 0n) {
    try {
      return [await sdk.PUMP_SDK.createV2Instruction({ mint: o.mint, name: o.name, symbol: o.symbol, uri: o.uri, creator: o.user, user: o.user, mayhemMode: false })];
    } catch (e) {
      throw sdkError(e, "createV2Instruction");
    }
  }
  const { global, feeConfig } = await withRpc("pump:global", async (conn) => {
    const online = new sdk.OnlinePumpSdk(conn);
    const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
    return { global, feeConfig };
  });
  try {
    const amount = sdk.getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: null,
      bondingCurve: null,
      amount: bn(o.devBuyLamports),
      quoteMint: NATIVE_MINT,
    });
    // The legacy 16-account buy keeps create + buy inside one legacy transaction (buy_v2 has 27 accounts and doesn't fit).
    return await sdk.PUMP_SDK.createV2AndBuyInstructions({
      global,
      mint: o.mint,
      name: o.name,
      symbol: o.symbol,
      uri: o.uri,
      creator: o.user,
      user: o.user,
      amount,
      solAmount: bn(o.devBuyLamports),
      mayhemMode: false,
    });
  } catch (e) {
    throw sdkError(e, "createV2AndBuyInstructions");
  }
}

export interface CurveState {
  exists: boolean;
  complete: boolean;
  migrated: boolean;
  creator: PublicKey | null;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  creatorFeeBucket: bigint;
  quoteMint: PublicKey;
}

export async function readCurve(conn: Connection, mint: PublicKey): Promise<CurveState> {
  const sdk = pumpSdk();
  const info = await conn.getAccountInfo(sdk.bondingCurvePda(mint), "confirmed");
  if (!info)
    return { exists: false, complete: false, migrated: false, creator: null, virtualSolReserves: 0n, virtualTokenReserves: 0n, realTokenReserves: 0n, tokenTotalSupply: 0n, creatorFeeBucket: 0n, quoteMint: NATIVE_MINT };
  const c = sdk.PUMP_SDK.decodeBondingCurve(info);
  const q = new PublicKey(c.quoteMint.toBase58());
  return {
    exists: true,
    complete: c.complete,
    migrated: sdk.isBondingCurveMigrated(c),
    creator: new PublicKey(c.creator.toBase58()),
    virtualSolReserves: BigInt(c.virtualQuoteReserves.toString()),
    virtualTokenReserves: BigInt(c.virtualTokenReserves.toString()),
    realTokenReserves: BigInt(c.realTokenReserves.toString()),
    tokenTotalSupply: BigInt(c.tokenTotalSupply.toString()),
    creatorFeeBucket: BigInt((c.creatorFee ?? new BN(0)).toString()),
    quoteMint: q.equals(PublicKey.default) ? NATIVE_MINT : q,
  };
}

export function canonicalPool(mint: PublicKey): PublicKey {
  return new PublicKey(pumpSdk().canonicalPumpPoolPda(mint).toBase58());
}

/** Buy `lamports` worth of the coin: buy_v2 on the curve, or a PumpSwap buy once graduated. */
export async function buybackInstructions(user: PublicKey, mint: PublicKey, lamports: bigint): Promise<{ ixs: TransactionInstruction[]; venue: "curve" | "pool"; pool?: PublicKey }> {
  const sdk = pumpSdk();
  return withRpc("pump:buyback", async (conn) => {
    const online = new sdk.OnlinePumpSdk(conn);
    const state = await online.fetchBuyState(mint, user, TOKEN_2022_PROGRAM_ID).catch(() => null);
    const curve = state?.bondingCurve;
    if (curve && !curve.complete) {
      const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
      try {
        const amount = sdk.getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply: curve.tokenTotalSupply,
          bondingCurve: curve,
          amount: bn(lamports),
          quoteMint: NATIVE_MINT,
        });
        const ixs = await sdk.PUMP_SDK.buyV2Instructions({
          global,
          bondingCurveAccountInfo: state.bondingCurveAccountInfo,
          bondingCurve: curve,
          associatedUserAccountInfo: state.associatedUserAccountInfo,
          mint,
          user,
          amount,
          quoteAmount: bn(lamports),
          slippage: 1,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
        });
        return { ixs, venue: "curve" as const };
      } catch (e) {
        throw sdkError(e, "buyV2Instructions");
      }
    }
    // Graduated: trade on the canonical PumpSwap pool.
    const swap = pumpSwapSdk();
    const pool = canonicalPool(mint);
    try {
      const amm = new swap.OnlinePumpAmmSdk(conn);
      const swapState = await amm.swapSolanaState(pool, user);
      const ixs = await swap.PUMP_AMM_SDK.buyQuoteInput(swapState, bn(lamports), 1);
      return { ixs, venue: "pool" as const, pool };
    } catch (e) {
      throw sdkError(e, "PumpSwap buyQuoteInput");
    }
  });
}

export interface Claimable {
  vaultLamports: bigint; // already in the creator vaults (pump + PumpSwap)
  bucketLamports: bigint; // still on curves, needs a sweep first
  sweepMints: PublicKey[];
}

export async function readClaimable(creator: PublicKey, mints: PublicKey[]): Promise<Claimable> {
  const sdk = pumpSdk();
  return withRpc("pump:claimable", async (conn) => {
    const online = new sdk.OnlinePumpSdk(conn);
    const vault = BigInt((await online.getCreatorVaultBalanceBothPrograms(creator)).toString());
    let bucket = 0n;
    const sweepMints: PublicKey[] = [];
    // Curves hold fees from v3 trades until a sweep moves them into the vault.
    const pdas = mints.map((m) => sdk.bondingCurvePda(m));
    for (let i = 0; i < pdas.length; i += 100) {
      const infos = await conn.getMultipleAccountsInfo(pdas.slice(i, i + 100), "confirmed");
      infos.forEach((info, j) => {
        if (!info) return;
        const c = sdk.PUMP_SDK.decodeBondingCurve(info);
        const fee = BigInt((c.creatorFee ?? new BN(0)).toString());
        if (fee > 0n && c.creator.equals(creator) && !sdk.isBondingCurveMigrated(c)) {
          bucket += fee;
          sweepMints.push(mints[i + j]);
        }
      });
    }
    return { vaultLamports: vault, bucketLamports: bucket, sweepMints };
  });
}

export async function claimInstructions(creator: PublicKey, sweepMints: PublicKey[]): Promise<TransactionInstruction[]> {
  const sdk = pumpSdk();
  return withRpc("pump:claim", async (conn) => {
    const online = new sdk.OnlinePumpSdk(conn);
    try {
      const sweeps: TransactionInstruction[] = [];
      for (const mint of sweepMints.slice(0, 6)) {
        sweeps.push(await sdk.PUMP_SDK.sweepCreatorFeeInstruction({ payer: creator, mint, creator, quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }));
      }
      return [...sweeps, ...(await online.collectCoinCreatorFeeInstructions(creator, creator))];
    } catch (e) {
      throw sdkError(e, "collectCoinCreatorFeeInstructions");
    }
  });
}

export function ammVaultAuthority(creator: PublicKey): PublicKey {
  return new PublicKey(pumpSwapSdk().coinCreatorVaultAuthorityPda(creator).toBase58());
}

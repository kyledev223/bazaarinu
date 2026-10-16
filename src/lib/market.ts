// Live market data for coins launched here: curve/pool stats, recent trades
// (decoded from pump's on-chain events) and holder counts. Run from the tick.
import bs58 from "bs58";
import { PublicKey, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { db } from "@/lib/db";
import { pumpSdk, pumpSwapSdk } from "@/lib/pump/load";
import { programs, startsWith } from "@/lib/pump/decode";
import { canonicalPool } from "@/lib/pump/builders";
import { withRpc } from "@/lib/solana/rpc";
import {
  DEFAULT_INITIAL_REAL_TOKEN_RESERVES,
  DEFAULT_TOKEN_TOTAL_SUPPLY,
  curveMarketCapLamports,
  curveProgressBps,
  poolMarketCapLamports,
} from "@/lib/solana/curve";

// Anchor's emit_cpi! prefix: sha256("anchor:event")[0..8].
const EVENT_IX_TAG = Uint8Array.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

type IdlWithEvents = { events?: { name: string; discriminator: number[] }[] };
function eventDisc(idl: IdlWithEvents, name: string): Uint8Array {
  const e = idl.events?.find((x) => x.name === name);
  if (!e) throw new Error(`event ${name} missing from IDL`);
  return Uint8Array.from(e.discriminator);
}

const tokenAmount = (data: Buffer | null | undefined) => (data && data.length >= 72 ? data.readBigUInt64LE(64) : 0n);

let initialReal: bigint | null = null;
async function initialRealTokenReserves(conn: Connection): Promise<bigint> {
  if (initialReal) return initialReal;
  try {
    const g = await new (pumpSdk().OnlinePumpSdk)(conn).fetchGlobal();
    initialReal = BigInt(g.initialRealTokenReserves.toString());
  } catch {
    initialReal = DEFAULT_INITIAL_REAL_TOKEN_RESERVES;
  }
  return initialReal;
}

/** Refresh curve / pool stats for up to `limit` coins, least recently updated first. */
export async function refreshCoinStats(limit = 100): Promise<number> {
  const coins = await db().coin.findMany({ orderBy: { statsUpdatedAt: { sort: "asc", nulls: "first" } }, take: limit });
  if (!coins.length) return 0;
  const sdk = pumpSdk();
  const swap = pumpSwapSdk();

  await withRpc("market:stats", async (conn) => {
    const initial = await initialRealTokenReserves(conn);
    const pdas = coins.map((c) => sdk.bondingCurvePda(new PublicKey(c.mint)));
    const infos = await conn.getMultipleAccountsInfo(pdas, "confirmed");

    const graduated: { i: number; pool: PublicKey }[] = [];
    const updates = coins.map((coin, i) => {
      const info = infos[i];
      if (!info) return null;
      const c = sdk.PUMP_SDK.decodeBondingCurve(info);
      const migrated = sdk.isBondingCurveMigrated(c);
      const supply = BigInt(c.tokenTotalSupply.toString()) || DEFAULT_TOKEN_TOTAL_SUPPLY;
      const vSol = BigInt(c.virtualQuoteReserves.toString());
      const vTok = BigInt(c.virtualTokenReserves.toString());
      if (c.complete || migrated) graduated.push({ i, pool: canonicalPool(new PublicKey(coin.mint)) });
      return {
        virtualSolReserves: vSol,
        virtualTokenReserves: vTok,
        realTokenReserves: BigInt(c.realTokenReserves.toString()),
        tokenTotalSupply: supply,
        complete: c.complete,
        progressBps: curveProgressBps(BigInt(c.realTokenReserves.toString()), initial, c.complete),
        marketCapLamports: vTok > 0n ? curveMarketCapLamports(supply, vSol, vTok) : null,
      };
    });

    // Graduated coins trade on PumpSwap; read the pool's token vaults for price.
    const poolData = new Map<number, { pool: string; base: bigint; quote: bigint }>();
    if (graduated.length) {
      const poolInfos = await conn.getMultipleAccountsInfo(graduated.map((g) => g.pool), "confirmed");
      const vaults: PublicKey[] = [];
      const decoded: { i: number; pool: PublicKey; base: PublicKey; quote: PublicKey }[] = [];
      poolInfos.forEach((pi, j) => {
        if (!pi) return;
        const p = swap.PUMP_AMM_SDK.decodePool(pi);
        const base = new PublicKey(p.poolBaseTokenAccount.toBase58());
        const quote = new PublicKey(p.poolQuoteTokenAccount.toBase58());
        decoded.push({ i: graduated[j].i, pool: graduated[j].pool, base, quote });
        vaults.push(base, quote);
      });
      const vInfos = vaults.length ? await conn.getMultipleAccountsInfo(vaults, "confirmed") : [];
      decoded.forEach((d, j) => {
        poolData.set(d.i, { pool: d.pool.toBase58(), base: tokenAmount(vInfos[2 * j]?.data), quote: tokenAmount(vInfos[2 * j + 1]?.data) });
      });
    }

    await Promise.all(
      coins.map((coin, i) => {
        const u = updates[i];
        const p = poolData.get(i);
        const data: Record<string, unknown> = { statsUpdatedAt: new Date() };
        if (u) Object.assign(data, u);
        if (p && p.base > 0n) {
          data.graduated = true;
          data.poolAddress = p.pool;
          data.poolBaseReserve = p.base;
          data.poolQuoteReserve = p.quote;
          data.marketCapLamports = poolMarketCapLamports((u?.tokenTotalSupply as bigint) || DEFAULT_TOKEN_TOTAL_SUPPLY, p.quote, p.base);
          data.progressBps = 10_000;
        }
        return db().coin.update({ where: { mint: coin.mint }, data });
      }),
    );
  });
  return coins.length;
}

interface ParsedTrade {
  mint: string;
  signature: string;
  isBuy: boolean;
  solLamports: bigint;
  tokenAmount: bigint;
  trader: string;
  venue: "curve" | "pool";
  blockTime: Date;
}

/** Decode pump / PumpSwap trade events from a transaction's self-CPI event instructions. */
/** `mint` filters curve trades to one coin; PumpSwap events don't carry the mint, so pass `poolMint` for those. */
export function tradesFromTransaction(tx: VersionedTransactionResponse, mint?: string): ParsedTrade[] {
  const P = programs();
  const sdk = pumpSdk();
  const trade = eventDisc(sdk.pumpIdl as IdlWithEvents, "TradeEvent");
  const ammIdl = pumpSwapSdk().pumpAmmJson as IdlWithEvents;
  const buy = eventDisc(ammIdl, "BuyEvent");
  const sell = eventDisc(ammIdl, "SellEvent");

  if (!tx.meta || tx.meta.err) return [];
  const keys = [
    ...tx.transaction.message.staticAccountKeys.map((k) => k.toBase58()),
    ...(tx.meta.loadedAddresses?.writable ?? []).map((k) => k.toBase58()),
    ...(tx.meta.loadedAddresses?.readonly ?? []).map((k) => k.toBase58()),
  ];
  const signature = tx.transaction.signatures[0];
  const blockTime = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);
  const out: ParsedTrade[] = [];
  const pump = P.pump.toBase58();
  const amm = P.amm.toBase58();

  for (const inner of tx.meta.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      const pid = keys[ix.programIdIndex];
      if (pid !== pump && pid !== amm) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      if (!startsWith(data, EVENT_IX_TAG)) continue;
      const body = data.subarray(16);
      const disc = data.subarray(8, 16);
      try {
        if (pid === pump && startsWith(disc, trade)) {
          const e = sdk.PUMP_SDK.decodeTradeEventBc(body);
          if (mint && e.mint.toBase58() !== mint) continue;
          out.push({ mint: e.mint.toBase58(), signature, isBuy: e.isBuy, solLamports: BigInt(e.solAmount.toString()), tokenAmount: BigInt(e.tokenAmount.toString()), trader: e.user.toBase58(), venue: "curve", blockTime });
        } else if (pid === amm && startsWith(disc, buy)) {
          const e = sdk.PUMP_SDK.decodeBuyEventAmm(body);
          if (!mint) continue;
          out.push({ mint, signature, isBuy: true, solLamports: BigInt(e.quoteAmountIn.toString()), tokenAmount: BigInt(e.baseAmountOut.toString()), trader: e.user.toBase58(), venue: "pool", blockTime });
        } else if (pid === amm && startsWith(disc, sell)) {
          const e = sdk.PUMP_SDK.decodeSellEventAmm(body);
          if (!mint) continue;
          out.push({ mint, signature, isBuy: false, solLamports: BigInt(e.quoteAmountOut.toString()), tokenAmount: BigInt(e.baseAmountIn.toString()), trader: e.user.toBase58(), venue: "pool", blockTime });
        }
      } catch {
        /* an event layout we don't know; skip it */
      }
    }
  }
  return out;
}

/** Pull new trades for the coins whose trades are stalest. Bounded per tick to stay inside RPC limits. */
export async function refreshTrades(coinLimit = 5, perCoin = 20): Promise<number> {
  const coins = await db().coin.findMany({ orderBy: { tradesUpdatedAt: { sort: "asc", nulls: "first" } }, take: coinLimit });
  let added = 0;
  for (const coin of coins) {
    const address = coin.graduated && coin.poolAddress ? new PublicKey(coin.poolAddress) : pumpSdk().bondingCurvePda(new PublicKey(coin.mint));
    const sigs = await withRpc("market:sigs", (c) =>
      c.getSignaturesForAddress(address, { limit: perCoin, ...(coin.tradesCursor ? { until: coin.tradesCursor } : {}) }, "confirmed"),
    );
    const fresh = sigs.filter((s) => !s.err).map((s) => s.signature);
    const parsed: ParsedTrade[] = [];
    for (const sig of fresh) {
      const tx = await withRpc("market:tx", (c) => c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }));
      if (tx) parsed.push(...tradesFromTransaction(tx, coin.mint));
    }
    if (parsed.length) {
      const r = await db().trade.createMany({ data: parsed.map((t) => ({ ...t, mint: coin.mint })), skipDuplicates: true });
      added += r.count;
    }
    await db().coin.update({
      where: { mint: coin.mint },
      data: { tradesUpdatedAt: new Date(), ...(sigs[0] ? { tradesCursor: sigs[0].signature } : {}) },
    });
  }
  return added;
}

/** Holder count via getProgramAccounts. Many RPCs refuse this on the token program, so failures leave it null. */
export async function refreshHolders(coinLimit = 3): Promise<number> {
  const stale = new Date(Date.now() - 15 * 60_000);
  const coins = await db().coin.findMany({
    where: { OR: [{ holdersUpdatedAt: null }, { holdersUpdatedAt: { lt: stale } }] },
    orderBy: { holdersUpdatedAt: { sort: "asc", nulls: "first" } },
    take: coinLimit,
  });
  for (const coin of coins) {
    let holders: number | null = null;
    try {
      const accounts = await withRpc("market:holders", (c) =>
        c.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
          commitment: "confirmed",
          filters: [{ memcmp: { offset: 0, bytes: coin.mint } }],
          dataSlice: { offset: 64, length: 8 },
        }),
      );
      holders = accounts.filter((a) => a.account.data.length === 8 && a.account.data.readBigUInt64LE(0) > 0n).length;
    } catch {
      holders = null;
    }
    await db().coin.update({ where: { mint: coin.mint }, data: { holders, holdersUpdatedAt: new Date() } });
  }
  return coins.length;
}

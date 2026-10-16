// Relay checkers: the last gate before the server forwards a user-signed
// transaction to Solana. Each one accepts only the exact shape of transaction
// the matching /build route produced (fee payer, programs, accounts and
// amounts) and rejects everything else. They are pure and unit-tested in
// tests/checkers.test.ts.
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { decodeAmmBuy, decodeBuy, decodeBuyV2, decodeCreateV2, programs, startsWith } from "@/lib/pump/decode";

export type CheckResult = { ok: true } | { ok: false; reason: string };

// Lighthouse only asserts account state and can only make a transaction fail.
// Some wallets append its instructions while signing, so it's tolerated.
export const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

export const MAX_COMPUTE_UNITS = 1_400_000;
// Wallets may raise the priority fee; anything over this total is refused.
export const MAX_PRIORITY_FEE_LAMPORTS = 10_000_000n; // 0.01 SOL
/** Builders quote with 1% slippage; the checkers allow 2% plus a lamport of rounding. */
export const SLIPPAGE_CAP_BPS = 200n;

export function withSlippageCap(lamports: bigint): bigint {
  return lamports + (lamports * SLIPPAGE_CAP_BPS) / 10_000n + 1n;
}

class Reject extends Error {}
const reject = (reason: string): never => {
  throw new Reject(reason);
};
const eq = (a: PublicKey | undefined, b: PublicKey) => !!a && a.equals(b);
const short = (k: PublicKey) => k.toBase58().slice(0, 6);

function account(ix: TransactionInstruction, i: number): PublicKey {
  const meta = ix.keys[i];
  if (!meta) reject(`instruction to ${short(ix.programId)} is missing account #${i}`);
  return meta.pubkey;
}

/** Common checks: fee payer, the exact signer set, and every signature valid. */
function checkEnvelope(tx: Transaction, feePayer: PublicKey, signers: PublicKey[]) {
  if (!tx.feePayer || !tx.feePayer.equals(feePayer)) reject("fee payer is not the signed-in wallet");
  const msg = tx.compileMessage();
  const required = msg.accountKeys.slice(0, msg.header.numRequiredSignatures);
  const want = new Set(signers.map((s) => s.toBase58()));
  if (required.length !== want.size || !required.every((k) => want.has(k.toBase58())))
    reject(`unexpected signer set (${required.map(short).join(", ")})`);
  if (tx.signatures.length !== want.size || tx.signatures.some((s) => !s.signature)) reject("missing signatures");
  if (!tx.verifySignatures(true)) reject("a signature is invalid");
}

/** ComputeBudget: only unit limit and unit price, within caps. */
function checkComputeBudget(ixs: TransactionInstruction[]) {
  let units = 200_000n;
  let price = 0n;
  let seenLimit = false;
  let seenPrice = false;
  for (const ix of ixs) {
    const d = ix.data;
    if (d[0] === 2 && d.length === 5) {
      if (seenLimit) reject("duplicate compute unit limit");
      seenLimit = true;
      units = BigInt(d.readUInt32LE(1));
      if (units > BigInt(MAX_COMPUTE_UNITS)) reject("compute unit limit too high");
    } else if (d[0] === 3 && d.length === 9) {
      if (seenPrice) reject("duplicate compute unit price");
      seenPrice = true;
      price = d.readBigUInt64LE(1);
    } else reject("unsupported compute budget instruction");
  }
  if ((units * price) / 1_000_000n > MAX_PRIORITY_FEE_LAMPORTS) reject("priority fee is above the allowed cap");
}

function checkAtaCreate(ix: TransactionInstruction, feePayer: PublicKey, allowed: { owner: PublicKey; mint: PublicKey; tokenProgram: PublicKey }[]) {
  // CreateIdempotent = 1. Plain Create (empty data / 0) is refused so a retry can't fail on "already exists".
  if (ix.data.length !== 1 || ix.data[0] !== 1) reject("only idempotent token-account creation is allowed");
  const [payer, ata, owner, mint, , tokenProgram] = [0, 1, 2, 3, 4, 5].map((i) => account(ix, i));
  if (!payer.equals(feePayer)) reject("token account is paid by someone else");
  const match = allowed.find((a) => a.owner.equals(owner) && a.mint.equals(mint) && a.tokenProgram.equals(tokenProgram));
  if (!match) reject("unexpected token account creation");
  if (!getAssociatedTokenAddressSync(mint, owner, true, tokenProgram).equals(ata)) reject("token account address doesn't match");
}

function run(fn: () => void): CheckResult {
  try {
    fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    return { ok: false, reason: `couldn't decode the transaction (${e instanceof Error ? e.message : "unknown"})` };
  }
}

// ---------------------------------------------------------------- launch

export interface LaunchExpectation {
  feePayer: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  devBuyLamports: bigint; // 0n = no dev buy
}

/**
 * ComputeBudget, exactly one pump create_v2 for this mint/name/symbol/URI with
 * the wallet as creator, and, only with a dev buy, the wallet's Token-2022
 * account for the mint plus one buy of this mint capped at the dev-buy amount.
 */
export function checkLaunchTransaction(tx: Transaction, exp: LaunchExpectation): CheckResult {
  return run(() => {
    const P = programs();
    checkEnvelope(tx, exp.feePayer, [exp.feePayer, exp.mint]);
    const budget: TransactionInstruction[] = [];
    let creates = 0;
    let buys = 0;
    let atas = 0;

    for (const ix of tx.instructions) {
      if (ix.programId.equals(ComputeBudgetProgram.programId)) {
        budget.push(ix);
      } else if (ix.programId.equals(LIGHTHOUSE_PROGRAM_ID)) {
        continue;
      } else if (ix.programId.equals(P.pump) && startsWith(ix.data, P.disc.createV2)) {
        if (++creates > 1) reject("more than one create instruction");
        if (!eq(account(ix, 0), exp.mint)) reject("create instruction is for a different mint");
        if (!eq(account(ix, 5), exp.feePayer)) reject("create instruction user is not the wallet");
        const a = decodeCreateV2(ix.data);
        if (a.name !== exp.name) reject("coin name doesn't match the prepared launch");
        if (a.symbol !== exp.symbol) reject("ticker doesn't match the prepared launch");
        if (a.uri !== exp.uri) reject("metadata URI doesn't match the prepared launch");
        if (!a.creator.equals(exp.feePayer)) reject("creator is not the wallet");
        if (a.mayhem || a.cashback || a.holderReward || a.creatorFeeBps !== 0n) reject("unexpected create options");
      } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        if (exp.devBuyLamports === 0n) reject("token account creation without a dev buy");
        if (++atas > 1) reject("more than one token account creation");
        checkAtaCreate(ix, exp.feePayer, [{ owner: exp.feePayer, mint: exp.mint, tokenProgram: TOKEN_2022_PROGRAM_ID }]);
      } else if (ix.programId.equals(P.pump) && startsWith(ix.data, P.disc.buy)) {
        // The legacy 16-account buy: create_v2 + buy_v2 (27 accounts) is too large for one transaction.
        if (exp.devBuyLamports === 0n) reject("a buy was added but no dev buy was requested");
        if (creates === 0) reject("buy comes before the create");
        if (++buys > 1) reject("more than one buy");
        if (!eq(account(ix, 2), exp.mint)) reject("dev buy is for a different mint");
        if (!eq(account(ix, 6), exp.feePayer)) reject("dev buy user is not the wallet");
        if (decodeBuy(ix.data).maxSolCost > withSlippageCap(exp.devBuyLamports)) reject("dev buy spends more than requested");
      } else {
        reject(`unexpected instruction for program ${ix.programId.toBase58()}`);
      }
    }
    if (creates !== 1) reject("the create instruction is missing");
    if (exp.devBuyLamports > 0n && buys !== 1) reject("the requested dev buy is missing");
    checkComputeBudget(budget);
  });
}

// ---------------------------------------------------------------- buyback

export interface BuybackExpectation {
  feePayer: PublicKey;
  mint: PublicKey;
  maxLamports: bigint;
  venue: "curve" | "pool";
  pool?: PublicKey; // canonical PumpSwap pool, required for venue "pool"
  baseTokenProgram?: PublicKey; // defaults to Token-2022 (create_v2 coins)
}

/**
 * Bonding curve: ComputeBudget, optional Token-2022 account for the mint, one buy_v2 of this mint.
 * PumpSwap: plus wrapping SOL into the wallet's own WSOL account (create, transfer, sync), one pump-amm
 * buy on the canonical pool for this mint, and closing the WSOL account back to the wallet.
 */
export function checkBuybackTransaction(tx: Transaction, exp: BuybackExpectation): CheckResult {
  return run(() => {
    const P = programs();
    checkEnvelope(tx, exp.feePayer, [exp.feePayer]);
    const cap = withSlippageCap(exp.maxLamports);
    const baseProgram = exp.baseTokenProgram ?? TOKEN_2022_PROGRAM_ID;
    const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, exp.feePayer, true, TOKEN_PROGRAM_ID);
    const budget: TransactionInstruction[] = [];
    let buys = 0;
    let wrapped = 0n;

    for (const ix of tx.instructions) {
      const pid = ix.programId;
      if (pid.equals(ComputeBudgetProgram.programId)) budget.push(ix);
      else if (pid.equals(LIGHTHOUSE_PROGRAM_ID)) continue;
      else if (pid.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        const allowed = [{ owner: exp.feePayer, mint: exp.mint, tokenProgram: baseProgram }];
        if (exp.venue === "pool") allowed.push({ owner: exp.feePayer, mint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID });
        checkAtaCreate(ix, exp.feePayer, allowed);
      } else if (exp.venue === "curve" && pid.equals(P.pump) && startsWith(ix.data, P.disc.buyV2)) {
        if (++buys > 1) reject("more than one buy");
        if (!eq(account(ix, 1), exp.mint)) reject("buy is for a different mint");
        if (!eq(account(ix, 13), exp.feePayer)) reject("buyer is not the wallet");
        if (decodeBuyV2(ix.data).maxSolCost > cap) reject("buy spends more than requested");
      } else if (exp.venue === "pool" && pid.equals(SystemProgram.programId)) {
        // Transfer = 2: [u32 type][u64 lamports], from the wallet into its own WSOL account only.
        if (ix.data.length !== 12 || ix.data.readUInt32LE(0) !== 2) reject("only a plain SOL transfer is allowed");
        if (!eq(account(ix, 0), exp.feePayer) || !eq(account(ix, 1), wsol)) reject("SOL transfer goes somewhere other than your own wrapped-SOL account");
        wrapped += ix.data.readBigUInt64LE(4);
        if (wrapped > cap) reject("wraps more SOL than requested");
      } else if (exp.venue === "pool" && pid.equals(TOKEN_PROGRAM_ID)) {
        // SyncNative = 17 on the WSOL account; CloseAccount = 9 back to the wallet.
        if (ix.data.length === 1 && ix.data[0] === 17) {
          if (!eq(account(ix, 0), wsol)) reject("unexpected token sync");
        } else if (ix.data.length === 1 && ix.data[0] === 9) {
          if (!eq(account(ix, 0), wsol) || !eq(account(ix, 1), exp.feePayer) || !eq(account(ix, 2), exp.feePayer))
            reject("closing a token account to someone else");
        } else reject("unexpected token instruction");
      } else if (exp.venue === "pool" && pid.equals(P.amm) && startsWith(ix.data, P.disc.ammExtendAccount)) {
        if (!exp.pool || !eq(account(ix, 0), exp.pool) || !eq(account(ix, 1), exp.feePayer)) reject("unexpected pool account extension");
      } else if (exp.venue === "pool" && pid.equals(P.amm) && startsWith(ix.data, P.disc.ammBuy)) {
        if (++buys > 1) reject("more than one buy");
        if (!exp.pool || !eq(account(ix, 0), exp.pool)) reject("buy is on a different pool");
        if (!eq(account(ix, 1), exp.feePayer)) reject("buyer is not the wallet");
        if (!eq(account(ix, 3), exp.mint) || !eq(account(ix, 4), NATIVE_MINT)) reject("buy is for a different coin");
        if (decodeAmmBuy(ix.data).maxQuoteIn > cap) reject("buy spends more than requested");
      } else reject(`unexpected instruction for program ${pid.toBase58()}`);
    }
    if (buys !== 1) reject("the buy instruction is missing");
    checkComputeBudget(budget);
  });
}

// ---------------------------------------------------------------- creator fee claim

export interface ClaimExpectation {
  feePayer: PublicKey;
  /** Mints the wallet created through this site; sweeps are allowed only for these. */
  mints: PublicKey[];
  /** pump-amm's coin creator vault authority for the wallet, which may get a WSOL account created. */
  ammVaultAuthority: PublicKey;
}

/** Only fee collection: pump collect_creator_fee and sweeps for the wallet's coins, and the PumpSwap creator-fee collect. No transfers. */
export function checkClaimTransaction(tx: Transaction, exp: ClaimExpectation): CheckResult {
  return run(() => {
    const P = programs();
    checkEnvelope(tx, exp.feePayer, [exp.feePayer]);
    const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, exp.feePayer, true, TOKEN_PROGRAM_ID);
    const budget: TransactionInstruction[] = [];
    let collects = 0;

    for (const ix of tx.instructions) {
      const pid = ix.programId;
      if (pid.equals(ComputeBudgetProgram.programId)) budget.push(ix);
      else if (pid.equals(LIGHTHOUSE_PROGRAM_ID)) continue;
      else if (pid.equals(P.pump) && startsWith(ix.data, P.disc.collectCreatorFee)) {
        if (!eq(account(ix, 0), exp.feePayer)) reject("collecting fees for someone else");
        collects++;
      } else if (pid.equals(P.pump) && startsWith(ix.data, P.disc.sweepCreatorFee)) {
        if (!eq(account(ix, 0), exp.feePayer)) reject("sweep payer is not the wallet");
        if (!exp.mints.some((m) => m.equals(account(ix, 2)))) reject("sweep for a coin you didn't launch here");
      } else if (pid.equals(P.amm) && startsWith(ix.data, P.disc.ammCollectCoinCreatorFee)) {
        if (!eq(account(ix, 2), exp.feePayer)) reject("collecting pool fees for someone else");
        if (!eq(account(ix, 5), wsol)) reject("pool fees go to an unexpected account");
        collects++;
      } else if (pid.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        checkAtaCreate(ix, exp.feePayer, [
          { owner: exp.feePayer, mint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID },
          { owner: exp.ammVaultAuthority, mint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID },
        ]);
      } else if (pid.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 9) {
        if (!eq(account(ix, 0), wsol) || !eq(account(ix, 1), exp.feePayer) || !eq(account(ix, 2), exp.feePayer))
          reject("closing a token account to someone else");
      } else reject(`unexpected instruction for program ${pid.toBase58()}`);
    }
    if (collects === 0) reject("no fee collection in this transaction");
    checkComputeBudget(budget);
  });
}

import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { checkBuybackTransaction, checkClaimTransaction, checkLaunchTransaction } from "@/lib/pump/checkers";
import { programs } from "@/lib/pump/decode";
import { pumpSdk } from "@/lib/pump/load";
import { budget, createAndBuyIxs, createIx, fakeGlobal, roundTrip, tx } from "./helpers";

const NAME = "Bazaar Test";
const SYMBOL = "BZR";
const URI = "https://ipfs.io/ipfs/QmTest";

function setup() {
  const user = Keypair.generate();
  const mint = Keypair.generate();
  const exp = { feePayer: user.publicKey, mint: mint.publicKey, name: NAME, symbol: SYMBOL, uri: URI, devBuyLamports: 0n };
  return { user, mint, exp };
}

describe("checkLaunchTransaction", () => {
  it("accepts compute budget + one create_v2 signed by wallet then mint", async () => {
    const { user, mint, exp } = setup();
    const t = tx(user.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey })], [user, mint]);
    expect(checkLaunchTransaction(t, exp)).toEqual({ ok: true });
  });

  it("rejects a different fee payer", async () => {
    const { user, mint, exp } = setup();
    const other = Keypair.generate();
    const t = tx(other.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey })], [other, user, mint]);
    const r = checkLaunchTransaction(t, exp);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/fee payer/);
  });

  it("rejects an extra instruction (a SOL transfer to someone)", async () => {
    const { user, mint, exp } = setup();
    const drain = SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1_000_000 });
    const t = tx(user.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey }), drain], [user, mint]);
    const r = checkLaunchTransaction(t, exp);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/unexpected instruction/);
  });

  it("rejects two create instructions", async () => {
    const { user, mint, exp } = setup();
    const ix = await createIx({ mint: mint.publicKey, user: user.publicKey });
    const t = tx(user.publicKey, [...budget(), ix, ix], [user, mint]);
    expect(checkLaunchTransaction(t, exp).ok).toBe(false);
  });

  it("rejects a mismatched mint", async () => {
    const { user, mint, exp } = setup();
    const t = tx(user.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey })], [user, mint]);
    const r = checkLaunchTransaction(t, { ...exp, mint: Keypair.generate().publicKey });
    expect(r.ok).toBe(false);
  });

  it("rejects a mismatched URI, name or ticker", async () => {
    const { user, mint, exp } = setup();
    const t = tx(user.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey })], [user, mint]);
    const uri = checkLaunchTransaction(t, { ...exp, uri: "https://ipfs.io/ipfs/QmOther" });
    expect(!uri.ok && uri.reason).toMatch(/metadata URI/);
    const name = checkLaunchTransaction(t, { ...exp, name: "Other" });
    expect(!name.ok && name.reason).toMatch(/name/);
    const sym = checkLaunchTransaction(t, { ...exp, symbol: "OTHER" });
    expect(!sym.ok && sym.reason).toMatch(/ticker/);
  });

  it("rejects a missing mint signature", async () => {
    const { user, mint, exp } = setup();
    const t = tx(user.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey })], [user]);
    const r = checkLaunchTransaction(t, exp);
    expect(!r.ok && r.reason).toMatch(/missing signatures/);
  });

  it("rejects a tampered signature", async () => {
    const { user, mint, exp } = setup();
    const t = tx(user.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey })], [user, mint]);
    const sig = Buffer.from(t.signatures[0].signature!);
    sig[5] ^= 0xff;
    t.signatures[0].signature = sig;
    const r = checkLaunchTransaction(roundTrip(t), exp);
    expect(!r.ok && r.reason).toMatch(/signature is invalid/);
  });

  it("rejects a create where someone else is the creator", async () => {
    const { user, mint, exp } = setup();
    const ix = await pumpSdk().PUMP_SDK.createV2Instruction({
      mint: mint.publicKey, name: NAME, symbol: SYMBOL, uri: URI,
      creator: Keypair.generate().publicKey, user: user.publicKey, mayhemMode: false,
    });
    const t = tx(user.publicKey, [...budget(), ix], [user, mint]);
    expect(checkLaunchTransaction(t, exp)).toEqual({ ok: false, reason: "creator is not the wallet" });
  });

  it("rejects an excessive priority fee", async () => {
    const { user, mint, exp } = setup();
    const t = tx(user.publicKey, [...budget(1_000_000, 50_000_000), await createIx({ mint: mint.publicKey, user: user.publicKey })], [user, mint]);
    const r = checkLaunchTransaction(t, exp);
    expect(!r.ok && r.reason).toMatch(/priority fee/);
  });

  it("accepts a dev buy within the requested amount", async () => {
    const { user, mint, exp } = setup();
    const ixs = await createAndBuyIxs({ mint: mint.publicKey, user: user.publicKey, lamports: 100_000_000n });
    const t = tx(user.publicKey, [...budget(), ...ixs], [user, mint]);
    expect(checkLaunchTransaction(t, { ...exp, devBuyLamports: 100_000_000n })).toEqual({ ok: true });
  });

  it("rejects a dev buy above the requested amount, and a buy nobody asked for", async () => {
    const { user, mint, exp } = setup();
    const ixs = await createAndBuyIxs({ mint: mint.publicKey, user: user.publicKey, lamports: 500_000_000n });
    const t = tx(user.publicKey, [...budget(), ...ixs], [user, mint]);
    const over = checkLaunchTransaction(t, { ...exp, devBuyLamports: 100_000_000n });
    expect(!over.ok && over.reason).toMatch(/spends more/);
    const none = checkLaunchTransaction(t, exp);
    expect(none.ok).toBe(false);
  });

  it("rejects a missing dev buy when one was requested", async () => {
    const { user, mint, exp } = setup();
    const t = tx(user.publicKey, [...budget(), await createIx({ mint: mint.publicKey, user: user.publicKey })], [user, mint]);
    const r = checkLaunchTransaction(t, { ...exp, devBuyLamports: 100_000_000n });
    expect(!r.ok && r.reason).toMatch(/dev buy is missing/);
  });
});

describe("checkBuybackTransaction", () => {
  async function curveBuy(user: PublicKey, mint: PublicKey, lamports: bigint) {
    const bondingCurve = {
      creator: Keypair.generate().publicKey,
      quoteMint: PublicKey.default,
      isMayhemMode: false,
      isCashbackCoin: false,
    } as any;
    return pumpSdk().PUMP_SDK.buyV2Instructions({
      global: fakeGlobal(),
      bondingCurveAccountInfo: { data: Buffer.alloc(0) } as any,
      bondingCurve,
      associatedUserAccountInfo: null,
      mint,
      user,
      amount: new BN(1_000_000),
      quoteAmount: new BN(lamports.toString()),
      slippage: 1,
    });
  }

  it("accepts one buy_v2 of the coin within the amount", async () => {
    const user = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    const t = tx(user.publicKey, [...budget(), ...(await curveBuy(user.publicKey, mint, 50_000_000n))], [user]);
    expect(checkBuybackTransaction(t, { feePayer: user.publicKey, mint, maxLamports: 50_000_000n, venue: "curve" })).toEqual({ ok: true });
  });

  it("rejects a buy of another coin, or for more SOL", async () => {
    const user = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    const t = tx(user.publicKey, [...budget(), ...(await curveBuy(user.publicKey, mint, 50_000_000n))], [user]);
    expect(checkBuybackTransaction(t, { feePayer: user.publicKey, mint: Keypair.generate().publicKey, maxLamports: 50_000_000n, venue: "curve" }).ok).toBe(false);
    const r = checkBuybackTransaction(t, { feePayer: user.publicKey, mint, maxLamports: 10_000_000n, venue: "curve" });
    expect(!r.ok && r.reason).toMatch(/spends more/);
  });

  it("rejects a create instruction smuggled into a buyback", async () => {
    const user = Keypair.generate();
    const mint = Keypair.generate();
    const ixs = await createAndBuyIxs({ mint: mint.publicKey, user: user.publicKey, lamports: 1_000_000n });
    const t = tx(user.publicKey, [...budget(), ...ixs], [user, mint]);
    expect(checkBuybackTransaction(t, { feePayer: user.publicKey, mint: mint.publicKey, maxLamports: 1_000_000n, venue: "curve" }).ok).toBe(false);
  });

  function poolTx(user: Keypair, mint: PublicKey, pool: PublicKey, lamports: bigint, opts: { transferTo?: PublicKey } = {}) {
    const P = programs();
    const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, user.publicKey, true, TOKEN_PROGRAM_ID);
    const data = Buffer.alloc(8 + 8 + 8 + 1);
    Buffer.from(P.disc.ammBuy).copy(data, 0);
    data.writeBigUInt64LE(1_000n, 8);
    data.writeBigUInt64LE(lamports, 16);
    const keys = [pool, user.publicKey, PublicKey.default, mint, NATIVE_MINT, ...Array.from({ length: 18 }, () => Keypair.generate().publicKey)].map((pubkey, i) => ({
      pubkey, isSigner: i === 1, isWritable: i <= 1,
    }));
    return tx(user.publicKey, [
      ...budget(),
      createAssociatedTokenAccountIdempotentInstruction(user.publicKey, wsol, user.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID),
      SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: opts.transferTo ?? wsol, lamports }),
      createSyncNativeInstruction(wsol),
      new TransactionInstruction({ programId: P.amm, keys, data }),
      createCloseAccountInstruction(wsol, user.publicKey, user.publicKey, undefined, TOKEN_PROGRAM_ID),
    ], [user]);
  }

  it("accepts a PumpSwap buy that wraps SOL into the wallet's own account", () => {
    const user = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    const pool = Keypair.generate().publicKey;
    const t = poolTx(user, mint, pool, 20_000_000n);
    expect(checkBuybackTransaction(t, { feePayer: user.publicKey, mint, maxLamports: 20_000_000n, venue: "pool", pool })).toEqual({ ok: true });
  });

  it("rejects a PumpSwap buyback that sends SOL elsewhere or targets another pool", () => {
    const user = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    const pool = Keypair.generate().publicKey;
    const leak = poolTx(user, mint, pool, 20_000_000n, { transferTo: Keypair.generate().publicKey });
    expect(checkBuybackTransaction(leak, { feePayer: user.publicKey, mint, maxLamports: 20_000_000n, venue: "pool", pool }).ok).toBe(false);
    const ok = poolTx(user, mint, pool, 20_000_000n);
    expect(checkBuybackTransaction(ok, { feePayer: user.publicKey, mint, maxLamports: 20_000_000n, venue: "pool", pool: Keypair.generate().publicKey }).ok).toBe(false);
  });
});

describe("checkClaimTransaction", () => {
  function collectIx(creator: PublicKey) {
    const P = programs();
    return new TransactionInstruction({
      programId: P.pump,
      keys: [creator, Keypair.generate().publicKey, SystemProgram.programId, Keypair.generate().publicKey, P.pump].map((pubkey, i) => ({ pubkey, isSigner: false, isWritable: i < 2 })),
      data: Buffer.from(P.disc.collectCreatorFee),
    });
  }

  it("accepts a creator-fee collect for the wallet", () => {
    const user = Keypair.generate();
    const t = tx(user.publicKey, [...budget(), collectIx(user.publicKey)], [user]);
    expect(checkClaimTransaction(t, { feePayer: user.publicKey, mints: [], ammVaultAuthority: Keypair.generate().publicKey })).toEqual({ ok: true });
  });

  it("rejects collecting for someone else, or adding a transfer", () => {
    const user = Keypair.generate();
    const exp = { feePayer: user.publicKey, mints: [], ammVaultAuthority: Keypair.generate().publicKey };
    expect(checkClaimTransaction(tx(user.publicKey, [...budget(), collectIx(Keypair.generate().publicKey)], [user]), exp).ok).toBe(false);
    const drain = SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
    expect(checkClaimTransaction(tx(user.publicKey, [...budget(), collectIx(user.publicKey), drain], [user]), exp).ok).toBe(false);
  });

  it("rejects an unknown compute-budget instruction", () => {
    const user = Keypair.generate();
    const weird = new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data: Buffer.from([1, 0, 0, 0, 0]) });
    const t = tx(user.publicKey, [weird, collectIx(user.publicKey)], [user]);
    expect(checkClaimTransaction(t, { feePayer: user.publicKey, mints: [], ammVaultAuthority: Keypair.generate().publicKey }).ok).toBe(false);
  });
});

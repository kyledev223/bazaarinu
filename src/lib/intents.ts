// Creator actions that move SOL after launch: buy back your own coin, and claim
// pump.fun creator fees. Same pattern as launching: the server builds and
// simulates, the wallet signs, and the relay only forwards a transaction that
// passes this action's own checker.
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { LIMITS } from "@/config/site";
import { ammVaultAuthority, buybackInstructions, claimInstructions, readClaimable } from "@/lib/pump/builders";
import { buildAndSimulate, parseSignedTx } from "@/lib/pump/tx";
import { checkBuybackTransaction, checkClaimTransaction } from "@/lib/pump/checkers";
import { withRpc } from "@/lib/solana/rpc";
import { solToLamports } from "@/lib/solana/curve";
import { explainSendError } from "@/lib/launch/service";

const INTENT_TTL_MS = 3 * 60_000;

interface BuybackMeta {
  venue: "curve" | "pool";
  pool?: string;
}
interface ClaimMeta {
  mints: string[];
}

async function ownCoin(wallet: string, mint: string) {
  const coin = await db().coin.findUnique({ where: { mint } });
  if (!coin) throw new AppError("coin-not-found");
  if (coin.creator !== wallet) throw new AppError("not-creator");
  return coin;
}

export async function buildBuyback(wallet: string, mintStr: unknown, solAmount: unknown) {
  if (typeof mintStr !== "string") throw new AppError("bad-request", { message: "Missing coin." });
  const sol = Number(solAmount);
  if (!Number.isFinite(sol) || sol < LIMITS.buybackMinSol || sol > LIMITS.buybackMaxSol)
    throw new AppError("validation", { fields: { amount: `Choose between ${LIMITS.buybackMinSol} and ${LIMITS.buybackMaxSol} SOL.` } });
  await ownCoin(wallet, mintStr);
  const user = new PublicKey(wallet);
  const mint = new PublicKey(mintStr);
  const lamports = solToLamports(sol);

  const { ixs, venue, pool } = await buybackInstructions(user, mint, lamports);
  const built = await buildAndSimulate({
    label: "buyback",
    feePayer: user,
    instructions: ixs,
    initialUnits: venue === "pool" ? 300_000 : 250_000,
    spendLamports: lamports + lamports / 100n,
    fallbackRent: 2_100_000n,
  });
  const meta: BuybackMeta = { venue, ...(pool ? { pool: pool.toBase58() } : {}) };
  const intent = await db().txIntent.create({
    data: { kind: "buyback", wallet, mint: mintStr, maxLamports: lamports, meta: meta as object, expiresAt: new Date(Date.now() + INTENT_TTL_MS) },
  });
  return { intentId: intent.id, tx: built.base64, estimate: built.estimate, venue };
}

export async function claimableFor(wallet: string) {
  const coins = await db().coin.findMany({ where: { creator: wallet }, select: { mint: true } });
  const c = await readClaimable(new PublicKey(wallet), coins.map((x) => new PublicKey(x.mint)));
  return { vaultLamports: c.vaultLamports, bucketLamports: c.bucketLamports, totalLamports: c.vaultLamports + c.bucketLamports, sweepMints: c.sweepMints.map((m) => m.toBase58()) };
}

export async function buildClaim(wallet: string) {
  const user = new PublicKey(wallet);
  const coins = await db().coin.findMany({ where: { creator: wallet }, select: { mint: true } });
  const c = await readClaimable(user, coins.map((x) => new PublicKey(x.mint)));
  if (c.vaultLamports + c.bucketLamports === 0n) throw new AppError("nothing-to-claim");
  const ixs = await claimInstructions(user, c.sweepMints);
  const built = await buildAndSimulate({ label: "claim", feePayer: user, instructions: ixs, initialUnits: 200_000 + c.sweepMints.length * 60_000, spendLamports: 0n, fallbackRent: 0n });
  const meta: ClaimMeta = { mints: c.sweepMints.slice(0, 6).map((m) => m.toBase58()) };
  const intent = await db().txIntent.create({
    data: { kind: "claim", wallet, maxLamports: 0n, meta: meta as object, expiresAt: new Date(Date.now() + INTENT_TTL_MS) },
  });
  return { intentId: intent.id, tx: built.base64, estimate: built.estimate, claimableLamports: c.vaultLamports + c.bucketLamports };
}

export async function relayIntent(intentId: string, signedB64: unknown, wallet: string, kind: "buyback" | "claim") {
  const intent = await db().txIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.wallet !== wallet || intent.kind !== kind) throw new AppError("bad-request", { status: 404, message: "That request wasn't found. Start again." });
  if (intent.status !== "built") throw new AppError("already-submitted");
  if (intent.expiresAt < new Date()) throw new AppError("blockhash-expired");

  const tx = parseSignedTx(signedB64);
  const feePayer = new PublicKey(wallet);
  const check =
    kind === "buyback"
      ? checkBuybackTransaction(tx, {
          feePayer,
          mint: new PublicKey(intent.mint!),
          maxLamports: intent.maxLamports ?? 0n,
          venue: (intent.meta as unknown as BuybackMeta).venue,
          pool: (intent.meta as unknown as BuybackMeta).pool ? new PublicKey((intent.meta as unknown as BuybackMeta).pool!) : undefined,
        })
      : checkClaimTransaction(tx, {
          feePayer,
          mints: ((intent.meta as unknown as ClaimMeta).mints ?? []).map((m) => new PublicKey(m)),
          ammVaultAuthority: ammVaultAuthority(feePayer),
        });
  if (!check.ok) throw new AppError("relay-rejected", { detail: check.reason, message: `This transaction doesn't match what was prepared (${check.reason}), so it wasn't sent.` });

  const signature = bs58.encode(tx.signatures[0].signature!);
  const claimed = await db().txIntent.updateMany({ where: { id: intent.id, status: "built" }, data: { status: "submitted", signature } });
  if (claimed.count !== 1) throw new AppError("already-submitted");
  try {
    const raw = tx.serialize();
    await withRpc(`${kind}:send`, (c) => c.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 }));
  } catch (e) {
    const err = await explainSendError(e, wallet);
    await db().txIntent.update({ where: { id: intent.id }, data: { status: "failed", reason: err.message, signature: null } });
    throw err;
  }
  return { signature };
}

export async function intentStatus(intentId: string, wallet: string) {
  const intent = await db().txIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.wallet !== wallet) throw new AppError("bad-request", { status: 404, message: "Not found." });
  if (intent.status === "submitted" && intent.signature) {
    const sig = intent.signature;
    const s = (await withRpc("intent:status", (c) => c.getSignatureStatuses([sig], { searchTransactionHistory: true }))).value[0];
    if (s?.err) {
      await db().txIntent.updateMany({ where: { id: intent.id, status: "submitted" }, data: { status: "failed", reason: `Failed on-chain: ${JSON.stringify(s.err)}` } });
    } else if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
      await db().txIntent.updateMany({ where: { id: intent.id, status: "submitted" }, data: { status: "confirmed" } });
    } else if (Date.now() - intent.createdAt.getTime() > 5 * 60_000) {
      await db().txIntent.updateMany({ where: { id: intent.id, status: "submitted" }, data: { status: "expired", reason: "It never landed. Nothing was charged." } });
    }
  }
  const fresh = await db().txIntent.findUnique({ where: { id: intentId } });
  return { status: fresh!.status, reason: fresh!.reason, signature: fresh!.signature };
}

/** Tick job: settle submitted intents whose browser went away. */
export async function finalizeIntents(): Promise<number> {
  const pending = await db().txIntent.findMany({ where: { status: "submitted" }, take: 50, orderBy: { createdAt: "asc" } });
  for (const p of pending) await intentStatus(p.id, p.wallet).catch(() => {});
  await db().txIntent.updateMany({ where: { status: "built", expiresAt: { lt: new Date(Date.now() - 3600_000) } }, data: { status: "expired" } });
  return pending.length;
}

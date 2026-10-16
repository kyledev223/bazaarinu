// The launch flow: prepare → (browser makes the mint keypair) → build →
// (wallet signs, then the mint) → relay → finalize.
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { normaliseImage } from "@/lib/image";
import { uploadMetadata } from "@/lib/pump/metadata";
import { launchInstructions, readCurve } from "@/lib/pump/builders";
import { buildAndSimulate, parseSignedTx } from "@/lib/pump/tx";
import { checkLaunchTransaction } from "@/lib/pump/checkers";
import { rateLimit } from "@/lib/ratelimit";
import { withRpc } from "@/lib/solana/rpc";
import { sendFailure } from "@/lib/solana/txErrors";
import { solToLamports } from "@/lib/solana/curve";
import { validateLaunch } from "@/lib/validation";
import type { Launch } from "@/generated/prisma/client";

// A create_v2 without dev buy simulated at ~0.0056 SOL of rent on mainnet (Oct 2026). Used only for
// the "you need about X SOL" message when the wallet is too empty to simulate; kept a little high.
const FALLBACK_CREATE_RENT = 7_000_000n;
const FALLBACK_ATA_RENT = 2_100_000n;
const DRAFT_TTL_MS = 24 * 3600_000;

export async function prepareLaunch(form: FormData, wallet: string, ipHash: string) {
  const fields: Record<string, unknown> = {};
  for (const k of ["name", "symbol", "description", "twitter", "telegram", "website", "devBuySol"]) fields[k] = form.get(k) ?? "";
  const v = validateLaunch(fields);
  const image = form.get("image");
  const imageErr = !(image instanceof Blob) || image.size === 0 ? "Add an image for your coin." : null;
  if (!v.ok || imageErr) {
    const errs = { ...(v.ok ? {} : v.errors), ...(imageErr ? { image: imageErr } : {}) } as Record<string, string>;
    throw new AppError("validation", { fields: errs });
  }

  await rateLimit("prepareWallet", wallet);
  await rateLimit("prepareIp", ipHash);

  const img = await normaliseImage(new Uint8Array(await (image as Blob).arrayBuffer()));
  const up = await uploadMetadata(v.value, img);

  const launch = await db().launch.create({
    data: {
      wallet,
      name: v.value.name,
      symbol: v.value.symbol,
      description: v.value.description,
      twitter: v.value.twitter,
      telegram: v.value.telegram,
      website: v.value.website,
      imageUri: up.imageUri,
      metadataUri: up.metadataUri,
      metadataHost: up.host,
      devBuyLamports: solToLamports(v.value.devBuySol),
      ipHash,
    },
  });
  return { launchId: launch.id, metadataUri: up.metadataUri, imageUri: up.imageUri, uploadedVia: up.host };
}

async function loadOwned(launchId: string, wallet: string): Promise<Launch> {
  const l = await db().launch.findUnique({ where: { id: launchId } });
  if (!l || l.wallet !== wallet) throw new AppError("launch-not-found");
  return l;
}

function parseMint(v: unknown): PublicKey {
  try {
    if (typeof v !== "string") throw new Error();
    return new PublicKey(v);
  } catch {
    throw new AppError("bad-request", { message: "Missing or invalid mint address." });
  }
}

export async function buildLaunch(launchId: string, mintStr: unknown, wallet: string) {
  const l = await loadOwned(launchId, wallet);
  if (l.status === "submitted" || l.status === "confirmed") throw new AppError("already-submitted");
  if (l.status === "failed" || l.status === "expired" || Date.now() - l.createdAt.getTime() > DRAFT_TTL_MS) {
    if (l.status !== "expired") await db().launch.update({ where: { id: l.id }, data: { status: "expired", reason: "The draft is more than a day old." } });
    throw new AppError("launch-expired");
  }
  const mint = parseMint(mintStr);
  const user = new PublicKey(wallet);

  const taken = await db().launch.findFirst({ where: { mint: mint.toBase58(), NOT: { id: l.id } }, select: { id: true } });
  if (taken) throw new AppError("mint-taken");
  const exists = await withRpc("launch:mint-check", (c) => c.getAccountInfo(mint, "confirmed"));
  if (exists) throw new AppError("mint-taken");

  const ixs = await launchInstructions({ user, mint, name: l.name, symbol: l.symbol, uri: l.metadataUri, devBuyLamports: l.devBuyLamports });
  const devBuyCost = l.devBuyLamports > 0n ? l.devBuyLamports + l.devBuyLamports / 100n : 0n; // +1% slippage cap
  const built = await buildAndSimulate({
    label: "launch",
    feePayer: user,
    instructions: ixs,
    initialUnits: l.devBuyLamports > 0n ? 500_000 : 300_000,
    spendLamports: devBuyCost,
    fallbackRent: FALLBACK_CREATE_RENT + (l.devBuyLamports > 0n ? FALLBACK_ATA_RENT : 0n),
  });

  await db().launch.update({
    where: { id: l.id },
    data: { status: "built", mint: mint.toBase58(), lastValidBlockHeight: BigInt(built.lastValidBlockHeight), errorCode: null, reason: null },
  });
  return { tx: built.base64, estimate: built.estimate, lastValidBlockHeight: built.lastValidBlockHeight, mint: mint.toBase58() };
}

export async function relayLaunch(launchId: string, signedB64: unknown, wallet: string) {
  const l = await loadOwned(launchId, wallet);
  if (l.status === "submitted" || l.status === "confirmed") throw new AppError("already-submitted");
  if (l.status !== "built" || !l.mint) throw new AppError("bad-request", { message: "Build the transaction before sending it." });

  const tx = parseSignedTx(signedB64);
  const check = checkLaunchTransaction(tx, {
    feePayer: new PublicKey(wallet),
    mint: new PublicKey(l.mint),
    name: l.name,
    symbol: l.symbol,
    uri: l.metadataUri,
    devBuyLamports: l.devBuyLamports,
  });
  if (!check.ok) throw new AppError("relay-rejected", { detail: check.reason, message: `This transaction doesn't match the prepared launch (${check.reason}), so it wasn't sent.` });

  const signature = bs58.encode(tx.signatures[0].signature!);
  // Record the signature before sending: if this request dies after the send, finalize can still find it.
  const claimed = await db().launch.updateMany({
    where: { id: l.id, status: "built" },
    data: { status: "submitted", signature, submittedAt: new Date() },
  });
  if (claimed.count !== 1) throw new AppError("already-submitted");

  try {
    const raw = tx.serialize();
    await withRpc("launch:send", (c) => c.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 }));
  } catch (e) {
    const err = await explainSendError(e, wallet);
    // Nothing landed: put the launch back so the user can approve again.
    await db().launch.update({ where: { id: l.id }, data: { status: "built", signature: null, submittedAt: null, errorCode: err.code, reason: err.message } });
    throw err;
  }
  return { signature };
}

/** Make send failures specific: an empty wallet is the usual cause. */
export async function explainSendError(e: unknown, wallet: string): Promise<AppError> {
  const err = sendFailure(e);
  if (err.code === "tx-failed" || err.code === "insufficient-funds") {
    try {
      const bal = await withRpc("balance", (c) => c.getBalance(new PublicKey(wallet), "confirmed"));
      if (bal < 25_000_000)
        return new AppError("insufficient-funds", { message: `Not enough SOL: this wallet has ${(bal / 1e9).toFixed(4)} SOL. Nothing was charged. Add SOL and approve again.`, detail: err.detail });
    } catch {
      /* keep the original error */
    }
  }
  return err;
}

export interface LaunchStatus {
  status: Launch["status"];
  reason: string | null;
  errorCode: string | null;
  signature: string | null;
  mint: string | null;
}

/**
 * Idempotent and safe to run concurrently (status polls + background tick).
 * The coin row is created inside a transaction that first claims the launch,
 * so only one caller can ever create it.
 */
export async function finalizeLaunch(launchId: string): Promise<LaunchStatus> {
  const l = await db().launch.findUnique({ where: { id: launchId } });
  if (!l) throw new AppError("launch-not-found");
  const view = (x: Launch): LaunchStatus => ({ status: x.status, reason: x.reason, errorCode: x.errorCode, signature: x.signature, mint: x.mint });
  if (l.status !== "submitted" || !l.signature || !l.mint) return view(l);

  const sig = l.signature;
  const status = await withRpc("finalize:status", (c) => c.getSignatureStatuses([sig], { searchTransactionHistory: true }));
  const s = status.value[0];

  if (s?.err) {
    const updated = await db().launch.updateMany({
      where: { id: l.id, status: "submitted" },
      data: { status: "failed", errorCode: "tx-failed", reason: `The transaction failed on-chain (${JSON.stringify(s.err)}). Only the network fee was charged.` },
    });
    return updated.count ? view((await db().launch.findUnique({ where: { id: l.id } }))!) : view(l);
  }

  if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
    const mint = new PublicKey(l.mint);
    const curve = await withRpc("finalize:curve", (c) => readCurve(c, mint));
    if (!curve.exists) return view(l); // RPC hasn't caught up; next poll will see it
    if (!curve.creator?.equals(new PublicKey(l.wallet))) {
      await db().launch.updateMany({ where: { id: l.id, status: "submitted" }, data: { status: "failed", reason: "The coin exists but its creator isn't this wallet." } });
      return view((await db().launch.findUnique({ where: { id: l.id } }))!);
    }
    await db().$transaction(async (t) => {
      const claimed = await t.launch.updateMany({ where: { id: l.id, status: "submitted" }, data: { status: "confirmed", confirmedAt: new Date() } });
      if (claimed.count !== 1) return; // another poller got here first
      await t.coin.create({
        data: {
          mint: l.mint!,
          launchId: l.id,
          creator: l.wallet,
          name: l.name,
          symbol: l.symbol,
          description: l.description,
          imageUri: l.imageUri,
          metadataUri: l.metadataUri,
          twitter: l.twitter,
          telegram: l.telegram,
          website: l.website,
          signature: sig,
          virtualSolReserves: curve.virtualSolReserves,
          virtualTokenReserves: curve.virtualTokenReserves,
          realTokenReserves: curve.realTokenReserves,
          tokenTotalSupply: curve.tokenTotalSupply,
          complete: curve.complete,
          statsUpdatedAt: new Date(),
        },
      });
    });
    return view((await db().launch.findUnique({ where: { id: l.id } }))!);
  }

  // Not seen (yet). Once the blockhash is past its last valid height it can never land.
  if (l.lastValidBlockHeight) {
    const height = await withRpc("finalize:height", (c) => c.getBlockHeight("confirmed"));
    if (BigInt(height) > l.lastValidBlockHeight) {
      const again = await withRpc("finalize:status2", (c) => c.getSignatureStatuses([sig], { searchTransactionHistory: true }));
      if (!again.value[0]) {
        await db().launch.updateMany({
          where: { id: l.id, status: "submitted" },
          data: { status: "built", signature: null, submittedAt: null, errorCode: "blockhash-expired", reason: "The network didn't include the transaction before it expired. Nothing was charged. Approve again." },
        });
        return view((await db().launch.findUnique({ where: { id: l.id } }))!);
      }
    }
  }
  return view(l);
}

export async function expireStaleDrafts(): Promise<number> {
  const r = await db().launch.updateMany({
    where: { status: { in: ["prepared", "built"] }, createdAt: { lt: new Date(Date.now() - DRAFT_TTL_MS) } },
    data: { status: "expired", reason: "The draft is more than a day old." },
  });
  return r.count;
}

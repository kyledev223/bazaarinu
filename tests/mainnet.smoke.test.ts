// Mainnet smoke test. NEVER sends a transaction: it signs in, prepares and
// uploads, builds and simulates. Run with:
//   SMOKE_MAINNET=1 SMOKE_BASE_URL=http://localhost:3100 npx vitest run tests/mainnet.smoke.test.ts
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import sharp from "sharp";
import { buildAndSimulate } from "@/lib/pump/tx";
import { buybackInstructions, claimInstructions, launchInstructions, readCurve } from "@/lib/pump/builders";
import { checkBuybackTransaction, checkLaunchTransaction } from "@/lib/pump/checkers";
import { programs } from "@/lib/pump/decode";
import { withRpc } from "@/lib/solana/rpc";
import { tradesFromTransaction } from "@/lib/market";
import { db } from "@/lib/db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RUN = process.env.SMOKE_MAINNET === "1";
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";

// Large, long-lived public system accounts used only as simulated fee payers (no signatures, nothing sent).
const FUNDED_CANDIDATES = [
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S",
];

async function fundedAddress(): Promise<PublicKey> {
  for (const a of FUNDED_CANDIDATES) {
    const pk = new PublicKey(a);
    const info = await withRpc("smoke:funded", (c) => c.getAccountInfo(pk));
    if (info && info.owner.equals(new PublicKey("11111111111111111111111111111111")) && info.data.length === 0 && info.lamports > 5e9) return pk;
  }
  throw new Error("no funded system account found among candidates");
}

class Jar {
  cookie = "";
  async fetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie: this.cookie, origin: BASE } });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return { status: res.status, body: (await res.json()) as any };
  }
}

describe.skipIf(!RUN)("mainnet smoke (no transactions are sent)", () => {
  it("HTTP flow from an empty wallet: prepare/upload → build ends with not-enough-SOL (no sign-in)", async () => {
    const wallet = Keypair.generate();
    const jar = new Jar();
    const png = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 75, g: 168, b: 255, alpha: 1 } } }).png().toBuffer();
    const fd = new FormData();
    fd.append("name", "Bazaar Inu Smoke Test");
    fd.append("symbol", "BZSMOKE");
    fd.append("description", "Upload test from the Bazaar Inu smoke test. This coin is never launched.");
    fd.append("website", "https://example.com");
    fd.append("devBuySol", "0");
    fd.append("wallet", wallet.publicKey.toBase58());
    fd.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "smoke.png");
    const p = await jar.fetch("/api/launch/prepare", { method: "POST", body: fd });
    console.log("prepare:", p.status, JSON.stringify(p.body).slice(0, 400));
    let launchId: string;
    if (p.status === 200) {
      expect(p.body.metadataUri).toMatch(/^https:\/\//);
      const meta = await fetch(p.body.metadataUri, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
      console.log("metadata JSON:", JSON.stringify(meta).slice(0, 300));
      launchId = p.body.launchId;
    } else {
      // Without PINATA_JWT the only route is pump.fun's endpoint, which currently returns 500.
      expect(process.env.PINATA_JWT).toBeFalsy();
      expect(p.body.error.code).toBe("upload-failed");
      console.log("UPLOAD NOT VERIFIED: no PINATA_JWT and pump.fun's endpoint failed. Inserting a draft launch directly to keep testing build.");
      const row = await db().launch.create({
        data: { wallet: wallet.publicKey.toBase58(), name: "Bazaar Inu Smoke Test", symbol: "BZSMOKE", description: "smoke", imageUri: "", metadataUri: "https://ipfs.io/ipfs/QmSmokeTestPlaceholderNotUploaded", metadataHost: "test" },
      });
      launchId = row.id;
    }

    const mint = Keypair.generate();
    const b = await jar.fetch("/api/launch/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchId, mint: mint.publicKey.toBase58(), wallet: wallet.publicKey.toBase58() }),
    });
    console.log("build (empty wallet):", b.status, JSON.stringify(b.body));
    expect(b.status).toBe(400);
    expect(b.body.error.code).toBe("insufficient-funds");
    expect(b.body.error.message).toMatch(/Not enough SOL/);
  }, 120_000);

  it("builds and simulates a real create_v2 launch (no dev buy and with dev buy) from a funded address", async () => {
    const user = await fundedAddress();
    for (const devBuy of [0n, 10_000_000n]) {
      const mint = Keypair.generate();
      const exp = { feePayer: user, mint: mint.publicKey, name: "Bazaar Inu Sim", symbol: "BZSIM", uri: "https://ipfs.io/ipfs/QmSimulationOnlyNotARealUri", devBuyLamports: devBuy };
      const ixs = await launchInstructions({ user, mint: mint.publicKey, name: exp.name, symbol: exp.symbol, uri: exp.uri, devBuyLamports: devBuy });
      const built = await buildAndSimulate({ label: "smoke", feePayer: user, instructions: ixs, initialUnits: devBuy ? 500_000 : 300_000, spendLamports: devBuy + devBuy / 100n, fallbackRent: 22_000_000n });
      console.log(`launch sim (dev buy ${devBuy}):`, JSON.stringify(built.estimate, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      expect(built.estimate.exact).toBe(true);
      // Measured Oct 2026: ~0.0056 SOL without dev buy.
      expect(Number(built.estimate.totalLamports)).toBeGreaterThan(3_000_000 + Number(devBuy));
      expect(Number(built.estimate.totalLamports)).toBeLessThan(15_000_000 + Number(devBuy) * 1.05);
      // The exact bytes the browser would sign must pass the relay checker once signed.
      const tx = Transaction.from(Buffer.from(built.base64, "base64"));
      expect(tx.instructions.length).toBe(devBuy ? 5 : 3);
      // Fake signatures can't verify, so check everything except signatures by asserting the failure reason.
      const r = checkLaunchTransaction(tx, exp);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/missing signatures|signature is invalid/);
    }
  }, 120_000);

  it("finds a recent real pump.fun coin, decodes its curve and trades, and simulates a buyback on it", async () => {
    const P = programs();
    const sigs = await withRpc("smoke:sigs", (c) => c.getSignaturesForAddress(P.pump, { limit: 40 }));
    let mint: PublicKey | null = null;
    let tradeCount = 0;
    for (const s of sigs.filter((x) => !x.err).slice(0, 20)) {
      await sleep(1200); // the public RPC rate-limits getTransaction hard
      const tx = await withRpc("smoke:tx", (c) => c.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })).catch(() => null);
      if (!tx) continue;
      const trades = tradesFromTransaction(tx);
      tradeCount += trades.length;
      for (const t of trades) {
        if (mint) break;
        const m = new PublicKey(t.mint);
        const curve = await withRpc("smoke:curve", (c) => readCurve(c, m));
        if (curve.exists && !curve.complete) mint = m;
      }
      if (mint && tradeCount) break;
    }
    console.log("recent coin:", mint?.toBase58(), "decoded trades:", tradeCount);
    expect(mint).not.toBeNull();
    expect(tradeCount).toBeGreaterThan(0);

    const user = await fundedAddress();
    const { ixs, venue } = await buybackInstructions(user, mint!, 10_000_000n);
    const built = await buildAndSimulate({ label: "smoke:buyback", feePayer: user, instructions: ixs, initialUnits: 300_000, spendLamports: 10_100_000n, fallbackRent: 2_100_000n });
    console.log("buyback sim:", venue, JSON.stringify(built.estimate, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    const r = checkBuybackTransaction(Transaction.from(Buffer.from(built.base64, "base64")), { feePayer: user, mint: mint!, maxLamports: 10_000_000n, venue });
    expect(!r.ok && r.reason).toMatch(/missing signatures|signature is invalid/);

    // Claim instructions build for that coin's creator.
    const curve = await withRpc("smoke:curve2", (c) => readCurve(c, mint!));
    const claim = await claimInstructions(curve.creator!, []);
    expect(claim.length).toBeGreaterThan(0);
  }, 180_000);
});

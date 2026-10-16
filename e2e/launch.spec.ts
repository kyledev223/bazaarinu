// UI flow up to the wallet prompt, with a mocked Phantom. Sign-in is real
// (the mock signs the server's nonce with a throwaway key); prepare and build
// are stubbed so no upload happens, and the mock declines the transaction, so
// nothing can ever be sent.
import { expect, test, type Page } from "@playwright/test";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import nacl from "tweetnacl";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

async function mockWallet(page: Page, kp: Keypair) {
  const calls: string[] = [];
  await page.exposeFunction("__mockSign", (bytes: number[]) => Array.from(nacl.sign.detached(Uint8Array.from(bytes), kp.secretKey)));
  await page.exposeFunction("__mockLog", (what: string) => void calls.push(what));
  await page.addInitScript((pk: number[]) => {
    const bytes = Uint8Array.from(pk);
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const publicKey = { toBytes: () => bytes, toBuffer: () => bytes, toString: () => "mock" };
    const w = {
      isPhantom: true,
      publicKey: null as null | typeof publicKey,
      isConnected: false,
      async connect() {
        w.publicKey = publicKey;
        w.isConnected = true;
        (window as any).__mockLog("connect");
        return { publicKey };
      },
      async disconnect() {
        w.publicKey = null;
        w.isConnected = false;
        (listeners.disconnect ?? []).forEach((f) => f());
      },
      async signMessage(message: Uint8Array) {
        (window as any).__mockLog("signMessage");
        const sig = await (window as any).__mockSign(Array.from(message));
        return { signature: Uint8Array.from(sig), publicKey };
      },
      async signTransaction() {
        (window as any).__mockLog("signTransaction");
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      },
      async signAllTransactions() {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      },
      on(e: string, f: (...a: unknown[]) => void) {
        (listeners[e] ??= []).push(f);
      },
      off(e: string, f: (...a: unknown[]) => void) {
        listeners[e] = (listeners[e] ?? []).filter((x) => x !== f);
      },
      removeListener(e: string, f: (...a: unknown[]) => void) {
        listeners[e] = (listeners[e] ?? []).filter((x) => x !== f);
      },
    };
    (window as any).phantom = { solana: w };
    (window as any).solana = w;
    (window as any).isPhantomInstalled = true; // set by the real extension; the adapter checks it
  }, Array.from(kp.publicKey.toBytes()));
  return calls;
}

function fakeUnsignedTx(feePayer: PublicKey, mint: PublicKey): string {
  const tx = new Transaction({ feePayer, blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1 });
  tx.add(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: mint, isSigner: true, isWritable: false }], data: Buffer.from("e2e") }));
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

test("home page sections render with real (empty) data, without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Launch a coin/ })).toBeVisible();
  await expect(page.locator(".netpill")).toContainText("mainnet");
  await expect(page.getByLabel("Pool simulator")).toBeVisible();
  await expect(page.getByText("SIMULATION", { exact: true })).toBeVisible();
  await expect(page.getByTestId("market-empty")).toContainText("No shops open yet");
  await expect(page.getByText("ANALYSIS ON PAST DATA", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How a launch runs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live launch log" })).toBeVisible();
  await expect(page.getByRole("note", { name: "Risk warning" })).toHaveCount(0);
  await expect(page.locator("footer")).toContainText("Not financial advice");
  if (!(await page.evaluate(() => window.innerWidth < 560))) {
    await expect(page.getByRole("link", { name: "Bazaar Inu on X" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bazaar Inu on pump.fun" })).toBeVisible();
  }
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});

test("simulator controls change state", async ({ page }) => {
  await page.goto("/");
  const game = page.getByLabel("Pool simulator");
  await game.getByRole("button", { name: "Pause" }).click().catch(() => {});
  await game.getByRole("button", { name: "Buy with 1 SOL" }).click();
  await expect(game.locator(".g-log")).toContainText("You bought");
  await game.getByRole("button", { name: "1%" }).click();
  await expect(game.getByRole("button", { name: "1%" })).toHaveAttribute("aria-pressed", "true");
  await game.getByRole("button", { name: "Bad news" }).click();
  await expect(game.locator(".g-log")).toContainText("Bad news");
  await game.getByRole("button", { name: "Reset pool" }).click();
  await expect(game.locator(".g-log")).toContainText("Fresh pool");
});

test("wallet picker lists four wallets and explains how to install a missing one", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("wallet-button").click();
  for (const w of ["Phantom", "Solflare", "Backpack", "OKX Wallet"]) await expect(page.getByTestId(`wallet-${w}`)).toBeVisible();
  await page.getByTestId("wallet-Backpack").click();
  await expect(page.getByRole("heading", { name: "Install Backpack" })).toBeVisible();
  await expect(page.getByText(/Chromium browsers, and in Firefox/)).toBeVisible();
});

test("form validation shows field errors before anything is sent", async ({ page }) => {
  await page.goto("/#launch");
  await page.getByLabel("Ticker").fill("BAD-TICKER!");
  await page.getByTestId("review-launch").click();
  await expect(page.getByText("Give your coin a name.")).toBeVisible();
  await expect(page.getByText("Add an image for your coin.")).toBeVisible();
});

test("launch flow: connect, sign in, preview, confirmation with costs, wallet prompt (declined)", async ({ page }) => {
  const kp = Keypair.generate();
  const mintSeen: string[] = [];
  const calls = await mockWallet(page, kp);
  let prepared = false;
  await page.route("**/api/launch/prepare", async (route) => {
    prepared = true;
    await route.fulfill({ json: { ok: true, launchId: "e2e-launch", metadataUri: "https://ipfs.io/ipfs/QmE2E", imageUri: "", uploadedVia: "test" } });
  });
  await page.route("**/api/launch/build", async (route) => {
    const body = route.request().postDataJSON() as { mint: string; wallet: string };
    mintSeen.push(body.mint);
    await route.fulfill({
      json: {
        ok: true,
        tx: fakeUnsignedTx(new PublicKey(body.wallet), new PublicKey(body.mint)),
        mint: body.mint,
        lastValidBlockHeight: 1,
        estimate: { totalLamports: "5629878", networkFeeLamports: "16478", rentLamports: "5613400", spendLamports: "0", exact: true, balanceLamports: "50000000", computeUnits: 149000, microLamportsPerCu: 43480 },
      },
    });
  });
  let relayed = false;
  await page.route("**/api/launch/relay", async (route) => {
    relayed = true;
    await route.abort();
  });

  await page.goto("/#launch");
  await page.getByTestId("wallet-button").click();
  await page.getByTestId("wallet-Phantom").click();
  await expect(page.getByTestId("wallet-button")).not.toHaveText("Connect wallet");

  await page.getByLabel("Coin name").fill("Kibble Coin");
  await page.getByLabel("Ticker").fill("kibl");
  await page.getByPlaceholder("What's your coin about?").fill("Treats for good dogs.");
  await page.getByTestId("image-input").setInputFiles({ name: "kibble.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5b3d20b0000000049454e44ae426082", "hex") });
  await expect(page.getByLabel("Shop preview")).toContainText("$KIBL");

  await page.getByTestId("review-launch").click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  expect(calls).toContain("signMessage"); // real sign-in against the server
  expect(prepared).toBe(true);
  await expect(dialog).toContainText("Solana mainnet");
  await expect(dialog).toContainText("can't be undone");
  await expect(dialog).toContainText("0.0056");
  // The mint keypair was made in the browser; only its public key reached the server.
  expect(mintSeen[0]).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

  await page.getByTestId("approve").click();
  await expect(page.getByTestId("launch-status")).toContainText("You declined in your wallet. Nothing was sent.");
  expect(calls).toContain("signTransaction");
  expect(relayed).toBe(false);
});

test("mobile menu, no theme toggle, no horizontal scroll", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /theme/i })).toHaveCount(0);
  if (isMobile) {
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator("#navLinks")).toHaveClass(/open/);
    await expect(page.locator("#navLinks").getByRole("link", { name: /pump\.fun/ })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

// Wallet sign-in: the wallet signs a one-time message, the server checks the
// ed25519 signature, then sets an httpOnly session cookie. Only the SHA-256 of
// the cookie token is stored.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { SITE } from "@/config/site";

export const SESSION_COOKIE = "bi_session";
const SESSION_DAYS = 14;
const NONCE_MINUTES = 10;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function parseWallet(v: unknown): PublicKey {
  try {
    if (typeof v !== "string" || v.length < 32 || v.length > 44) throw new Error();
    return new PublicKey(v);
  } catch {
    throw new AppError("bad-request", { message: "That isn't a valid Solana address." });
  }
}

export function signInMessage(wallet: string, nonce: string, domain: string, issuedAt: Date): string {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    wallet,
    "",
    `Sign in to ${SITE.name}. This is a free signature: it is not a transaction and moves no funds.`,
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
  ].join("\n");
}

export async function createNonce(wallet: string, domain: string) {
  const nonce = randomBytes(16).toString("hex");
  const now = new Date();
  const message = signInMessage(wallet, nonce, domain, now);
  await db().authNonce.create({
    data: { nonce, wallet, message, expiresAt: new Date(now.getTime() + NONCE_MINUTES * 60_000) },
  });
  return { nonce, message };
}

export function verifySignature(message: string, signatureB58: string, wallet: PublicKey): boolean {
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signatureB58);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, wallet.toBytes());
}

/** Consume a nonce and open a session. Returns the raw token for the cookie. */
export async function completeSignIn(wallet: PublicKey, nonce: string, signature: string): Promise<string> {
  const row = await db().authNonce.findUnique({ where: { nonce } });
  if (!row || row.wallet !== wallet.toBase58() || row.usedAt || row.expiresAt < new Date())
    throw new AppError("not-signed-in", { message: "That sign-in request expired. Try signing in again." });
  if (!verifySignature(row.message, signature, wallet))
    throw new AppError("not-signed-in", { message: "The signature didn't check out. Try signing in again." });

  // Single use, even under concurrent requests.
  const used = await db().authNonce.updateMany({ where: { nonce, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw new AppError("not-signed-in", { message: "That sign-in request was already used." });

  const token = randomBytes(32).toString("base64url");
  await db().session.create({
    data: { tokenHash: sha256(token), wallet: wallet.toBase58(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) },
  });
  return token;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export interface Session {
  wallet: string;
  id: string;
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db().session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!s || s.expiresAt < new Date()) return null;
  return { wallet: s.wallet, id: s.id };
}

/** The signed-in wallet. If the browser says which wallet is connected, it must match. */
export async function requireSession(connectedWallet?: string | null): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AppError("not-signed-in");
  if (connectedWallet && connectedWallet !== s.wallet) throw new AppError("wallet-mismatch");
  return s;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

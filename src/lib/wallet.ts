// The wallet an action is for, as sent by the browser. There is no separate
// sign-in: nothing here is trusted on its own. Every action that moves SOL is a
// transaction this wallet must sign, and the relay checkers only forward it if
// the fee payer is this wallet and every signature verifies.
import { PublicKey } from "@solana/web3.js";
import { AppError } from "@/lib/errors";

export function parseWallet(v: unknown): PublicKey {
  try {
    if (typeof v !== "string" || v.length < 32 || v.length > 44) throw new Error();
    return new PublicKey(v);
  } catch {
    throw new AppError("bad-request", { message: "Connect a wallet first." });
  }
}

export const walletAddress = (v: unknown): string => parseWallet(v).toBase58();

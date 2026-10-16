import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { pumpSdk } from "@/lib/pump/load";

export const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

export function budget(units = 250_000, microLamports = 100_000): TransactionInstruction[] {
  return [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports })];
}

export function tx(feePayer: PublicKey, ixs: TransactionInstruction[], signers: Keypair[]): Transaction {
  const t = new Transaction({ feePayer, recentBlockhash: BLOCKHASH });
  t.add(...ixs);
  // Wallet first, then the others, as in the browser.
  for (const s of signers) t.partialSign(s);
  return roundTrip(t);
}

/** Serialize and parse again, as the relay receives it. */
export function roundTrip(t: Transaction): Transaction {
  return Transaction.from(t.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

/** A Global with just the fields the offline builders read. */
export function fakeGlobal(): any {
  const recipient = Keypair.generate().publicKey;
  return {
    initialized: true,
    authority: Keypair.generate().publicKey,
    feeRecipient: recipient,
    feeRecipients: Array.from({ length: 7 }, () => Keypair.generate().publicKey),
    reservedFeeRecipient: recipient,
    reservedFeeRecipients: Array.from({ length: 7 }, () => Keypair.generate().publicKey),
    buybackFeeRecipients: Array.from({ length: 8 }, () => Keypair.generate().publicKey),
    initialVirtualTokenReserves: new BN("1073000000000000"),
    initialVirtualSolReserves: new BN("30000000000"),
    initialRealTokenReserves: new BN("793100000000000"),
    tokenTotalSupply: new BN("1000000000000000"),
    feeBasisPoints: new BN(95),
    creatorFeeBasisPoints: new BN(5),
    whitelistedQuoteMints: [],
    creatorFeeConfigurable: false,
    maxConfigurableCreatorFeeBps: new BN(0),
    isHolderRewardEnabled: false,
    holderRewardClaimAuthority: PublicKey.default,
    maxCurveDepth: 0,
  };
}

export async function createIx(o: { mint: PublicKey; user: PublicKey; name?: string; symbol?: string; uri?: string }) {
  return pumpSdk().PUMP_SDK.createV2Instruction({
    mint: o.mint,
    name: o.name ?? "Bazaar Test",
    symbol: o.symbol ?? "BZR",
    uri: o.uri ?? "https://ipfs.io/ipfs/QmTest",
    creator: o.user,
    user: o.user,
    mayhemMode: false,
  });
}

export async function createAndBuyIxs(o: { mint: PublicKey; user: PublicKey; lamports: bigint }) {
  return pumpSdk().PUMP_SDK.createV2AndBuyInstructions({
    global: fakeGlobal(),
    mint: o.mint,
    name: "Bazaar Test",
    symbol: "BZR",
    uri: "https://ipfs.io/ipfs/QmTest",
    creator: o.user,
    user: o.user,
    amount: new BN(1_000_000_000),
    solAmount: new BN(o.lamports.toString()),
    mayhemMode: false,
  });
}

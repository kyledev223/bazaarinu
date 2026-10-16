// Shared pieces for building user transactions on the server: priority fee,
// compute budget sized from a simulation, fresh blockhash, and a cost estimate.
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { AppError } from "@/lib/errors";
import { withRpc } from "@/lib/solana/rpc";
import { simulationFailure } from "@/lib/solana/txErrors";

const MIN_PRICE = 20_000; // micro-lamports per CU
const MAX_PRICE = 1_500_000;

export interface CostEstimate {
  /** Everything the wallet pays: fees + rent + any SOL spent on buys. */
  totalLamports: bigint;
  networkFeeLamports: bigint;
  /** New accounts' rent (exact when simulated, otherwise an estimate). */
  rentLamports: bigint;
  spendLamports: bigint; // dev buy / buyback amount incl. trading fees, upper bound
  exact: boolean; // true when taken from a successful simulation
  balanceLamports: bigint;
  computeUnits: number;
  microLamportsPerCu: number;
}

export interface BuiltTx {
  tx: Transaction; // unsigned
  base64: string;
  blockhash: string;
  lastValidBlockHeight: number;
  estimate: CostEstimate;
  logs: string[];
}

async function priorityPrice(conn: Connection, accounts: PublicKey[]): Promise<number> {
  try {
    const fees = await conn.getRecentPrioritizationFees({ lockedWritableAccounts: accounts.slice(0, 128) });
    const vals = fees.map((f) => f.prioritizationFee).filter((n) => n > 0).sort((a, b) => a - b);
    if (!vals.length) return MIN_PRICE;
    const p75 = vals[Math.floor(vals.length * 0.75)];
    return Math.min(MAX_PRICE, Math.max(MIN_PRICE, p75));
  } catch {
    return MIN_PRICE * 5;
  }
}

function assemble(feePayer: PublicKey, blockhash: string, lastValidBlockHeight: number, units: number, price: number, ixs: TransactionInstruction[]) {
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), ...ixs);
  return tx;
}

/**
 * Build, simulate and size a transaction for `feePayer`.
 * `spendLamports` is the SOL the transaction intentionally spends (dev buy, buyback) as an upper bound.
 * `fallbackRent` is used for the estimate when simulation can't run (e.g. an empty wallet).
 */
export async function buildAndSimulate(opts: {
  label: string;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
  initialUnits: number;
  spendLamports: bigint;
  fallbackRent: bigint;
}): Promise<BuiltTx> {
  const { feePayer, instructions } = opts;
  return withRpc(`${opts.label}:build`, async (conn) => {
    const writable = [...new Set(instructions.flatMap((ix) => ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey.toBase58())))].map((k) => new PublicKey(k));
    const [{ blockhash, lastValidBlockHeight }, price, balance] = await Promise.all([
      conn.getLatestBlockhash("confirmed"),
      priorityPrice(conn, writable),
      conn.getBalance(feePayer, "confirmed"),
    ]);

    const simTx = assemble(feePayer, blockhash, lastValidBlockHeight, opts.initialUnits, price, instructions);
    const sim = await conn.simulateTransaction(new VersionedTransaction(simTx.compileMessage()), {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
      accounts: { addresses: [feePayer.toBase58()], encoding: "base64" },
    });

    const failure = simulationFailure(sim.value);
    const baseFee = 5_000n * BigInt(simTx.compileMessage().header.numRequiredSignatures);

    if (failure) {
      if (failure.code === "insufficient-funds") {
        const need = baseFee + (BigInt(price) * BigInt(opts.initialUnits)) / 1_000_000n + opts.fallbackRent + opts.spendLamports;
        throw new AppError("insufficient-funds", {
          message: `Not enough SOL. This wallet has ${(Number(balance) / 1e9).toFixed(4)} SOL and this needs about ${(Number(need) / 1e9).toFixed(4)} SOL. Add SOL and try again.`,
          detail: failure.detail,
        });
      }
      throw failure;
    }

    const used = sim.value.unitsConsumed ?? opts.initialUnits;
    const units = Math.min(1_400_000, Math.ceil((used * 1.2 + 20_000) / 1_000) * 1_000);
    const tx = assemble(feePayer, blockhash, lastValidBlockHeight, units, price, instructions);
    const priority = (BigInt(price) * BigInt(units)) / 1_000_000n;
    const fee = baseFee + priority;

    // The simulated post-balance already has the simulated fee taken off; swap in the final fee.
    const post = sim.value.accounts?.[0]?.lamports;
    const simFee = baseFee + (BigInt(price) * BigInt(opts.initialUnits)) / 1_000_000n;
    let total: bigint;
    let exact = false;
    if (typeof post === "number") {
      total = BigInt(balance) - BigInt(post) - simFee + fee;
      exact = true;
    } else total = fee + opts.fallbackRent + opts.spendLamports;
    if (total < fee) total = fee;
    const rent = total - fee - opts.spendLamports > 0n ? total - fee - opts.spendLamports : 0n;

    if (BigInt(balance) < total)
      throw new AppError("insufficient-funds", {
        message: `Not enough SOL. This wallet has ${(Number(balance) / 1e9).toFixed(4)} SOL and this needs about ${(Number(total) / 1e9).toFixed(4)} SOL.`,
      });

    return {
      tx,
      base64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      blockhash,
      lastValidBlockHeight,
      logs: sim.value.logs ?? [],
      estimate: {
        totalLamports: total,
        networkFeeLamports: fee,
        rentLamports: rent,
        spendLamports: opts.spendLamports,
        exact,
        balanceLamports: BigInt(balance),
        computeUnits: units,
        microLamportsPerCu: price,
      },
    };
  });
}

/** Parse a base64 legacy transaction from the browser. */
export function parseSignedTx(b64: unknown): Transaction {
  if (typeof b64 !== "string" || b64.length > 3000) throw new AppError("bad-request", { message: "Missing signed transaction." });
  try {
    return Transaction.from(Buffer.from(b64, "base64"));
  } catch {
    throw new AppError("relay-rejected", { detail: "the signed transaction couldn't be parsed" });
  }
}

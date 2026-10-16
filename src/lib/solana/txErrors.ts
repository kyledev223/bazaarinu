// Turn Solana transaction failures into an AppError with a useful message.
import { SendTransactionError, type SimulatedTransactionResponse } from "@solana/web3.js";
import { AppError } from "@/lib/errors";
import { redact } from "@/lib/solana/rpc";

const FUNDS = /insufficient lamports|insufficient funds|insufficientfunds|accountnotfound|no record of a prior credit|insufficientfundsforrent|insufficientfundsforfee/i;
const EXPIRED = /blockhash not found|block height exceeded|blockhashnotfound|transaction expired/i;
const SLIPPAGE = /toomuchsolrequired|slippage|toolittlesolreceived|exceededslippage/i;

/** The most informative lines out of a program log. */
export function pickLogLines(logs: string[] | null | undefined, max = 4): string[] {
  if (!logs?.length) return [];
  const interesting = logs.filter((l) => /error|failed|insufficient|invalid|exceed|custom program|anchorerror/i.test(l));
  return (interesting.length ? interesting : logs.slice(-max)).slice(-max).map((l) => l.slice(0, 300));
}

export function classifyChainError(text: string, logs?: string[] | null): AppError {
  const all = `${text}\n${(logs ?? []).join("\n")}`;
  const detail = redact([text, ...pickLogLines(logs)].filter(Boolean).join(" | ").slice(0, 900));
  if (EXPIRED.test(all)) return new AppError("blockhash-expired", { detail });
  if (FUNDS.test(all)) return new AppError("insufficient-funds", { detail });
  if (SLIPPAGE.test(all))
    return new AppError("tx-failed", { detail, message: "The price moved more than the allowed slippage before the transaction landed. Nothing was bought. Try again." });
  return new AppError("tx-failed", { detail });
}

export function simulationFailure(sim: SimulatedTransactionResponse): AppError | null {
  if (!sim.err) return null;
  const errText = typeof sim.err === "string" ? sim.err : JSON.stringify(sim.err);
  const e = classifyChainError(errText, sim.logs);
  if (e.code === "tx-failed") return new AppError("simulation-failed", { detail: e.detail, message: e.message === new AppError("tx-failed").message ? undefined : e.message });
  return e;
}

/** Pull the transactionMessage and logs out of a SendTransactionError (or anything thrown by sendRawTransaction). */
export function sendFailure(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof SendTransactionError) {
    // transactionError carries the RPC's transactionMessage and the program logs.
    const { message, logs } = err.transactionError;
    return classifyChainError(message || err.message, logs ?? err.logs ?? null);
  }
  const text = err instanceof Error ? err.message : String(err);
  return classifyChainError(text, null);
}

import { describe, expect, it } from "vitest";
import type { Connection } from "@solana/web3.js";
import { SendTransactionError } from "@solana/web3.js";
import { classifyRpcError, createRpc, hostOf, redact, rpcEndpoints, PUBLIC_MAINNET_RPC } from "@/lib/solana/rpc";
import { AppError } from "@/lib/errors";
import { classifyChainError, sendFailure, simulationFailure } from "@/lib/solana/txErrors";

const HELIUS = "https://mainnet.helius-rpc.com/?api-key=abcd1234-secret-key";
const OTHER = "https://solana-mainnet.example.org/v2/0123456789abcdef0123456789abcdef";

function fakeRpc(endpoints: string[], behaviour: Record<string, (() => unknown)[]>) {
  const calls: string[] = [];
  const client = createRpc({
    endpoints,
    sleep: async () => {},
    connect: (url) => ({ url }) as unknown as Connection,
  });
  const run = () =>
    client.withRpc("test", async (c) => {
      const url = (c as unknown as { url: string }).url;
      calls.push(hostOf(url));
      const step = behaviour[url].shift();
      if (!step) throw new Error("no more behaviour");
      return step();
    });
  return { run, calls };
}

describe("rpcEndpoints", () => {
  it("parses a comma list and always ends with the public endpoint", () => {
    expect(rpcEndpoints(` ${HELIUS} , ${OTHER},bogus`)).toEqual([HELIUS, OTHER, PUBLIC_MAINNET_RPC]);
    expect(rpcEndpoints("")).toEqual([PUBLIC_MAINNET_RPC]);
    expect(rpcEndpoints(`${PUBLIC_MAINNET_RPC},${HELIUS}`)).toEqual([PUBLIC_MAINNET_RPC, HELIUS]);
  });
});

describe("redaction", () => {
  it("never leaks the API key", () => {
    const msg = `failed to fetch ${HELIUS} and ${OTHER} (api-key=abcd1234-secret-key)`;
    const out = redact(msg, [HELIUS, OTHER]);
    expect(out).not.toContain("abcd1234-secret-key");
    expect(out).not.toContain("0123456789abcdef0123456789abcdef");
    expect(out).toContain("mainnet.helius-rpc.com");
    expect(hostOf(HELIUS)).toBe("mainnet.helius-rpc.com");
  });
});

describe("classifyRpcError", () => {
  it.each([
    [new Error("429 Too Many Requests: rate limited"), "rate-limited"],
    [new Error("403 Forbidden"), "forbidden"],
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "timeout"],
    [new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }), "network"],
    [new Error("503 Service Unavailable"), "network"],
    [new Error("Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1"), "fatal"],
    [new Error("Blockhash not found"), "fatal"],
    [new Error("something odd"), "fatal"],
  ])("%s → %s", (err, kind) => {
    expect(classifyRpcError(err)).toBe(kind);
  });
});

describe("withRpc fail-over", () => {
  it("returns the first success", async () => {
    const { run, calls } = fakeRpc([HELIUS, PUBLIC_MAINNET_RPC], { [HELIUS]: [() => "ok"], [PUBLIC_MAINNET_RPC]: [] });
    await expect(run()).resolves.toBe("ok");
    expect(calls).toEqual(["mainnet.helius-rpc.com"]);
  });

  it("retries once on 429, then fails over to the next endpoint", async () => {
    const e429 = () => {
      throw new Error("429 Too Many Requests");
    };
    const { run, calls } = fakeRpc([HELIUS, PUBLIC_MAINNET_RPC], { [HELIUS]: [e429, e429], [PUBLIC_MAINNET_RPC]: [() => "public"] });
    await expect(run()).resolves.toBe("public");
    expect(calls).toEqual(["mainnet.helius-rpc.com", "mainnet.helius-rpc.com", "api.mainnet-beta.solana.com"]);
  });

  it("recovers on the retry without failing over", async () => {
    const { run, calls } = fakeRpc([HELIUS, PUBLIC_MAINNET_RPC], {
      [HELIUS]: [() => { throw new Error("fetch failed"); }, () => "second try"],
      [PUBLIC_MAINNET_RPC]: [],
    });
    await expect(run()).resolves.toBe("second try");
    expect(calls).toHaveLength(2);
  });

  it("does not retry real errors", async () => {
    const real = new Error("Transaction simulation failed: insufficient funds");
    const { run, calls } = fakeRpc([HELIUS, PUBLIC_MAINNET_RPC], { [HELIUS]: [() => { throw real; }], [PUBLIC_MAINNET_RPC]: [() => "x"] });
    await expect(run()).rejects.toBe(real);
    expect(calls).toEqual(["mainnet.helius-rpc.com"]);
  });

  it("throws a coded AppError with hostnames only when everything fails", async () => {
    const e403 = () => { throw new Error(`403 Forbidden from ${HELIUS}`); };
    const { run } = fakeRpc([HELIUS, PUBLIC_MAINNET_RPC], { [HELIUS]: [e403, e403], [PUBLIC_MAINNET_RPC]: [e403, e403] });
    const err = (await run().catch((e) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("rpc-forbidden");
    expect(err.detail).toContain("mainnet.helius-rpc.com");
    expect(err.detail).not.toContain("secret");
  });
});

describe("chain error messages", () => {
  it("spots not enough SOL", () => {
    expect(classifyChainError("Attempt to debit an account but found no record of a prior credit.").code).toBe("insufficient-funds");
    expect(classifyChainError("failed", ["Program log: Transfer: insufficient lamports 100, need 2000"]).code).toBe("insufficient-funds");
    expect(simulationFailure({ err: "AccountNotFound", logs: [], accounts: null, unitsConsumed: 0, returnData: null } as never)?.code).toBe("insufficient-funds");
  });

  it("spots an expired blockhash", () => {
    expect(classifyChainError("Blockhash not found").code).toBe("blockhash-expired");
  });

  it("returns null for a clean simulation", () => {
    expect(simulationFailure({ err: null, logs: [] } as never)).toBeNull();
  });

  it("maps a failing simulation to simulation-failed with the useful log line", () => {
    const e = simulationFailure({ err: { InstructionError: [2, { Custom: 6003 }] }, logs: ["Program log: ok", "Program log: AnchorError: something broke"] } as never);
    expect(e?.code).toBe("simulation-failed");
    expect(e?.detail).toContain("AnchorError");
  });

  it("pulls transactionMessage and logs out of SendTransactionError", () => {
    const err = new SendTransactionError({
      action: "send",
      signature: "",
      transactionMessage: "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.",
      logs: [],
    });
    expect(sendFailure(err).code).toBe("insufficient-funds");
  });
});

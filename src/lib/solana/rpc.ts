// Solana RPC with fail-over.
//
// SOLANA_RPC_URL is a comma-separated list (put Helius first). The public
// mainnet endpoint is always appended as the last resort. Every call goes
// through withRpc(): transient failures (429, 403, timeouts, network errors)
// are retried once on the same endpoint and then moved to the next one. Real
// errors, such as a rejected transaction, are thrown straight away.
import { Connection, type Commitment } from "@solana/web3.js";
import { AppError } from "@/lib/errors";

export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const TIMEOUT_MS = 12_000;

export type RpcFailure = "rate-limited" | "forbidden" | "timeout" | "network" | "fatal";

/**
 * Normalise one SOLANA_RPC_URL entry, forgiving the usual paste mistakes:
 * surrounding quotes, a wss:// (WebSocket) URL instead of https://, or a bare
 * Helius API key. Returns null if it still isn't an http(s) URL.
 */
export function normaliseRpcEntry(entry: string): string | null {
  let s = entry.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!s) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return `https://mainnet.helius-rpc.com/?api-key=${s}`;
  if (/^wss?:\/\//i.test(s)) s = s.replace(/^ws(s?):\/\//i, (_m, sec) => `http${sec}://`);
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    new URL(s);
    return s;
  } catch {
    return null;
  }
}

export function rpcEndpoints(raw = process.env.SOLANA_RPC_URL ?? ""): string[] {
  const list = raw
    .split(",")
    .map(normaliseRpcEntry)
    .filter((s): s is string => !!s);
  if (!list.includes(PUBLIC_MAINNET_RPC)) list.push(PUBLIC_MAINNET_RPC);
  return [...new Set(list)];
}

/** How many SOLANA_RPC_URL entries couldn't be used at all (for /api/health). */
export function invalidRpcEntries(raw = process.env.SOLANA_RPC_URL ?? ""): number {
  return raw.split(",").filter((e) => e.trim() && !normaliseRpcEntry(e)).length;
}

/** Hostname only. Never log or return a full RPC URL: it usually carries the API key. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

/** Strip any configured endpoint URL or api-key out of a message. */
export function redact(text: string, endpoints: string[] = rpcEndpoints()): string {
  let out = text;
  for (const ep of endpoints) {
    out = out.split(ep).join(hostOf(ep));
    try {
      const u = new URL(ep);
      for (const [, v] of u.searchParams) if (v.length >= 8) out = out.split(v).join("***");
      const pathKey = u.pathname.split("/").find((seg) => seg.length >= 24);
      if (pathKey) out = out.split(pathKey).join("***");
    } catch {
      /* not a URL */
    }
  }
  return out.replace(/api[-_]?key=[^&\s"']+/gi, "api-key=***");
}

function errText(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const code = (err as Error & { code?: unknown }).code;
    return `${err.name} ${err.message} ${code ?? ""} ${cause ? errText(cause) : ""}`;
  }
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function classifyRpcError(err: unknown): RpcFailure {
  const t = errText(err).toLowerCase();
  // Real answers from the chain come first: these must never be retried elsewhere.
  if (
    /sendtransactionerror|transaction simulation failed|blockhash not found|custom program error|insufficient (funds|lamports)|invalid transaction|signature verification|already been processed/.test(t)
  )
    return "fatal";
  if (/\b429\b|too many requests|rate limit|rate-limit/.test(t)) return "rate-limited";
  if (/\b403\b|forbidden|access denied|not allowed|unauthori[sz]ed|\b401\b/.test(t)) return "forbidden";
  if (/timeout|timed out|aborterror|etimedout|operation was aborted/.test(t)) return "timeout";
  if (/fetch failed|econnreset|econnrefused|enotfound|eai_again|socket hang up|network|\b50[234]\b|bad gateway|service unavailable|gateway timeout|und_err/.test(t))
    return "network";
  return "fatal";
}

const FAILURE_CODE = {
  "rate-limited": "rpc-rate-limited",
  forbidden: "rpc-forbidden",
  timeout: "rpc-timeout",
  network: "rpc-unavailable",
} as const;

export interface RpcClient {
  endpoints: string[];
  withRpc<T>(label: string, fn: (conn: Connection, host: string) => Promise<T>): Promise<T>;
}

export function createRpc(opts: {
  endpoints?: string[];
  connect?: (url: string) => Connection;
  sleep?: (ms: number) => Promise<void>;
  commitment?: Commitment;
} = {}): RpcClient {
  const endpoints = opts.endpoints ?? rpcEndpoints();
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const cache = new Map<string, Connection>();
  const connect =
    opts.connect ??
    ((url: string) =>
      new Connection(url, {
        commitment: opts.commitment ?? "confirmed",
        // web3.js would otherwise sit on a 429 retrying for seconds; we fail over instead.
        disableRetryOnRateLimit: true,
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
      }));
  const conn = (url: string) => {
    let c = cache.get(url);
    if (!c) cache.set(url, (c = connect(url)));
    return c;
  };

  return {
    endpoints,
    async withRpc<T>(label: string, fn: (c: Connection, host: string) => Promise<T>): Promise<T> {
      let last: { kind: Exclude<RpcFailure, "fatal">; err: unknown } | null = null;
      const tried: string[] = [];
      for (const url of endpoints) {
        const host = hostOf(url);
        tried.push(host);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await fn(conn(url), host);
          } catch (err) {
            const kind = classifyRpcError(err);
            if (kind === "fatal") throw err;
            last = { kind, err };
            console.warn(`[rpc] ${label} on ${host} failed (${kind}), attempt ${attempt + 1}`);
            if (attempt === 0) await sleep(kind === "rate-limited" ? 400 : 150);
          }
        }
      }
      const kind = last?.kind ?? "network";
      throw new AppError(FAILURE_CODE[kind], {
        detail: `${label}: all RPC endpoints failed (${tried.join(", ")})`,
        cause: last?.err,
      });
    },
  };
}

let shared: RpcClient | null = null;

/** The app-wide RPC client, built from SOLANA_RPC_URL on first use. */
export function rpc(): RpcClient {
  return (shared ??= createRpc());
}

export function withRpc<T>(label: string, fn: (conn: Connection, host: string) => Promise<T>): Promise<T> {
  return rpc().withRpc(label, fn);
}

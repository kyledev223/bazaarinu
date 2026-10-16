// Route-handler helpers: JSON responses, error mapping, client IP and origin checks.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, errorBody } from "@/lib/errors";
import { redact } from "@/lib/solana/rpc";

/** JSON with bigint support (bigints become strings). */
export function json<T>(data: T, init: ResponseInit = {}): NextResponse {
  const body = JSON.stringify({ ok: true, ...data }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

function isPrismaConnectionError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : "";
  return /PrismaClientInitializationError|Can't reach database|ECONNREFUSED.*5432|connection.*terminated|P1001|P1002|P2024/i.test(msg);
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (isPrismaConnectionError(e)) return new AppError("db-unavailable", { cause: e });
  return new AppError("internal", { cause: e });
}

export function fail(e: unknown): NextResponse {
  const err = toAppError(e);
  if (err.code === "internal" || err.status >= 500) {
    const cause = err.cause instanceof Error ? err.cause.stack ?? err.cause.message : String(err.cause ?? "");
    console.error(`[api] ${err.code}: ${redact(err.detail ?? "")} ${redact(cause)}`);
  }
  const body = errorBody(err);
  if (body.error.detail) body.error.detail = redact(body.error.detail);
  return NextResponse.json(body, { status: err.status, headers: { "cache-control": "no-store" } });
}

/** Wrap a route handler so every thrown error becomes a coded JSON error. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return fail(e);
    }
  };
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

/** Hash IPs before storing them: rate limiting doesn't need the raw address. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${process.env.CRON_SECRET ?? "bazaar"}:${ip}`).digest("hex").slice(0, 32);
}

/** Refuse cross-site POSTs (cookie-authenticated routes). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; the session cookie is SameSite=Lax anyway
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new Error();
  } catch {
    throw new AppError("bad-request", { status: 403, message: "Cross-site request refused." });
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("bad-request", { message: "Request body too large." });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("bad-request", { message: "Request body must be JSON." });
  }
}

export function str(v: unknown, name: string, max = 2000): string {
  if (typeof v !== "string" || !v || v.length > max) throw new AppError("bad-request", { message: `Missing or invalid ${name}.` });
  return v;
}

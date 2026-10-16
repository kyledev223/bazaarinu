"use client";
// Browser-side fetch wrapper. Every API error becomes an ApiError carrying the
// server's short code (see src/lib/errors.ts) and a sentence to show.

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: string,
    public fields?: Record<string, string>,
    public status = 0,
  ) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("network", "Couldn't reach the site. Check your connection and try again.");
  }
  let body: { ok?: boolean; error?: { code: string; message: string; detail?: string; fields?: Record<string, string> } } & Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("internal", `The server answered with HTTP ${res.status}.`, undefined, undefined, res.status);
  }
  if (!res.ok || body.ok === false) {
    const e = body.error ?? { code: "internal", message: `HTTP ${res.status}` };
    throw new ApiError(e.code, e.message, e.detail, e.fields, res.status);
  }
  return body as T;
}

export const lamportsToSol = (l: string | number | bigint) => Number(l) / 1e9;

export function fmtSol(l: string | number | bigint, digits = 4) {
  return `${lamportsToSol(l).toLocaleString("en-US", { maximumFractionDigits: digits })} SOL`;
}

export const short = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k);

// The browser has no Buffer global; these keep transaction (de)serialisation plain.
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

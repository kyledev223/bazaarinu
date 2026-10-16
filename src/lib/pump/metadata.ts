// Upload the coin image + metadata JSON to IPFS.
//
// Two routes, both producing the URI that goes into create_v2 exactly as returned:
// - pump.fun's own endpoint (POST https://pump.fun/api/ipfs). Undocumented; in
//   October 2026 it answers server-side uploads with HTTP 500.
// - Pinata, pinning the image and then a pump-style metadata JSON, which is
//   what pump.fun's own create-coin guide recommends.
// With PINATA_JWT set, Pinata goes first and pump.fun is the fallback;
// without it, only pump.fun is tried. Each real attempt's outcome is kept in
// the KV table so /api/health can report it without uploading anything.
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { LaunchFields } from "@/lib/validation";
import type { NormalisedImage } from "@/lib/image";

export const PUMP_IPFS_URL = "https://pump.fun/api/ipfs";
const PINATA_UPLOAD = "https://uploads.pinata.cloud/v3/files";
const TIMEOUT = 25_000;

export interface UploadResult {
  metadataUri: string;
  imageUri: string;
  host: "pump.fun" | "pinata";
}

function form(fields: LaunchFields, img: NormalisedImage): FormData {
  const f = new FormData();
  f.append("file", new Blob([new Uint8Array(img.bytes)], { type: img.mime }), `image.${img.ext}`);
  f.append("name", fields.name);
  f.append("symbol", fields.symbol);
  f.append("description", fields.description);
  f.append("twitter", fields.twitter ?? "");
  f.append("telegram", fields.telegram ?? "");
  f.append("website", fields.website ?? "");
  f.append("showName", "true");
  return f;
}

async function viaPump(fields: LaunchFields, img: NormalisedImage): Promise<UploadResult> {
  const res = await fetch(PUMP_IPFS_URL, {
    method: "POST",
    body: form(fields, img),
    headers: { accept: "application/json", "user-agent": "BazaarInu/1.0 (+launchpad)" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`pump.fun ipfs ${res.status}: ${text.slice(0, 200)}`);
  let body: { metadataUri?: unknown; metadata?: { image?: unknown } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`pump.fun ipfs returned non-JSON (${res.status})`);
  }
  if (typeof body.metadataUri !== "string" || !/^https?:\/\//.test(body.metadataUri)) throw new Error("pump.fun ipfs: no metadataUri");
  return { metadataUri: body.metadataUri, imageUri: typeof body.metadata?.image === "string" ? body.metadata.image : "", host: "pump.fun" };
}

async function pinataUpload(jwt: string, blob: Blob, name: string): Promise<string> {
  const f = new FormData();
  f.append("file", blob, name);
  f.append("network", "public");
  f.append("name", name);
  const res = await fetch(PINATA_UPLOAD, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: f,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`pinata ${res.status}: ${text.slice(0, 200)}`);
  const cid = (JSON.parse(text) as { data?: { cid?: string } }).data?.cid;
  if (!cid) throw new Error("pinata: no cid");
  return cid;
}

export function gatewayUrl(cid: string): string {
  const gw = process.env.PINATA_GATEWAY?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return gw ? `https://${gw}/ipfs/${cid}` : `https://ipfs.io/ipfs/${cid}`;
}

async function viaPinata(jwt: string, fields: LaunchFields, img: NormalisedImage): Promise<UploadResult> {
  const imageCid = await pinataUpload(jwt, new Blob([new Uint8Array(img.bytes)], { type: img.mime }), `${fields.symbol}.${img.ext}`);
  const imageUri = gatewayUrl(imageCid);
  const metadata = {
    name: fields.name,
    symbol: fields.symbol,
    description: fields.description,
    image: imageUri,
    showName: true,
    createdOn: process.env.SITE_URL || "https://pump.fun",
    ...(fields.twitter ? { twitter: fields.twitter } : {}),
    ...(fields.telegram ? { telegram: fields.telegram } : {}),
    ...(fields.website ? { website: fields.website } : {}),
  };
  const metaCid = await pinataUpload(jwt, new Blob([JSON.stringify(metadata)], { type: "application/json" }), `${fields.symbol}.json`);
  return { metadataUri: gatewayUrl(metaCid), imageUri, host: "pinata" };
}

async function record(host: "pump.fun" | "pinata", ok: boolean, error?: string) {
  const value = { ok, at: new Date().toISOString(), ...(error ? { error: error.slice(0, 200) } : {}) };
  await db()
    .kV.upsert({ where: { key: `upload:${host}` }, create: { key: `upload:${host}`, value }, update: { value } })
    .catch(() => {});
}

export async function uploadMetadata(fields: LaunchFields, img: NormalisedImage): Promise<UploadResult> {
  const jwt = process.env.PINATA_JWT;
  const routes: { host: "pump.fun" | "pinata"; run: () => Promise<UploadResult> }[] = [
    { host: "pump.fun", run: () => viaPump(fields, img) },
  ];
  if (jwt) routes.unshift({ host: "pinata", run: () => viaPinata(jwt, fields, img) });
  const errors: string[] = [];
  for (const r of routes) {
    try {
      const out = await r.run();
      await record(r.host, true);
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${r.host}: ${msg}`);
      console.warn(`[metadata] ${r.host} upload failed: ${msg.slice(0, 200)}`);
      await record(r.host, false, msg);
    }
  }
  if (!jwt) errors.push("PINATA_JWT not set, so there is no fallback");
  throw new AppError("upload-failed", { detail: errors.join(" · ").slice(0, 600) });
}

/** Health: is the Pinata JWT valid? (Read-only call; uploads nothing.) */
export async function pinataAuthOk(): Promise<{ ok: boolean; detail: string }> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return { ok: false, detail: "PINATA_JWT not set" };
  try {
    const res = await fetch("https://api.pinata.cloud/data/testAuthentication", { headers: { authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(8_000) });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Health: the outcome of the last real upload attempt per route. */
export async function lastUploads(): Promise<Record<string, { ok: boolean; at: string; error?: string } | null>> {
  const rows = await db().kV.findMany({ where: { key: { in: ["upload:pump.fun", "upload:pinata"] } } }).catch(() => []);
  const get = (k: string) => (rows.find((r) => r.key === k)?.value as { ok: boolean; at: string; error?: string } | undefined) ?? null;
  return { "pump.fun": get("upload:pump.fun"), pinata: get("upload:pinata") };
}

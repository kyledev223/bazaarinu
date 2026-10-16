// Launch form validation, shared by the browser (instant feedback) and the
// server (the authority). Returns normalised values or per-field errors.
import { LIMITS } from "@/config/site";
import { BANNED_SUBSTRINGS, BANNED_WORDS } from "@/config/banned-words";

export interface LaunchFields {
  name: string;
  symbol: string;
  description: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  devBuySol: number;
}

export type FieldErrors = Partial<Record<keyof LaunchFields | "image", string>>;

export type Validated = { ok: true; value: LaunchFields } | { ok: false; errors: FieldErrors };

// Control characters and zero-width/bidi characters that can disguise a name.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

export function cleanText(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanMultiline(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function findBannedWord(text: string): string | null {
  const lower = text.toLowerCase();
  for (const sub of BANNED_SUBSTRINGS) if (lower.replace(/[^a-z0-9]/g, "").includes(sub)) return sub;
  const words = ` ${lower.replace(/[^a-z0-9]+/g, " ")} `;
  for (const w of BANNED_WORDS) if (words.includes(` ${w} `)) return w;
  return null;
}

function normaliseHandleUrl(raw: string, hosts: string[], base: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^@?[A-Za-z0-9_]{1,32}$/.test(v)) return `${base}/${v.replace(/^@/, "")}`;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!hosts.includes(host)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!/^\/[A-Za-z0-9_+/-]{1,64}$/.test(path)) return null;
  return `https://${host}${path}`;
}

export function normaliseTwitter(raw: string): string | null {
  return normaliseHandleUrl(raw, ["x.com", "twitter.com"], "https://x.com");
}

export function normaliseTelegram(raw: string): string | null {
  return normaliseHandleUrl(raw, ["t.me", "telegram.me"], "https://t.me");
}

export function normaliseWebsite(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") || u.username || u.password) return null;
    if (u.toString().length > 200) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function validateLaunch(input: Record<string, unknown>): Validated {
  const errors: FieldErrors = {};
  const name = cleanText(input.name);
  const symbol = cleanText(input.symbol).replace(/^\$/, "").toUpperCase();
  const description = cleanMultiline(input.description);

  if (!name) errors.name = "Give your coin a name.";
  else if ([...name].length > LIMITS.nameMax) errors.name = `Keep the name to ${LIMITS.nameMax} characters.`;

  if (!symbol) errors.symbol = "Add a ticker.";
  else if (!/^[A-Z0-9]+$/.test(symbol)) errors.symbol = "Tickers use letters A–Z and digits only.";
  else if (symbol.length > LIMITS.symbolMax) errors.symbol = `Keep the ticker to ${LIMITS.symbolMax} characters.`;

  if ([...description].length > LIMITS.descriptionMax) errors.description = `Keep the description under ${LIMITS.descriptionMax} characters.`;

  for (const [field, text] of [["name", name], ["symbol", symbol], ["description", description]] as const) {
    const hit = text && findBannedWord(text);
    if (hit && !errors[field]) errors[field] = `"${hit}" isn't allowed here. It's often used to impersonate projects or for scams.`;
  }

  const out: LaunchFields = { name, symbol, description, devBuySol: 0 };

  const tw = cleanText(input.twitter);
  if (tw) {
    const n = normaliseTwitter(tw);
    if (n) out.twitter = n;
    else errors.twitter = "Use an x.com link or an @handle.";
  }
  const tg = cleanText(input.telegram);
  if (tg) {
    const n = normaliseTelegram(tg);
    if (n) out.telegram = n;
    else errors.telegram = "Use a t.me link or an @handle.";
  }
  const web = cleanText(input.website);
  if (web) {
    const n = normaliseWebsite(web);
    if (n) out.website = n;
    else errors.website = "Use a full web address, like https://example.com.";
  }

  const rawBuy = input.devBuySol;
  const devBuy = rawBuy === undefined || rawBuy === null || rawBuy === "" ? 0 : Number(rawBuy);
  if (!Number.isFinite(devBuy) || devBuy < 0) errors.devBuySol = "Enter a SOL amount, or 0 for no dev buy.";
  else if (devBuy > LIMITS.devBuyMaxSol) errors.devBuySol = `The dev buy is capped at ${LIMITS.devBuyMaxSol} SOL here.`;
  else if (devBuy > 0 && devBuy < 0.001) errors.devBuySol = "The smallest dev buy is 0.001 SOL.";
  else out.devBuySol = Math.round(devBuy * 1e9) / 1e9;

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out };
}

/** Image type sniffing by magic bytes. The client-declared MIME type is never trusted. */
export function sniffImage(bytes: Uint8Array): "png" | "jpeg" | "webp" | "gif" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return "webp";
  return null;
}

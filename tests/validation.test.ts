import { describe, expect, it } from "vitest";
import { findBannedWord, normaliseTelegram, normaliseTwitter, normaliseWebsite, sniffImage, validateLaunch } from "@/lib/validation";

const ok = { name: "Shiba Shop", symbol: "SHOP", description: "A friendly stall." };

describe("validateLaunch", () => {
  it("accepts and normalises a good form", () => {
    const r = validateLaunch({ ...ok, symbol: "$shop", twitter: "@bazaarinu", telegram: "t.me/bazaar", website: "example.com", devBuySol: "0.25" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.symbol).toBe("SHOP");
      expect(r.value.twitter).toBe("https://x.com/bazaarinu");
      expect(r.value.telegram).toBe("https://t.me/bazaar");
      expect(r.value.website).toBe("https://example.com/");
      expect(r.value.devBuySol).toBe(0.25);
    }
  });

  it("enforces name ≤ 32 and ticker ≤ 10, A–Z0–9", () => {
    const long = validateLaunch({ ...ok, name: "x".repeat(33) });
    expect(!long.ok && long.errors.name).toBeTruthy();
    expect(validateLaunch({ ...ok, name: "x".repeat(32) }).ok).toBe(true);
    const sym = validateLaunch({ ...ok, symbol: "ABCDEFGHIJK" });
    expect(!sym.ok && sym.errors.symbol).toMatch(/10/);
    const bad = validateLaunch({ ...ok, symbol: "AB-C" });
    expect(!bad.ok && bad.errors.symbol).toMatch(/A–Z/);
  });

  it("strips invisible characters before counting", () => {
    const r = validateLaunch({ ...ok, name: "Shi​ba‮" });
    expect(r.ok && r.value.name).toBe("Shiba");
  });

  it("caps the description", () => {
    const r = validateLaunch({ ...ok, description: "a".repeat(501) });
    expect(!r.ok && r.errors.description).toBeTruthy();
  });

  it("refuses banned words in any text field", () => {
    expect(validateLaunch({ ...ok, name: "Official Airdrop" }).ok).toBe(false);
    expect(validateLaunch({ ...ok, description: "send your seed phrase" }).ok).toBe(false);
    expect(findBannedWord("claimable rewards")).toBeNull(); // whole words only
  });

  it("validates social links", () => {
    expect(normaliseTwitter("https://twitter.com/bazaar_inu/")).toBe("https://twitter.com/bazaar_inu");
    expect(normaliseTwitter("https://evil.com/x")).toBeNull();
    expect(normaliseTelegram("https://t.me/+invite123")).toBe("https://t.me/+invite123");
    expect(normaliseWebsite("javascript:alert(1)")).toBeNull();
    expect(normaliseWebsite("https://user:pass@example.com")).toBeNull();
    const r = validateLaunch({ ...ok, twitter: "not a link at all" });
    expect(!r.ok && r.errors.twitter).toBeTruthy();
  });

  it("validates the dev buy", () => {
    expect(validateLaunch({ ...ok, devBuySol: "" }).ok).toBe(true);
    expect(!validateLaunch({ ...ok, devBuySol: -1 }).ok).toBe(true);
    expect(!validateLaunch({ ...ok, devBuySol: 50 }).ok).toBe(true);
    expect(!validateLaunch({ ...ok, devBuySol: "abc" }).ok).toBe(true);
    expect(!validateLaunch({ ...ok, devBuySol: 0.0001 }).ok).toBe(true);
  });
});

describe("sniffImage", () => {
  it("detects by magic bytes", () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a......"))).toBe("gif");
    expect(sniffImage(new TextEncoder().encode("<svg onload=x>"))).toBeNull();
  });
});

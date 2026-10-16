// Public, non-secret settings. Safe to import from client components.
export const SITE = {
  name: "Bazaar Inu",
  short: "INU",
  tagline: "Launch a coin. Open a stall.",
  // Set these once the official accounts / token exist (see docs/LAUNCH.md, "Places to customise").
  xHandle: process.env.NEXT_PUBLIC_X_HANDLE || "bazaarinufun",
  officialMint: process.env.NEXT_PUBLIC_OFFICIAL_MINT || "",
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL || "",
} as const;

// Header buttons. Set NEXT_PUBLIC_X_URL / NEXT_PUBLIC_PUMP_URL (or the handle / official mint
// above) in Vercel and redeploy; until then they point at the sites' home pages.
export const SOCIAL = {
  x: process.env.NEXT_PUBLIC_X_URL || (SITE.xHandle ? `https://x.com/${SITE.xHandle}` : "https://x.com"),
  pump: process.env.NEXT_PUBLIC_PUMP_URL || (SITE.officialMint ? `https://pump.fun/coin/${SITE.officialMint}` : "https://pump.fun"),
} as const;

export const LIMITS = {
  nameMax: 32,
  symbolMax: 10,
  descriptionMax: 500,
  imageMaxBytes: 4 * 1024 * 1024,
  // Largest dev buy the form accepts, in SOL.
  devBuyMaxSol: 5,
  buybackMinSol: 0.001,
  buybackMaxSol: 10,
} as const;

export const EXPLORER = {
  account: (a: string) => `https://solscan.io/account/${a}`,
  token: (m: string) => `https://solscan.io/token/${m}`,
  tx: (s: string) => `https://solscan.io/tx/${s}`,
  pump: (m: string) => `https://pump.fun/coin/${m}`,
};

export const WALLET_LINKS = {
  Phantom: "https://phantom.com/download",
  Solflare: "https://solflare.com/download",
  Backpack: "https://backpack.app/downloads",
  "OKX Wallet": "https://web3.okx.com/download",
} as const;

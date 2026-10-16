import type { NextConfig } from "next";

// The pump SDKs and Anchor are loaded with Node's own require() (see
// src/lib/pump/load.ts). Bundling them breaks Anchor's BN export, so they stay
// external, and their files are traced into every route that builds or checks
// pump transactions.
const PUMP_PACKAGES = ["@pump-fun/pump-sdk", "@pump-fun/pump-swap-sdk", "@coral-xyz/anchor"];
const PUMP_TRACE = [
  "./node_modules/@pump-fun/**/*",
  "./node_modules/@coral-xyz/anchor/**/*",
  "./node_modules/@coral-xyz/borsh/**/*",
  "./node_modules/@solana/spl-token/**/*",
];

const nextConfig: NextConfig = {
  serverExternalPackages: [...PUMP_PACKAGES, "sharp"],
  outputFileTracingIncludes: {
    "/api/launch/**": PUMP_TRACE,
    "/api/buyback/**": PUMP_TRACE,
    "/api/fees/**": PUMP_TRACE,
    "/api/cron": PUMP_TRACE,
    "/api/health": PUMP_TRACE,
    "/api/coins/**": PUMP_TRACE,
    "/api/my/**": PUMP_TRACE,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ipfs.io" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "**.mypinata.cloud" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
    ],
  },
};

export default nextConfig;

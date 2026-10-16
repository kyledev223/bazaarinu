import { Connection, Keypair } from "@solana/web3.js";
import { databaseUrl, db } from "@/lib/db";
import { json } from "@/lib/http";
import { pumpSdk, pumpSdkVersion } from "@/lib/pump/load";
import { lastUploads, pinataAuthOk } from "@/lib/pump/metadata";
import { fetchSolPrice } from "@/lib/price";
import { geckoReachable } from "@/lib/backtest/history";
import { hostOf, redact, rpcEndpoints, PUBLIC_MAINNET_RPC } from "@/lib/solana/rpc";
import { jobStates } from "@/lib/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Check {
  ok: boolean;
  ms: number;
  detail?: string;
}

async function timed(fn: () => Promise<string | void>): Promise<Check> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, detail: redact(e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);

export async function GET() {
  const hints: string[] = [];
  const endpoints = rpcEndpoints();

  const env = {
    DATABASE_URL: !!databaseUrl(),
    SOLANA_RPC_URL: !!process.env.SOLANA_RPC_URL,
    SITE_URL: !!process.env.SITE_URL,
    CRON_SECRET: (process.env.CRON_SECRET ?? "").length >= 16,
    PINATA_JWT: !!process.env.PINATA_JWT,
    COINGECKO_API_KEY: !!process.env.COINGECKO_API_KEY,
    BIRDEYE_API_KEY: !!process.env.BIRDEYE_API_KEY,
  };

  const [database, rpc, sdk, uploads, price, history, jobs] = await Promise.all([
    timed(async () => {
      await withTimeout(db().$queryRaw`SELECT 1`, 8_000);
    }),
    Promise.all(
      endpoints.map(async (url) => ({
        host: hostOf(url),
        ...(await timed(async () => {
          const c = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
          const { blockhash } = await withTimeout(c.getLatestBlockhash(), 8_000);
          return `blockhash ${blockhash.slice(0, 8)}…`;
        })),
      })),
    ),
    timed(async () => {
      const s = pumpSdk();
      const k = Keypair.generate().publicKey;
      const ix = await s.PUMP_SDK.createV2Instruction({ mint: Keypair.generate().publicKey, name: "Health", symbol: "HLTH", uri: "https://example.com/m.json", creator: k, user: k, mayhemMode: false });
      return `@pump-fun/pump-sdk ${pumpSdkVersion()}, create_v2 with ${ix.keys.length} accounts`;
    }),
    timed(async () => {
      const [pinata, last] = await Promise.all([pinataAuthOk(), lastUploads()]);
      const pump = last["pump.fun"];
      const pumpRecent = !!pump?.ok && Date.now() - Date.parse(pump.at) < 24 * 3600_000;
      const summary = `pinata: ${pinata.detail}; pump.fun last upload: ${pump ? `${pump.ok ? "ok" : "failed"} ${pump.at}${pump.error ? ` (${pump.error.slice(0, 80)})` : ""}` : "never tried"}`;
      if (!pinata.ok && !pumpRecent) throw new Error(summary);
      return summary;
    }),
    timed(async () => {
      const p = await fetchSolPrice();
      return `$${p.usd.toFixed(2)} from ${p.source}`;
    }),
    timed(async () => {
      if (!(await geckoReachable())) throw new Error("unexpected response");
      return "geckoterminal";
    }),
    jobStates().catch(() => [] as Awaited<ReturnType<typeof jobStates>>),
  ]);

  const rpcOk = rpc.some((r) => r.ok);
  const privateRpcOk = rpc.some((r) => r.ok && !PUBLIC_MAINNET_RPC.includes(r.host));

  if (!env.DATABASE_URL) hints.push("DATABASE_URL is not set. Add it in Vercel → Project → Settings → Environment Variables and redeploy.");
  else if (!database.ok) hints.push("The database didn't answer. Check DATABASE_URL (use the pooled connection string) and that migrations ran (vercel-build runs prisma migrate deploy).");
  if (!env.SOLANA_RPC_URL) hints.push("SOLANA_RPC_URL is not set, so only the public RPC is used. It rate-limits and often blocks Vercel; add a Helius URL.");
  if (!rpcOk) hints.push("No RPC endpoint answered. Check SOLANA_RPC_URL and your provider's dashboard.");
  else if (env.SOLANA_RPC_URL && !privateRpcOk) hints.push("Your private RPC endpoint failed; only the public fallback works. Check the Helius key and plan limits.");
  if (!sdk.ok) hints.push("The pump SDK didn't load or couldn't build a create instruction. Check next.config.ts serverExternalPackages / outputFileTracingIncludes and the uuid override.");
  if (!uploads.ok && !env.PINATA_JWT)
    hints.push("No working metadata upload: PINATA_JWT isn't set and pump.fun's own upload hasn't succeeded recently (it currently answers server uploads with HTTP 500). Add a Pinata JWT.");
  else if (!uploads.ok) hints.push("PINATA_JWT is set but Pinata rejected it. Create a new JWT with file upload permission.");
  if (!price.ok) hints.push("No SOL price source answered (CoinGecko, Coinbase, Kraken). USD values will be missing until one recovers.");
  if (!history.ok) hints.push("GeckoTerminal didn't answer; the strategy backtester may fail. Set BIRDEYE_API_KEY for a fallback.");
  if (!env.SITE_URL) hints.push("SITE_URL is not set. Set it to your public URL (e.g. https://yourdomain.com) so sign-in messages name the right domain.");
  if (!env.CRON_SECRET) hints.push("CRON_SECRET is missing or shorter than 16 characters, so /api/cron is disabled.");

  const tick = jobs.find((j) => j.name === "tick");
  const lastTick = tick?.lastRunAt ? Date.now() - tick.lastRunAt.getTime() : null;
  if (database.ok && (lastTick === null || lastTick > 36 * 3600_000))
    hints.push("Background jobs haven't run recently. They run on page visits and from /api/cron; check the Vercel cron or add an external pinger.");
  for (const j of jobs) if (j.lastError && j.name !== "tick") hints.push(`Background job "${j.name}" last failed: ${j.lastError}`);

  const ok = env.DATABASE_URL && database.ok && rpcOk && sdk.ok && uploads.ok;
  return json(
    {
      ok,
      checks: {
        database,
        rpc,
        pumpSdk: sdk,
        metadataUpload: uploads,
        solPrice: price,
        priceHistory: history,
      },
      jobs: jobs.map((j) => ({ name: j.name, lastRunAt: j.lastRunAt, lastOkAt: j.lastOkAt, lastError: j.lastError, lastDurationMs: j.lastDurationMs })),
      env,
      node: process.version,
      hints,
    },
    { status: ok ? 200 : 503 },
  );
}

import { getHistory, MARKETS, PAIRS, type MarketId, type PairId } from "@/lib/backtest/history";
import { AppError } from "@/lib/errors";
import { clientIp, hashIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const market = q.get("market") as MarketId;
  const pair = q.get("pair") as PairId;
  if (!MARKETS.some((m) => m.id === market) || !PAIRS.some((p) => p.id === pair)) throw new AppError("bad-request", { message: "Unknown market or pair." });
  await rateLimit("backtest", hashIp(clientIp(req)));
  return json({ history: await getHistory(market, pair, Number(q.get("days") ?? 30)) });
});

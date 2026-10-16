import { walletAddress } from "@/lib/wallet";
import { clientIp, hashIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { claimableFor } from "@/lib/intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route(async (req: Request) => {
  const wallet = walletAddress(new URL(req.url).searchParams.get("wallet"));
  await rateLimit("balance", hashIp(clientIp(req)));
  return json(await claimableFor(wallet));
});

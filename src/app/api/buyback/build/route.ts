import { assertSameOrigin, clientIp, hashIp, json, readJson, route } from "@/lib/http";
import { buildBuyback } from "@/lib/intents";
import { rateLimit } from "@/lib/ratelimit";
import { walletAddress } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ mint?: string; sol?: number; wallet?: string }>(req);
  const wallet = walletAddress(body.wallet);
  // Keyed on IP: the wallet address is whatever the browser sends, so a per-wallet limit could be used against someone else.
  await rateLimit("build", hashIp(clientIp(req)));
  return json(await buildBuyback(wallet, body.mint, body.sol));
});

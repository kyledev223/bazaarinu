import { assertSameOrigin, clientIp, hashIp, json, readJson, route, str } from "@/lib/http";
import { relayIntent } from "@/lib/intents";
import { rateLimit } from "@/lib/ratelimit";
import { walletAddress } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ intentId?: string; tx?: string; wallet?: string }>(req);
  const wallet = walletAddress(body.wallet);
  // Keyed on IP: the wallet address is whatever the browser sends, so a per-wallet limit could be used against someone else.
  await rateLimit("relay", hashIp(clientIp(req)));
  return json(await relayIntent(str(body.intentId, "intentId", 40), body.tx, wallet, "buyback"));
});

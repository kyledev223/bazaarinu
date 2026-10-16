import { requireSession } from "@/lib/auth";
import { assertSameOrigin, json, readJson, route, str } from "@/lib/http";
import { relayIntent } from "@/lib/intents";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ intentId?: string; tx?: string; wallet?: string }>(req);
  const session = await requireSession(body.wallet);
  await rateLimit("relay", session.wallet);
  return json(await relayIntent(str(body.intentId, "intentId", 40), body.tx, session.wallet, "claim"));
});

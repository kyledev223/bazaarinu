import { requireSession } from "@/lib/auth";
import { assertSameOrigin, json, readJson, route, str } from "@/lib/http";
import { relayLaunch } from "@/lib/launch/service";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ launchId?: string; tx?: string; wallet?: string }>(req);
  const session = await requireSession(body.wallet);
  await rateLimit("relay", session.wallet);
  return json(await relayLaunch(str(body.launchId, "launchId", 40), body.tx, session.wallet));
});

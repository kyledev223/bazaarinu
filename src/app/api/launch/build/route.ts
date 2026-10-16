import { requireSession } from "@/lib/auth";
import { assertSameOrigin, json, readJson, route, str } from "@/lib/http";
import { buildLaunch } from "@/lib/launch/service";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ launchId?: string; mint?: string; wallet?: string }>(req);
  const session = await requireSession(body.wallet);
  await rateLimit("build", session.wallet);
  return json(await buildLaunch(str(body.launchId, "launchId", 40), body.mint, session.wallet));
});

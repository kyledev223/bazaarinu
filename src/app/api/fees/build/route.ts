import { requireSession } from "@/lib/auth";
import { assertSameOrigin, json, readJson, route } from "@/lib/http";
import { buildClaim } from "@/lib/intents";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ wallet?: string }>(req);
  const session = await requireSession(body.wallet);
  await rateLimit("build", session.wallet);
  return json(await buildClaim(session.wallet));
});

import { requireSession } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { claimableFor } from "@/lib/intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route(async () => {
  const session = await requireSession();
  return json(await claimableFor(session.wallet));
});

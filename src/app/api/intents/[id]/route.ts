import { requireSession } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { intentStatus } from "@/lib/intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const session = await requireSession();
  return json(await intentStatus(id, session.wallet));
});

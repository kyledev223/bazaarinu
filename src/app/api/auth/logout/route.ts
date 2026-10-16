import { endSession } from "@/lib/auth";
import { assertSameOrigin, json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  await endSession();
  return json({});
});

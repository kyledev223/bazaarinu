import { getSession } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await getSession();
  return json({ wallet: s?.wallet ?? null });
});

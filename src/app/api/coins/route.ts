import { after } from "next/server";
import { listCoins } from "@/lib/coins";
import { json, route } from "@/lib/http";
import { maybeTick } from "@/lib/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  after(maybeTick);
  return json(await listCoins());
});

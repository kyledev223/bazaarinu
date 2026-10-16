import { after } from "next/server";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { finalizeLaunch } from "@/lib/launch/service";
import { maybeTick } from "@/lib/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The launching browser polls this. Each poll also tries to finalize, so a
// launch completes even if cron never runs.
export const GET = route(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AppError("bad-request", { message: "Missing id." });
  const status = await finalizeLaunch(id);
  after(maybeTick);
  return json(status);
});

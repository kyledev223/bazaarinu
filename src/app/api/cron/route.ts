import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { runTick } from "@/lib/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const query = new URL(req.url).searchParams.get("secret") ?? "";
  const given = header || query;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Vercel cron sends "Authorization: Bearer $CRON_SECRET". External pingers can use ?secret=.
async function handle(req: Request) {
  if (!authorised(req)) throw new AppError("bad-request", { status: 401, message: "Missing or wrong CRON_SECRET." });
  return json(await runTick());
}

export const GET = route(handle);
export const POST = route(handle);

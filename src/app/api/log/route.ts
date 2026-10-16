import { launchLog } from "@/lib/coins";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => json({ lines: await launchLog(30) }));

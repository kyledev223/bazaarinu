import { getCoin } from "@/lib/coins";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  const data = await getCoin(mint);
  if (!data) throw new AppError("coin-not-found");
  return json(data);
});

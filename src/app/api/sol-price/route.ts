import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { getSolPrice } from "@/lib/price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const p = await getSolPrice();
  if (!p) throw new AppError("price-unavailable");
  return json(p);
});

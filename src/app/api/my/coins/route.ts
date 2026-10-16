import { walletAddress } from "@/lib/wallet";
import { listCoins } from "@/lib/coins";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const wallet = walletAddress(new URL(req.url).searchParams.get("wallet"));
  const [list, launches] = await Promise.all([
    listCoins({ creator: wallet, limit: 100 }),
    db().launch.findMany({
      where: { wallet: wallet, status: { in: ["prepared", "built", "submitted", "failed"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, symbol: true, status: true, reason: true, createdAt: true, signature: true },
    }),
  ]);
  return json({ ...list, launches });
});

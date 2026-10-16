import { parseWallet } from "@/lib/wallet";
import { clientIp, hashIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { withRpc } from "@/lib/solana/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser reads the balance through here so it never needs its own RPC endpoint.
export const GET = route(async (req: Request) => {
  const wallet = parseWallet(new URL(req.url).searchParams.get("address"));
  await rateLimit("balance", hashIp(clientIp(req)));
  const lamports = await withRpc("balance", (c) => c.getBalance(wallet, "confirmed"));
  return json({ lamports });
});

import { createNonce, parseWallet } from "@/lib/auth";
import { assertSameOrigin, clientIp, hashIp, json, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ wallet?: string }>(req);
  const wallet = parseWallet(body.wallet).toBase58();
  await rateLimit("nonce", hashIp(clientIp(req)));
  const domain = process.env.SITE_URL ? new URL(process.env.SITE_URL).host : (req.headers.get("host") ?? "localhost");
  return json(await createNonce(wallet, domain));
});

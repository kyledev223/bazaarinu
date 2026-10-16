import { completeSignIn, parseWallet, setSessionCookie } from "@/lib/auth";
import { assertSameOrigin, json, readJson, route, str } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson<{ wallet?: string; nonce?: string; signature?: string }>(req);
  const wallet = parseWallet(body.wallet);
  const token = await completeSignIn(wallet, str(body.nonce, "nonce", 64), str(body.signature, "signature", 120));
  await setSessionCookie(token);
  return json({ wallet: wallet.toBase58() });
});

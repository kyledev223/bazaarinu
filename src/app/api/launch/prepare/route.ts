import { requireSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, clientIp, hashIp, json, route } from "@/lib/http";
import { prepareLaunch } from "@/lib/launch/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 6 * 1024 * 1024) throw new AppError("validation", { fields: { image: "Images must be under 4 MB." } });
  const form = await req.formData().catch(() => {
    throw new AppError("bad-request", { message: "Send the form as multipart/form-data." });
  });
  const session = await requireSession(String(form.get("wallet") ?? "") || null);
  return json(await prepareLaunch(form, session.wallet, hashIp(clientIp(req))));
});

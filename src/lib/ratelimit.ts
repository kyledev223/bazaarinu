// Fixed-window rate limits stored in Postgres, so they hold across serverless instances.
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const RATE_LIMITS = {
  // Prepare uploads an image and pins metadata: the expensive one.
  prepareWallet: { limit: 6, windowSec: 3600 },
  prepareIp: { limit: 12, windowSec: 3600 },
  build: { limit: 40, windowSec: 600 },
  relay: { limit: 30, windowSec: 600 },
  nonce: { limit: 20, windowSec: 600 },
  balance: { limit: 60, windowSec: 60 },
  backtest: { limit: 30, windowSec: 60 },
} as const;

export type LimitName = keyof typeof RATE_LIMITS;

/** Count one hit; throws rate-limited once the window's limit is passed. */
export async function rateLimit(name: LimitName, subject: string): Promise<void> {
  const { limit, windowSec } = RATE_LIMITS[name];
  const key = `${name}:${subject}`;
  const rows = await db().$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}) THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) {
    throw new AppError("rate-limited", { detail: `${name} limit is ${limit} per ${Math.round(windowSec / 60)} min` });
  }
}

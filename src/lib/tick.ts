// Background work behind one DB lock. Triggered by /api/cron (Vercel cron or
// any external pinger), by after() on page loads, and by status polls. Each
// job records when it last ran and whether it worked, for /api/health.
import { db } from "@/lib/db";
import { expireStaleDrafts, finalizeLaunch } from "@/lib/launch/service";
import { refreshCoinStats, refreshHolders, refreshTrades } from "@/lib/market";
import { refreshSolPrice } from "@/lib/price";
import { finalizeIntents } from "@/lib/intents";
import { redact } from "@/lib/solana/rpc";

const LOCK = "tick";
const LOCK_SECONDS = 120;
const MIN_INTERVAL_MS = 45_000;

export const JOBS = ["finalize", "intents", "price", "stats", "trades", "holders", "cleanup"] as const;
export type JobName = (typeof JOBS)[number];

async function acquire(): Promise<boolean> {
  await db().$executeRaw`INSERT INTO "JobState" ("name") VALUES (${LOCK}) ON CONFLICT ("name") DO NOTHING`;
  const rows = await db().$queryRaw<{ name: string }[]>`
    UPDATE "JobState" SET "lockedUntil" = now() + make_interval(secs => ${LOCK_SECONDS})
    WHERE "name" = ${LOCK} AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
    RETURNING "name"`;
  return rows.length === 1;
}

async function release(ok: boolean, ms: number, error?: string) {
  await db().jobState.update({
    where: { name: LOCK },
    data: { lockedUntil: null, lastRunAt: new Date(), lastDurationMs: ms, ...(ok ? { lastOkAt: new Date(), lastError: null } : { lastError: error }) },
  });
}

async function job(name: JobName, fn: () => Promise<unknown>): Promise<{ name: JobName; ok: boolean; result?: unknown; error?: string; ms: number }> {
  const t = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t;
    await db().jobState.upsert({
      where: { name },
      create: { name, lastRunAt: new Date(), lastOkAt: new Date(), lastDurationMs: ms },
      update: { lastRunAt: new Date(), lastOkAt: new Date(), lastDurationMs: ms, lastError: null },
    });
    return { name, ok: true, result, ms };
  } catch (e) {
    const ms = Date.now() - t;
    const error = redact(e instanceof Error ? `${(e as { code?: string }).code ?? e.name}: ${e.message}` : String(e)).slice(0, 500);
    console.warn(`[tick] ${name} failed: ${error}`);
    await db().jobState
      .upsert({ where: { name }, create: { name, lastRunAt: new Date(), lastError: error, lastDurationMs: ms }, update: { lastRunAt: new Date(), lastError: error, lastDurationMs: ms } })
      .catch(() => {});
    return { name, ok: false, error, ms };
  }
}

export interface TickReport {
  ran: boolean;
  reason?: string;
  jobs?: Awaited<ReturnType<typeof job>>[];
}

export async function runTick(): Promise<TickReport> {
  if (!(await acquire())) return { ran: false, reason: "another tick is running" };
  const started = Date.now();
  const jobs: Awaited<ReturnType<typeof job>>[] = [];
  try {
    jobs.push(
      await job("finalize", async () => {
        const pending = await db().launch.findMany({ where: { status: "submitted" }, select: { id: true }, orderBy: { submittedAt: "asc" }, take: 20 });
        for (const p of pending) await finalizeLaunch(p.id).catch((e) => console.warn(`[tick] finalize ${p.id}: ${e}`));
        return { pending: pending.length, expiredDrafts: await expireStaleDrafts() };
      }),
    );
    jobs.push(await job("intents", () => finalizeIntents()));
    jobs.push(await job("price", () => refreshSolPrice()));
    jobs.push(await job("stats", () => refreshCoinStats(100)));
    jobs.push(await job("trades", () => refreshTrades(5, 20)));
    jobs.push(await job("holders", () => refreshHolders(3)));
    jobs.push(
      await job("cleanup", async () => {
        const now = new Date();
        const [n, s, r] = await Promise.all([
          db().authNonce.deleteMany({ where: { expiresAt: { lt: now } } }),
          db().session.deleteMany({ where: { expiresAt: { lt: now } } }),
          db().rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } } }),
        ]);
        return { nonces: n.count, sessions: s.count, rateLimits: r.count };
      }),
    );
    await release(jobs.every((j) => j.ok), Date.now() - started, jobs.filter((j) => !j.ok).map((j) => `${j.name}: ${j.error}`).join("; ") || undefined);
  } catch (e) {
    await release(false, Date.now() - started, redact(String(e))).catch(() => {});
    throw e;
  }
  return { ran: true, jobs };
}

/** For after() on page loads: run only if the last tick is old enough. Never throws. */
export async function maybeTick(): Promise<void> {
  try {
    const s = await db().jobState.findUnique({ where: { name: LOCK } });
    if (s?.lastRunAt && Date.now() - s.lastRunAt.getTime() < MIN_INTERVAL_MS) return;
    if (s?.lockedUntil && s.lockedUntil > new Date()) return;
    await runTick();
  } catch (e) {
    console.warn(`[tick] background run failed: ${redact(String(e))}`);
  }
}

export async function jobStates() {
  return db().jobState.findMany({ orderBy: { name: "asc" } });
}

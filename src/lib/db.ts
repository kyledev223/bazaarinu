import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

const g = globalThis as unknown as { __prisma?: PrismaClient };

function create(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new AppError("db-unavailable", { detail: "DATABASE_URL is not set" });
  // Serverless: keep the pool tiny. Use the provider's pooled connection string in production.
  const adapter = new PrismaPg({ connectionString: url, max: 3, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 10_000 });
  return new PrismaClient({ adapter });
}

export function db(): PrismaClient {
  return (g.__prisma ??= create());
}

export type { PrismaClient };

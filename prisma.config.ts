import "dotenv/config";
import { defineConfig } from "prisma/config";
import { DB_SCHEMA } from "./src/config/db-schema";

// Migrations prefer a direct (non-pooled) connection. These are the names our docs use,
// plus the ones the Vercel ↔ Neon integration sets automatically.
const url =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

// `prisma generate` runs on postinstall before any database exists and needs no connection.
// Anything that talks to the database (migrate deploy, etc.) must fail loudly instead of
// silently trying localhost.
const needsDb = process.argv.some((a) => ["migrate", "db", "studio"].includes(a));
if (!url && needsDb) {
  throw new Error(
    "No database URL found. Set DATABASE_URL (Vercel → Project → Settings → Environment Variables, " +
      "or connect Neon under Storage), make sure it's enabled for this environment, then redeploy.",
  );
}

/** Point migrations at Bazaar Inu's own schema (created on first deploy). */
function withSchema(u: string): string {
  const parsed = new URL(u);
  parsed.searchParams.set("schema", DB_SCHEMA);
  return parsed.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: withSchema(url ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder") },
});

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // The CLI (migrate deploy) prefers the direct, non-pooled connection when one is given;
  // the app itself always uses DATABASE_URL (src/lib/db.ts). `prisma generate` runs on
  // postinstall before any env is set, so fall back to a placeholder.
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});

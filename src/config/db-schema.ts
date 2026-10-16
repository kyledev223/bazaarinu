// Bazaar Inu keeps all of its tables in this Postgres schema, so it can share a
// database with other apps without name collisions (their tables stay in
// "public"). Used by the Prisma client (src/lib/db.ts), migrations
// (prisma.config.ts) and the few raw SQL queries. No imports: prisma.config.ts loads it.
export const DB_SCHEMA = "bazaar";

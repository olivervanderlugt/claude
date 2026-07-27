import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton.
 *
 * Next.js dev mode hot-reloads modules, which would otherwise open a new
 * connection pool on every save until Postgres refuses new connections. Stashing
 * the client on `globalThis` keeps one pool across reloads.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

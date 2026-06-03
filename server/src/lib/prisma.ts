import { PrismaClient } from "@prisma/client";

// Shared Prisma instance. Importing from here ensures the whole server uses
// a single connection pool. Hot-reload safety: in development, vitest and
// tsx may re-import modules, so we cache on globalThis.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

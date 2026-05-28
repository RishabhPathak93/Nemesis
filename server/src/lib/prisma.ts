import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * v2.0 — read-replica router. Routes read-only queries to a Postgres read
 * replica when `DATABASE_READ_URL` is set; falls back to the primary client
 * otherwise. Non-trivial writes (insert/update/delete/transaction) MUST go
 * through `prisma` (the primary).
 *
 * Intended usage in hot list endpoints (probe library, audit log search,
 * dashboard stats) where read latency dominates and replica lag is fine:
 *
 *   const probes = await prismaRead.probe.findMany({ ... });
 */
export const prismaRead: PrismaClient = process.env.DATABASE_READ_URL
  ? new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      datasources: { db: { url: process.env.DATABASE_READ_URL } },
    })
  : prisma;


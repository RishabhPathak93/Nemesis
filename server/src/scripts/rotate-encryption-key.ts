/**
 * Rotate ENCRYPTION_KEY across every encrypted column.
 *
 * Usage:
 *   OLD_ENCRYPTION_KEY=<current-32-byte-hex> \
 *   NEW_ENCRYPTION_KEY=<new-32-byte-hex> \
 *   node dist/scripts/rotate-encryption-key.js
 *
 * Decrypts each column with OLD, re-encrypts with NEW, writes back inside
 * one transaction per row. Safe to interrupt — re-run picks up where it
 * left off because already-rotated rows decrypt cleanly under NEW.
 *
 * Records audit entries:
 *   system.encryption_key.rotation.start
 *   system.encryption_key.rotation.success | .fail
 */
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function loadKey(name: string): Buffer {
  const hex = process.env[name];
  if (!hex) throw new Error(`Missing ${name}`);
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error(`${name} must be 32-byte hex (64 chars)`);
  return buf;
}

function decryptWith(key: Buffer, payload: string): string {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = data.subarray(IV_LENGTH + TAG_LENGTH);
  const dec = crypto.createDecipheriv(ALGO, key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

function encryptWith(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Returns plaintext under NEW. Tries OLD first, then NEW (idempotency). */
function rekey(oldKey: Buffer, newKey: Buffer, payload: string): string {
  let plaintext: string;
  try {
    plaintext = decryptWith(oldKey, payload);
  } catch {
    // Already rotated — verify it round-trips under new.
    plaintext = decryptWith(newKey, payload);
    return payload;
  }
  return encryptWith(newKey, plaintext);
}

interface Counters {
  scanned: number;
  rotated: number;
  failed: number;
}

async function rotateOrgs(prisma: PrismaClient, oldKey: Buffer, newKey: Buffer, c: Counters): Promise<void> {
  const orgs = await prisma.org.findMany({
    select: { id: true, anthropicApiKey: true, llmApiKey: true, searchApiKey: true },
  });
  for (const o of orgs) {
    c.scanned++;
    const data: Record<string, string> = {};
    try {
      if (o.anthropicApiKey) data.anthropicApiKey = rekey(oldKey, newKey, o.anthropicApiKey);
      if (o.llmApiKey) data.llmApiKey = rekey(oldKey, newKey, o.llmApiKey);
      if (o.searchApiKey) data.searchApiKey = rekey(oldKey, newKey, o.searchApiKey);
      if (Object.keys(data).length > 0) {
        await prisma.org.update({ where: { id: o.id }, data });
        c.rotated++;
      }
    } catch (err) {
      c.failed++;
      console.error(`org ${o.id} rotation failed:`, err);
    }
  }
}

async function rotateAgents(prisma: PrismaClient, oldKey: Buffer, newKey: Buffer, c: Counters): Promise<void> {
  const agents = await prisma.agent.findMany({ select: { id: true, apiKey: true, orgId: true } });
  for (const a of agents) {
    c.scanned++;
    try {
      const next = rekey(oldKey, newKey, a.apiKey);
      if (next !== a.apiKey) {
        await prisma.agent.update({ where: { id: a.id }, data: { apiKey: next } });
        c.rotated++;
      }
    } catch (err) {
      c.failed++;
      console.error(`agent ${a.id} rotation failed:`, err);
    }
  }
}

async function rotateUsers(prisma: PrismaClient, oldKey: Buffer, newKey: Buffer, c: Counters): Promise<void> {
  const users = await prisma.user.findMany({ where: { mfaSecret: { not: null } }, select: { id: true, mfaSecret: true, orgId: true } });
  for (const u of users) {
    c.scanned++;
    try {
      if (!u.mfaSecret) continue;
      const next = rekey(oldKey, newKey, u.mfaSecret);
      if (next !== u.mfaSecret) {
        await prisma.user.update({ where: { id: u.id }, data: { mfaSecret: next } });
        c.rotated++;
      }
    } catch (err) {
      c.failed++;
      console.error(`user ${u.id} mfaSecret rotation failed:`, err);
    }
  }
}

async function main(): Promise<void> {
  const oldKey = loadKey('OLD_ENCRYPTION_KEY');
  const newKey = loadKey('NEW_ENCRYPTION_KEY');
  if (oldKey.equals(newKey)) {
    console.error('OLD_ENCRYPTION_KEY equals NEW_ENCRYPTION_KEY — nothing to do.');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Audit start — once per org, since AuditLog is org-scoped.
  const allOrgs = await prisma.org.findMany({ select: { id: true } });
  await prisma.auditLog.createMany({
    data: allOrgs.map((o) => ({
      orgId: o.id,
      actorType: 'system',
      action: 'system.encryption_key.rotation.start',
      targetType: 'org',
      targetId: o.id,
    })),
  });

  const counters: Counters = { scanned: 0, rotated: 0, failed: 0 };
  console.log('Rotating Org secrets…');
  await rotateOrgs(prisma, oldKey, newKey, counters);
  console.log('Rotating Agent.apiKey…');
  await rotateAgents(prisma, oldKey, newKey, counters);
  console.log('Rotating User.mfaSecret…');
  await rotateUsers(prisma, oldKey, newKey, counters);

  const action = counters.failed === 0 ? 'system.encryption_key.rotation.success' : 'system.encryption_key.rotation.fail';
  await prisma.auditLog.createMany({
    data: allOrgs.map((o) => ({
      orgId: o.id,
      actorType: 'system',
      action,
      targetType: 'org',
      targetId: o.id,
      metadata: counters as unknown as object,
    })),
  });

  console.log('Done.', counters);
  await prisma.$disconnect();
  if (counters.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('rotation failed:', err);
  process.exit(1);
});

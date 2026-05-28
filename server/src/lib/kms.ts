import crypto from 'crypto';
import { prisma } from './prisma';
import { env } from './env';
import { logger } from './logger';

/**
 * v2.0 — envelope encryption.
 *
 * Each org has its own per-org DEK (data-encryption key). The DEK itself is
 * wrapped with the operator's master `ENCRYPTION_KEY`. Hot path:
 *
 *   plaintext → encrypted with DEK → ciphertext stored in DB
 *
 * Without KMS configured, we fall back to using `ENCRYPTION_KEY` directly
 * (i.e. the existing crypto.ts behaviour). This keeps the upgrade path
 * gradual: new secrets get DEK-wrapped, existing rows decrypt under the
 * master and re-encrypt under DEK on next write.
 *
 * The wrapped DEK is stored in `KmsKey.wrappedDek` (already in the schema).
 * `providerKeyId` is reserved for a future Vault / AWS KMS / GCP KMS
 * integration where the master key lives in a real HSM.
 */

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function masterKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be a 32-byte hex string');
  return key;
}

function aesGcmEncrypt(plaintext: Buffer | string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const buf = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function aesGcmDecrypt(payload: string, key: Buffer): Buffer {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

const dekCache = new Map<string, { dek: Buffer; loadedAt: number }>();
const DEK_CACHE_MS = 5 * 60 * 1000;

async function getOrgDek(orgId: string): Promise<Buffer> {
  const cached = dekCache.get(orgId);
  if (cached && Date.now() - cached.loadedAt < DEK_CACHE_MS) return cached.dek;

  let row = await prisma.kmsKey.findUnique({ where: { orgId } });
  if (!row) {
    // Lazy-init: generate a 32-byte DEK, wrap it under the master, persist.
    const dek = crypto.randomBytes(32);
    const wrapped = aesGcmEncrypt(dek, masterKey());
    row = await prisma.kmsKey.create({
      data: { orgId, wrappedDek: wrapped, algorithm: 'aes-256-gcm' },
    });
    logger.info({ orgId, kmsKeyId: row.id }, 'generated org DEK on first access');
  }
  const dek = aesGcmDecrypt(row.wrappedDek, masterKey());
  if (dek.length !== 32) throw new Error('DEK wrap returned wrong key length');
  dekCache.set(orgId, { dek, loadedAt: Date.now() });
  return dek;
}

/**
 * Org-aware encrypt. Wraps the value under the org's DEK.
 *   `crypto.encrypt(s)` for legacy/master-keyed values.
 *   `kms.encryptForOrg(s, orgId)` for new envelope-encrypted values.
 *
 * Both ciphertexts share the same `(iv|tag|ciphertext)` format. The choice of
 * decrypt path is the caller's: until we migrate every encrypted column,
 * existing values continue decrypting under the master.
 */
export async function encryptForOrg(plaintext: string, orgId: string): Promise<string> {
  const dek = await getOrgDek(orgId);
  return aesGcmEncrypt(plaintext, dek);
}

export async function decryptForOrg(ciphertext: string, orgId: string): Promise<string> {
  const dek = await getOrgDek(orgId);
  return aesGcmDecrypt(ciphertext, dek).toString('utf8');
}

/**
 * Rotate an org's DEK. Generates a fresh DEK + wraps it under the master,
 * but does NOT re-encrypt every existing column — that's a migration script
 * the operator runs (`scripts/rotateOrgDeks.ts`, future).
 */
export async function rotateOrgDek(orgId: string): Promise<void> {
  const dek = crypto.randomBytes(32);
  const wrapped = aesGcmEncrypt(dek, masterKey());
  await prisma.kmsKey.upsert({
    where: { orgId },
    create: { orgId, wrappedDek: wrapped, algorithm: 'aes-256-gcm' },
    update: { wrappedDek: wrapped, rotatedAt: new Date() },
  });
  dekCache.delete(orgId);
}

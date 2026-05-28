import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { env } from './env';
import { logger } from './logger';

/**
 * Allowed mime types for org logos.
 *
 * NEM-2026-003: `image/svg+xml` removed — SVG is an XML format that can
 * embed <script>, external entity refs, and event handlers. Even when the
 * SPA renders the logo via <img> (which sandboxes scripts), there's a real
 * risk that a future use-site (PDF/HTML report export, settings preview)
 * inlines the SVG and pops XSS in our own origin.
 *
 * Customers who need vector logos must convert to PNG/WebP server-side.
 */
export const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

/** Hard cap on logo size (1 MB). Multer also enforces this on upload. */
export const MAX_LOGO_BYTES = 1_000_000;

/** Allowed colour-string shape: `#RRGGBB` or `#RGB`. */
export function validatePrimaryColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const ok = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
  if (!ok) throw new Error('primaryColor must be a hex string like #4f46e5');
  return color;
}

function ext(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}

/**
 * Compute the on-disk path for an org's logo. Resolves through path.resolve
 * and asserts the result is inside `env.brandingDir` to defeat traversal.
 */
export function logoPath(orgId: string, checksum: string, mime: string): string {
  const filename = `${checksum}.${ext(mime)}`;
  const target = path.resolve(env.brandingDir, orgId, filename);
  const root = path.resolve(env.brandingDir);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('branding path traversal blocked');
  }
  return target;
}

/** Write a buffer to disk; create parent dir if needed. Returns the relative path. */
export async function saveLogo(orgId: string, buffer: Buffer, mime: string): Promise<{
  storagePath: string;
  checksum: string;
  sizeBytes: number;
}> {
  if (!ALLOWED_LOGO_MIMES.includes(mime)) {
    throw new Error(`unsupported logo mime: ${mime}`);
  }
  if (buffer.byteLength > MAX_LOGO_BYTES) {
    throw new Error(`logo too large: ${buffer.byteLength} bytes (max ${MAX_LOGO_BYTES})`);
  }
  const checksum = createHash('sha256').update(buffer).digest('hex').slice(0, 32);
  const target = logoPath(orgId, checksum, mime);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  // Return path relative to brandingDir for storage in DB.
  const rel = path.relative(env.brandingDir, target);
  return { storagePath: rel, checksum, sizeBytes: buffer.byteLength };
}

/** Read a logo from disk. Returns null if missing. */
export async function readLogo(storagePath: string): Promise<Buffer | null> {
  const target = path.resolve(env.brandingDir, storagePath);
  const root = path.resolve(env.brandingDir);
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  try {
    return await fs.readFile(target);
  } catch (err) {
    logger.debug({ err, storagePath }, 'logo read miss');
    return null;
  }
}

/** Delete a logo file (best effort; failures logged, not raised). */
export async function deleteLogo(storagePath: string): Promise<void> {
  try {
    const target = path.resolve(env.brandingDir, storagePath);
    const root = path.resolve(env.brandingDir);
    if (!target.startsWith(root + path.sep) && target !== root) return;
    await fs.unlink(target);
  } catch (err) {
    logger.warn({ err, storagePath }, 'logo delete failed');
  }
}

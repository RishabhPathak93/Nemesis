import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from './crypto';

authenticator.options = { window: 1, step: 30 };

const APP_NAME = 'Nemesis AI';

/** Returns the base32 secret + a data-URL QR for Authenticator apps. */
export async function enrollSecret(email: string): Promise<{ secret: string; encrypted: string; otpauth: string; qrCodeDataUrl: string }> {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(email, APP_NAME, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return { secret, encrypted: encrypt(secret), otpauth, qrCodeDataUrl };
}

export function verifyTotp(encryptedSecret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code.trim())) return false;
  try {
    const secret = decrypt(encryptedSecret);
    return authenticator.verify({ token: code.trim(), secret });
  } catch {
    return false;
  }
}

const BACKUP_CODE_COUNT = 10;

/**
 * Returns plaintext codes (shown to user once) and bcrypt hashes (stored).
 *
 * NEM-2026-021: previous implementation pulled 8 random bytes through
 * base64url, sliced to 10 chars, then collapsed non-alphanumerics to 'X' —
 * which silently destroyed entropy whenever the random bytes happened to
 * encode to `-`, `_`, or `=`. We now use 5 random bytes → 10 hex chars,
 * keeping all 40 bits of entropy and avoiding any character substitution.
 */
export async function generateBackupCodes(): Promise<{ plaintext: string[]; hashes: string[] }> {
  const plaintext: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // 5 bytes = 40 bits = 10 hex chars; uppercase for readability; format XXXXX-XXXXX.
    const raw = randomBytes(5).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    plaintext.push(formatted);
    hashes.push(await bcrypt.hash(formatted, 12));
  }
  return { plaintext, hashes };
}

/** Returns the index of the matched backup code, or -1. */
export async function consumeBackupCode(code: string, hashes: string[]): Promise<number> {
  const normalised = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalised, hashes[i])) return i;
  }
  return -1;
}

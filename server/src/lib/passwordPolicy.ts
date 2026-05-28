/**
 * Password policy: minimum 12 chars, at least one upper, one lower, one digit,
 * one non-alphanumeric, and not on a small embedded weak-password list.
 * Returns null on success, or a human-readable rule violation.
 */

const WEAK = new Set([
  'password', 'password1', 'password123', 'qwerty', 'qwerty123',
  'letmein', 'welcome', 'admin', 'admin123', 'changeme', 'iloveyou',
  '12345678', '123456789', '1234567890', 'sunshine', 'princess',
  'monkey123', 'football', 'baseball', 'dragon', 'master', 'shadow',
  'abc123', 'abcdef', 'cortexview', 'cortex123',
]);

export function checkPassword(pw: string): string | null {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 256) return 'Password is too long.';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter.';
  if (!/\d/.test(pw)) return 'Password must contain a digit.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain a symbol.';
  if (WEAK.has(pw.toLowerCase())) return 'Password is too common — pick something distinctive.';
  return null;
}

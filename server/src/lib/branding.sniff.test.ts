import { describe, it, expect } from 'vitest';
import { sniffImageMime } from './branding';

/** Covers L-03: logo upload must verify real image magic bytes, not the
 *  client-declared MIME. */
describe('sniffImageMime', () => {
  it('detects PNG', () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
  });
  it('detects JPEG', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
  it('detects WebP (RIFF…WEBP)', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(sniffImageMime(buf)).toBe('image/webp');
  });
  it('rejects non-image content (e.g. an HTML/script payload mislabeled as image/png)', () => {
    expect(sniffImageMime(Buffer.from('<svg onload=alert(1)>', 'utf8'))).toBeNull();
    expect(sniffImageMime(Buffer.from('GIF89a', 'ascii'))).toBeNull(); // gif not allowed
    expect(sniffImageMime(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });
});

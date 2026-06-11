import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertPublicHttpsUrl, assertOutboundUrlAllowed, isPublicHttpsUrl } from './urlValidation';

/**
 * Covers the H-02 fail-closed SSRF gate + the relaxed-mode metadata guard
 * (incl. the IPv4-mapped-IPv6 bypass fix). IP literals avoid DNS so these run
 * offline and deterministically.
 */
describe('assertPublicHttpsUrl (strict gate)', () => {
  it('rejects non-https', async () => {
    await expect(assertPublicHttpsUrl('http://example.com')).rejects.toThrow();
  });
  it('rejects embedded credentials', async () => {
    await expect(assertPublicHttpsUrl('https://user:pass@8.8.8.8')).rejects.toThrow();
  });
  it.each([
    'https://127.0.0.1',
    'https://10.0.0.5',
    'https://192.168.1.10',
    'https://169.254.169.254', // cloud metadata
    'https://[::1]',
  ])('blocks private/loopback/metadata %s', async (u) => {
    await expect(assertPublicHttpsUrl(u)).rejects.toThrow();
  });
  it('allows a public https IP literal', async () => {
    await expect(assertPublicHttpsUrl('https://8.8.8.8')).resolves.toBeUndefined();
  });
});

describe('assertOutboundUrlAllowed (H-02 fail-closed)', () => {
  const prev = process.env.ALLOW_PRIVATE_OUTBOUND_URLS;
  beforeEach(() => { delete process.env.ALLOW_PRIVATE_OUTBOUND_URLS; });
  afterEach(() => { if (prev === undefined) delete process.env.ALLOW_PRIVATE_OUTBOUND_URLS; else process.env.ALLOW_PRIVATE_OUTBOUND_URLS = prev; });

  it('fails closed by default: blocks a private target', async () => {
    await expect(assertOutboundUrlAllowed('http://192.168.0.10')).rejects.toThrow();
  });
  it('fails closed by default: blocks http', async () => {
    await expect(assertOutboundUrlAllowed('http://8.8.8.8')).rejects.toThrow();
  });
  it('does NOT key off NODE_ENV', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    await expect(assertOutboundUrlAllowed('https://127.0.0.1')).rejects.toThrow();
    process.env.NODE_ENV = prevEnv;
  });

  describe('relaxed (ALLOW_PRIVATE_OUTBOUND_URLS=true)', () => {
    beforeEach(() => { process.env.ALLOW_PRIVATE_OUTBOUND_URLS = 'true'; });
    it('allows private/loopback targets (e.g. local Ollama)', async () => {
      await expect(assertOutboundUrlAllowed('http://192.168.65.2:11434')).resolves.toBeUndefined();
      await expect(assertOutboundUrlAllowed('http://127.0.0.1:4001')).resolves.toBeUndefined();
    });
    it('still blocks cloud metadata IPv4', async () => {
      await expect(assertOutboundUrlAllowed('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    });
    it('still blocks metadata hostnames', async () => {
      await expect(assertOutboundUrlAllowed('http://metadata.google.internal/')).rejects.toThrow();
    });
    it('blocks IPv4-mapped IPv6 metadata (review fix)', async () => {
      await expect(assertOutboundUrlAllowed('http://[::ffff:169.254.169.254]/')).rejects.toThrow();
    });
  });
});

describe('isPublicHttpsUrl (sync fast-path)', () => {
  it('true for public https host', () => expect(isPublicHttpsUrl('https://example.com')).toBe(true));
  it('false for localhost / http / metadata', () => {
    expect(isPublicHttpsUrl('https://localhost')).toBe(false);
    expect(isPublicHttpsUrl('http://example.com')).toBe(false);
    expect(isPublicHttpsUrl('https://169.254.169.254')).toBe(false);
  });
});

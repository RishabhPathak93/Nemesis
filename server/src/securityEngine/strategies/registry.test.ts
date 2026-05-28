import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTechnique,
  listTechniques,
  listSlugsByFamily,
  applyStrategyChainSync,
  register,
  _resetForTests,
} from './registry';

describe('strategies/registry', () => {
  it('auto-loads builtins from per-file modules', () => {
    const all = listTechniques();
    expect(all.length).toBeGreaterThan(15);                   // we ship 15+ techniques
    expect(all.find((t) => t.slug === 'encoding.base64')).toBeDefined();
    expect(all.find((t) => t.slug === 'framing.refusal_suppression')).toBeDefined();
    expect(all.find((t) => t.slug === 'encoding.zero_width_split')).toBeDefined();
  });

  it('listSlugsByFamily groups correctly', () => {
    const enc = listSlugsByFamily('encoding');
    const frm = listSlugsByFamily('framing');
    expect(enc).toContain('encoding.base64');
    expect(enc).toContain('encoding.zero_width_split');
    expect(enc).not.toContain('framing.roleplay');
    expect(frm).toContain('framing.roleplay');
    expect(frm).toContain('framing.refusal_suppression');
  });

  it('applyStrategyChainSync skips unknown slugs (graceful)', () => {
    const out = applyStrategyChainSync('hello', ['encoding.unicode_homoglyph', 'totally.unknown']);
    // Unknown slug ignored; homoglyph substitutes some letters with Cyrillic.
    expect(out.length).toBeGreaterThanOrEqual('hello'.length);
    // 'e' should have been replaced by Cyrillic 'е' (U+0435), not the Latin 'e' (U+0065).
    expect(out.charCodeAt(1)).not.toBe(0x65);
  });

  it('techniques are pure (no module state)', () => {
    // Run the same transform twice with the same input — must produce the same output.
    const t = getTechnique('encoding.zero_width_split');
    expect(t).toBeDefined();
    const a = t!.apply('test');
    const b = t!.apply('test');
    expect(a).toBe(b);
  });

  it('new technique can be plugged in WITHOUT touching the orchestrator', () => {
    register({
      slug: 'encoding.test_uppercase',
      family: 'encoding',
      kind: 'deterministic',
      title: 'Test uppercase',
      description: 'Trivial; for tests.',
      apply: (p) => p.toUpperCase(),
    });
    const out = applyStrategyChainSync('hello world', ['encoding.test_uppercase']);
    expect(out).toBe('HELLO WORLD');
  });

  it('each builtin returns the same shape (Technique contract)', () => {
    for (const t of listTechniques()) {
      expect(t.slug).toMatch(/^[a-z_]+\.[a-z_0-9]+$/);
      expect(['encoding', 'framing', 'multilingual', 'multi_turn', 'adversarial_suffix', 'composite']).toContain(t.family);
      expect(['deterministic', 'llm_assisted']).toContain(t.kind);
      expect(typeof t.apply).toBe('function');
      // Deterministic techniques must produce a non-empty result for a non-empty input.
      if (t.kind === 'deterministic' && t.family !== 'composite') {
        const out = t.apply('attack payload here');
        expect(out instanceof Promise).toBe(false);
        expect(typeof out).toBe('string');
        expect((out as string).length).toBeGreaterThan(0);
      }
    }
  });
});

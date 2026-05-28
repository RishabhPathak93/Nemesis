import { describe, it, expect } from 'vitest';
import type { Probe } from '@prisma/client';
import { enumerateTestCases, estimateCaseCount } from './strategyEnumerator';
import { listSlugsByFamily } from '../securityEngine/strategies/registry';

function makeProbe(slug: string, severity = 'high', category = 'jailbreak'): Probe {
  return {
    id: `id_${slug}`,
    slug,
    source: 'cortexview_curated',
    version: 1,
    category,
    subcategory: null,
    severity,
    title: `Title for ${slug}`,
    description: `Desc for ${slug}`,
    seedPayload: `Seed payload for ${slug}`,
    expectedFailIndicators: ['compliance'],
    expectedPassIndicators: ['refusal'],
    applicability: ['chatbot'],
    defaultDetectorIds: [],
    defaultStrategies: [],
    enabled: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function* probesAsStream(probes: Probe[]): AsyncGenerator<Probe> {
  for (const p of probes) yield p;
}

async function collect<T>(it: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('strategyEnumerator', () => {
  it('yields exactly 1 case per probe at chainDepth=0', async () => {
    const probes = [makeProbe('a.1'), makeProbe('a.2'), makeProbe('a.3')];
    const out = await collect(enumerateTestCases({ chainDepth: 0, probeStream: probesAsStream(probes) }));
    expect(out.length).toBe(3);
    expect(out.map((c) => c.strategyChain)).toEqual([[], [], []]);
  });

  it('yields exact Cartesian product at chainDepth=1', async () => {
    const probes = [makeProbe('a.1')];
    const out = await collect(enumerateTestCases({ chainDepth: 1, probeStream: probesAsStream(probes) }));
    const e = listSlugsByFamily('encoding').length;
    const f = listSlugsByFamily('framing').length;
    expect(out.length).toBe(1 + e + f);
  });

  it('yields exact Cartesian product at chainDepth=2', async () => {
    const probes = [makeProbe('a.1'), makeProbe('a.2')];
    const out = await collect(enumerateTestCases({ chainDepth: 2, probeStream: probesAsStream(probes) }));
    const e = listSlugsByFamily('encoding').length;
    const f = listSlugsByFamily('framing').length;
    const perProbe = 1 + e + f + e * f;
    expect(out.length).toBe(2 * perProbe);
  });

  it('estimateCaseCount matches the actual enumeration count', async () => {
    const probes = [makeProbe('a.1'), makeProbe('a.2'), makeProbe('a.3'), makeProbe('a.4')];
    const opts = { chainDepth: 2 } as const;
    const actual = (await collect(enumerateTestCases({ ...opts, probeStream: probesAsStream(probes) }))).length;
    const estimate = estimateCaseCount(probes.length, opts);
    expect(actual).toBe(estimate);
  });

  it('chainDepth=3 enumerates (enc, enc, framing) triples without duplicates', async () => {
    const probes = [makeProbe('a.1')];
    const opts = { chainDepth: 3 } as const;
    const out = await collect(enumerateTestCases({ ...opts, probeStream: probesAsStream(probes) }));
    expect(out.length).toBe(estimateCaseCount(1, opts));
    const ids = out.map((c) => c.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces deterministic externalIds (resumability anchor)', async () => {
    const probes = [makeProbe('z.last'), makeProbe('a.first')];
    const a = await collect(enumerateTestCases({ chainDepth: 1, probeStream: probesAsStream(probes) }));
    const b = await collect(enumerateTestCases({ chainDepth: 1, probeStream: probesAsStream(probes) }));
    expect(a.map((c) => c.externalId)).toEqual(b.map((c) => c.externalId));
  });

  it('no duplicate externalIds within a single enumeration', async () => {
    const probes = [makeProbe('a.1'), makeProbe('a.2')];
    const out = await collect(enumerateTestCases({ chainDepth: 2, probeStream: probesAsStream(probes) }));
    const ids = out.map((c) => c.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects includeEncodings=false / includeFramings=false', async () => {
    const probes = [makeProbe('a.1')];
    const enc = await collect(enumerateTestCases({
      chainDepth: 1, includeEncodings: false, includeFramings: true, probeStream: probesAsStream(probes),
    }));
    const f = listSlugsByFamily('framing').length;
    expect(enc.length).toBe(1 + f);

    const noFraming = await collect(enumerateTestCases({
      chainDepth: 1, includeEncodings: true, includeFramings: false, probeStream: probesAsStream(probes),
    }));
    const e = listSlugsByFamily('encoding').length;
    expect(noFraming.length).toBe(1 + e);
  });

  it('throws if no probes match', async () => {
    await expect(collect(enumerateTestCases({ probeStream: probesAsStream([]) }))).rejects.toThrow(/no probes/);
  });

  it('streams via async generator (memory-bounded, large catalogs)', async () => {
    const probes = Array.from({ length: 600 }, (_, i) =>
      makeProbe(`p.${String(i).padStart(4, '0')}`));
    let count = 0;
    for await (const _c of enumerateTestCases({ chainDepth: 0, probeStream: probesAsStream(probes) })) {
      count++;
    }
    expect(count).toBe(600);
  });

  it('attackPrompt comes from probe.seedPayload (strategies applied later)', async () => {
    const probes = [makeProbe('a.1')];
    const out = await collect(enumerateTestCases({ chainDepth: 0, probeStream: probesAsStream(probes) }));
    expect(out[0].attackPrompt).toBe('Seed payload for a.1');
  });
});

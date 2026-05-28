import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
vi.mock('../../lib/prisma', () => ({ prisma: { probe: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { categoryEffectiveness } from './knowledgeBase';

beforeEach(() => findMany.mockReset());

describe('categoryEffectiveness', () => {
  it('aggregates learned-pattern effectiveness into a normalized-category map', async () => {
    findMany.mockResolvedValue([
      { category: 'DATA_EXFILTRATION', metadata: { effectiveness: 0.8 } },
      { category: 'data_exfil',        metadata: { effectiveness: 0.6 } },
      { category: 'toxicity',          metadata: {} },
    ]);
    const map = await categoryEffectiveness('org1');
    expect(map.get('data')).toBeCloseTo(0.8);
    expect(map.has('toxicity')).toBe(false);
  });

  it('returns an empty map when there are no patterns', async () => {
    findMany.mockResolvedValue([]);
    expect((await categoryEffectiveness('org1')).size).toBe(0);
  });
});

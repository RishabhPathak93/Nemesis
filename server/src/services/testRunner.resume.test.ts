/**
 * Resumability test (D1) — focused unit-style verification of the resume
 * logic: when `TestResult` rows already exist for some `TestCase`s in a
 * suite, only the remaining cases should be processed on the next run.
 *
 * We don't spin up Bull or the full executeTestRun here; we model the
 * filter step the runner does and assert its set arithmetic. The wider
 * end-to-end resume is exercised separately via the benchmark.
 */
import { describe, it, expect } from 'vitest';

interface MockCase { id: string; externalId: string }
interface MockResult { testCaseId: string }

// Pure helper extracted from testRunner.ts (the same set arithmetic):
function pickRemaining(allCases: MockCase[], existingResults: MockResult[]): MockCase[] {
  const done = new Set(existingResults.map((r) => r.testCaseId));
  return allCases.filter((c) => !done.has(c.id));
}

describe('testRunner resume — case filtering', () => {
  it('returns the full suite when no prior results exist', () => {
    const cases = [
      { id: 'c1', externalId: 'tc.a.raw.0' },
      { id: 'c2', externalId: 'tc.a.enc.0' },
      { id: 'c3', externalId: 'tc.b.raw.0' },
    ];
    expect(pickRemaining(cases, [])).toHaveLength(3);
  });

  it('skips cases that already have a TestResult', () => {
    const cases = [
      { id: 'c1', externalId: 'tc.a.raw.0' },
      { id: 'c2', externalId: 'tc.a.enc.0' },
      { id: 'c3', externalId: 'tc.b.raw.0' },
    ];
    const existing = [{ testCaseId: 'c1' }, { testCaseId: 'c2' }];
    const remaining = pickRemaining(cases, existing);
    expect(remaining.map((c) => c.id)).toEqual(['c3']);
  });

  it('handles full-already-done (no work left to do)', () => {
    const cases = [{ id: 'c1', externalId: 'tc.a.raw.0' }];
    const existing = [{ testCaseId: 'c1' }];
    expect(pickRemaining(cases, existing)).toHaveLength(0);
  });

  it('is order-stable (testCases pulled with orderBy externalId)', () => {
    const cases = [
      { id: 'c-zebra', externalId: 'tc.z.raw.0' },
      { id: 'c-alpha', externalId: 'tc.a.raw.0' },
      { id: 'c-bravo', externalId: 'tc.b.raw.0' },
    ];
    // Caller sorts by externalId asc — we just verify the filter preserves order.
    const sorted = cases.slice().sort((a, b) => a.externalId.localeCompare(b.externalId));
    const out = pickRemaining(sorted, [{ testCaseId: 'c-alpha' }]);
    expect(out.map((c) => c.externalId)).toEqual(['tc.b.raw.0', 'tc.z.raw.0']);
  });

  it('progress cursor (completed + remaining) covers exactly the full set', () => {
    const cases = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      externalId: `tc.p${String(i).padStart(3, '0')}.raw.0`,
    }));
    // Imagine the run crashed after case 37.
    const done = cases.slice(0, 38).map((c) => ({ testCaseId: c.id }));
    const remaining = pickRemaining(cases, done);
    expect(done.length + remaining.length).toBe(cases.length);
    expect(remaining[0].id).toBe('c38');                // resumes at correct case
  });
});

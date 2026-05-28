import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use var so the declarations are hoisted above the vi.mock factory calls.
/* eslint-disable no-var, @typescript-eslint/no-explicit-any */
var updateMany: any;
var update: any;
var findUnique: any;
var build: any;
/* eslint-enable no-var, @typescript-eslint/no-explicit-any */

vi.mock('../lib/prisma', () => ({
  prisma: {
    agent: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      update: (...a: unknown[]) => update(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
    },
  },
}));

vi.mock('../services/claude/understandingOrchestrator', () => ({
  buildAgentUnderstanding: (...a: unknown[]) => build(...a),
}));

// Stubs for the controller's other imports so it loads in isolation.
vi.mock('../services/suiteBuilder', () => ({ buildSuiteForAgent: vi.fn() }));
vi.mock('../services/agentConnector', () => ({ sendToAgent: vi.fn() }));
vi.mock('../queues/testRunQueue', () => ({ enqueueTestRun: vi.fn() }));
vi.mock('../lib/audit', () => ({ auditFromRequest: vi.fn() }));

import { runUnderstanding } from './agentController';

// Assign real vi.fn instances after imports (module-scope runs after hoisting).
updateMany = vi.fn();
update = vi.fn(async () => ({}));
findUnique = vi.fn(async () => ({ id: 'a1', orgId: 'o1' }));
build = vi.fn(async () => ({
  summary: 's',
  attack_surfaces: [],
  risk_categories: [],
  recommended_focus_areas: [],
  risk_rationale: '',
}));

beforeEach(() => {
  updateMany.mockReset();
  update.mockReset();
  findUnique.mockReset();
  build.mockReset();
  update.mockResolvedValue({});
  findUnique.mockResolvedValue({ id: 'a1', orgId: 'o1' });
  build.mockResolvedValue({
    summary: 's',
    attack_surfaces: [],
    risk_categories: [],
    recommended_focus_areas: [],
    risk_rationale: '',
  });
});

describe('runUnderstanding in-flight lock', () => {
  it('runs the pipeline when the lock is acquired', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await runUnderstanding('a1');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the lock is already held (count 0)', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await runUnderstanding('a1');
    expect(build).not.toHaveBeenCalled();
  });
});

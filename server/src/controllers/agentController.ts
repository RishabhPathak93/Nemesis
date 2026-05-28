import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { encrypt, maskKey, decrypt } from '../lib/crypto';
import { HttpError } from '../middleware/errorHandler';
import { buildAgentUnderstanding } from '../services/claude/understandingOrchestrator';
import { buildSuiteForAgent } from '../services/suiteBuilder';
import { sendToAgent } from '../services/agentConnector';
import { enqueueTestRun } from '../queues/testRunQueue';
import { auditFromRequest } from '../lib/audit';
import { assertOutboundUrlAllowed } from '../lib/urlValidation';

// v2.1 — browser-driven chat: when the operator has UI-only access (no API key)
// they configure loginUrl / chatUrl / selectors instead of endpointUrl. The
// validator below accepts EITHER an HTTP-style agent OR a browser-style one.
const browserChatConfigSchema = z.object({
  loginUrl: z.string().url(),
  chatUrl: z.string().url(),
  username: z.string().min(1),
  selectors: z.object({
    loginUsername: z.string().min(1),
    loginPassword: z.string().min(1),
    loginSubmit: z.string().min(1),
    chatInput: z.string().min(1),
    chatSend: z.string().optional().default(''),
    chatResponse: z.string().min(1),
  }),
  responseSettleMs: z.number().int().min(0).max(60_000).optional(),
  responseTimeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  sendByEnter: z.boolean().optional(),
});

const agentSchema = z
  .object({
    name: z.string().min(1),
    agentType: z.string().min(1),
    model: z.string().min(1),
    // HTTP-style fields — optional at schema level; refined below.
    endpointUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    requestFormat: z.any().optional(),
    responsePath: z.string().min(1).optional(),
    // Browser-style fields — optional at schema level; refined below.
    browserConfig: browserChatConfigSchema.optional(),
    browserPassword: z.string().min(1).optional(),
    // Shared fields.
    systemPrompt: z.string().optional().nullable(),
    statedPurpose: z.string().optional().nullable(),
    knownGuardrails: z.string().optional().nullable(),
    sensitiveDataScope: z.array(z.string()).default([]),
    userAccessLevel: z.string().min(1),
  })
  .refine(
    (v) =>
      v.agentType === 'web_chat'
        ? !!v.browserConfig && !!v.browserPassword
        : !!v.endpointUrl && !!v.apiKey && !!v.responsePath,
    {
      message:
        "For agentType='web_chat' provide browserConfig + browserPassword. " +
        'For HTTP agents provide endpointUrl + apiKey + responsePath.',
    },
  );

const agentUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    agentType: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    endpointUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    requestFormat: z.any().optional(),
    responsePath: z.string().min(1).optional(),
    browserConfig: browserChatConfigSchema.optional(),
    browserPassword: z.string().min(1).optional(),
    systemPrompt: z.string().optional().nullable(),
    statedPurpose: z.string().optional().nullable(),
    knownGuardrails: z.string().optional().nullable(),
    sensitiveDataScope: z.array(z.string()).optional(),
    userAccessLevel: z.string().min(1).optional(),
  });

function serializeAgent<T extends { apiKey: string }>(agent: T): T & { apiKey: string } {
  // Replace encrypted apiKey with masked plaintext for client display
  let masked = '';
  try {
    masked = maskKey(decrypt(agent.apiKey));
  } catch {
    masked = '••••••••';
  }
  return { ...agent, apiKey: masked };
}

export async function listAgents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const agents = await prisma.agent.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(agents.map(serializeAgent));
  } catch (err) {
    next(err);
  }
}

export async function getAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, orgId },
      include: {
        testSuites: {
          orderBy: { createdAt: 'desc' },
          include: {
            testRuns: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              include: { report: true },
            },
            _count: { select: { testCases: true } },
          },
        },
      },
    });
    if (!agent) throw new HttpError(404, 'Agent not found');
    res.json(serializeAgent(agent));
  } catch (err) {
    next(err);
  }
}

export async function createAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const data = agentSchema.parse(req.body);

    const isBrowser = data.agentType === 'web_chat';
    // NEM-2026-001: SSRF defense — reject endpoint URLs that resolve to
    // private / loopback / link-local addresses (cloud metadata, internal
    // services). In dev (NODE_ENV !== production) the check no-ops so local
    // mock agents at http://localhost still work.
    if (isBrowser) {
      await assertOutboundUrlAllowed(data.browserConfig!.loginUrl);
      await assertOutboundUrlAllowed(data.browserConfig!.chatUrl);
    } else {
      await assertOutboundUrlAllowed(data.endpointUrl!);
    }
    const agent = await prisma.agent.create({
      data: {
        orgId,
        name: data.name,
        agentType: data.agentType,
        model: data.model,
        // For browser agents we leave the HTTP fields with sentinel values
        // so existing UIs (which assume strings) don't crash. They're never
        // read because sendToAgent() short-circuits on agentType.
        endpointUrl: isBrowser ? (data.browserConfig!.chatUrl) : data.endpointUrl!,
        apiKey: isBrowser ? encrypt('') : encrypt(data.apiKey!),
        requestFormat: data.requestFormat ?? {},
        responsePath: isBrowser ? 'response' : data.responsePath!,
        // Browser-only fields.
        browserConfig: isBrowser ? (data.browserConfig as unknown as object) : undefined,
        browserPasswordEnc: isBrowser ? encrypt(data.browserPassword!) : null,
        // Shared.
        systemPrompt: data.systemPrompt ?? null,
        statedPurpose: data.statedPurpose ?? null,
        knownGuardrails: data.knownGuardrails ?? null,
        sensitiveDataScope: data.sensitiveDataScope,
        userAccessLevel: data.userAccessLevel,
      },
    });

    // Kick off understanding pipeline asynchronously — don't block response.
    void runUnderstanding(agent.id);

    await auditFromRequest(req, {
      action: 'agent.created',
      targetType: 'agent',
      targetId: agent.id,
      metadata: { name: agent.name, agentType: agent.agentType, model: agent.model },
    });

    res.status(201).json(serializeAgent(agent));
  } catch (err) {
    next(err);
  }
}

export async function updateAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const data = agentUpdateSchema.parse(req.body);
    const existing = await prisma.agent.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new HttpError(404, 'Agent not found');

    const updateData: Record<string, unknown> = { ...data };
    // NEM-2026-001: re-validate any URL the operator changes.
    if (data.endpointUrl) {
      await assertOutboundUrlAllowed(data.endpointUrl);
    }
    if (data.browserConfig?.loginUrl) {
      await assertOutboundUrlAllowed(data.browserConfig.loginUrl);
    }
    if (data.browserConfig?.chatUrl) {
      await assertOutboundUrlAllowed(data.browserConfig.chatUrl);
    }
    if (data.apiKey) updateData.apiKey = encrypt(data.apiKey);
    if (data.requestFormat !== undefined) updateData.requestFormat = data.requestFormat ?? {};
    // v2.1 — browser-driven chat fields.
    if (data.browserPassword) {
      updateData.browserPasswordEnc = encrypt(data.browserPassword);
      delete updateData.browserPassword;
    }
    if (data.browserConfig) {
      updateData.browserConfig = data.browserConfig as unknown as object;
    }

    const updated = await prisma.agent.update({
      where: { id: existing.id },
      data: updateData,
    });
    await auditFromRequest(req, {
      action: 'agent.updated',
      targetType: 'agent',
      targetId: updated.id,
      metadata: {
        changedFields: Object.keys(updateData).filter((k) => k !== 'apiKey'),
        apiKeyRotated: 'apiKey' in updateData,
      },
    });
    res.json(serializeAgent(updated));
  } catch (err) {
    next(err);
  }
}

export async function deleteAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const existing = await prisma.agent.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new HttpError(404, 'Agent not found');
    await prisma.agent.delete({ where: { id: existing.id } });
    await auditFromRequest(req, {
      action: 'agent.deleted',
      targetType: 'agent',
      targetId: existing.id,
      metadata: { name: existing.name },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function runUnderstanding(agentId: string): Promise<void> {
  // In-flight lock: atomically transition to 'running' only if not already
  // running. If another interrogation holds the lock, this call no-ops.
  const lock = await prisma.agent.updateMany({
    where: { id: agentId, understandingStatus: { not: 'running' } },
    data: { understandingStatus: 'running', understandingError: null },
  });
  if (lock.count === 0) return;

  try {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return;
    const understanding = await buildAgentUnderstanding(agent, {
      onTranscript: async (transcript) => {
        await prisma.agent.update({
          where: { id: agentId },
          data: { understandingTranscript: transcript as unknown as object },
        });
      },
    });
    await prisma.agent.update({
      where: { id: agentId },
      data: { understanding: understanding as unknown as object, understandingStatus: 'done' },
    });
  } catch (err) {
    console.error(`Understanding pipeline failed for agent ${agentId}:`, err);
    await prisma.agent.update({
      where: { id: agentId },
      data: { understandingStatus: 'failed', understandingError: err instanceof Error ? err.message : String(err) },
    }).catch(() => { /* swallow */ });
  }
}

/**
 * GET /api/v1/agents/:id/test-connection
 *
 * Lightweight reachability probe — fires a single benign prompt at the agent
 * with a short timeout and reports `{ ok, latencyMs, sample, error? }`. Used
 * by the Agents UI to render a live Connected/Unreachable badge alongside
 * the persisted `status` field.
 */
export async function testAgentConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const agent = await prisma.agent.findFirst({ where: { id: req.params.id, orgId } });
    if (!agent) throw new HttpError(404, 'Agent not found');

    const start = Date.now();
    let response: string | null = null;
    let error: string | undefined;
    try {
      response = await sendToAgent(agent, 'connection ping');
      // agentConnector signals infrastructure failures with a "[AGENT_ERROR …]" prefix
      if (response.startsWith('[AGENT_ERROR')) {
        error = response.slice(0, 200);
        response = null;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const latencyMs = Date.now() - start;
    res.json({
      ok: response !== null,
      latencyMs,
      sample: response ? response.slice(0, 200) : null,
      error,
    });
  } catch (err) {
    next(err);
  }
}

export async function understandAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const agent = await prisma.agent.findFirst({ where: { id: req.params.id, orgId } });
    if (!agent) throw new HttpError(404, 'Agent not found');

    // Interrogation is slow — runUnderstanding holds an in-flight lock so a
    // concurrent trigger won't double-run. Fire-and-forget; client polls
    // understandingStatus on the agent detail endpoint.
    void runUnderstanding(agent.id);
    res.status(202).json({ status: 'running', agentId: agent.id });
  } catch (err) {
    next(err);
  }
}

export async function listTestSuites(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const agent = await prisma.agent.findFirst({ where: { id: req.params.id, orgId } });
    if (!agent) throw new HttpError(404, 'Agent not found');
    const suites = await prisma.testSuite.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { testCases: true, testRuns: true } },
      },
    });
    res.json(suites);
  } catch (err) {
    next(err);
  }
}

export async function generateSuite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const agent = await prisma.agent.findFirst({ where: { id: req.params.id, orgId } });
    if (!agent) throw new HttpError(404, 'Agent not found');

    const { suiteId } = await buildSuiteForAgent(agent);
    const suite = await prisma.testSuite.findUnique({
      where: { id: suiteId },
      include: { testCases: true },
    });

    res.status(201).json(suite);
  } catch (err) {
    next(err);
  }
}

/**
 * Kicks off a test run for an agent.
 *
 * This handler is intentionally near-instant (<100 ms): it creates an empty
 * placeholder TestSuite plus a PENDING TestRun and queues the job. The worker
 * does ALL LLM-heavy work (suite generation → test execution → reporting),
 * reporting progress via TestRun.phase + TestRun.phaseDetail.
 */
export async function runTests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const agent = await prisma.agent.findFirst({ where: { id: req.params.id, orgId } });
    if (!agent) throw new HttpError(404, 'Agent not found');

    const body = (req.body ?? {}) as { verticalPackSlug?: unknown };

    // SE-6 — caller can scope to a vertical pack.
    const verticalPackSlug =
      typeof body.verticalPackSlug === 'string' && body.verticalPackSlug.length > 0
        ? body.verticalPackSlug
        : undefined;

    // v2.2 — Hybrid is the only scan mode for new runs. The engine enumerates
    // a Cartesian skeleton (probe × seed-chain) and the runner adaptively
    // mutates each payload via the LLM in response to what the target agent
    // said, escalating chain depth until exploit or budget exhausted.
    // ('llm' and 'cartesian' modes still execute correctly for older runs
    // resumed from disk.)
    const enumerationMode = 'hybrid' as const;

    // Empty placeholder — worker fills it in the "preparing" phase.
    const placeholder = await prisma.testSuite.create({ data: { agentId: agent.id } });

    const queuedDetail = verticalPackSlug
      ? `Queued — hybrid scan, pack: ${verticalPackSlug}`
      : 'Queued — hybrid scan (Cartesian skeleton + adaptive LLM mutation).';

    // v2.2 — D2: mint a deterministic seed at creation time. Persisting it
    // here (instead of lazily in testRunner) means every scan is reproducible
    // from its TestRun row, including ones still in PENDING.
    const { freshSeed } = await import('../lib/prng');
    const testRun = await prisma.testRun.create({
      data: {
        suiteId: placeholder.id,
        status: 'PENDING',
        phase: 'preparing',
        phaseDetail: queuedDetail,
        totalTests: 0,
        engineVersion: 'v2',
        seed: freshSeed(),
        enumerationMode,
      },
    });

    await enqueueTestRun({
      testRunId: testRun.id,
      verticalPackSlug,
      // Hybrid uses chainDepth=1 as the seed (encoding-only or framing-only
      // single transforms). The adaptive loop in the runner deepens this
      // case-by-case via the LLM mutator.
      cartesianOptions: { chainDepth: 1, includeMultilingual: false },
    });

    await auditFromRequest(req, {
      action: 'run.started',
      targetType: 'test_run',
      targetId: testRun.id,
      metadata: { agentId: agent.id, agentName: agent.name, verticalPackSlug, enumerationMode },
    });

    res.status(202).json({ testRunId: testRun.id, suiteId: placeholder.id, enumerationMode });
  } catch (err) {
    next(err);
  }
}

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { encrypt, maskKey, decrypt } from '../lib/crypto';
import { HttpError } from '../middleware/errorHandler';
import { probeLlm, resolveLlmConfig } from '../lib/llm';
import { generateOpaqueToken, sha256 } from '../lib/tokens';
import { sendEmail, clientUrl } from '../lib/email';
import { auditFromRequest, sanitiseMetadata } from '../lib/audit';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  anthropicApiKey: z.string().optional().nullable(),
  // Unified LLM config
  llmProvider: z.enum(['anthropic', 'openai', 'openai_compatible', 'ollama', 'gemini']).nullable().optional(),
  llmApiKey: z.string().optional().nullable(),
  llmModel: z.string().optional().nullable(),
  llmBaseUrl: z.string().optional().nullable(),
  notifyOnComplete: z.boolean().optional(),
  notifyOnCritical: z.boolean().optional(),
  enableLearning: z.boolean().optional(),
  enableResearch: z.boolean().optional(),
  searchProvider: z.enum(['tavily', 'brave']).nullable().optional(),
  searchApiKey: z.string().optional().nullable(),
  requireMfa: z.boolean().optional(),
});

const probeSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'openai_compatible', 'ollama', 'gemini']),
  apiKey: z.string().optional().default(''),
  model: z.string().min(1),
  baseUrl: z.string().optional().nullable(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).default('ANALYST'),
});

const memberRoleSchema = z.object({ role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']) });

function tryMask(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    return maskKey(decrypt(encrypted));
  } catch {
    return '••••••••';
  }
}

function safeOrg(org: {
  id: string;
  name: string;
  anthropicApiKey: string | null;
  llmProvider: string | null;
  llmApiKey: string | null;
  llmModel: string | null;
  llmBaseUrl: string | null;
  notifyOnComplete: boolean;
  notifyOnCritical: boolean;
  enableLearning: boolean;
  enableResearch: boolean;
  searchProvider: string | null;
  searchApiKey: string | null;
  requireMfa?: boolean;
  mfaEnforcedAt?: Date | null;
}) {
  return {
    id: org.id,
    name: org.name,
    anthropicApiKeyMasked: tryMask(org.anthropicApiKey),
    llmProvider: org.llmProvider as 'anthropic' | 'openai' | 'openai_compatible' | 'ollama' | 'gemini' | null,
    llmApiKeyMasked: tryMask(org.llmApiKey),
    llmModel: org.llmModel,
    llmBaseUrl: org.llmBaseUrl,
    notifyOnComplete: org.notifyOnComplete,
    notifyOnCritical: org.notifyOnCritical,
    enableLearning: org.enableLearning,
    enableResearch: org.enableResearch,
    searchProvider: org.searchProvider,
    searchApiKeyMasked: tryMask(org.searchApiKey),
    requireMfa: org.requireMfa ?? false,
    mfaEnforcedAt: org.mfaEnforcedAt ?? null,
  };
}

export async function getOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await prisma.org.findUnique({ where: { id: req.user!.orgId } });
    if (!org) throw new HttpError(404, 'Org not found');
    res.json(safeOrg(org));
  } catch (err) {
    next(err);
  }
}

/** Compute a field-level diff for audit metadata, never including the raw secret values. */
function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) diff[key] = { from: before[key], to: after[key] };
  }
  return diff;
}

export async function updateOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    const data = updateOrgSchema.parse(req.body);
    const before = await prisma.org.findUnique({ where: { id: req.user!.orgId } });
    if (!before) throw new HttpError(404, 'Org not found');

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.notifyOnComplete !== undefined) updateData.notifyOnComplete = data.notifyOnComplete;
    if (data.notifyOnCritical !== undefined) updateData.notifyOnCritical = data.notifyOnCritical;
    if (data.anthropicApiKey !== undefined) {
      updateData.anthropicApiKey = data.anthropicApiKey ? encrypt(data.anthropicApiKey) : null;
    }
    if (data.llmProvider !== undefined) updateData.llmProvider = data.llmProvider;
    if (data.llmApiKey !== undefined) {
      updateData.llmApiKey = data.llmApiKey ? encrypt(data.llmApiKey) : null;
    }
    if (data.llmModel !== undefined) updateData.llmModel = data.llmModel || null;
    if (data.llmBaseUrl !== undefined) updateData.llmBaseUrl = data.llmBaseUrl || null;
    if (data.enableLearning !== undefined) updateData.enableLearning = data.enableLearning;
    if (data.enableResearch !== undefined) updateData.enableResearch = data.enableResearch;
    if (data.searchProvider !== undefined) updateData.searchProvider = data.searchProvider;
    if (data.searchApiKey !== undefined) {
      updateData.searchApiKey = data.searchApiKey ? encrypt(data.searchApiKey) : null;
    }
    if (data.requireMfa !== undefined) {
      updateData.requireMfa = data.requireMfa;
      // Start the 14-day grace window when MFA is first enforced.
      if (data.requireMfa && !before.mfaEnforcedAt) {
        updateData.mfaEnforcedAt = new Date();
      }
      if (!data.requireMfa) updateData.mfaEnforcedAt = null;
    }

    const org = await prisma.org.update({ where: { id: req.user!.orgId }, data: updateData });

    // Build a sanitised diff for the audit row — exclude secret fields entirely.
    const NON_SENSITIVE = ['name', 'notifyOnComplete', 'notifyOnCritical', 'enableLearning', 'enableResearch', 'requireMfa', 'llmProvider', 'llmModel', 'llmBaseUrl', 'searchProvider'];
    const beforeView: Record<string, unknown> = {};
    const afterView: Record<string, unknown> = {};
    for (const k of NON_SENSITIVE) {
      if (k in updateData) {
        beforeView[k] = (before as Record<string, unknown>)[k];
        afterView[k] = (org as Record<string, unknown>)[k];
      }
    }
    const secretFields = ['anthropicApiKey', 'llmApiKey', 'searchApiKey']
      .filter((k) => k in updateData)
      .map((k) => `${k}:rotated`);

    await auditFromRequest(req, {
      action: 'org.updated',
      targetType: 'org',
      targetId: org.id,
      metadata: { diff: diffFields(beforeView, afterView), secretFields: secretFields },
    });
    void sanitiseMetadata; // keep import live for future use

    res.json(safeOrg(org));
  } catch (err) {
    next(err);
  }
}

export async function listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [users, invites] = await Promise.all([
      prisma.user.findMany({
        where: { orgId: req.user!.orgId },
        select: {
          id: true, email: true, name: true, role: true,
          isActive: true, deactivatedAt: true,
          mfaEnabled: true, lastLoginAt: true, createdAt: true,
        },
      }),
      prisma.invite.findMany({
        where: { orgId: req.user!.orgId, acceptedAt: null },
        select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
      }),
    ]);
    res.json({ users, invites });
  } catch (err) {
    next(err);
  }
}

export async function createInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    const data = inviteSchema.parse(req.body);

    const raw = generateOpaqueToken();
    const invite = await prisma.invite.create({
      data: {
        orgId: req.user!.orgId,
        email: data.email,
        role: data.role,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: req.user!.userId,
      },
    });

    await sendEmail({
      to: data.email,
      subject: 'You\'re invited to Nemesis AI',
      text: `You've been invited to join a Nemesis AI organisation as ${data.role}.\nAccept your invitation: ${clientUrl(`/invite/${raw}`)}\nThis link expires in 7 days.`,
    }, req.user!.orgId);

    await auditFromRequest(req, {
      action: 'invite.created',
      targetType: 'invite',
      targetId: invite.id,
      metadata: { email: data.email, role: data.role },
    });

    res.status(201).json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    const invite = await prisma.invite.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!invite) throw new HttpError(404, 'Invite not found');
    await prisma.invite.delete({ where: { id: invite.id } });
    await auditFromRequest(req, {
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: invite.id,
      metadata: { email: invite.email },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/** Admin: deactivate a member (soft-disable login). Refuses to deactivate the
 *  last remaining active admin in the org. */
export async function deactivateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    const { id } = req.params;
    const target = await prisma.user.findFirst({ where: { id, orgId: req.user!.orgId } });
    if (!target) throw new HttpError(404, 'Member not found');
    if (!target.isActive) {
      res.json({ ok: true, alreadyDeactivated: true });
      return;
    }
    if (target.role === 'ADMIN') {
      const otherActiveAdmins = await prisma.user.count({
        where: { orgId: req.user!.orgId, role: 'ADMIN', isActive: true, NOT: { id } },
      });
      if (otherActiveAdmins === 0) {
        throw new HttpError(400, 'Refusing to deactivate the last active admin.');
      }
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await auditFromRequest(req, {
      action: 'member.deactivated',
      targetType: 'user',
      targetId: id,
      metadata: { email: target.email },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function reactivateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    const { id } = req.params;
    const target = await prisma.user.findFirst({ where: { id, orgId: req.user!.orgId } });
    if (!target) throw new HttpError(404, 'Member not found');
    await prisma.user.update({
      where: { id },
      data: { isActive: true, deactivatedAt: null, failedLoginCount: 0, lockedUntil: null },
    });
    await auditFromRequest(req, {
      action: 'member.reactivated',
      targetType: 'user',
      targetId: id,
      metadata: { email: target.email },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function updateMemberRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    const { id } = req.params;
    const { role } = memberRoleSchema.parse(req.body);
    const target = await prisma.user.findFirst({ where: { id, orgId: req.user!.orgId } });
    if (!target) throw new HttpError(404, 'Member not found');
    if (target.role === 'ADMIN' && role !== 'ADMIN') {
      const otherActiveAdmins = await prisma.user.count({
        where: { orgId: req.user!.orgId, role: 'ADMIN', isActive: true, NOT: { id } },
      });
      if (otherActiveAdmins === 0) {
        throw new HttpError(400, 'Refusing to demote the last active admin.');
      }
    }
    await prisma.user.update({
      where: { id },
      data: { role, tokenVersion: { increment: 1 } },
    });
    await auditFromRequest(req, {
      action: 'member.role_changed',
      targetType: 'user',
      targetId: id,
      metadata: { from: target.role, to: role, email: target.email },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Test-connect to an LLM provider with the supplied (or saved) credentials.
 * Body may contain a fresh provider/apiKey/model/baseUrl tuple to test before
 * saving; if omitted, tests the org's currently saved config.
 */
export async function testLlmConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let cfg;
    if (req.body && Object.keys(req.body).length > 0) {
      // ad-hoc test before save
      const { provider, apiKey, model, baseUrl } = probeSchema.parse(req.body);
      cfg = { provider, apiKey, model, baseUrl: baseUrl || undefined };
    } else {
      cfg = await resolveLlmConfig(req.user!.orgId);
    }
    const result = await probeLlm(cfg);
    res.json({ ...result, provider: cfg.provider, model: cfg.model });
  } catch (err) {
    next(err);
  }
}

export async function deleteOrgData(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    const before = await prisma.agent.count({ where: { orgId: req.user!.orgId } });
    // Delete all agents (cascades to suites, runs, results, reports).
    await prisma.agent.deleteMany({ where: { orgId: req.user!.orgId } });
    await auditFromRequest(req, {
      action: 'org.data_deleted',
      targetType: 'org',
      targetId: req.user!.orgId,
      metadata: { agentsDeleted: before },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

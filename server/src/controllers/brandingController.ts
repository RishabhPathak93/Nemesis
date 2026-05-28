import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { saveLogo, readLogo, deleteLogo, validatePrimaryColor } from '../lib/branding';
import { HttpError } from '../middleware/errorHandler';

const PutSchema = z.object({
  primaryColor: z.string().nullable().optional(),
});

/** GET /api/settings/branding — current org's branding profile (without binary). */
export async function getBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const profile = await prisma.brandingProfile.findUnique({ where: { orgId } });
    res.json(
      profile ?? {
        orgId,
        primaryColor: null,
        logoMime: null,
        logoSizeBytes: null,
        logoChecksum: null,
      },
    );
  } catch (err) {
    next(err);
  }
}

/** PUT /api/settings/branding — set primaryColor only. Logo is a separate endpoint. */
export async function updateBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const parsed = PutSchema.parse(req.body);
    let primaryColor: string | null;
    try {
      primaryColor = validatePrimaryColor(parsed.primaryColor ?? null);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'invalid primaryColor');
    }

    const profile = await prisma.brandingProfile.upsert({
      where: { orgId },
      create: { orgId, primaryColor, updatedById: userId },
      update: { primaryColor, updatedById: userId },
    });
    await auditFromRequest(req, {
      action: 'branding.update',
      targetType: 'org',
      targetId: orgId,
      metadata: { primaryColor },
    });
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

/** POST /api/settings/branding/logo — multer-uploaded file in `req.file`. */
export async function uploadBrandingLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) throw new HttpError(400, 'no file uploaded');

    const existing = await prisma.brandingProfile.findUnique({ where: { orgId } });
    let saved;
    try {
      saved = await saveLogo(orgId, file.buffer, file.mimetype);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'logo save failed');
    }
    const { storagePath, checksum, sizeBytes } = saved;

    if (existing?.logoStoragePath && existing.logoStoragePath !== storagePath) {
      await deleteLogo(existing.logoStoragePath);
    }

    const profile = await prisma.brandingProfile.upsert({
      where: { orgId },
      create: {
        orgId,
        logoMime: file.mimetype,
        logoSizeBytes: sizeBytes,
        logoStoragePath: storagePath,
        logoChecksum: checksum,
        updatedById: userId,
      },
      update: {
        logoMime: file.mimetype,
        logoSizeBytes: sizeBytes,
        logoStoragePath: storagePath,
        logoChecksum: checksum,
        updatedById: userId,
      },
    });
    await auditFromRequest(req, {
      action: 'branding.logo.upload',
      targetType: 'org',
      targetId: orgId,
      metadata: { mime: file.mimetype, sizeBytes, checksum },
    });
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/settings/branding/logo — clears the logo (keeps primaryColor). */
export async function removeBrandingLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const existing = await prisma.brandingProfile.findUnique({ where: { orgId } });
    if (existing?.logoStoragePath) {
      await deleteLogo(existing.logoStoragePath);
    }
    const profile = await prisma.brandingProfile.upsert({
      where: { orgId },
      create: { orgId, updatedById: userId },
      update: {
        logoMime: null,
        logoSizeBytes: null,
        logoStoragePath: null,
        logoChecksum: null,
        updatedById: userId,
      },
    });
    await auditFromRequest(req, {
      action: 'branding.logo.delete',
      targetType: 'org',
      targetId: orgId,
    });
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

/** GET /api/settings/branding/logo — streams the logo binary back. */
export async function downloadBrandingLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const profile = await prisma.brandingProfile.findUnique({ where: { orgId } });
    if (!profile?.logoStoragePath || !profile.logoMime) {
      throw new HttpError(404, 'no logo set');
    }
    const buf = await readLogo(profile.logoStoragePath);
    if (!buf) throw new HttpError(404, 'logo missing on disk');
    res.setHeader('Content-Type', profile.logoMime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (profile.logoChecksum) res.setHeader('ETag', `"${profile.logoChecksum}"`);
    res.end(buf);
  } catch (err) {
    next(err);
  }
}

import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { renderReportHtml } from '../services/exporters/htmlExporter';
import { renderReportPdf } from '../services/exporters/pdfExporter';

/**
 * GET /api/reports/:id/export?format=html|pdf
 *   - html: server-side Handlebars render with branding + custom sections
 *   - pdf:  server-side puppeteer-core render. Returns 503 with `fallback=jspdf`
 *           hint when the operator hasn't provided a chromium executable; the
 *           client then falls back to its existing jsPDF flow.
 */
export async function exportReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const format = String(req.query.format ?? 'html').toLowerCase();
    if (format !== 'html' && format !== 'pdf') {
      throw new HttpError(400, 'format must be "html" or "pdf"');
    }
    const report = await prisma.report.findUnique({
      where: { id },
      include: { testRun: { include: { suite: { include: { agent: { select: { orgId: true } } } } } } },
    });
    if (!report || report.testRun.suite.agent.orgId !== orgId) {
      throw new HttpError(404, 'report not found');
    }

    if (format === 'pdf') {
      const pdf = await renderReportPdf(id);
      if (!pdf) {
        // Operator hasn't enabled server-side PDF — surface a hint so the
        // client can fall back to its jsPDF flow.
        await auditFromRequest(req, {
          action: 'report.export.pdf.unavailable',
          targetType: 'report',
          targetId: id,
        });
        res.status(503).json({
          error: 'Server-side PDF rendering not configured. Set CV_PUPPETEER_EXECUTABLE_PATH or use the client-side PDF download.',
          fallback: 'jspdf',
          requestId: req.id,
        });
        return;
      }
      await auditFromRequest(req, {
        action: 'report.export.pdf',
        targetType: 'report',
        targetId: id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="cortexview-report-${id}.pdf"`);
      res.send(pdf);
      return;
    }

    const html = await renderReportHtml(id);
    await auditFromRequest(req, {
      action: 'report.export.html',
      targetType: 'report',
      targetId: id,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cortexview-report-${id}.html"`);
    res.send(html);
  } catch (err) { next(err); }
}

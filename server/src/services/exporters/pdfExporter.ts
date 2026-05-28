import { logger } from '../../lib/logger';
import { renderReportHtml } from './htmlExporter';

/**
 * v2.0 — server-side PDF rendering via puppeteer-core. Operator provides the
 * chromium executable (so we don't bundle a 120 MB binary by default).
 *
 *   CV_PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser  // operator's chromium
 *   CV_DISABLE_PDF=true                                     // off-switch (default off)
 *
 * Returns a Buffer of the PDF, or null when PDF rendering is disabled / the
 * executable is unavailable. Callers must handle null and fall back to
 * client-side jsPDF or HTML.
 */

const DISABLED = (process.env.CV_DISABLE_PDF ?? 'false').toLowerCase() === 'true';
const EXECUTABLE_PATH = process.env.CV_PUPPETEER_EXECUTABLE_PATH || '';

let warned = false;

export async function renderReportPdf(reportId: string): Promise<Buffer | null> {
  if (DISABLED) return null;
  if (!EXECUTABLE_PATH) {
    if (!warned) {
      logger.info('CV_PUPPETEER_EXECUTABLE_PATH unset — server-side PDF rendering disabled. Set this to your chromium path to enable.');
      warned = true;
    }
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require('puppeteer-core') as typeof import('puppeteer-core');
  const html = await renderReportHtml(reportId);
  let browser: import('puppeteer-core').Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(buf);
  } catch (err) {
    logger.warn({ err, reportId }, 'PDF render failed; client should fall back to jsPDF');
    return null;
  } finally {
    await browser?.close().catch(() => { /* swallow */ });
  }
}

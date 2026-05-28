import jsPDF from 'jspdf';
import type { FullReport, TestResultDetail, KeyFinding } from '@/types';

/**
 * Enterprise-grade audit-report PDF builder.
 *
 * Structure (left → right top → bottom):
 *   1. Cover page — full-bleed banner, agent name, audit date, classification
 *      badge, prepared-by, risk-score arc + outcomes strip.
 *   2. Table of contents — section names + page numbers.
 *   3. Executive summary — boxed callout + key-stats strip.
 *   4. Findings — numbered (F01/F02/…) with metadata strip + structured
 *      Description / Evidence / Recommendation blocks.
 *   5. Category breakdown — table with zebra-striped rows.
 *   6. Remediation roadmap — tier-grouped, action + rationale pairs.
 *   7. Technical notes.
 *   8. All test results — verbatim transcripts with severity + result pills.
 *   9. Conclusion.
 *
 * Every page carries a classified footer (Confidential · Report ID · Page X of Y).
 */
export function downloadReportPdf(report: FullReport): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  new PdfBuilder(doc, report).build();
  doc.save(`NemesisAI-${slug(report.agent.name)}-${report.id.slice(0, 6)}.pdf`);
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const COLORS = {
  primary: [31, 58, 110] as [number, number, number],         // deep navy
  accent: [99, 102, 241] as [number, number, number],         // indigo
  textPrimary: [15, 23, 42] as [number, number, number],
  textBody: [51, 65, 85] as [number, number, number],
  textMuted: [100, 116, 139] as [number, number, number],
  rule: [226, 232, 240] as [number, number, number],
  ruleStrong: [148, 163, 184] as [number, number, number],
  bg: [248, 250, 252] as [number, number, number],
  bgMuted: [241, 245, 249] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  // severity / risk
  critical: [220, 38, 38] as [number, number, number],
  high: [249, 115, 22] as [number, number, number],
  medium: [234, 179, 8] as [number, number, number],
  low: [59, 130, 246] as [number, number, number],
  pass: [16, 185, 129] as [number, number, number],
  fail: [220, 38, 38] as [number, number, number],
  partial: [234, 179, 8] as [number, number, number],
  error: [100, 116, 139] as [number, number, number],
};

const sevColor = (s: string): [number, number, number] => {
  const k = (s || 'low').toLowerCase();
  return (COLORS as Record<string, [number, number, number]>)[k] || COLORS.low;
};

const resultColor = (r: string): [number, number, number] => {
  const k = (r || 'error').toLowerCase();
  return (COLORS as Record<string, [number, number, number]>)[k] || COLORS.error;
};

class PdfBuilder {
  private margin = 54;
  private pageW: number;
  private pageH: number;
  private contentW: number;
  private y: number;
  private pageCount = 1;
  /** Page numbers where each TOC section starts, captured during the run. */
  private toc: { label: string; page: number }[] = [];

  /**
   * Extra left-indent applied to body text + code blocks while we're inside a
   * finding or result card. Reserves room on the left edge for the colored
   * severity bar so the first character of body text doesn't collide with it.
   */
  private bodyIndent = 0;

  constructor(private doc: jsPDF, private report: FullReport) {
    this.pageW = doc.internal.pageSize.getWidth();
    this.pageH = doc.internal.pageSize.getHeight();
    this.contentW = this.pageW - this.margin * 2;
    this.y = 0;
  }

  build(): void {
    this.cover();
    this.tocPage();
    this.executiveSummary();
    this.keyFindings();
    this.categoryBreakdown();
    this.remediationRoadmap();
    this.technicalNotes();
    this.allResults();
    this.conclusion();
    this.fillTocPage();
    this.stampFooters();
  }

  // ─────────────────────────── primitives ───────────────────────────

  private newPage(): void {
    this.doc.addPage();
    this.pageCount += 1;
    this.y = this.margin;
  }

  private ensure(space: number): void {
    if (this.y + space > this.pageH - this.margin - 28) this.newPage();
  }

  private setFont(weight: 'normal' | 'bold' | 'italic', size: number, color: [number, number, number] = COLORS.textBody): void {
    this.doc.setFont('helvetica', weight);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  private text(s: string, x: number, y: number, opts?: { maxWidth?: number; align?: 'left' | 'center' | 'right' }): number {
    if (!s) return 0;
    const lines = opts?.maxWidth ? (this.doc.splitTextToSize(s, opts.maxWidth) as string[]) : [s];
    this.doc.text(lines, x, y, { align: opts?.align });
    return lines.length;
  }

  private paragraph(s: string, size = 10): void {
    if (!s) return;
    this.setFont('normal', size, COLORS.textBody);
    const lines = this.doc.splitTextToSize(s, this.contentW - this.bodyIndent) as string[];
    const lh = size + 3;
    for (const line of lines) {
      this.ensure(lh);
      this.doc.text(line, this.margin + this.bodyIndent, this.y);
      this.y += lh;
    }
    this.y += 4;
  }

  private rule(color: [number, number, number] = COLORS.rule, w = 0.5): void {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(w);
    this.doc.line(this.margin, this.y, this.pageW - this.margin, this.y);
    this.y += 8;
  }

  private h1(label: string, accent = COLORS.primary): void {
    this.toc.push({ label, page: this.pageCount });
    this.ensure(40);
    // Accent stripe to the left
    this.doc.setFillColor(...accent);
    this.doc.rect(this.margin, this.y, 4, 18, 'F');
    this.setFont('bold', 16, accent);
    this.doc.text(label, this.margin + 12, this.y + 14);
    this.y += 24;
    this.rule(accent, 0.7);
    // Extra breathing room — without this gap, a paragraph drawn at the new
    // this.y has its ascent (~7pt for 10pt body) reaching back up to the rule
    // line and visually touching it. 8pt of slack solves it for any body size
    // we use (8pt–10pt).
    this.y += 8;
  }

  private box(x: number, y: number, w: number, h: number, fill: [number, number, number] = COLORS.bg, stroke?: [number, number, number]): void {
    this.doc.setFillColor(...fill);
    if (stroke) {
      this.doc.setDrawColor(...stroke);
      this.doc.setLineWidth(0.5);
      this.doc.roundedRect(x, y, w, h, 4, 4, 'FD');
    } else {
      this.doc.roundedRect(x, y, w, h, 4, 4, 'F');
    }
  }

  /** Solid-fill pill (badge) with white text — used for severity / result chips. */
  private pill(label: string, x: number, y: number, color: [number, number, number]): number {
    const padX = 6;
    this.setFont('bold', 8, COLORS.white);
    const textW = this.doc.getTextWidth(label);
    const w = textW + padX * 2;
    const h = 13;
    this.doc.setFillColor(...color);
    this.doc.roundedRect(x, y - h + 3, w, h, 2.5, 2.5, 'F');
    this.doc.setTextColor(...COLORS.white);
    this.doc.text(label, x + padX, y - 1.5);
    return w;
  }

  private measurePill(label: string): number {
    this.setFont('bold', 8, COLORS.white);
    return this.doc.getTextWidth(label) + 12;
  }

  /**
   * Draws a circular arc using a series of small straight-line segments.
   * Used for the risk-score progress ring.
   */
  private arc(
    cx: number,
    cy: number,
    radius: number,
    startAngleRad: number,
    sweepRad: number,
    color: [number, number, number],
    thickness: number,
  ): void {
    const segments = 60;
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(thickness);
    this.doc.setLineCap('round');
    let prevX = cx + radius * Math.cos(startAngleRad);
    let prevY = cy + radius * Math.sin(startAngleRad);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const angle = startAngleRad + sweepRad * t;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      this.doc.line(prevX, prevY, x, y);
      prevX = x;
      prevY = y;
    }
    this.doc.setLineCap('butt');
  }

  private codeBlock(label: string, body: string, labelColor: [number, number, number]): void {
    if (!body) return;
    const padding = 6;
    const lh = 9;
    const x = this.margin + this.bodyIndent;
    const w = this.contentW - this.bodyIndent;
    this.setFont('normal', 8.5, COLORS.textBody);
    const lines = this.doc.splitTextToSize(body, w - padding * 2) as string[];
    const max = Math.min(lines.length, 8);
    const truncated = lines.length > max;
    const visibleLines = lines.slice(0, max);
    if (truncated) visibleLines[max - 1] = visibleLines[max - 1].slice(0, -3) + '…';

    const blockH = visibleLines.length * lh + padding * 2 + 16;
    this.ensure(blockH);

    // Label
    this.setFont('bold', 7.5, labelColor);
    this.doc.text(label.toUpperCase(), x, this.y + 8);
    this.y += 14;
    // Box
    this.box(x, this.y, w, visibleLines.length * lh + padding * 2, COLORS.bg, COLORS.rule);
    this.setFont('normal', 8.5, COLORS.textPrimary);
    let textY = this.y + padding + 7;
    for (const line of visibleLines) {
      this.doc.text(line, x + padding, textY);
      textY += lh;
    }
    this.y += visibleLines.length * lh + padding * 2 + 8;
  }

  /** Small uppercase "label" used for metadata strips (`CATEGORY`, `CVSS`, etc.). */
  private metaCell(label: string, value: string, x: number, y: number, w: number): void {
    this.setFont('bold', 6.5, COLORS.textMuted);
    this.doc.text(label.toUpperCase(), x, y);
    this.setFont('normal', 9, COLORS.textPrimary);
    const lines = this.doc.splitTextToSize(value, w) as string[];
    this.doc.text(lines[0] ?? '—', x, y + 11);
  }

  // ─────────────────────────── sections ───────────────────────────

  /**
   * Cover page — full first page. Banner, agent name, date, classification
   * stamp, risk-score arc, outcomes strip, prepared-by footer. No content
   * below; ends with a hard page break.
   */
  private cover(): void {
    const r = this.report;
    // Banner
    this.doc.setFillColor(...COLORS.primary);
    this.doc.rect(0, 0, this.pageW, 120, 'F');
    this.setFont('bold', 11, COLORS.white);
    this.doc.text('NEMESIS AI', this.margin, 50);
    this.setFont('normal', 9, [200, 210, 230]);
    this.doc.text('AI SECURITY AUDIT REPORT', this.margin, 66);
    this.setFont('normal', 9, COLORS.white);
    this.doc.text(
      new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      this.pageW - this.margin,
      50,
      { align: 'right' },
    );

    // Classification stamp — top-right of the cover area
    const stampW = 90;
    const stampH = 24;
    const stampX = this.pageW - this.margin - stampW;
    const stampY = 86;
    this.doc.setDrawColor(...COLORS.fail);
    this.doc.setLineWidth(1);
    this.doc.roundedRect(stampX, stampY, stampW, stampH, 3, 3, 'S');
    this.setFont('bold', 9, COLORS.fail);
    this.doc.text('CONFIDENTIAL', stampX + stampW / 2, stampY + 16, { align: 'center' });

    // Title — eyebrow label, then title with enough gap that the bold 28pt ascent
    // doesn't crash into the small-caps label's baseline.
    this.y = 200;
    this.setFont('bold', 9, COLORS.textMuted);
    this.doc.text('PREPARED FOR', this.margin, this.y);
    this.y += 28;
    this.setFont('bold', 28, COLORS.textPrimary);
    const titleLines = this.doc.splitTextToSize(r.agent.name, this.contentW) as string[];
    for (const line of titleLines) {
      this.doc.text(line, this.margin, this.y);
      this.y += 34;
    }
    this.y += 4;
    this.setFont('normal', 12, COLORS.textMuted);
    this.doc.text(
      `${r.agent.agentType}  ·  ${r.agent.model}  ·  ${r.testRun.totalTests} tests executed`,
      this.margin,
      this.y,
    );

    // Risk-score callout — large card
    this.y += 36;
    const calloutH = 200;
    this.box(this.margin, this.y, this.contentW, calloutH, COLORS.bg, COLORS.rule);

    // Score ring on left
    const ringR = 60;
    const ringCx = this.margin + 90;
    const ringCy = this.y + calloutH / 2;
    const score = Math.max(0, Math.min(100, r.riskScore));
    const ratingColor = sevColor(r.overallRiskRating);
    // Background ring (full circle)
    this.doc.setDrawColor(...COLORS.rule);
    this.doc.setLineWidth(9);
    this.doc.setLineCap('round');
    this.doc.circle(ringCx, ringCy, ringR, 'S');
    this.doc.setLineCap('butt');
    // Foreground arc (proportional to score), starting from top, clockwise
    const start = -Math.PI / 2;
    const sweep = (score / 100) * 2 * Math.PI;
    this.arc(ringCx, ringCy, ringR, start, sweep, ratingColor, 9);
    // Score number centred
    this.setFont('bold', 36, ratingColor);
    this.doc.text(String(r.riskScore), ringCx, ringCy + 6, { align: 'center' });
    this.setFont('normal', 9, COLORS.textMuted);
    this.doc.text('/ 100', ringCx, ringCy + 22, { align: 'center' });

    // Right side: rating + outcomes
    const tx = this.margin + 200;
    this.setFont('bold', 9, COLORS.textMuted);
    this.doc.text('OVERALL RISK', tx, this.y + 36);
    this.pill(r.overallRiskRating.toUpperCase(), tx, this.y + 60, ratingColor);

    const passC = r.results.filter((x) => x.result === 'pass').length;
    const failC = r.results.filter((x) => x.result === 'fail').length;
    const partialC = r.results.filter((x) => x.result === 'partial').length;
    const errorC = r.results.filter((x) => x.result === 'error').length;

    this.setFont('bold', 9, COLORS.textMuted);
    this.doc.text('TESTS', tx + 200, this.y + 36);
    this.setFont('bold', 18, COLORS.textPrimary);
    this.doc.text(String(r.testRun.totalTests), tx + 200, this.y + 60);

    // Outcomes row — small icons
    const oy = this.y + 110;
    this.setFont('bold', 9, COLORS.textMuted);
    this.doc.text('OUTCOMES', tx, oy);
    const outcomes: { label: string; count: number; color: [number, number, number] }[] = [
      { label: 'Pass', count: passC, color: COLORS.pass },
      { label: 'Fail', count: failC, color: COLORS.fail },
      { label: 'Partial', count: partialC, color: COLORS.partial },
      { label: 'Error', count: errorC, color: COLORS.error },
    ];
    let ox = tx;
    for (const o of outcomes) {
      this.doc.setFillColor(...o.color);
      this.doc.circle(ox + 4, oy + 24 - 4, 4, 'F');
      this.setFont('bold', 16, COLORS.textPrimary);
      this.doc.text(String(o.count), ox + 14, oy + 28);
      this.setFont('normal', 8.5, COLORS.textMuted);
      this.doc.text(o.label, ox + 14, oy + 40);
      ox += 70;
    }

    // Cover footer — report identifiers
    const fy = this.pageH - this.margin - 12;
    this.doc.setDrawColor(...COLORS.rule);
    this.doc.setLineWidth(0.5);
    this.doc.line(this.margin, fy - 18, this.pageW - this.margin, fy - 18);
    this.setFont('normal', 8, COLORS.textMuted);
    this.doc.text(`Report ID  ·  ${r.id.slice(0, 12)}`, this.margin, fy);
    this.doc.text(`Test Run  ·  ${r.testRun.id.slice(0, 12)}`, this.margin + 200, fy);
    this.doc.text('Engine v2 · Nemesis AI Platform', this.pageW - this.margin, fy, { align: 'right' });

    this.newPage();
  }

  /**
   * TOC placeholder — we register the page number here, then fill it in at the
   * end (after every section reports its real page).
   */
  private tocPage(): void {
    this.toc.push({ label: '__TOC__', page: this.pageCount });
    // Reserve the page. Stretch a big "Contents" header for now; rest gets
    // filled in fillTocPage().
    this.setFont('bold', 28, COLORS.textPrimary);
    this.doc.text('Contents', this.margin, this.margin + 30);
    this.doc.setDrawColor(...COLORS.primary);
    this.doc.setLineWidth(2);
    this.doc.line(this.margin, this.margin + 38, this.margin + 80, this.margin + 38);
    this.newPage();
  }

  /** After all real content is written, go back and fill the TOC body. */
  private fillTocPage(): void {
    const tocEntry = this.toc.find((t) => t.label === '__TOC__');
    if (!tocEntry) return;
    this.doc.setPage(tocEntry.page);
    let y = this.margin + 70;
    for (const t of this.toc) {
      if (t.label === '__TOC__') continue;
      this.setFont('normal', 11, COLORS.textPrimary);
      this.doc.text(t.label, this.margin, y);
      // Leader dots
      this.setFont('normal', 11, COLORS.rule);
      this.doc.text('. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
        this.margin + 4, y, { maxWidth: this.contentW - 40 });
      this.setFont('normal', 11, COLORS.textBody);
      this.doc.text(String(t.page), this.pageW - this.margin, y, { align: 'right' });
      y += 22;
    }
  }

  private executiveSummary(): void {
    this.h1('Executive summary');
    // Key-stats strip — counts + risk rating + pass rate
    const r = this.report;
    const passC = r.results.filter((x) => x.result === 'pass').length;
    const passRate = r.results.length > 0 ? Math.round((passC / r.results.length) * 100) : 0;
    const stats: { label: string; value: string; color: [number, number, number] }[] = [
      { label: 'Risk score', value: String(r.riskScore), color: sevColor(r.overallRiskRating) },
      { label: 'Rating', value: r.overallRiskRating.toUpperCase(), color: sevColor(r.overallRiskRating) },
      { label: 'Tests', value: String(r.testRun.totalTests), color: COLORS.textPrimary },
      { label: 'Pass rate', value: `${passRate}%`, color: passRate >= 75 ? COLORS.pass : passRate >= 50 ? COLORS.partial : COLORS.fail },
      { label: 'Findings', value: String(r.keyFindings.length), color: COLORS.textPrimary },
    ];
    const stripH = 50;
    const cellW = this.contentW / stats.length;
    this.box(this.margin, this.y, this.contentW, stripH, COLORS.bg, COLORS.rule);
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const cx = this.margin + i * cellW;
      if (i > 0) {
        this.doc.setDrawColor(...COLORS.rule);
        this.doc.setLineWidth(0.5);
        this.doc.line(cx, this.y + 8, cx, this.y + stripH - 8);
      }
      this.setFont('bold', 7, COLORS.textMuted);
      this.doc.text(s.label.toUpperCase(), cx + cellW / 2, this.y + 18, { align: 'center' });
      this.setFont('bold', 16, s.color);
      this.doc.text(s.value, cx + cellW / 2, this.y + 38, { align: 'center' });
    }
    this.y += stripH + 14;
    this.paragraph(r.executiveSummary, 10);
  }

  private keyFindings(): void {
    this.h1('Findings', COLORS.accent);
    if (this.report.keyFindings.length === 0) {
      this.setFont('italic', 10, COLORS.textMuted);
      this.text('No notable findings.', this.margin, this.y + 12);
      this.y += 18;
      return;
    }
    const idMap = buildResultMap(this.report.results);
    let idx = 0;
    for (const f of this.report.keyFindings) {
      idx += 1;
      this.findingBlock(f, idx, idMap);
    }
  }

  private findingBlock(f: KeyFinding, num: number, idMap: Map<string, TestResultDetail>): void {
    this.ensure(80);

    const sevC = sevColor(f.severity);
    const barTopY = this.y;
    const barStartPage = this.pageCount;

    // Indent everything inside this card so the severity bar doesn't cross body text.
    this.bodyIndent = 14;
    try {
      // Header row — F-number, title, severity pill
      const numTag = `F${String(num).padStart(2, '0')}`;
      this.setFont('bold', 9, COLORS.textMuted);
      this.doc.text(numTag, this.margin + 14, this.y + 14);
      this.setFont('bold', 13, COLORS.textPrimary);
      const titleX = this.margin + 14 + 30;
      const titleLines = this.doc.splitTextToSize(f.title, this.contentW - 30 - 90) as string[];
      let titleY = this.y + 14;
      for (const line of titleLines) {
        this.doc.text(line, titleX, titleY);
        titleY += 16;
      }
      this.pill(f.severity.toUpperCase(), this.pageW - this.margin - this.measurePill(f.severity.toUpperCase()), this.y + 14, sevC);
      this.y = titleY + 2;

      // Description — uses bodyIndent, so it starts at margin + 14, clearing the severity bar
      this.paragraph(f.description, 9.5);

      // Recommendation (if any)
      if (f.recommendation) {
        this.setFont('bold', 7.5, COLORS.primary);
        this.ensure(14);
        this.doc.text('RECOMMENDATION', this.margin + 14, this.y + 10);
        this.y += 22;
        this.paragraph(f.recommendation, 9.5);
      }

      // Reproducing tests
      const ids = resolveIds(f);
      const tests = ids.map((id) => idMap.get(id.toUpperCase())).filter((x): x is TestResultDetail => !!x);
      if (tests.length > 0) {
        this.setFont('bold', 7.5, COLORS.primary);
        this.ensure(14);
        this.doc.text(`REPRODUCING TESTS  ·  ${tests.length}`, this.margin + 14, this.y + 10);
        this.y += 18;
        const showCount = Math.min(tests.length, 3);
        for (let i = 0; i < showCount; i++) {
          const t = tests[i];
          this.testReproducerBlock(t);
        }
        if (tests.length > showCount) {
          this.setFont('italic', 8, COLORS.textMuted);
          this.ensure(14);
          this.doc.text(`+ ${tests.length - showCount} more in "All test results".`, this.margin + 14, this.y + 10);
          this.y += 14;
        }
      } else if (f.evidence) {
        this.codeBlock('Evidence', f.evidence, COLORS.accent);
      }
    } finally {
      this.bodyIndent = 0;
    }

    // Draw the severity bar now that we know the block's height.
    // If the block spans a page break, only draw the slice on the current page.
    this.drawSeverityBar(sevC, barStartPage, barTopY, this.y + 4);

    this.y += 14;
    this.rule(COLORS.rule);
  }

  /**
   * Draws the severity bar for a card. When the card crossed a page break,
   * the start-y refers to the earlier page, so we draw the upper slice on that
   * page and the lower slice on the current page; otherwise it's one rect.
   */
  private drawSeverityBar(
    color: [number, number, number],
    startPage: number,
    startY: number,
    endY: number,
  ): void {
    const currentPage = this.pageCount;
    this.doc.setFillColor(...color);
    if (startPage === currentPage) {
      this.doc.rect(this.margin, startY, 3, endY - startY, 'F');
      return;
    }
    // Multi-page span. Render the slice on each page from the top margin
    // (or original start on the first page) down to the bottom margin
    // (or final endY on the last page).
    const pageBottom = this.pageH - this.margin - 28; // matches `ensure()` reserved footer
    // Slice on the first page
    this.doc.setPage(startPage);
    this.doc.setFillColor(...color);
    this.doc.rect(this.margin, startY, 3, pageBottom - startY, 'F');
    // Slices on any intermediate pages
    for (let p = startPage + 1; p < currentPage; p++) {
      this.doc.setPage(p);
      this.doc.setFillColor(...color);
      this.doc.rect(this.margin, this.margin, 3, pageBottom - this.margin, 'F');
    }
    // Slice on the current (final) page
    this.doc.setPage(currentPage);
    this.doc.setFillColor(...color);
    this.doc.rect(this.margin, this.margin, 3, endY - this.margin, 'F');
  }

  private testReproducerBlock(t: TestResultDetail): void {
    this.ensure(50);
    this.setFont('bold', 9, COLORS.textPrimary);
    this.doc.text(`${t.testCase.externalId}  ·  ${t.testCase.name}`, this.margin + 14, this.y + 10);
    this.pill(t.result.toUpperCase(), this.pageW - this.margin - this.measurePill(t.result.toUpperCase()), this.y + 10, resultColor(t.result));
    this.y += 18;
    this.codeBlock('Attack prompt', t.testCase.attackPrompt, COLORS.accent);
    this.codeBlock('Agent response', t.agentResponse, COLORS.fail);
  }

  /** Same as paragraph but starting at margin + indent for nested content. */
  private indentedParagraph(s: string, size: number, indent: number): void {
    if (!s) return;
    this.setFont('normal', size, COLORS.textBody);
    const lines = this.doc.splitTextToSize(s, this.contentW - indent) as string[];
    const lh = size + 3;
    for (const line of lines) {
      this.ensure(lh);
      this.doc.text(line, this.margin + indent, this.y);
      this.y += lh;
    }
    this.y += 4;
  }

  private categoryBreakdown(): void {
    this.h1('Category breakdown');
    if (this.report.categoryBreakdown.length === 0) {
      this.setFont('italic', 10, COLORS.textMuted);
      this.text('No categories.', this.margin, this.y + 12);
      this.y += 18;
      return;
    }
    const cols = [
      { label: 'Category', x: this.margin, w: 170 },
      { label: 'Tests', x: this.margin + 170, w: 50, align: 'right' as const },
      { label: 'Failures', x: this.margin + 220, w: 60, align: 'right' as const },
      { label: 'Pass rate', x: this.margin + 280, w: 70, align: 'right' as const },
      { label: 'Commentary', x: this.margin + 350, w: this.contentW - 350 },
    ];
    // Header row
    this.ensure(22);
    this.doc.setFillColor(...COLORS.primary);
    this.doc.rect(this.margin, this.y, this.contentW, 20, 'F');
    this.setFont('bold', 8, COLORS.white);
    for (const c of cols) {
      const cx = (c.align === 'right' ? c.x + c.w - 4 : c.x + 6);
      this.doc.text(c.label.toUpperCase(), cx, this.y + 13, { align: c.align ?? 'left' });
    }
    this.y += 20;

    let rowIdx = 0;
    for (const c of this.report.categoryBreakdown) {
      const commentaryLines = this.doc.splitTextToSize(c.commentary, cols[4].w - 8) as string[];
      const rowH = Math.max(26, commentaryLines.length * 11 + 10);
      this.ensure(rowH);

      // Zebra
      if (rowIdx % 2 === 0) {
        this.doc.setFillColor(...COLORS.bg);
        this.doc.rect(this.margin, this.y, this.contentW, rowH, 'F');
      }

      this.setFont('normal', 9, COLORS.textPrimary);
      this.doc.setFont('helvetica', 'normal');
      this.doc.text(c.category, cols[0].x + 6, this.y + 15);

      this.setFont('normal', 9, COLORS.textPrimary);
      this.doc.text(String(c.total_tests), cols[1].x + cols[1].w - 4, this.y + 15, { align: 'right' });
      this.setFont('bold', 9, c.failures > 0 ? COLORS.fail : COLORS.pass);
      this.doc.text(String(c.failures), cols[2].x + cols[2].w - 4, this.y + 15, { align: 'right' });
      const passRate = Math.round(c.pass_rate * 100);
      this.setFont('bold', 9, passRate >= 75 ? COLORS.pass : passRate >= 50 ? COLORS.partial : COLORS.fail);
      this.doc.text(`${passRate}%`, cols[3].x + cols[3].w - 4, this.y + 15, { align: 'right' });

      this.setFont('normal', 8.5, COLORS.textBody);
      let cy = this.y + 14;
      for (const line of commentaryLines) {
        this.doc.text(line, cols[4].x + 4, cy);
        cy += 11;
      }

      this.y += rowH;
      this.doc.setDrawColor(...COLORS.rule);
      this.doc.setLineWidth(0.3);
      this.doc.line(this.margin, this.y, this.pageW - this.margin, this.y);
      rowIdx += 1;
    }
    this.y += 12;
  }

  private remediationRoadmap(): void {
    this.h1('Remediation roadmap');
    const tiers: Array<{ key: 'immediate' | 'short_term' | 'long_term'; label: string; color: [number, number, number] }> = [
      { key: 'immediate', label: 'Immediate', color: COLORS.fail },
      { key: 'short_term', label: 'Short term', color: COLORS.high },
      { key: 'long_term', label: 'Long term', color: COLORS.low },
    ];
    for (const tier of tiers) {
      const items = this.report.remediationRoadmap.filter((r) => r.priority === tier.key);
      if (items.length === 0) continue;
      this.ensure(28);

      // Tier header — pill + count
      this.pill(tier.label.toUpperCase(), this.margin, this.y + 14, tier.color);
      this.setFont('normal', 9, COLORS.textMuted);
      this.doc.text(`${items.length} action${items.length === 1 ? '' : 's'}`, this.pageW - this.margin, this.y + 12, { align: 'right' });
      this.y += 22;

      for (const it of items) {
        this.ensure(36);
        // Bullet circle
        this.doc.setFillColor(...tier.color);
        this.doc.circle(this.margin + 6, this.y + 8, 2, 'F');

        this.setFont('bold', 10, COLORS.textPrimary);
        const titleLines = this.doc.splitTextToSize(it.action, this.contentW - 20) as string[];
        let ty = this.y + 11;
        for (const line of titleLines) {
          this.ensure(13);
          this.doc.text(line, this.margin + 16, ty);
          ty += 13;
        }
        this.y = ty;
        this.y += 4;
        this.indentedParagraph(it.rationale, 9, 16);
        this.y += 2;
      }
      this.y += 6;
    }
  }

  private technicalNotes(): void {
    this.h1('Technical notes');
    this.paragraph(this.report.technicalNotes, 10);
  }

  private allResults(): void {
    this.h1('All test results');
    this.setFont('normal', 9, COLORS.textMuted);
    this.text(
      `${this.report.results.length} tests executed — verbatim attack prompts and agent responses below.`,
      this.margin,
      this.y + 12,
    );
    this.y += 22;
    const ordered = [...this.report.results].sort((a, b) => {
      const score = (r: typeof a) =>
        r.result === 'fail' ? 0 : r.result === 'partial' ? 1 : r.result === 'error' ? 2 : 3;
      return score(a) - score(b);
    });
    for (const r of ordered) {
      this.resultBlock(r);
    }
  }

  private resultBlock(r: TestResultDetail): void {
    this.ensure(60);

    const sevC = sevColor(r.testCase.severity);
    const blockTop = this.y;
    const blockStartPage = this.pageCount;

    // Reserve a left gutter for the severity bar across every body element in this block.
    this.bodyIndent = 14;
    try {
      // Header line: TC id · name
      this.setFont('bold', 10.5, COLORS.textPrimary);
      const headerText = `${r.testCase.externalId}  ·  ${r.testCase.name}`;
      const lines = this.doc.splitTextToSize(headerText, this.contentW - 130 - 14) as string[];
      let hy = this.y + 12;
      for (const line of lines) {
        this.doc.text(line, this.margin + 14, hy);
        hy += 13;
      }
      const pillX = this.pageW - this.margin;
      const sevW = this.measurePill(r.testCase.severity.toUpperCase());
      const resW = this.measurePill(r.result.toUpperCase());
      this.pill(r.result.toUpperCase(), pillX - resW, this.y + 12, resultColor(r.result));
      this.pill(r.testCase.severity.toUpperCase(), pillX - resW - sevW - 4, this.y + 12, sevC);
      this.y = hy;

      // Category sub-line
      this.setFont('normal', 8.5, COLORS.textMuted);
      this.doc.text(r.testCase.category, this.margin + 14, this.y + 10);
      this.y += 16;

      this.codeBlock('Attack prompt', r.testCase.attackPrompt, COLORS.accent);
      this.codeBlock('Agent response', r.agentResponse, COLORS.fail);

      if (r.reasoning) {
        this.setFont('bold', 7.5, COLORS.textMuted);
        this.ensure(14);
        this.doc.text(`REASONING  ·  CONFIDENCE ${(r.confidence * 100).toFixed(0)}%`, this.margin + 14, this.y + 10);
        this.y += 20;
        this.paragraph(r.reasoning, 9);
      }
      if (r.exploitationEvidence) {
        this.setFont('bold', 7.5, COLORS.fail);
        this.ensure(14);
        this.doc.text('EXPLOITATION EVIDENCE', this.margin + 14, this.y + 10);
        this.y += 20;
        this.paragraph(r.exploitationEvidence, 9);
      }
    } finally {
      this.bodyIndent = 0;
    }

    this.drawSeverityBar(sevC, blockStartPage, blockTop, this.y + 4);

    this.y += 8;
    this.rule(COLORS.rule, 0.3);
  }

  private conclusion(): void {
    this.h1('Conclusion');
    this.paragraph(this.report.conclusion, 10);
  }

  /** Footer + classification on every page. Runs after all content is laid down. */
  private stampFooters(): void {
    const r = this.report;
    const total = this.pageCount;
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      // Footer rule
      this.doc.setDrawColor(...COLORS.rule);
      this.doc.setLineWidth(0.3);
      this.doc.line(this.margin, this.pageH - this.margin + 4, this.pageW - this.margin, this.pageH - this.margin + 4);
      // Left: classification + report id
      this.setFont('bold', 7.5, COLORS.fail);
      this.doc.text('CONFIDENTIAL', this.margin, this.pageH - this.margin + 17);
      this.setFont('normal', 7.5, COLORS.textMuted);
      this.doc.text(`  ·  Report ${r.id.slice(0, 8)}`, this.margin + this.doc.getTextWidth('CONFIDENTIAL'), this.pageH - this.margin + 17);
      // Centre: brand
      this.setFont('normal', 7.5, COLORS.textMuted);
      this.doc.text('Nemesis AI Platform', this.pageW / 2, this.pageH - this.margin + 17, { align: 'center' });
      // Right: page X of Y
      this.doc.text(`Page ${i} of ${total}`, this.pageW - this.margin, this.pageH - this.margin + 17, { align: 'right' });
    }
  }
}

function resolveIds(f: KeyFinding): string[] {
  if (f.related_test_ids && f.related_test_ids.length > 0) return f.related_test_ids;
  const ids = new Set<string>();
  const re = /\bTC-\d+\b/gi;
  for (const t of [f.evidence, f.description]) {
    if (!t) continue;
    const m = t.match(re);
    if (m) for (const x of m) ids.add(x.toUpperCase());
  }
  return Array.from(ids);
}

function buildResultMap(results: TestResultDetail[]): Map<string, TestResultDetail> {
  const m = new Map<string, TestResultDetail>();
  for (const r of results) m.set(r.testCase.externalId.toUpperCase(), r);
  return m;
}

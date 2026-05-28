import Handlebars from 'handlebars';
import { prisma } from '../../lib/prisma';
import { readLogo } from '../../lib/branding';

/**
 * Enterprise-grade HTML rendering for a security audit report. Mirrors the
 * client-side jsPDF design ([client/src/lib/pdf.ts]) so the three delivery
 * paths produce visually consistent output:
 *
 *   - Client "Download PDF" → jsPDF builder
 *   - API GET /reports/:id/export?format=html → this template
 *   - API GET /reports/:id/export?format=pdf → this template + Puppeteer
 *   - Scheduled report attachment → this template
 *
 * Structure: navy banner, classification stamp, prepared-for title, risk-score
 * card (SVG donut + outcomes strip), executive summary with stats strip,
 * numbered findings (F01/F02/…) with severity-color left bars, category
 * breakdown table with zebra rows, tier-pilled remediation roadmap, technical
 * notes, full transcript section, conclusion, classified footer.
 */

// Severity → palette
function sevHex(s: string): { fg: string; bg: string; ring: string } {
  const k = (s || 'low').toLowerCase();
  switch (k) {
    case 'critical': return { fg: '#dc2626', bg: '#fee2e2', ring: '#fecaca' };
    case 'high':     return { fg: '#c2410c', bg: '#ffedd5', ring: '#fed7aa' };
    case 'medium':   return { fg: '#a16207', bg: '#fef3c7', ring: '#fde68a' };
    case 'low':      return { fg: '#1d4ed8', bg: '#dbeafe', ring: '#bfdbfe' };
    case 'informational':
    case 'info':     return { fg: '#475569', bg: '#f1f5f9', ring: '#e2e8f0' };
    default:         return { fg: '#1d4ed8', bg: '#dbeafe', ring: '#bfdbfe' };
  }
}
function resultHex(r: string): { fg: string; bg: string } {
  switch ((r || '').toLowerCase()) {
    case 'pass':    return { fg: '#047857', bg: '#d1fae5' };
    case 'fail':    return { fg: '#b91c1c', bg: '#fee2e2' };
    case 'partial': return { fg: '#a16207', bg: '#fef3c7' };
    case 'error':   return { fg: '#475569', bg: '#f1f5f9' };
    default:        return { fg: '#475569', bg: '#f1f5f9' };
  }
}

Handlebars.registerHelper('sevBg', (s: string) => sevHex(s).bg);
Handlebars.registerHelper('sevFg', (s: string) => sevHex(s).fg);
Handlebars.registerHelper('sevRing', (s: string) => sevHex(s).ring);
Handlebars.registerHelper('resBg', (r: string) => resultHex(r).bg);
Handlebars.registerHelper('resFg', (r: string) => resultHex(r).fg);
Handlebars.registerHelper('upper', (s: string) => (s || '').toUpperCase());
Handlebars.registerHelper('pct', (n: number) => Math.round((n ?? 0) * 100) + '%');
Handlebars.registerHelper('pad2', (n: number) => String(n + 1).padStart(2, '0'));
Handlebars.registerHelper('truncate', (s: string, n: number) =>
  (s || '').length > n ? (s || '').slice(0, n) + '…' : s,
);
Handlebars.registerHelper('arcOffset', (score: number) => {
  // For an SVG donut with r=15.915 (circumference ≈ 100), `score`% fill →
  // stroke-dasharray "<score> <100-score>" starting at the top.
  return Math.max(0, Math.min(100, score ?? 0));
});
Handlebars.registerHelper('scoreColor', (score: number) => {
  if (score >= 75) return '#dc2626';
  if (score >= 50) return '#f97316';
  if (score >= 25) return '#eab308';
  return '#10b981';
});

const TEMPLATE_SOURCE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{report.agent.name}} — Security Audit Report</title>
<style>
  :root { --primary: {{primaryColor}}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
    color: #0f172a;
    background: white;
    line-height: 1.5;
  }
  main { max-width: 920px; margin: 0 auto; padding: 0 32px 48px; }

  /* ── Cover banner ─────────────────────────────────────────────────────── */
  .cover-banner {
    background: var(--primary);
    color: white;
    padding: 24px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .cover-banner .brand { font-weight: 700; font-size: 16px; letter-spacing: 0.04em; }
  .cover-banner .brand small { display: block; font-weight: 400; font-size: 11px; opacity: 0.8; letter-spacing: 0.08em; }
  .cover-banner .date { font-size: 12px; }
  .classification {
    display: inline-block;
    padding: 6px 14px;
    border: 1.5px solid #dc2626;
    color: #dc2626;
    background: white;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.1em;
  }

  /* ── Cover body ───────────────────────────────────────────────────────── */
  .cover-body { padding: 48px 32px 32px; max-width: 920px; margin: 0 auto; }
  .eyebrow {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.12em;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  h1.title {
    font-size: 36px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #0f172a;
    margin: 0 0 12px;
    line-height: 1.15;
  }
  .cover-meta { font-size: 14px; color: #475569; margin-bottom: 32px; }
  .cover-meta b { color: #0f172a; font-weight: 600; }
  .cover-meta .sep { color: #cbd5e1; margin: 0 8px; }

  /* Risk-score callout */
  .risk-callout {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 32px;
    align-items: center;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 28px 32px;
  }
  .risk-donut {
    width: 180px; height: 180px;
  }
  .risk-side .label-row {
    display: flex; align-items: flex-start; gap: 32px;
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid #e2e8f0;
  }
  .stat-label { font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.08em; text-transform: uppercase; }
  .pill {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: white;
    margin-top: 6px;
  }
  .pill.thin {
    background: white;
    border: 1px solid currentColor;
    padding: 2px 8px;
    font-size: 10.5px;
  }
  .big-num { font-size: 28px; font-weight: 800; color: #0f172a; margin-top: 2px; }
  .outcomes {
    display: flex; gap: 28px;
  }
  .outcome-cell { display: flex; align-items: flex-start; gap: 10px; }
  .outcome-cell .dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 8px; flex-shrink: 0; }
  .outcome-cell .v { font-size: 22px; font-weight: 700; line-height: 1; }
  .outcome-cell .l { font-size: 11px; color: #64748b; margin-top: 4px; }

  /* ── Section heading ──────────────────────────────────────────────────── */
  h2.section {
    font-size: 22px;
    font-weight: 700;
    color: var(--primary);
    margin: 36px 0 4px;
    padding-left: 12px;
    border-left: 4px solid var(--primary);
    line-height: 1.2;
  }
  h2.section.accent { color: #6366f1; border-left-color: #6366f1; }
  .section-rule {
    height: 1px;
    background: #e2e8f0;
    margin: 8px 0 20px;
  }

  /* ── Exec-summary stats strip ─────────────────────────────────────────── */
  .stats-strip {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1px;
    background: #e2e8f0;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .stats-cell {
    background: #f8fafc;
    padding: 14px 8px;
    text-align: center;
  }
  .stats-cell .lbl { font-size: 10px; font-weight: 700; color: #64748b; letter-spacing: 0.08em; text-transform: uppercase; }
  .stats-cell .val { font-size: 22px; font-weight: 800; margin-top: 6px; line-height: 1; }

  /* ── Findings ─────────────────────────────────────────────────────────── */
  .finding {
    display: grid;
    grid-template-columns: 4px 1fr;
    gap: 16px;
    padding: 18px 0;
    border-bottom: 1px solid #e2e8f0;
  }
  .finding .sev-bar { border-radius: 2px; min-height: 100%; }
  .finding-num { font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.08em; margin-right: 12px; }
  .finding-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .finding-title { font-size: 16px; font-weight: 700; color: #0f172a; line-height: 1.35; }
  .finding-desc { font-size: 13.5px; color: #334155; margin: 8px 0 14px; }
  .finding-section-label { font-size: 10px; font-weight: 700; color: var(--primary); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
  .finding-recommendation { font-size: 13px; color: #334155; margin-bottom: 14px; }
  .reproducer { margin-top: 6px; }
  .reproducer .repro-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }

  /* ── Code blocks ──────────────────────────────────────────────────────── */
  .codeblock { margin: 6px 0 10px; }
  .codeblock-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
  .codeblock-body {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 12px;
    font-family: ui-monospace, "SF Mono", Monaco, Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    color: #0f172a;
  }

  /* ── Severity / result pills ──────────────────────────────────────────── */
  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    line-height: 1;
  }

  /* ── Category breakdown table ─────────────────────────────────────────── */
  table.category-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 13px;
  }
  table.category-table th {
    background: var(--primary);
    color: white;
    padding: 10px 12px;
    text-align: left;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  table.category-table th.num { text-align: right; }
  table.category-table td {
    padding: 12px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  table.category-table tr:nth-child(even) td { background: #f8fafc; }
  table.category-table td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .fail-num { color: #dc2626; }
  .pass-num { color: #059669; }
  .pct-good { color: #059669; }
  .pct-ok { color: #d97706; }
  .pct-bad { color: #dc2626; }
  td.commentary { color: #475569; font-size: 12.5px; }

  /* ── Remediation roadmap ──────────────────────────────────────────────── */
  .tier { margin-top: 18px; }
  .tier-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 8px;
  }
  .tier-count { font-size: 12px; color: #64748b; }
  .tier-action {
    display: flex; gap: 10px;
    padding: 6px 0;
  }
  .tier-action .bullet {
    width: 6px; height: 6px; border-radius: 50%;
    margin-top: 8px; flex-shrink: 0;
  }
  .tier-action .body .title { font-weight: 700; color: #0f172a; font-size: 13.5px; }
  .tier-action .body .rationale { color: #475569; font-size: 12.5px; margin-top: 4px; line-height: 1.55; }

  /* ── Footer ───────────────────────────────────────────────────────────── */
  .footer-bar {
    border-top: 1px solid #e2e8f0;
    margin-top: 36px;
    padding: 14px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: #64748b;
    max-width: 920px;
    margin-left: auto;
    margin-right: auto;
  }
  .footer-bar .classified { color: #dc2626; font-weight: 700; letter-spacing: 0.1em; }

  @media print {
    body { font-size: 11px; }
    .cover-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2.section { page-break-after: avoid; }
    .finding { page-break-inside: avoid; }
    .reproducer { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<!-- ── Cover banner ──────────────────────────────────────────────────────── -->
<div class="cover-banner">
  <div class="brand">
    {{#if logoDataUri}}<img src="{{logoDataUri}}" alt="" style="height: 26px; vertical-align: middle; margin-right: 12px;">{{/if}}
    NEMESIS AI<small>ADVERSARIAL SECURITY AUDIT</small>
  </div>
  <div style="display: flex; align-items: center; gap: 20px;">
    <span class="date">{{generatedAt}}</span>
    <span class="classification">CONFIDENTIAL</span>
  </div>
</div>

<!-- ── Cover body ────────────────────────────────────────────────────────── -->
<div class="cover-body">
  <div class="eyebrow">PREPARED FOR</div>
  <h1 class="title">{{report.agent.name}}</h1>
  <div class="cover-meta">
    {{report.agent.agentType}}<span class="sep">·</span>{{report.agent.model}}<span class="sep">·</span><b>{{report.testRun.totalTests}}</b> tests executed<span class="sep">·</span>run completed {{runCompletedAt}}
  </div>

  <div class="risk-callout">
    <svg class="risk-donut" viewBox="0 0 42 42" aria-label="Risk score {{report.riskScore}} of 100">
      <circle cx="21" cy="21" r="15.915" fill="white" stroke="#e2e8f0" stroke-width="3.5"/>
      <circle cx="21" cy="21" r="15.915" fill="transparent"
              stroke="{{scoreColor report.riskScore}}" stroke-width="3.5"
              stroke-dasharray="{{arcOffset report.riskScore}} {{arcRemain}}" stroke-dashoffset="25"
              stroke-linecap="round"
              transform="rotate(0 21 21)"/>
      <text x="21" y="22" text-anchor="middle" font-size="11" font-weight="800" fill="{{scoreColor report.riskScore}}">{{report.riskScore}}</text>
      <text x="21" y="28" text-anchor="middle" font-size="3" fill="#64748b">out of 100</text>
    </svg>

    <div class="risk-side">
      <div class="label-row">
        <div>
          <div class="stat-label">Overall risk</div>
          <span class="pill" style="background: {{scoreColor report.riskScore}};">{{upper report.overallRiskRating}}</span>
        </div>
        <div>
          <div class="stat-label">Tests</div>
          <div class="big-num">{{report.testRun.totalTests}}</div>
        </div>
      </div>

      <div class="stat-label">Outcomes</div>
      <div class="outcomes" style="margin-top: 10px;">
        <div class="outcome-cell"><span class="dot" style="background: #10b981;"></span><div><div class="v">{{counts.pass}}</div><div class="l">Pass</div></div></div>
        <div class="outcome-cell"><span class="dot" style="background: #ef4444;"></span><div><div class="v">{{counts.fail}}</div><div class="l">Fail</div></div></div>
        <div class="outcome-cell"><span class="dot" style="background: #f59e0b;"></span><div><div class="v">{{counts.partial}}</div><div class="l">Partial</div></div></div>
        <div class="outcome-cell"><span class="dot" style="background: #64748b;"></span><div><div class="v">{{counts.error}}</div><div class="l">Error</div></div></div>
      </div>
    </div>
  </div>
</div>

<!-- ── Body ─────────────────────────────────────────────────────────────── -->
<main>

  <h2 class="section">Executive summary</h2>
  <div class="section-rule"></div>
  <div class="stats-strip">
    <div class="stats-cell"><div class="lbl">Risk score</div><div class="val" style="color: {{scoreColor report.riskScore}};">{{report.riskScore}}</div></div>
    <div class="stats-cell"><div class="lbl">Rating</div><div class="val" style="color: {{scoreColor report.riskScore}};">{{upper report.overallRiskRating}}</div></div>
    <div class="stats-cell"><div class="lbl">Tests</div><div class="val">{{report.testRun.totalTests}}</div></div>
    <div class="stats-cell"><div class="lbl">Pass rate</div><div class="val" style="color: {{passRateColor}};">{{passRatePct}}%</div></div>
    <div class="stats-cell"><div class="lbl">Findings</div><div class="val">{{keyFindings.length}}</div></div>
  </div>
  <p style="font-size: 14px; color: #334155; margin: 0;">{{report.executiveSummary}}</p>

  <h2 class="section accent">Findings</h2>
  <div class="section-rule"></div>
  {{#each keyFindings}}
    <div class="finding">
      <div class="sev-bar" style="background: {{sevFg severity}};"></div>
      <div>
        <div class="finding-head">
          <div>
            <span class="finding-num">F{{pad2 @index}}</span>
            <span class="finding-title">{{title}}</span>
          </div>
          <span class="badge" style="background: {{sevFg severity}}; color: white;">{{upper severity}}</span>
        </div>
        <div class="finding-desc">{{description}}</div>
        {{#if recommendation}}
          <div class="finding-section-label">RECOMMENDATION</div>
          <div class="finding-recommendation">{{recommendation}}</div>
        {{/if}}
        {{#if reproducers.length}}
          <div class="finding-section-label">REPRODUCING TESTS · {{reproducers.length}}</div>
          {{#each reproducers}}
            <div class="reproducer">
              <div class="repro-title">
                <span><b>{{testCase.externalId}}</b><span style="color: #64748b;"> · </span>{{testCase.name}}</span>
                <span class="badge" style="background: {{resFg result}}; color: white;">{{upper result}}</span>
              </div>
              <div class="codeblock">
                <div class="codeblock-label" style="color: #6366f1;">ATTACK PROMPT</div>
                <div class="codeblock-body">{{truncate testCase.attackPrompt 600}}</div>
              </div>
              <div class="codeblock">
                <div class="codeblock-label" style="color: #dc2626;">AGENT RESPONSE</div>
                <div class="codeblock-body">{{truncate agentResponse 600}}</div>
              </div>
            </div>
          {{/each}}
        {{/if}}
      </div>
    </div>
  {{else}}
    <div style="color: #64748b; font-style: italic; padding: 12px 0;">No notable findings.</div>
  {{/each}}

  <h2 class="section">Category breakdown</h2>
  <div class="section-rule"></div>
  <table class="category-table">
    <thead>
      <tr>
        <th>Category</th>
        <th class="num">Tests</th>
        <th class="num">Failures</th>
        <th class="num">Pass rate</th>
        <th>Commentary</th>
      </tr>
    </thead>
    <tbody>
      {{#each categoryBreakdown}}
        <tr>
          <td>{{category}}</td>
          <td class="num">{{total_tests}}</td>
          <td class="num {{#if failures}}fail-num{{else}}pass-num{{/if}}">{{failures}}</td>
          <td class="num {{#if (gte pass_rate 0.75)}}pct-good{{else if (gte pass_rate 0.5)}}pct-ok{{else}}pct-bad{{/if}}">{{pct pass_rate}}</td>
          <td class="commentary">{{commentary}}</td>
        </tr>
      {{/each}}
    </tbody>
  </table>

  <h2 class="section">Remediation roadmap</h2>
  <div class="section-rule"></div>
  {{#each tiers}}
    {{#if items.length}}
      <div class="tier">
        <div class="tier-header">
          <span class="badge" style="background: {{color}}; color: white;">{{upper label}}</span>
          <span class="tier-count">{{items.length}} action{{#unless one}}s{{/unless}}</span>
        </div>
        {{#each items}}
          <div class="tier-action">
            <div class="bullet" style="background: {{../color}};"></div>
            <div class="body">
              <div class="title">{{action}}</div>
              <div class="rationale">{{rationale}}</div>
            </div>
          </div>
        {{/each}}
      </div>
    {{/if}}
  {{/each}}

  <h2 class="section">Technical notes</h2>
  <div class="section-rule"></div>
  <p style="font-size: 13.5px; color: #334155; white-space: pre-line; margin: 0;">{{report.technicalNotes}}</p>

  {{#if results.length}}
    <h2 class="section">All test results</h2>
    <div class="section-rule"></div>
    <p style="color: #64748b; font-size: 12px; margin: 0 0 16px;">{{results.length}} tests executed — verbatim attack prompts and agent responses below.</p>
    {{#each results}}
      <div class="finding">
        <div class="sev-bar" style="background: {{sevFg testCase.severity}};"></div>
        <div>
          <div class="finding-head">
            <div>
              <span class="finding-title"><b>{{testCase.externalId}}</b><span style="color: #64748b;"> · </span>{{testCase.name}}</span>
            </div>
            <div>
              <span class="badge" style="background: {{sevFg testCase.severity}}; color: white; margin-right: 4px;">{{upper testCase.severity}}</span>
              <span class="badge" style="background: {{resFg result}}; color: white;">{{upper result}}</span>
            </div>
          </div>
          <div style="font-size: 11.5px; color: #64748b; margin: 6px 0 8px;">{{testCase.category}}</div>
          <div class="codeblock">
            <div class="codeblock-label" style="color: #6366f1;">ATTACK PROMPT</div>
            <div class="codeblock-body">{{truncate testCase.attackPrompt 800}}</div>
          </div>
          <div class="codeblock">
            <div class="codeblock-label" style="color: #dc2626;">AGENT RESPONSE</div>
            <div class="codeblock-body">{{truncate agentResponse 800}}</div>
          </div>
          {{#if reasoning}}
            <div class="finding-section-label" style="color: #64748b;">REASONING · CONFIDENCE {{confidencePct}}%</div>
            <div class="finding-recommendation">{{reasoning}}</div>
          {{/if}}
          {{#if exploitationEvidence}}
            <div class="finding-section-label" style="color: #dc2626;">EXPLOITATION EVIDENCE</div>
            <div class="finding-recommendation">{{exploitationEvidence}}</div>
          {{/if}}
        </div>
      </div>
    {{/each}}
  {{/if}}

  <h2 class="section">Conclusion</h2>
  <div class="section-rule"></div>
  <p style="font-size: 14px; color: #334155; white-space: pre-line; margin: 0;">{{report.conclusion}}</p>

  {{#if customSections}}
    <h2 class="section">Additional context</h2>
    <div class="section-rule"></div>
    {{#each customSections}}
      <h3 style="font-size: 14px; margin: 14px 0 6px; color: #0f172a;">{{title}}</h3>
      <div style="font-size: 13px; color: #334155;">{{{body}}}</div>
    {{/each}}
  {{/if}}

</main>

<div class="footer-bar">
  <span><span class="classified">CONFIDENTIAL</span> · Report {{shortId}}</span>
  <span>Nemesis AI Platform</span>
  <span>Generated {{generatedAt}}</span>
</div>

</body>
</html>`;

// Tiny helper for use inside the template ({{#if (gte x y)}}).
Handlebars.registerHelper('gte', (a: number, b: number) => (a ?? 0) >= (b ?? 0));

const compiled = Handlebars.compile(TEMPLATE_SOURCE);

interface FindingShape {
  title?: string;
  severity?: string;
  description?: string;
  recommendation?: string;
  evidence?: string;
  related_test_ids?: string[];
  [k: string]: unknown;
}
interface CategoryShape {
  category?: string;
  total_tests?: number;
  failures?: number;
  pass_rate?: number;
  commentary?: string;
  [k: string]: unknown;
}
interface RoadmapShape {
  priority?: 'immediate' | 'short_term' | 'long_term' | string;
  action?: string;
  rationale?: string;
  [k: string]: unknown;
}

function asArray<T>(j: unknown): T[] {
  if (Array.isArray(j)) return j as T[];
  if (j && typeof j === 'object') {
    const o = j as { findings?: T[]; items?: T[] };
    if (Array.isArray(o.findings)) return o.findings;
    if (Array.isArray(o.items)) return o.items;
  }
  return [];
}

interface CustomSection { title: string; body: string }

/** Render a Report row to standalone HTML with branding inlined (logo as data URI). */
export async function renderReportHtml(reportId: string, customSections?: CustomSection[]): Promise<string> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      testRun: {
        include: {
          suite: {
            include: {
              agent: { include: { org: { include: { brandingProfile: true } } } },
            },
          },
          results: { include: { testCase: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  if (!report) throw new Error(`report ${reportId} not found`);
  const agent = report.testRun.suite.agent;
  const org = agent.org;
  const branding = org.brandingProfile;

  let logoDataUri = '';
  if (branding?.logoStoragePath && branding.logoMime) {
    const buf = await readLogo(branding.logoStoragePath);
    if (buf) logoDataUri = `data:${branding.logoMime};base64,${buf.toString('base64')}`;
  }

  // Index reproducing tests by external id so findings can render them inline.
  const resultsByExternalId = new Map<string, typeof report.testRun.results[number]>();
  for (const r of report.testRun.results) resultsByExternalId.set(r.testCase.externalId.toUpperCase(), r);

  const keyFindings = asArray<FindingShape>(report.keyFindings).map((f) => {
    const ids: string[] = Array.isArray(f.related_test_ids) ? f.related_test_ids : [];
    const reproducers = ids
      .map((id) => resultsByExternalId.get(String(id).toUpperCase()))
      .filter((r): r is NonNullable<typeof r> => !!r);
    return { ...f, reproducers };
  });

  const counts = {
    pass: report.testRun.results.filter((r) => r.result === 'pass').length,
    fail: report.testRun.results.filter((r) => r.result === 'fail').length,
    partial: report.testRun.results.filter((r) => r.result === 'partial').length,
    error: report.testRun.results.filter((r) => r.result === 'error').length,
  };
  const total = report.testRun.results.length;
  const passRatePct = total > 0 ? Math.round((counts.pass / total) * 100) : 0;
  const passRateColor =
    passRatePct >= 75 ? '#10b981' : passRatePct >= 50 ? '#f59e0b' : '#dc2626';

  // Bucket roadmap actions into tiers for the template.
  const roadmap = asArray<RoadmapShape>(report.remediationRoadmap);
  const tiers = [
    { key: 'immediate', label: 'Immediate', color: '#dc2626', items: roadmap.filter((r) => r.priority === 'immediate') },
    { key: 'short_term', label: 'Short term', color: '#f97316', items: roadmap.filter((r) => r.priority === 'short_term') },
    { key: 'long_term', label: 'Long term', color: '#3b82f6', items: roadmap.filter((r) => r.priority === 'long_term') },
  ].map((t) => ({ ...t, one: t.items.length === 1 }));

  const results = report.testRun.results.map((r) => ({
    ...r,
    confidencePct: Math.round((r.confidence ?? 0) * 100),
  }));

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const runCompletedAt = report.testRun.completedAt
    ? new Date(report.testRun.completedAt).toISOString().replace('T', ' ').slice(0, 16)
    : 'in progress';

  return compiled({
    primaryColor: branding?.primaryColor ?? '#1f3a6e',
    logoDataUri,
    org: { name: org.name },
    report: {
      id: report.id,
      executiveSummary: report.executiveSummary,
      overallRiskRating: report.overallRiskRating,
      riskScore: report.riskScore,
      technicalNotes: report.technicalNotes,
      conclusion: report.conclusion,
      agent: { name: agent.name, agentType: agent.agentType, model: agent.model },
      testRun: { totalTests: report.testRun.totalTests },
    },
    keyFindings,
    categoryBreakdown: asArray<CategoryShape>(report.categoryBreakdown),
    tiers,
    results,
    counts,
    passRatePct,
    passRateColor,
    arcRemain: Math.max(0, 100 - report.riskScore),
    customSections: customSections ?? [],
    generatedAt,
    runCompletedAt,
    shortId: report.id.slice(0, 8),
  });
}

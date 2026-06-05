import { useMemo } from 'react';
import { KeyFinding, TestResultDetail } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { SeverityBadge, ResultBadge } from '@/components/shared/SeverityBadge';

interface FindingCardProps {
  finding: KeyFinding;
  /** Map from external TC id (e.g. "TC-014") → full test result so we can render prompt+response inline. */
  testCaseById?: Map<string, TestResultDetail>;
}

/**
 * Resolve which test cases this finding refers to. Prefers the explicit
 * related_test_ids array; falls back to scraping `TC-NNN` patterns from
 * the evidence/description text for legacy reports without the array.
 */
function resolveRelatedIds(finding: KeyFinding): string[] {
  if (finding.related_test_ids && finding.related_test_ids.length > 0) {
    return finding.related_test_ids;
  }
  const ids = new Set<string>();
  const re = /\bTC-\d+\b/gi;
  for (const text of [finding.evidence, finding.description]) {
    if (!text) continue;
    const matches = text.match(re);
    if (matches) for (const m of matches) ids.add(m.toUpperCase());
  }
  return Array.from(ids);
}

export function FindingCard({ finding, testCaseById }: FindingCardProps) {
  const relatedIds = useMemo(() => resolveRelatedIds(finding), [finding]);
  const relatedResults = useMemo(
    () => relatedIds.map((id) => testCaseById?.get(id)).filter((r): r is TestResultDetail => !!r),
    [relatedIds, testCaseById],
  );

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">{finding.title}</h3>
          <SeverityBadge severity={finding.severity} />
        </div>
        <p className="text-sm text-muted-foreground">{finding.description}</p>

        {finding.recommendation && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommendation</div>
            <p className="mt-1 text-sm text-foreground">{finding.recommendation}</p>
          </div>
        )}

        {/* Reproducing tests — the actual prompts that surfaced this finding */}
        {relatedResults.length > 0 ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reproducing tests ({relatedResults.length})
            </div>
            <ul className="mt-2 space-y-3">
              {relatedResults.map((r) => (
                <li key={r.id} className="rounded-md border border-border bg-muted/60 p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">{r.testCase.externalId}</span>
                    <span>·</span>
                    <span className="font-mono">{r.testCase.category}</span>
                    <span>·</span>
                    <SeverityBadge severity={r.testCase.severity} />
                    <ResultBadge result={r.result} />
                  </div>
                  <div className="text-sm font-medium text-foreground">{r.testCase.name}</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Attack prompt</div>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-card p-2 text-[11px] text-foreground ring-1 ring-border">
                        {r.testCase.attackPrompt}
                      </pre>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">Agent response</div>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-card p-2 text-[11px] text-foreground ring-1 ring-border">
                        {r.agentResponse}
                      </pre>
                    </div>
                  </div>
                  {r.exploitationEvidence && (
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exploitation evidence</div>
                      <p className="mt-1 text-xs text-foreground">{r.exploitationEvidence}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          // Legacy / unparseable findings — fall back to LLM-supplied evidence text only
          finding.evidence && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-foreground">
                {finding.evidence}
              </pre>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

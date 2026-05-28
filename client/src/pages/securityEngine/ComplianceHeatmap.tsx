import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';

interface Probe {
  id: string;
  slug: string;
  title: string;
  severity: string;
  source: string;
}

interface ControlCell {
  control: { id: string; title: string; shortDescription: string };
  probes: Probe[];
}

type Heatmap = Record<string, Record<string, ControlCell>>;

const FRAMEWORK_TITLES: Record<string, string> = {
  OWASP_LLM_TOP10: 'OWASP LLM Top 10 (2025)',
  MITRE_ATLAS: 'MITRE ATLAS',
  NIST_AI_RMF: 'NIST AI RMF',
  EU_AI_ACT: 'EU AI Act',
};

function coverageTone(count: number): string {
  if (count === 0) return 'bg-muted/40 text-muted-foreground border-border';
  if (count < 2) return 'bg-amber-50 text-amber-900 border-amber-200';
  if (count < 4) return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  return 'bg-emerald-100 text-emerald-900 border-emerald-300';
}

export default function ComplianceHeatmap() {
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const { data } = await api.get<{ heatmap: Heatmap }>('/security-engine/compliance/heatmap');
      setHeatmap(data.heatmap);
    } catch (err) {
      const m = apiError(err);
      setLoadError(m);
      toast.error(m);
    }
  }
  useEffect(() => { void load(); }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} full />;
  if (!heatmap) return <FullPageLoader />;

  const orderedFrameworks = ['OWASP_LLM_TOP10', 'MITRE_ATLAS', 'NIST_AI_RMF', 'EU_AI_ACT']
    .filter((f) => f in heatmap);

  return (
    <>
      <PageHeader
        title="Compliance heatmap"
        description="Coverage of probes against framework controls. Greener cells = more probes mapped to that control."
      />

      <div className="space-y-4">
        {orderedFrameworks.map((fw) => {
          const controls = heatmap[fw];
          const ids = Object.keys(controls).sort();
          const totalCovered = ids.filter((id) => controls[id].probes.length > 0).length;
          return (
            <Card key={fw}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{FRAMEWORK_TITLES[fw] ?? fw}</CardTitle>
                    <CardDescription>
                      {totalCovered}/{ids.length} controls covered by at least one probe
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{fw}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {ids.map((id) => {
                    const cell = controls[id];
                    return (
                      <div
                        key={id}
                        className={`rounded-md border p-3 text-xs ${coverageTone(cell.probes.length)}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono font-semibold">{id}</span>
                          <span>{cell.probes.length} {cell.probes.length === 1 ? 'probe' : 'probes'}</span>
                        </div>
                        <div className="mt-1 text-sm font-medium">{cell.control.title}</div>
                        <p className="mt-1 leading-snug opacity-80">{cell.control.shortDescription}</p>
                        {cell.probes.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {cell.probes.slice(0, 5).map((p) => (
                              <span key={p.id} className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-black/10">
                                {p.slug}
                              </span>
                            ))}
                            {cell.probes.length > 5 && (
                              <span className="text-[10px] opacity-60">+{cell.probes.length - 5} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

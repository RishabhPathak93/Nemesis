import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Database, RefreshCw, ExternalLink, ArrowUpCircle } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';

interface DatasetSnapshot {
  id: string;
  source: string;
  version: string;
  itemCount: number;
  fetchedAt: string;
  licenseUrl: string | null;
  citation: string | null;
}

const SUPPORTED_FETCHERS = [
  { source: 'harmbench', title: 'HarmBench', repo: 'centerforaisafety/HarmBench' },
  { source: 'advbench', title: 'AdvBench', repo: 'llm-attacks/llm-attacks' },
  { source: 'donotanswer', title: 'DoNotAnswer', repo: 'Libr-AI/do-not-answer' },
  { source: 'cybersec_eval', title: 'CyberSecEval', repo: 'meta-llama/PurpleLlama' },
];

export default function Datasets() {
  const [datasets, setDatasets] = useState<DatasetSnapshot[] | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const { data } = await api.get<{ datasets: DatasetSnapshot[] }>('/security-engine/datasets');
      setDatasets(data.datasets);
    } catch (err) { const m = apiError(err); setLoadError(m); toast.error(m); }
  }
  useEffect(() => { void load(); }, []);

  async function refresh(source: string) {
    setRefreshing(source);
    try {
      const { data } = await api.post<{ ok: boolean; itemCount: number }>(
        `/security-engine/datasets/refresh?source=${source}`,
      );
      if (data.ok) toast.success(`${source} fetched: ${data.itemCount} items`);
      else toast.error('Fetch failed.');
      await load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setRefreshing(null); }
  }

  async function promote(source: string) {
    setPromoting(source);
    try {
      const { data } = await api.post<{ ok: boolean; promoted: number; totalCandidates: number }>(
        `/security-engine/datasets/promote-all?source=${source}`,
      );
      if (data.promoted === 0 && data.totalCandidates === 0) {
        toast.info(`${source}: all items already promoted to probes`);
      } else {
        toast.success(`${source}: promoted ${data.promoted} item${data.promoted === 1 ? '' : 's'} to probes`);
      }
    } catch (err) { toast.error(apiError(err)); }
    finally { setPromoting(null); }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} full />;
  if (!datasets) return <FullPageLoader />;

  const bySource = new Map(datasets.map((d) => [d.source, d]));

  return (
    <>
      <PageHeader
        title="Public datasets"
        description="Snapshot HarmBench / AdvBench / DoNotAnswer / CyberSecEval and materialise items as Probe rows. Operator-triggered only — no auto-update phone-home."
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" /> Available fetchers</CardTitle>
          <CardDescription>Refresh pulls the latest version. Promote materialises the snapshot items as Probe rows.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead><TableHead>Repo</TableHead>
                <TableHead>Snapshot</TableHead><TableHead>Items</TableHead>
                <TableHead>Fetched</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SUPPORTED_FETCHERS.map((f) => {
                const snap = bySource.get(f.source);
                return (
                  <TableRow key={f.source}>
                    <TableCell className="font-medium">{f.title}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <a href={`https://github.com/${f.repo}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1">
                        {f.repo} <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell>{snap ? <Badge>{snap.version}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{snap?.itemCount ?? '—'}</TableCell>
                    <TableCell className="text-xs">{snap ? new Date(snap.fetchedAt).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={refreshing === f.source} onClick={() => refresh(f.source)}>
                          <RefreshCw className={`mr-1 h-3 w-3 ${refreshing === f.source ? 'animate-spin' : ''}`} />
                          {refreshing === f.source ? 'Fetching…' : 'Refresh'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!snap || promoting === f.source}
                          onClick={() => promote(f.source)}
                          title={snap ? 'Promote all unpromoted items into the Probe library' : 'Refresh first'}
                        >
                          <ArrowUpCircle className="mr-1 h-3 w-3" />
                          {promoting === f.source ? 'Promoting…' : 'Promote'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {datasets.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Snapshot details</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead><TableHead>Version</TableHead>
                  <TableHead>License</TableHead><TableHead>Citation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.source}</TableCell>
                    <TableCell className="font-mono text-xs">{d.version}</TableCell>
                    <TableCell>{d.licenseUrl ? <a className="text-indigo-600 dark:text-indigo-400 underline" href={d.licenseUrl} target="_blank" rel="noopener noreferrer">view</a> : '—'}</TableCell>
                    <TableCell className="text-xs">{d.citation ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

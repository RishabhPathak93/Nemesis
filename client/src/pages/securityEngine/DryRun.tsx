import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Play, ChevronRight } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface Probe { id: string; slug: string; title: string; severity: string; source: string }
interface Strategy { id: string; slug: string; family: string; kind: string; title: string }
interface Agent { id: string; name: string }

interface SingleResult {
  orchestrator: 'single';
  transformedPayload: string;
  response: string;
}
interface MultiTurnResult {
  orchestrator: 'crescendo' | 'skeleton_key' | 'tap' | 'goat' | 'model_extraction' | 'membership_inference' | 'training_data_replay';
  threadId: string;
  worstResponse: string;
  succeeded: boolean;
  rationale: string;
  turnsUsed: number;
  transcript: { turn: number; role: string; content: string }[];
}
type DryRunResult = SingleResult | MultiTurnResult;

export default function DryRun() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [agentId, setAgentId] = useState('');
  const [probeSlug, setProbeSlug] = useState('');
  const [chain, setChain] = useState<string[]>([]);
  const [orchestrator, setOrchestrator] = useState<'single' | 'crescendo' | 'skeleton_key' | 'tap' | 'goat' | 'model_extraction' | 'membership_inference' | 'training_data_replay'>('single');
  const [translateLanguage, setTranslateLanguage] = useState('');
  const [maxTurns, setMaxTurns] = useState('5');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);

  async function load() {
    try {
      const [p, s, a] = await Promise.all([
        api.get<{ probes: Probe[] }>('/security-engine/probes?limit=200'),
        api.get<{ strategies: Strategy[] }>('/security-engine/strategies'),
        api.get<Agent[]>('/agents'),
      ]);
      setProbes(p.data.probes);
      setStrategies(s.data.strategies);
      setAgents(a.data);
      if (p.data.probes.length > 0) setProbeSlug(p.data.probes[0].slug);
      if (a.data.length > 0) setAgentId(a.data[0].id);
    } catch (err) { toast.error(apiError(err)); }
  }
  useEffect(() => { void load(); }, []);

  function toggleChain(slug: string) {
    setChain((curr) => (curr.includes(slug) ? curr.filter((s) => s !== slug) : [...curr, slug]));
  }
  function moveChain(idx: number, dir: -1 | 1) {
    setChain((curr) => {
      const next = [...curr];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return curr;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function go() {
    if (!agentId) { toast.error('Pick a target agent.'); return; }
    if (!probeSlug) { toast.error('Pick a probe.'); return; }
    setRunning(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        agentId, probeSlug, orchestrator, strategyChain: chain,
      };
      if (translateLanguage.trim()) body.translateLanguage = translateLanguage.trim();
      if (orchestrator !== 'single' && orchestrator !== 'skeleton_key') body.maxTurns = parseInt(maxTurns, 10) || 5;
      const { data } = await api.post<DryRunResult>('/security-engine/dry-run', body);
      setResult(data);
    } catch (err) { toast.error(apiError(err)); }
    finally { setRunning(false); }
  }

  return (
    <>
      <PageHeader
        title="Dry-run console"
        description="Compose a probe, optional strategy chain, and orchestrator. Fires once at the chosen agent without committing a TestRun."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Composer</CardTitle>
            <CardDescription>Configure a single probe + attack strategy and test it against one agent without saving a report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Target agent</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder="Pick agent" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Probe</Label>
              <Select value={probeSlug} onValueChange={setProbeSlug}>
                <SelectTrigger><SelectValue placeholder="Pick probe" /></SelectTrigger>
                <SelectContent>
                  {probes.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.slug} — {p.title.slice(0, 50)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Translation pre-step (optional)</Label>
              <Input value={translateLanguage} onChange={(e) => setTranslateLanguage(e.target.value)} placeholder="e.g. zu, xh, mt — leave blank to skip" />
            </div>
            <div>
              <Label>Strategy chain (apply in order)</Label>
              <div className="mt-1 mb-2 min-h-[28px] flex flex-wrap items-center gap-1">
                {chain.length === 0 ? (
                  <span className="text-xs text-muted-foreground">none — payload sent unmodified</span>
                ) : (
                  chain.map((slug, i) => (
                    <span key={`${slug}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[11px] text-indigo-800">
                      {slug}
                      <button type="button" aria-label="Move up" className="opacity-60 hover:opacity-100" onClick={() => moveChain(i, -1)} disabled={i === 0}>↑</button>
                      <button type="button" aria-label="Move down" className="opacity-60 hover:opacity-100" onClick={() => moveChain(i, 1)} disabled={i === chain.length - 1}>↓</button>
                      <button type="button" aria-label="Remove from chain" className="opacity-60 hover:opacity-100" onClick={() => toggleChain(slug)}>×</button>
                      {i < chain.length - 1 && <ChevronRight className="h-3 w-3 opacity-50" />}
                    </span>
                  ))
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {strategies
                  .filter((s) => s.family === 'encoding' || s.family === 'framing' || s.family === 'composite')
                  .map((s) => (
                    <button
                      key={s.slug} type="button"
                      onClick={() => toggleChain(s.slug)}
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${chain.includes(s.slug) ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-border text-muted-foreground hover:border-indigo-200 dark:border-indigo-500/30'}`}
                    >
                      {s.slug}
                    </button>
                  ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Orchestrator</Label>
                <Select value={orchestrator} onValueChange={(v) => setOrchestrator(v as typeof orchestrator)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single-turn</SelectItem>
                    <SelectItem value="skeleton_key">Skeleton Key (2-turn)</SelectItem>
                    <SelectItem value="crescendo">Crescendo (multi-turn)</SelectItem>
                    <SelectItem value="tap">TAP (Tree of Attacks with Pruning)</SelectItem>
                    <SelectItem value="goat">GOAT (autonomous attacker)</SelectItem>
                    <SelectItem value="model_extraction">Model Extraction (system-prompt leak budget)</SelectItem>
                    <SelectItem value="membership_inference">Membership Inference (canary recall)</SelectItem>
                    <SelectItem value="training_data_replay">Training-Data Replay (verbatim leakage)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {orchestrator !== 'single' && orchestrator !== 'skeleton_key' && (
                <div>
                  <Label>{orchestrator === 'tap' ? 'Tree depth' : orchestrator === 'model_extraction' || orchestrator === 'membership_inference' || orchestrator === 'training_data_replay' ? 'Query budget' : 'Max turns'}</Label>
                  <Input type="number" min={1} max={20} value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} />
                </div>
              )}
            </div>
            <Button onClick={go} disabled={running} className="w-full">
              <Play className="mr-1 h-4 w-4" /> {running ? 'Running…' : 'Run'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
            <CardDescription>Each dry-run is recorded in the audit log.</CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-sm text-muted-foreground">Run a probe to see results here.</p>
            ) : result.orchestrator === 'single' ? (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 font-medium text-foreground">Transformed payload</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{result.transformedPayload}</pre>
                </div>
                <div>
                  <div className="mb-1 font-medium text-foreground">Agent response</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{result.response}</pre>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={result.succeeded ? 'default' : 'outline'}>
                    {result.succeeded ? 'compromised' : 'no compromise'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {result.orchestrator} · {result.turnsUsed} turns · thread <code className="font-mono text-[10px]">{result.threadId}</code>
                  </span>
                </div>
                <div className="text-xs text-foreground"><strong>Rationale:</strong> {result.rationale}</div>
                <div>
                  <div className="mb-1 font-medium text-foreground">Worst response</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{result.worstResponse}</pre>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-indigo-600 dark:text-indigo-400">Show transcript ({result.transcript.length} messages)</summary>
                  <div className="mt-2 space-y-2 max-h-72 overflow-auto">
                    {result.transcript.map((t, i) => (
                      <div key={i} className="border-l-2 border-border pl-2 text-xs">
                        <div className="font-mono text-[10px] text-muted-foreground">turn {t.turn} · {t.role}</div>
                        <pre className="whitespace-pre-wrap">{t.content.slice(0, 600)}{t.content.length > 600 ? '…' : ''}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

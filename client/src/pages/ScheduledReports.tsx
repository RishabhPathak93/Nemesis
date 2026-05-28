import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Play, Calendar } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';

interface ScheduledReport {
  id: string;
  scope: string;
  agentId: string | null;
  cronExpr: string;
  timezone: string;
  channels: string[];
  format: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

interface Channel { id: string; name: string; kind: string }
interface Agent { id: string; name: string }

export default function ScheduledReports() {
  const [reports, setReports] = useState<ScheduledReport[] | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [scope, setScope] = useState<'ORG' | 'AGENT'>('AGENT');
  const [agentId, setAgentId] = useState('');
  const [cronExpr, setCronExpr] = useState('0 9 * * MON');
  const [timezone, setTimezone] = useState('UTC');
  const [pickedChannels, setPickedChannels] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<'HTML' | 'PDF'>('HTML');
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const [r, c, a] = await Promise.all([
        api.get<{ scheduledReports: ScheduledReport[] }>('/settings/scheduled-reports'),
        api.get<{ channels: Channel[] }>('/settings/notifications'),
        api.get<Agent[]>('/agents'),
      ]);
      setReports(r.data.scheduledReports);
      setChannels(c.data.channels);
      setAgents(a.data);
      if (a.data.length > 0 && !agentId) setAgentId(a.data[0].id);
    } catch (err) { toast.error(apiError(err)); }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    if (pickedChannels.size === 0) { toast.error('Pick at least one channel.'); return; }
    if (scope === 'AGENT' && !agentId) { toast.error('Pick an agent.'); return; }
    setCreating(true);
    try {
      await api.post('/settings/scheduled-reports', {
        scope, agentId: scope === 'AGENT' ? agentId : null,
        cronExpr, timezone, channels: [...pickedChannels], format,
      });
      toast.success('Schedule created');
      setPickedChannels(new Set());
      await load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setCreating(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this schedule?')) return;
    try { await api.delete(`/settings/scheduled-reports/${id}`); await load(); }
    catch (err) { toast.error(apiError(err)); }
  }

  async function runNow(id: string) {
    try { await api.post(`/settings/scheduled-reports/${id}/run-now`); toast.success('Triggered'); }
    catch (err) { toast.error(apiError(err)); }
  }

  if (!reports) return <FullPageLoader />;

  return (
    <>
      <PageHeader title="Scheduled reports" description="Cron-driven report delivery to your configured notification channels." />

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> New schedule</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div><Label>Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as 'ORG' | 'AGENT')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AGENT">Agent</SelectItem>
                  <SelectItem value="ORG">Whole org</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === 'AGENT' && (
              <div><Label>Agent</Label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger><SelectValue placeholder="Pick an agent" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Cron</Label>
              <Input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="0 9 * * MON" className="font-mono" />
            </div>
            <div><Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
            </div>
            <div className="md:col-span-2"><Label>Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as 'HTML' | 'PDF')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HTML">Standalone HTML</SelectItem>
                  <SelectItem value="PDF">PDF (client-side rendering)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Channels (multi-select)</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {channels.map((c) => (
                  <button
                    key={c.id} type="button"
                    onClick={() => {
                      const next = new Set(pickedChannels);
                      if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                      setPickedChannels(next);
                    }}
                    className={`rounded border px-2 py-1 text-xs ${pickedChannels.has(c.id) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-border text-muted-foreground'}`}
                  >
                    {c.name} <span className="font-mono opacity-60">({c.kind})</span>
                  </button>
                ))}
                {channels.length === 0 && <span className="text-xs text-muted-foreground">No channels yet — create one in Notifications first.</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={create} disabled={creating}><Calendar className="mr-1 h-4 w-4" /> {creating ? 'Creating…' : 'Schedule'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Schedules ({reports.length})</CardTitle></CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled reports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead><TableHead>Cron (TZ)</TableHead><TableHead>Format</TableHead>
                  <TableHead>Channels</TableHead><TableHead>Last run</TableHead><TableHead>Next run</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline">{r.scope}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.cronExpr} <span className="opacity-60">({r.timezone})</span></TableCell>
                    <TableCell><Badge>{r.format}</Badge></TableCell>
                    <TableCell className="text-xs">{r.channels.length}</TableCell>
                    <TableCell className="text-xs">{r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-xs">{r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => runNow(r.id)}><Play className="h-3 w-3 mr-1" /> Run</Button>
                        <Button size="sm" variant="outline" onClick={() => remove(r.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

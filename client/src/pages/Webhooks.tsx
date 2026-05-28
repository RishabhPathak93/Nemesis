import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, RotateCw, Send, Copy } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  failureCount: number;
}

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [knownEvents, setKnownEvents] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [eventChecks, setEventChecks] = useState<Set<string>>(new Set());
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<{ webhooks: Webhook[]; knownEvents: string[] }>('/settings/webhooks');
      setWebhooks(data.webhooks);
      setKnownEvents(data.knownEvents);
    } catch (err) { toast.error(apiError(err)); }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    if (!name || !url) { toast.error('Name and URL are required.'); return; }
    setCreating(true);
    try {
      const { data } = await api.post<{ secret: string; id: string }>('/settings/webhooks', {
        name, url, events: [...eventChecks],
      });
      setIssuedSecret(data.secret);
      setName(''); setUrl(''); setEventChecks(new Set());
      await load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setCreating(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this webhook?')) return;
    try { await api.delete(`/settings/webhooks/${id}`); await load(); }
    catch (err) { toast.error(apiError(err)); }
  }

  async function rotate(id: string) {
    if (!confirm('Rotate signing secret? The old secret stops working immediately.')) return;
    try {
      const { data } = await api.post<{ secret: string }>(`/settings/webhooks/${id}/rotate-secret`);
      setIssuedSecret(data.secret);
      await load();
    } catch (err) { toast.error(apiError(err)); }
  }

  async function test(id: string) {
    try {
      await api.post(`/settings/webhooks/${id}/test`);
      toast.success('Test event queued — check the Deliveries view shortly.');
    } catch (err) { toast.error(apiError(err)); }
  }

  function copySecret() {
    if (!issuedSecret) return;
    void navigator.clipboard.writeText(issuedSecret);
    toast.success('Secret copied.');
  }

  if (!webhooks) return <FullPageLoader />;

  return (
    <>
      <PageHeader title="Webhooks" description="HMAC-signed outbound event deliveries with exponential-backoff retry." />

      {issuedSecret && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="pt-5">
            <p className="mb-2 text-sm font-medium text-amber-900">Signing secret — shown ONCE, copy it now:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-900">{issuedSecret}</code>
              <Button size="sm" variant="outline" onClick={copySecret}><Copy className="mr-1 h-4 w-4" /> Copy</Button>
              <Button size="sm" variant="outline" onClick={() => setIssuedSecret(null)}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> New webhook</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production alerts" /></div>
            <div><Label>URL (https://...)</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/cortexview" /></div>
          </div>
          <div className="mt-3">
            <Label>Subscribed events</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {knownEvents.map((evt) => (
                <button
                  key={evt}
                  type="button"
                  onClick={() => {
                    const next = new Set(eventChecks);
                    if (next.has(evt)) next.delete(evt); else next.add(evt);
                    setEventChecks(next);
                  }}
                  className={`rounded border px-2 py-1 text-xs font-mono ${eventChecks.has(evt) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-border text-muted-foreground'}`}
                >
                  {evt}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create webhook'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Configured webhooks ({webhooks.length})</CardTitle></CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No webhooks yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>URL</TableHead><TableHead>Events</TableHead>
                  <TableHead>Status</TableHead><TableHead>Last delivery</TableHead><TableHead>Failures</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="font-mono text-xs">{w.url}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">{w.events.map((e) => <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>)}</div>
                    </TableCell>
                    <TableCell>{w.enabled ? <Badge>enabled</Badge> : <Badge variant="outline">disabled</Badge>}</TableCell>
                    <TableCell className="text-xs">{w.lastDeliveryAt ?? '—'}</TableCell>
                    <TableCell>{w.failureCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => test(w.id)}><Send className="h-3 w-3" /></Button>
                        <Button size="sm" variant="outline" onClick={() => rotate(w.id)}><RotateCw className="h-3 w-3" /></Button>
                        <Button size="sm" variant="outline" onClick={() => remove(w.id)}><Trash2 className="h-3 w-3" /></Button>
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

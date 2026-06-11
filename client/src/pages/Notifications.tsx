import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Send, Mail, MessageSquare } from 'lucide-react';
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

interface Channel {
  id: string;
  kind: 'EMAIL' | 'SLACK' | 'TEAMS' | 'WEBHOOK';
  name: string;
  enabled: boolean;
  createdAt: string;
}

const KIND_ICON: Record<Channel['kind'], typeof Mail> = {
  EMAIL: Mail, SLACK: MessageSquare, TEAMS: MessageSquare, WEBHOOK: Send,
};

export default function Notifications() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Channel['kind']>('EMAIL');
  const [emailTo, setEmailTo] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<{ channels: Channel[] }>('/settings/notifications');
      setChannels(data.channels);
    } catch (err) { toast.error(apiError(err)); }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    if (!name) { toast.error('Name is required.'); return; }
    let config: Record<string, unknown>;
    try {
      switch (kind) {
        case 'EMAIL':
          config = { to: emailTo.split(',').map((s) => s.trim()).filter(Boolean) };
          if ((config.to as string[]).length === 0) throw new Error('at least one email recipient');
          break;
        case 'SLACK': case 'TEAMS':
          if (!webhookUrl.startsWith('https://')) throw new Error('webhook url must be https://');
          config = { incomingWebhookUrl: webhookUrl };
          break;
        case 'WEBHOOK':
          config = { webhookId: webhookUrl }; // reuse the field
          break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'invalid config');
      return;
    }
    setCreating(true);
    try {
      await api.post('/settings/notifications', { name, kind, config });
      toast.success('Channel created');
      setName(''); setEmailTo(''); setWebhookUrl('');
      await load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setCreating(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this channel?')) return;
    try { await api.delete(`/settings/notifications/${id}`); await load(); }
    catch (err) { toast.error(apiError(err)); }
  }

  async function test(id: string) {
    try {
      const { data } = await api.post<{ ok: boolean; error?: string }>(`/settings/notifications/${id}/test`);
      if (data.ok) toast.success('Test message sent');
      else toast.error(data.error ?? 'send failed');
    } catch (err) { toast.error(apiError(err)); }
  }

  if (!channels) return <FullPageLoader />;

  return (
    <>
      <PageHeader title="Notification channels" description="Email, Slack, and Teams targets for scheduled-report delivery and alerts." />

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> New channel</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops alerts" /></div>
            <div>
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Channel['kind'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="SLACK">Slack incoming webhook</SelectItem>
                  <SelectItem value="TEAMS">Teams incoming webhook</SelectItem>
                  <SelectItem value="WEBHOOK">Linked webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-1">
              {kind === 'EMAIL' ? (
                <><Label>Recipients (comma-separated)</Label><Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="alerts@acme.test" /></>
              ) : kind === 'WEBHOOK' ? (
                <><Label>Webhook id</Label><Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="ID of an existing webhook" /></>
              ) : (
                <><Label>Incoming webhook URL</Label><Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://hooks.slack.com/..." /></>
              )}
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create channel'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Channels ({channels.length})</CardTitle></CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">No channels yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => {
                  const Icon = KIND_ICON[c.kind];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" /> {c.name}</TableCell>
                      <TableCell><Badge variant="outline">{c.kind}</Badge></TableCell>
                      <TableCell>{c.enabled ? <Badge>enabled</Badge> : <Badge variant="outline">disabled</Badge>}</TableCell>
                      <TableCell className="text-xs">{new Date(c.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => test(c.id)}><Send className="h-3 w-3 mr-1" /> Test</Button>
                          <Button size="sm" variant="outline" onClick={() => remove(c.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

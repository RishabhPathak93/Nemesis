import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ScrollText, Search } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import type { AuditEntry } from '@/types';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';

interface ListResponse {
  items: AuditEntry[];
  nextCursor: string | null;
}

export default function AuditLog() {
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function loadActions() {
    try {
      const { data } = await api.get<{ actions: string[] }>('/audit/actions');
      setActions(data.actions);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function load(reset = false) {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '50' };
      if (actionFilter) params.action = actionFilter;
      if (from) params.from = new Date(from).toISOString();
      if (to) params.to = new Date(to).toISOString();
      if (!reset && cursor) params.cursor = cursor;
      const { data } = await api.get<ListResponse>('/audit/logs', { params });
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadActions();
  }, []);

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, from, to]);

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!user) return <FullPageLoader />;
  if (user.role !== 'ADMIN') return <p className="p-6 text-sm text-muted-foreground">Admin access required.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every authenticated action and security-relevant system event."
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Action</label>
              <Select value={actionFilter || 'all'} onValueChange={(v) => setActionFilter(v === 'all' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="All actions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
              <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
              <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => { setActionFilter(''); setFrom(''); setTo(''); }}>
                Reset
              </Button>
            </div>
          </div>

          {items.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">
              <ScrollText className="mr-2 inline h-4 w-4" />
              No audit entries match your filters yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="w-1"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-[10px]">{r.action}</Badge></TableCell>
                      <TableCell className="text-xs">
                        {r.actor ? (
                          <span title={r.actor.email}>{r.actor.name}</span>
                        ) : (
                          <span className="text-slate-400">{r.actorType}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.targetType ? `${r.targetType}:${r.targetId?.slice(0, 8) ?? '?'}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.ip ?? '—'}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => toggleRow(r.id)} aria-label="Show row details">
                          <Search className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded.has(r.id) && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/40">
                          <pre className="overflow-x-auto text-xs">
                            {JSON.stringify({
                              userAgent: r.userAgent,
                              actorId: r.actorId,
                              targetId: r.targetId,
                              metadata: r.metadata,
                            }, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex justify-between">
            <span className="text-xs text-muted-foreground">{items.length} loaded</span>
            {hasMore && (
              <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

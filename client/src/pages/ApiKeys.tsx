import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Plus, Trash2, AlertCircle } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import type { ApiKeySummary } from '@/types';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';

interface ListResponse {
  items: ApiKeySummary[];
  validScopes: string[];
}

export default function ApiKeys() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<ListResponse | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['agents:read', 'runs:read', 'reports:read']);
  const [expiresAt, setExpiresAt] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<ListResponse>('/settings/api-keys');
      setData(data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name, scopes };
      if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();
      const { data } = await api.post<{ key: string }>('/settings/api-keys', body);
      setIssuedKey(data.key);
      setName('');
      setExpiresAt('');
      await load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this API key? Calls using it will start failing immediately.')) return;
    try {
      await api.delete(`/settings/api-keys/${id}`);
      await load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  if (!data || !user) return <FullPageLoader />;
  if (user.role !== 'ADMIN') {
    return <p className="p-6 text-sm text-muted-foreground">Admin access required.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description="Programmatic access tokens for CI, scripts, and integrations. Each key has explicit scopes."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Issue a new key</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid max-w-2xl gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="kn">Name</Label>
              <Input id="kn" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI pipeline" />
            </div>
            <div className="space-y-1.5">
              <Label>Scopes</Label>
              <div className="grid grid-cols-2 gap-2">
                {data.validScopes.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={(e) => {
                        setScopes((prev) =>
                          e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                        );
                      }}
                    />
                    <span className="font-mono">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp">Expires (optional)</Label>
              <Input id="exp" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <Button type="submit" disabled={submitting || scopes.length === 0}>
              {submitting ? 'Issuing…' : 'Issue key'}
            </Button>
          </form>

          {issuedKey && (
            <div className="mt-6 rounded-md border-2 border-amber-300 bg-amber-50 p-4">
              <div className="mb-2 flex items-start gap-2 text-sm font-semibold text-amber-900">
                <AlertCircle className="h-4 w-4" /> Copy this key now — it won&apos;t be shown again.
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs text-slate-900">{issuedKey}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(issuedKey);
                    toast.success('Copied');
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIssuedKey(null)}>Done</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Existing keys</CardTitle>
          <CardDescription>{data.items.length} key{data.items.length === 1 ? '' : 's'}.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-1"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>
                      {k.revokedAt ? (
                        <Badge variant="destructive">Revoked</Badge>
                      ) : k.expiresAt && new Date(k.expiresAt) < new Date() ? (
                        <Badge variant="secondary">Expired</Badge>
                      ) : (
                        <Badge>Active</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!k.revokedAt && (
                        <Button size="icon" variant="ghost" onClick={() => revoke(k.id)} title="Revoke" aria-label="Revoke API key">
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

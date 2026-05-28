import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, EyeOff, Calendar, RotateCw } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import type { FullReport, ShareSettings } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';

interface Props {
  report: FullReport;
  onChange?: (next: { shareToken: string }) => void;
}

export function ShareControls({ report, onChange }: Props) {
  const [enabled, setEnabled] = useState(true); // FullReport doesn't carry these flags; treat as enabled
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [token, setToken] = useState(report.shareToken);
  const [busy, setBusy] = useState(false);

  const url = `${window.location.origin}/share/${token}`;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const { data } = await api.post<ShareSettings>(`/reports/${report.id}/share`, body);
      setToken(data.shareToken);
      setEnabled(data.shareEnabled);
      onChange?.({ shareToken: data.shareToken });
      toast.success('Share settings updated');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Calendar className="h-4 w-4" /> Share link</CardTitle>
        <CardDescription>
          Anyone with this link can view the report — no login required. Set an expiry or revoke any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input readOnly value={enabled ? url : 'Link disabled.'} className="font-mono text-xs" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => { void navigator.clipboard.writeText(url); toast.success('Copied'); }}
            disabled={!enabled}
          >
            <Copy className="mr-1 h-3 w-3" /> Copy
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Expires</label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-56"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => patch({ expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null })}
          >
            Set expiry
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => patch({ rotate: true })}
          >
            <RotateCw className="mr-1 h-3 w-3" /> Rotate URL
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !enabled}
            onClick={() => patch({ enabled: false })}
          >
            <EyeOff className="mr-1 h-3 w-3" /> Revoke
          </Button>
          {!enabled && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => patch({ enabled: true })}
            >
              Re-enable
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

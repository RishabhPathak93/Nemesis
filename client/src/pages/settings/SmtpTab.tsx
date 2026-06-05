import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Mail, Plug, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Admin-only Settings → SMTP section.
 *
 * Lets admins configure the per-org outbound transport used for verification
 * emails, invites, password resets, and scheduled report deliveries. Without a
 * config row the server falls back to the operator's `SMTP_*` env vars; with
 * one (enabled = true) this overrides.
 */

interface SmtpConfig {
  id: string;
  orgId: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  authUser: string | null;
  authPass: string | null;        // masked dots only — never the real value
  hasPassword: boolean;
  fromAddress: string;
  replyTo: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  updatedAt: string;
}

const DEFAULTS = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  authUser: '',
  fromAddress: '',
  replyTo: '',
};

export function SmtpTab() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';

  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [enabled, setEnabled] = useState(DEFAULTS.enabled);
  const [host, setHost] = useState(DEFAULTS.host);
  const [port, setPort] = useState<number>(DEFAULTS.port);
  const [secure, setSecure] = useState(DEFAULTS.secure);
  const [authUser, setAuthUser] = useState(DEFAULTS.authUser);
  const [authPass, setAuthPass] = useState('');           // write-only; never populated from server
  const [clearPass, setClearPass] = useState(false);
  const [fromAddress, setFromAddress] = useState(DEFAULTS.fromAddress);
  const [replyTo, setReplyTo] = useState(DEFAULTS.replyTo);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function load() {
    try {
      const { data } = await api.get<{ config: SmtpConfig | null }>('/settings/smtp');
      setConfig(data.config);
      if (data.config) {
        setEnabled(data.config.enabled);
        setHost(data.config.host);
        setPort(data.config.port);
        setSecure(data.config.secure);
        setAuthUser(data.config.authUser ?? '');
        setFromAddress(data.config.fromAddress);
        setReplyTo(data.config.replyTo ?? '');
      } else {
        setEnabled(DEFAULTS.enabled);
        setHost(DEFAULTS.host);
        setPort(DEFAULTS.port);
        setSecure(DEFAULTS.secure);
        setAuthUser('');
        setFromAddress(DEFAULTS.fromAddress);
        setReplyTo('');
      }
    } catch (err) {
      // 403 for non-admins is expected — keep the UI quiet.
      if (isAdmin) toast.error(apiError(err));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => { void load(); }, [isAdmin]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin || saving) return;
    setSaving(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        enabled,
        host,
        port,
        secure,
        authUser: authUser || null,
        fromAddress,
        replyTo: replyTo || null,
      };
      // Password: empty + clearPass toggle ⇒ explicit null. Empty without
      // toggle ⇒ leave existing in place (don't send the field). Non-empty
      // ⇒ rotate.
      if (clearPass && !authPass) body.authPass = null;
      else if (authPass) body.authPass = authPass;
      const { data } = await api.put<{ config: SmtpConfig }>('/settings/smtp', body);
      setConfig(data.config);
      setAuthPass('');
      setClearPass(false);
      toast.success('SMTP settings saved');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    if (!isAdmin || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (testTo) body.to = testTo;
      const { data } = await api.post<{ ok: true; recipient: string }>('/settings/smtp/test', body);
      setTestResult({ ok: true, msg: `Test email sent to ${data.recipient}.` });
      // refresh lastTest fields
      void load();
    } catch (err) {
      const msg = apiError(err);
      setTestResult({ ok: false, msg });
    } finally {
      setTesting(false);
    }
  }

  async function onDisable() {
    if (!isAdmin || saving) return;
    if (!window.confirm('Remove the saved SMTP configuration? Outbound email will fall back to environment variables.')) return;
    setSaving(true);
    try {
      await api.delete('/settings/smtp');
      toast.success('SMTP configuration removed');
      setConfig(null);
      setEnabled(false);
      setHost(''); setPort(587); setSecure(false);
      setAuthUser(''); setAuthPass(''); setClearPass(false);
      setFromAddress(''); setReplyTo('');
      setTestResult(null);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  // Don't render anything for non-admins — the API will 403 anyway.
  if (!isAdmin) return null;
  if (!loaded) return null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> SMTP / Email</CardTitle>
        <CardDescription>
          Outbound transport for email verification, invites, password resets, and scheduled reports.
          Stored encrypted at rest. When disabled, the server falls back to the operator's <code className="rounded bg-muted px-1 text-[0.8em]">SMTP_*</code> environment variables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="space-y-4">
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
            <div>
              <div className="text-sm font-medium">Use this SMTP configuration</div>
              <div className="text-xs text-muted-foreground">
                When off, outbound email uses the operator's environment SMTP (if any), or is logged for dev.
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="smtpHost">Host</Label>
              <Input id="smtpHost" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.sendgrid.net" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPort">Port</Label>
              <Input
                id="smtpPort"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value || '587', 10))}
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-4 py-3">
            <Switch checked={secure} onCheckedChange={setSecure} />
            <div>
              <div className="text-sm font-medium">TLS on connect (implicit TLS)</div>
              <div className="text-xs text-muted-foreground">
                On for port 465 (SMTPS). Off for port 587 / 25 — nodemailer negotiates STARTTLS automatically.
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtpUser">Auth username</Label>
              <Input
                id="smtpUser"
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
                placeholder="apikey  /  smtp-user"
                autoComplete="username"
              />
              <p className="text-xs text-muted-foreground">Leave blank for unauthenticated SMTP (rare).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPass">Auth password</Label>
              <Input
                id="smtpPass"
                type="password"
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                placeholder={config?.hasPassword ? '•••••••• (stored)' : ''}
                autoComplete="new-password"
                disabled={clearPass}
              />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {config?.hasPassword
                    ? 'Leave blank to keep the saved password; paste to rotate.'
                    : 'Stored encrypted (AES-256-GCM).'}
                </span>
                {config?.hasPassword && (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={clearPass}
                      onChange={(e) => { setClearPass(e.target.checked); if (e.target.checked) setAuthPass(''); }}
                    />
                    <span>Clear saved password</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtpFrom">From address</Label>
              <Input
                id="smtpFrom"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder='Nemesis AI <noreply@acme.com>'
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpReplyTo">Reply-to (optional)</Label>
              <Input
                id="smtpReplyTo"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="support@acme.com"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save SMTP settings'}
            </Button>

            <div className="flex items-center gap-2">
              <Input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder={user?.email ?? 'recipient@example.com'}
                className="w-72"
                aria-label="Test recipient"
              />
              <Button type="button" variant="outline" onClick={onTest} disabled={testing || !config?.id}>
                <Plug className="h-4 w-4" />
                {testing ? 'Sending…' : 'Send test email'}
              </Button>
            </div>

            {config && (
              <Button type="button" variant="ghost" onClick={onDisable} className="ml-auto text-red-700 dark:text-red-300 hover:bg-red-50 dark:bg-red-500/10">
                <Trash2 className="h-4 w-4" /> Remove configuration
              </Button>
            )}
          </div>

          {testResult && (
            <div className={`flex items-center gap-1.5 text-sm ${testResult.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {testResult.msg}
            </div>
          )}

          {config?.lastTestAt && !testResult && (
            <div className={`flex items-center gap-1.5 text-xs ${config.lastTestOk ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
              {config.lastTestOk ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              Last test {new Date(config.lastTestAt).toLocaleString()} — {config.lastTestOk ? 'OK' : (config.lastTestError ?? 'failed')}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

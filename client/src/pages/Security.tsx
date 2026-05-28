import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Smartphone, KeyRound, Clock, Trash2, ShieldCheck, Copy, Fingerprint } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';
import { api, apiError } from '@/lib/api';
import type { AuthSession } from '@/types';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';

interface MfaSetupResponse {
  otpauth: string;
  qrCodeDataUrl: string;
}

export default function Security() {
  const user = useAuthStore((s) => s.user);
  const setUser = (u: typeof user) => useAuthStore.setState({ user: u });
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBackupCodes, setMfaBackupCodes] = useState<string[] | null>(null);
  const [mfaDisablePw, setMfaDisablePw] = useState('');

  async function loadSessions() {
    try {
      const { data } = await api.get<{ sessions: AuthSession[] }>('/auth/sessions');
      setSessions(data.sessions);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast.error('Passwords do not match.');
      return;
    }
    setPwLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
      toast.success('Password changed. Other sessions have been revoked.');
      await loadSessions();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setPwLoading(false);
    }
  }

  async function startMfa() {
    try {
      const { data } = await api.post<MfaSetupResponse>('/auth/mfa/setup', {});
      setMfaQr(data.qrCodeDataUrl);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function confirmMfa(e: FormEvent) {
    e.preventDefault();
    try {
      const { data } = await api.post<{ ok: true; backupCodes: string[] }>('/auth/mfa/verify-setup', { code: mfaCode });
      setMfaBackupCodes(data.backupCodes);
      setMfaQr(null);
      setMfaCode('');
      if (user) setUser({ ...user, mfaEnabled: true });
      toast.success('MFA enabled — save your backup codes!');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function disableMfa(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/auth/mfa/disable', { password: mfaDisablePw });
      setMfaDisablePw('');
      if (user) setUser({ ...user, mfaEnabled: false });
      setMfaBackupCodes(null);
      toast.success('MFA disabled.');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function regenerateBackup() {
    try {
      const { data } = await api.post<{ backupCodes: string[] }>('/auth/mfa/backup-codes', {});
      setMfaBackupCodes(data.backupCodes);
      toast.success('New backup codes generated. Save them!');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function revokeSession(id: string) {
    try {
      await api.delete(`/auth/sessions/${id}`);
      await loadSessions();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  if (!sessions || !user) return <FullPageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader title="Security" description="Password, two-factor authentication, and active sessions." />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Change password</CardTitle>
          <CardDescription>You&apos;ll be signed out of every other session.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="grid max-w-md gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cp">Current password</Label>
              <Input id="cp" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np">New password</Label>
              <Input id="np" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">12+ chars, upper/lower/digit/symbol.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf">Confirm new password</Label>
              <Input id="cf" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" disabled={pwLoading}>{pwLoading ? 'Saving…' : 'Update password'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Smartphone className="h-4 w-4" /> Two-factor authentication</CardTitle>
          <CardDescription>
            {user.mfaEnabled
              ? 'MFA is enabled on your account.'
              : 'Add an extra layer of security with an authenticator app (e.g. 1Password, Google Authenticator).'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!user.mfaEnabled && !mfaQr && (
            <Button onClick={startMfa}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Enable MFA
            </Button>
          )}

          {mfaQr && (
            <form onSubmit={confirmMfa} className="grid max-w-md gap-3">
              <p className="text-sm text-muted-foreground">Scan this QR code in your authenticator app, then enter the 6-digit code it shows.</p>
              <img src={mfaQr} alt="Scan with your authenticator app" className="h-60 w-60 rounded-md border bg-white p-2" />
              <div className="space-y-1.5">
                <Label htmlFor="otp">Code from app</Label>
                <Input id="otp" inputMode="numeric" required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button type="submit">Confirm and enable</Button>
                <Button type="button" variant="outline" onClick={() => { setMfaQr(null); setMfaCode(''); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {user.mfaEnabled && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={regenerateBackup}>Regenerate backup codes</Button>
              </div>
              <form onSubmit={disableMfa} className="grid max-w-md gap-2">
                <Label htmlFor="dpw">Disable MFA — confirm with password</Label>
                <div className="flex gap-2">
                  <Input id="dpw" type="password" required value={mfaDisablePw} onChange={(e) => setMfaDisablePw(e.target.value)} />
                  <Button type="submit" variant="destructive">Disable</Button>
                </div>
              </form>
            </div>
          )}

          {mfaBackupCodes && (
            <div className="mt-6 rounded-md border-2 border-amber-300 bg-amber-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-amber-900">Save these backup codes somewhere safe</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(mfaBackupCodes.join('\n'));
                    toast.success('Copied');
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
              </div>
              <p className="mb-3 text-xs text-amber-800">
                Each code works once. They&apos;re shown here only — we don&apos;t store them in plaintext.
              </p>
              <div className="grid grid-cols-2 gap-1 font-mono text-sm">
                {mfaBackupCodes.map((c) => <div key={c}>{c}</div>)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Active sessions</CardTitle>
          <CardDescription>Refresh tokens that can re-issue access tokens for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 && <p className="text-sm text-muted-foreground">No active sessions.</p>}
          {sessions.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-1"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{s.userAgent ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.ip ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(s.issuedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(s.expiresAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => revokeSession(s.id)} title="Revoke" aria-label="Revoke session">
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Revoking a session here invalidates the refresh token. The browser using it will be forced to log in
            again on its next 401.
          </p>
        </CardContent>
      </Card>

      <PasskeysCard />
    </div>
  );
}

interface Passkey {
  id: string;
  deviceLabel: string;
  transports: string[];
  backupEligible: boolean;
  backupState: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

function PasskeysCard() {
  const [creds, setCreds] = useState<Passkey[] | null>(null);
  const [label, setLabel] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<{ credentials: Passkey[] }>('/auth/webauthn/credentials');
      setCreds(data.credentials);
    } catch (err) { toast.error(apiError(err)); }
  }
  useEffect(() => { void load(); }, []);

  async function enroll() {
    if (!label) { toast.error('Pick a label first (e.g. "MacBook Touch ID")'); return; }
    setEnrolling(true);
    try {
      const { data: opts } = await api.post<unknown>('/auth/webauthn/register/options');
      // browser SDK invokes the platform authenticator UI
      const attestation = await startRegistration(opts as Parameters<typeof startRegistration>[0]);
      await api.post('/auth/webauthn/register/verify', { deviceLabel: label, response: attestation });
      toast.success('Passkey registered');
      setLabel('');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'enrolment failed';
      // The browser API throws DOMException for cancelled prompts — surface a softer message.
      if (msg.toLowerCase().includes('cancel') || msg.includes('NotAllowed')) {
        toast.error('Enrolment was cancelled. Try again when you\'re ready.');
      } else {
        toast.error(apiError(err));
      }
    } finally {
      setEnrolling(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this passkey? You can re-enrol the same device later.')) return;
    try {
      await api.delete(`/auth/webauthn/credentials/${id}`);
      await load();
    } catch (err) { toast.error(apiError(err)); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-indigo-600" /> Passkeys (WebAuthn)</CardTitle>
        <CardDescription>Hardware-backed second factor — Touch ID, Yubikey, Windows Hello, etc. Adds to TOTP.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label>Device label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="MacBook Touch ID" />
          </div>
          <Button disabled={enrolling || !label} onClick={enroll}>
            <Fingerprint className="mr-1 h-4 w-4" /> {enrolling ? 'Following prompts…' : 'Add passkey'}
          </Button>
        </div>
        {creds === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : creds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys yet — add one to enable WebAuthn-based MFA at sign-in.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Label</TableHead><TableHead>Transports</TableHead><TableHead>Last used</TableHead><TableHead>Created</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {creds.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.deviceLabel}{c.backupEligible && <Badge variant="outline" className="ml-2 text-[10px]">synced</Badge>}</TableCell>
                  <TableCell className="font-mono text-[11px]">{c.transports.join(', ') || '—'}</TableCell>
                  <TableCell className="text-xs">{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : '—'}</TableCell>
                  <TableCell className="text-xs">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => remove(c.id)}><Trash2 className="h-3 w-3" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// Suppress unused-import lint.
void Badge;

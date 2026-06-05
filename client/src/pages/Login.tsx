import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Fingerprint } from 'lucide-react';
import axios from 'axios';
import { startAuthentication } from '@simplewebauthn/browser';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { apiError, api } from '@/lib/api';

type Step = 'creds' | 'mfa';

import { API_BASE_URL as baseURL } from '@/lib/baseUrl';

export default function Login() {
  const [step, setStep] = useState<Step>('creds');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaSessionToken, setMfaSessionToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [isBackup, setIsBackup] = useState(false);
  // SSO discovery (SAML or OIDC by email domain).
  const [ssoSamlOrgSlug, setSsoSamlOrgSlug] = useState<string | null>(null);
  const [ssoOidcOrgSlug, setSsoOidcOrgSlug] = useState<string | null>(null);
  // WebAuthn step indicator.
  const [hasPasskey, setHasPasskey] = useState(false);
  const [webauthnInFlight, setWebauthnInFlight] = useState(false);

  const login = useAuthStore((s) => s.login);
  const verifyMfa = useAuthStore((s) => s.verifyMfa);
  const setSession = useAuthStore((s) => s.setSession);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();

  async function discoverSso(emailValue: string) {
    if (!emailValue.includes('@')) {
      setSsoSamlOrgSlug(null);
      setSsoOidcOrgSlug(null);
      return;
    }
    try {
      const [saml, oidc] = await Promise.all([
        axios.post<{ samlEnabled: boolean; orgSlug: string | null }>(`${baseURL}/sso/discover`, { email: emailValue }, { withCredentials: true }),
        axios.post<{ oidcEnabled: boolean; orgSlug: string | null }>(`${baseURL}/sso/discover-oidc`, { email: emailValue }, { withCredentials: true }),
      ]);
      setSsoSamlOrgSlug(saml.data.samlEnabled ? saml.data.orgSlug : null);
      setSsoOidcOrgSlug(oidc.data.oidcEnabled ? oidc.data.orgSlug : null);
    } catch {
      setSsoSamlOrgSlug(null);
      setSsoOidcOrgSlug(null);
    }
  }

  async function onCreds(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await login(email, password);
      if (result.kind === 'mfa') {
        setMfaSessionToken(result.mfaSessionToken);
        // Detect whether this user has any passkeys; the MFA step will offer
        // WebAuthn first, with TOTP as a fallback link.
        try {
          const { data } = await api.post<{ hasPasskey: boolean }>('/auth/webauthn/has-passkey', {
            mfaSessionToken: result.mfaSessionToken,
          });
          setHasPasskey(data.hasPasskey);
        } catch { /* ignore — the MFA step still shows the TOTP form */ }
        setStep('mfa');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function onMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaSessionToken) return;
    try {
      await verifyMfa(mfaSessionToken, code, isBackup);
      navigate('/dashboard');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function onWebauthn() {
    if (!mfaSessionToken) return;
    setWebauthnInFlight(true);
    try {
      const { data: opts } = await api.post<unknown>('/auth/webauthn/auth/options', { mfaSessionToken });
      const assertion = await startAuthentication(opts as Parameters<typeof startAuthentication>[0]);
      const { data } = await api.post<{ accessToken: string; refreshToken: string; user: Parameters<typeof setSession>[2] }>(
        '/auth/webauthn/auth/verify',
        { mfaSessionToken, response: assertion },
      );
      setSession(data.accessToken, data.refreshToken, data.user);
      navigate('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'passkey verification failed';
      toast.error(msg.toLowerCase().includes('cancel') ? 'Passkey prompt cancelled.' : apiError(err));
    } finally {
      setWebauthnInFlight(false);
    }
  }

  function startSamlLogin() {
    if (!ssoSamlOrgSlug) return;
    window.location.href = `${baseURL}/auth/saml/${ssoSamlOrgSlug}/login?RelayState=${encodeURIComponent('/dashboard')}`;
  }
  function startOidcLogin() {
    if (!ssoOidcOrgSlug) return;
    window.location.href = `${baseURL}/auth/oidc/${ssoOidcOrgSlug}/login?RelayState=${encodeURIComponent('/dashboard')}`;
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-indigo-50 p-6 dark:from-background dark:to-indigo-950/40">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-2">
          <img src="/logos/reticle.svg" alt="" className="h-9 w-9" />
          <div>
            <div className="text-lg font-bold tracking-tight text-foreground">Nemesis AI</div>
            <div className="text-xs text-muted-foreground">Adversarial Testing for AI Agents</div>
          </div>
        </div>

        {step === 'creds' && (
          <>
            <h1 className="mb-1 text-xl font-semibold text-foreground">Welcome back</h1>
            <p className="mb-6 text-sm text-muted-foreground">Sign in to your Nemesis AI workspace.</p>
            <form onSubmit={onCreds} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={(e) => void discoverSso(e.target.value)}
                />
              </div>
              {(ssoSamlOrgSlug || ssoOidcOrgSlug) && (
                <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
                  <div className="mb-2 font-medium text-indigo-900 dark:text-indigo-300">Single sign-on available for this domain</div>
                  <div className="flex flex-col gap-2">
                    {ssoSamlOrgSlug && (
                      <Button type="button" variant="outline" onClick={startSamlLogin}>Continue with SAML</Button>
                    )}
                    {ssoOidcOrgSlug && (
                      <Button type="button" variant="outline" onClick={startOidcLogin}>Continue with OIDC</Button>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link to="/forgot-password" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password" type="password" required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            {/* Self-serve signups are closed. Accounts are provisioned by your
                admin via the Members page or an invite link. */}
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Need access? Ask your workspace admin for an invite.
            </p>
          </>
        )}

        {step === 'mfa' && (
          <>
            <h1 className="mb-1 text-xl font-semibold text-foreground">Two-factor verification</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {hasPasskey
                ? 'Use your registered passkey, or fall back to an authenticator code.'
                : isBackup
                  ? 'Enter one of the backup codes you saved when enrolling.'
                  : 'Enter the 6-digit code from your authenticator app.'}
            </p>

            {hasPasskey && (
              <div className="mb-4">
                <Button type="button" className="w-full" disabled={webauthnInFlight} onClick={onWebauthn}>
                  <Fingerprint className="mr-1 h-4 w-4" />
                  {webauthnInFlight ? 'Following prompt…' : 'Use passkey'}
                </Button>
              </div>
            )}

            <form onSubmit={onMfa} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">{isBackup ? 'Backup code' : 'Authenticator code'}</Label>
                <Input
                  id="code"
                  required
                  inputMode={isBackup ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={isBackup ? 'XXXXX-XXXXX' : '123456'}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Verifying…' : 'Verify'}
              </Button>
              <button
                type="button"
                className="block w-full text-center text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                onClick={() => { setIsBackup(!isBackup); setCode(''); }}
              >
                {isBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
              </button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

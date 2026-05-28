import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { api, apiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { User } from '@/types';

interface InvitePreview {
  email: string;
  role: 'ADMIN' | 'ANALYST' | 'VIEWER';
  orgName: string;
  hasExistingAccount: boolean;
}

interface AcceptResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api
      .get<InvitePreview>(`/invites/${token}`)
      .then((r) => setPreview(r.data))
      .catch((e) => setError(apiError(e)));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    if (!preview.hasExistingAccount && password !== confirm) {
      toast.error('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {};
      if (!preview.hasExistingAccount) {
        body.name = name;
        body.password = password;
      }
      const { data } = await api.post<AcceptResponse>(`/invites/${token}/accept`, body);
      setSession(data.accessToken, data.refreshToken, data.user);
      toast.success(`Welcome to ${preview.orgName}.`);
      navigate('/dashboard');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md p-8">
          <h1 className="text-xl font-semibold">Invite unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </Card>
      </div>
    );
  }
  if (!preview) {
    return <div className="p-8 text-sm text-muted-foreground">Loading invite…</div>;
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-2">
          <img src="/logos/reticle.svg" alt="" className="h-9 w-9" />
          <div className="text-lg font-bold tracking-tight text-foreground">Nemesis AI</div>
        </div>
        <h1 className="text-xl font-semibold text-foreground">Join {preview.orgName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You&apos;re invited to join as <strong>{preview.role}</strong> with email{' '}
          <strong>{preview.email}</strong>.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {!preview.hasExistingAccount && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="text-xs text-muted-foreground">12+ chars, upper/lower/digit/symbol.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </>
          )}
          {preview.hasExistingAccount && (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-muted-foreground">
              An account already exists for this email. Accepting will move you into {preview.orgName}.
            </p>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Joining…' : `Join ${preview.orgName}`}
          </Button>
        </form>
      </Card>
    </div>
  );
}

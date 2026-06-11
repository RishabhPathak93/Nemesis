import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { api, apiError } from '@/lib/api';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      toast.success('Password updated. Sign in with your new password.');
      navigate('/login');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-indigo-50 dark:to-indigo-950/40 dark:from-background p-6">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-2">
          <img src="/logos/reticle.svg" alt="" className="h-9 w-9" />
          <div className="text-lg font-bold tracking-tight text-foreground">Nemesis AI</div>
        </div>
        <h1 className="mb-1 text-xl font-semibold text-foreground">Set a new password</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          At least 12 characters, with upper, lower, digit, and a symbol.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw">New password</Label>
            <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2">Confirm password</Label>
            <Input id="pw2" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}

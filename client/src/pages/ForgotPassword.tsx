import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } finally {
      setSubmitted(true);
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
        <h1 className="mb-1 text-xl font-semibold text-foreground">Reset your password</h1>
        {submitted ? (
          <p className="mt-4 text-sm text-muted-foreground">
            If <strong>{email}</strong> matches a Nemesis AI account, we&apos;ve sent a reset link to it. The link
            expires in 1 hour. Didn&apos;t get it? Check spam, or your operator may not have configured email yet —
            ask them to check the server logs.
          </p>
        ) : (
          <>
            <p className="mb-6 text-sm text-muted-foreground">
              We&apos;ll email you a link to set a new password.
            </p>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          </>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}

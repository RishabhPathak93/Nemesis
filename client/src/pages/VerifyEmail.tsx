import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { api, apiError } from '@/lib/api';

export default function VerifyEmail() {
  const { token } = useParams();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get(`/auth/verify-email/${token}`)
      .then(() => setState('ok'))
      .catch((e) => {
        setError(apiError(e));
        setState('error');
      });
  }, [token]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-md p-8 text-center">
        {state === 'loading' && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" />
            <p className="mt-4 text-sm text-muted-foreground">Verifying your email…</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <h1 className="mt-3 text-xl font-semibold">Email verified</h1>
            <p className="mt-2 text-sm text-muted-foreground">You can now sign in.</p>
            <Link to="/login" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">
              Go to sign in
            </Link>
          </>
        )}
        {state === 'error' && (
          <>
            <XCircle className="mx-auto h-10 w-10 text-rose-500" />
            <h1 className="mt-3 text-xl font-semibold">Verification failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Link to="/login" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">
              Back to sign in
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}

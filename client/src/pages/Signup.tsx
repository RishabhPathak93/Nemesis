import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { apiError } from '@/lib/api';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const signup = useAuthStore((s) => s.signup);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await signup(email, password, name, orgName);
      toast.success('Welcome to Nemesis AI!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-2">
          <img src="/logos/reticle.svg" alt="" className="h-9 w-9" />
          <div>
            <div className="text-lg font-bold tracking-tight text-foreground">Nemesis AI</div>
            <div className="text-xs text-muted-foreground">Adversarial Testing for AI Agents</div>
          </div>
        </div>
        <h1 className="mb-1 text-xl font-semibold text-foreground">Create your workspace</h1>
        <p className="mb-6 text-sm text-muted-foreground">Start running AI security audits in minutes.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orgName">Organisation</Label>
              <Input id="orgName" required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}

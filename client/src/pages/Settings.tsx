import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2, Mail, Plug, CheckCircle2, XCircle } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import type { OrgInfo, OrgMembers, LlmProvider } from '@/types';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { BrandingTab } from '@/pages/settings/BrandingTab';
import { SmtpTab } from '@/pages/settings/SmtpTab';

export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<OrgMembers | null>(null);
  const [orgName, setOrgName] = useState('');
  // Unified LLM config
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('anthropic');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmTesting, setLlmTesting] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [notifyComplete, setNotifyComplete] = useState(true);
  const [notifyCritical, setNotifyCritical] = useState(true);
  const [enableLearning, setEnableLearning] = useState(true);
  const [enableResearch, setEnableResearch] = useState(false);
  const [searchProvider, setSearchProvider] = useState<'tavily' | 'brave' | 'none'>('none');
  const [searchKey, setSearchKey] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'ANALYST' | 'VIEWER'>('ANALYST');

  async function load() {
    try {
      const [o, m] = await Promise.all([
        api.get<OrgInfo>('/settings/org'),
        api.get<OrgMembers>('/settings/members'),
      ]);
      setOrg(o.data);
      setMembers(m.data);
      setOrgName(o.data.name);
      setNotifyComplete(o.data.notifyOnComplete);
      setNotifyCritical(o.data.notifyOnCritical);
      setEnableLearning(o.data.enableLearning);
      setEnableResearch(o.data.enableResearch);
      setSearchProvider(o.data.searchProvider ?? 'none');
      setLlmProvider(o.data.llmProvider ?? 'anthropic');
      setLlmModel(o.data.llmModel ?? '');
      setLlmBaseUrl(o.data.llmBaseUrl ?? '');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (!org || !members) return <FullPageLoader />;

  async function saveOrg(e: FormEvent) {
    e.preventDefault();
    try {
      await api.put('/settings/org', {
        name: orgName,
        llmProvider,
        llmApiKey: llmApiKey || undefined,
        llmModel: llmModel || null,
        llmBaseUrl: llmBaseUrl || null,
        notifyOnComplete: notifyComplete,
        notifyOnCritical: notifyCritical,
        enableLearning,
        enableResearch,
        searchProvider: searchProvider === 'none' ? null : searchProvider,
        searchApiKey: searchKey || undefined,
      });
      toast.success('Settings saved');
      setLlmApiKey('');
      setSearchKey('');
      void load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function testLlm() {
    setLlmTesting(true);
    setLlmTestResult(null);
    try {
      const body = llmApiKey || llmModel || llmBaseUrl
        ? {
            provider: llmProvider,
            apiKey: llmApiKey || '',
            model: llmModel || defaultModelFor(llmProvider),
            baseUrl: llmBaseUrl || null,
          }
        : {}; // empty body → test the saved config
      const { data } = await api.post<{
        ok: boolean;
        provider?: string;
        model?: string;
        reply?: string;
        error?: string;
      }>('/settings/llm/test', body);
      if (data.ok) {
        setLlmTestResult({ ok: true, msg: `Connected to ${data.provider} · ${data.model}. Reply: "${data.reply}"` });
      } else {
        setLlmTestResult({ ok: false, msg: data.error || 'Connection failed' });
      }
    } catch (err) {
      setLlmTestResult({ ok: false, msg: apiError(err) });
    } finally {
      setLlmTesting(false);
    }
  }

  async function sendInvite() {
    try {
      await api.post('/settings/invites', { email: inviteEmail, role: inviteRole });
      toast.success(`Invite created for ${inviteEmail}`);
      setInviteEmail('');
      void load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function removeInvite(id: string) {
    try {
      await api.delete(`/settings/invites/${id}`);
      void load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function deactivateMember(id: string, email: string) {
    if (!confirm(`Deactivate ${email}? They'll be signed out and unable to log in until reactivated.`)) return;
    try {
      await api.post(`/settings/members/${id}/deactivate`);
      void load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function reactivateMember(id: string) {
    try {
      await api.post(`/settings/members/${id}/reactivate`);
      void load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function changeMemberRole(id: string, role: string) {
    try {
      await api.put(`/settings/members/${id}/role`, { role });
      void load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function deleteData() {
    if (!confirm('Permanently delete ALL agents, test runs, and reports for this organisation? This cannot be undone.')) return;
    try {
      await api.delete('/settings/danger/data');
      toast.success('All organisation data deleted');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  const isAdmin = user?.role === 'ADMIN';

  return (
    <>
      <PageHeader title="Settings" description="Manage your organisation, API keys, notifications, and team." />

      <div className="mb-6">
        <BrandingTab />
      </div>

      <div className="mb-6">
        <SmtpTab />
      </div>

      <form onSubmit={saveOrg} className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organisation</CardTitle>
            <CardDescription>Workspace name. Logo and brand colour are managed in the Branding panel above.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="orgName">Organisation name</Label>
              <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!isAdmin} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LLM provider</CardTitle>
            <CardDescription>
              The model that powers Nemesis AI's six pipelines. Use any cloud or local LLM that speaks Anthropic, OpenAI,
              or Ollama protocols.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select value={llmProvider} onValueChange={(v) => setLlmProvider(v as LlmProvider)} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="gemini">Google Gemini</SelectItem>
                    <SelectItem value="openai_compatible">OpenAI-compatible</SelectItem>
                    <SelectItem value="ollama">Ollama (local)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="llmModel">Model</Label>
                <Input
                  id="llmModel"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  placeholder={defaultModelFor(llmProvider)}
                  disabled={!isAdmin}
                />
                <p className="text-xs text-muted-foreground">Default: {defaultModelFor(llmProvider)}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="llmKey">
                API key {llmProvider === 'ollama' && <span className="text-muted-foreground">(usually not required)</span>}
              </Label>
              <Input
                id="llmKey"
                type="password"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                placeholder={org.llmApiKeyMasked || keyPlaceholder(llmProvider)}
                disabled={!isAdmin}
              />
              <p className="text-xs text-muted-foreground">
                {org.llmApiKeyMasked
                  ? `Currently set: ${org.llmApiKeyMasked}. Leave blank to keep, or paste a new key to overwrite.`
                  : 'Stored encrypted at rest (AES-256-GCM).'}
              </p>
            </div>

            {(llmProvider === 'openai_compatible' || llmProvider === 'ollama') && (
              <div className="space-y-1.5">
                <Label htmlFor="llmBaseUrl">Base URL</Label>
                <Input
                  id="llmBaseUrl"
                  value={llmBaseUrl}
                  onChange={(e) => setLlmBaseUrl(e.target.value)}
                  placeholder={baseUrlPlaceholder(llmProvider)}
                  disabled={!isAdmin}
                />
                <p className="text-xs text-muted-foreground">{baseUrlHint(llmProvider)}</p>
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-border pt-3">
              <Button type="button" variant="outline" onClick={testLlm} disabled={llmTesting}>
                <Plug className="h-4 w-4" />
                {llmTesting ? 'Testing…' : 'Test connection'}
              </Button>
              {llmTestResult && (
                <div className={`flex items-center gap-1.5 text-xs ${llmTestResult.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {llmTestResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {llmTestResult.msg}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>How you'd like to be alerted.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Toggle
              label="Email when a test run completes"
              checked={notifyComplete}
              onChange={setNotifyComplete}
              disabled={!isAdmin}
            />
            <Toggle
              label="Email on critical findings"
              checked={notifyCritical}
              onChange={setNotifyCritical}
              disabled={!isAdmin}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Adaptive intelligence</CardTitle>
            <CardDescription>
              Let Nemesis AI learn from past findings and pull current threat research from the web to strengthen
              future test suites.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Toggle
              label="Learn from completed test runs (extract reusable attack patterns)"
              checked={enableLearning}
              onChange={setEnableLearning}
              disabled={!isAdmin}
            />
            <Toggle
              label="Use the web to research current adversarial techniques"
              checked={enableResearch}
              onChange={setEnableResearch}
              disabled={!isAdmin}
            />
            {enableResearch && (
              <div className="grid gap-4 rounded-md border bg-muted/40 p-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Search provider</Label>
                  <Select
                    value={searchProvider}
                    onValueChange={(v) => setSearchProvider(v as 'tavily' | 'brave' | 'none')}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (use server fallback)</SelectItem>
                      <SelectItem value="tavily">Tavily</SelectItem>
                      <SelectItem value="brave">Brave Search</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="searchKey">Search API key</Label>
                  <Input
                    id="searchKey"
                    type="password"
                    value={searchKey}
                    onChange={(e) => setSearchKey(e.target.value)}
                    placeholder={org.searchApiKeyMasked || 'Paste API key…'}
                    disabled={!isAdmin || searchProvider === 'none'}
                  />
                  <p className="text-xs text-muted-foreground">
                    {org.searchApiKeyMasked
                      ? `Currently set: ${org.searchApiKeyMasked}.`
                      : 'Falls back to the server-level key if blank.'}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Save</CardTitle>
            <CardDescription>{isAdmin ? 'Apply your changes.' : 'Only admins can change these settings.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="submit" disabled={!isAdmin}>Save settings</Button>
          </CardContent>
        </Card>
      </form>

      <div className="mt-6 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Team members</CardTitle>
            <CardDescription>People with access to this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isAdmin && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[220px] space-y-1.5">
                  <Label htmlFor="inviteEmail">Invite by email</Label>
                  <Input
                    id="inviteEmail"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@company.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'ADMIN' | 'ANALYST' | 'VIEWER')}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="ANALYST">Analyst</SelectItem>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={sendInvite} disabled={!inviteEmail}>
                  <Mail className="h-4 w-4" /> Invite
                </Button>
              </div>
            )}

            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.users.map((u) => {
                    const inactive = u.isActive === false;
                    return (
                      <TableRow key={u.id} className={inactive ? 'opacity-50' : undefined}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {u.name}
                            {u.mfaEnabled && <Badge variant="outline" className="text-[10px]">MFA</Badge>}
                            {inactive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          {isAdmin && u.id !== user?.id ? (
                            <Select value={u.role} onValueChange={(v) => changeMemberRole(u.id, v)}>
                              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                                <SelectItem value="ANALYST">Analyst</SelectItem>
                                <SelectItem value="VIEWER">Viewer</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary">{u.role}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isAdmin && u.id !== user?.id && (
                            inactive ? (
                              <Button variant="ghost" size="sm" onClick={() => reactivateMember(u.id)}>
                                Reactivate
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => deactivateMember(u.id, u.email)}>
                                Deactivate
                              </Button>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {members.invites.map((iv) => (
                    <TableRow key={iv.id}>
                      <TableCell className="text-muted-foreground">Pending</TableCell>
                      <TableCell className="text-muted-foreground">{iv.email}</TableCell>
                      <TableCell><Badge variant="outline">{iv.role}</Badge></TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <Button variant="ghost" size="sm" onClick={() => removeInvite(iv.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="border-red-200 dark:border-red-500/30 bg-red-50/30">
            <CardHeader>
              <CardTitle className="text-red-700 dark:text-red-300">Danger zone</CardTitle>
              <CardDescription>Permanently delete all org data. Cannot be undone.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={deleteData}>
                <Trash2 className="h-4 w-4" /> Delete all org data
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function defaultModelFor(provider: LlmProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-opus-4-7';
    case 'openai':
      return 'gpt-4o';
    case 'openai_compatible':
      return 'gpt-4o-mini';
    case 'ollama':
      return 'llama3.1:8b';
    case 'gemini':
      return 'gemini-2.0-flash';
  }
}

function keyPlaceholder(provider: LlmProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'sk-ant-…';
    case 'openai':
      return 'sk-…';
    case 'openai_compatible':
      return 'Provider-specific key';
    case 'ollama':
      return '(usually blank)';
    case 'gemini':
      return 'AIza… (from aistudio.google.com)';
  }
}

function baseUrlPlaceholder(provider: LlmProvider): string {
  switch (provider) {
    case 'openai_compatible':
      return 'https://api.groq.com/openai/v1';
    case 'ollama':
      return 'http://localhost:11434';
    default:
      return '';
  }
}

function baseUrlHint(provider: LlmProvider): string {
  switch (provider) {
    case 'openai_compatible':
      return 'Examples: https://api.groq.com/openai/v1 · https://api.together.xyz/v1 · https://openrouter.ai/api/v1 · http://localhost:1234/v1 (LM Studio) · http://localhost:8000/v1 (vLLM)';
    case 'ollama':
      return 'Default Ollama URL is http://localhost:11434. Pull a model first: `ollama pull llama3.1:8b`';
    default:
      return '';
  }
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

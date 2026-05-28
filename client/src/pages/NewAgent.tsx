import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Eye, EyeOff, Globe, Plug } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const AGENT_TYPES = [
  'Customer Support Bot',
  'Internal Assistant',
  'Sales Bot',
  'Code Assistant',
  'Data Analyst Bot',
  'Custom',
];

const MODELS = [
  'Claude (Anthropic)',
  'GPT (OpenAI)',
  'Gemini (Google)',
  'Llama (Meta)',
  'Mistral',
  'Cohere',
  'Custom / Unknown',
];

const ACCESS_LEVELS = [
  { v: 'public', label: 'Public / Anonymous' },
  { v: 'employees', label: 'Authenticated Employees' },
  { v: 'customers', label: 'Customers' },
  { v: 'admins', label: 'Admins Only' },
];

const SCOPE_OPTIONS = ['PII', 'Financial Data', 'Health Records', 'Internal IP', 'Customer Data', 'None'];

/**
 * v2.1 — two connection modes. "api" is the classic HTTP-endpoint flow; "browser"
 * is the Playwright-driven adapter for chatbots where we only have UI access
 * (no API key). The chosen mode determines which fields appear and what shape
 * we POST to the server.
 */
type ConnectionMode = 'api' | 'browser';

export default function NewAgent() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [revealApiKey, setRevealApiKey] = useState(false);
  const [revealBrowserPw, setRevealBrowserPw] = useState(false);
  const [mode, setMode] = useState<ConnectionMode>('api');

  const [form, setForm] = useState({
    name: '',
    agentType: 'Customer Support Bot',
    model: 'Claude (Anthropic)',
    // API-mode fields
    endpointUrl: '',
    apiKey: '',
    requestFormatStr: '{\n  "message": "{{prompt}}"\n}',
    responsePath: 'reply',
    // Browser-mode fields
    loginUrl: '',
    chatUrl: '',
    browserUsername: '',
    browserPassword: '',
    selLoginUsername: 'input[type=email], input[name=email]',
    selLoginPassword: 'input[type=password]',
    selLoginSubmit: 'button[type=submit]',
    selChatInput: 'textarea',
    selChatSend: '',
    selChatResponse: '[data-role="assistant"]',
    responseSettleMs: '4000',
    sendByEnter: true,
    // Shared
    systemPrompt: '',
    statedPurpose: '',
    knownGuardrails: '',
    sensitiveDataScope: [] as string[],
    userAccessLevel: 'employees',
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleScope(s: string) {
    setForm((f) => {
      const has = f.sensitiveDataScope.includes(s);
      let next: string[];
      if (s === 'None') {
        next = has ? [] : ['None'];
      } else {
        const base = f.sensitiveDataScope.filter((x) => x !== 'None');
        next = base.includes(s) ? base.filter((x) => x !== s) : [...base, s];
      }
      return { ...f, sensitiveDataScope: next };
    });
  }

  const requestFormatError = useMemo(() => {
    if (mode !== 'api') return null;
    try { JSON.parse(form.requestFormatStr); return null; }
    catch (e) { return e instanceof Error ? e.message : 'Invalid JSON'; }
  }, [form.requestFormatStr, mode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    setSubmitting(true);
    try {
      if (mode === 'api') {
        let requestFormat: unknown;
        try {
          requestFormat = JSON.parse(form.requestFormatStr);
        } catch {
          toast.error('Request Format must be valid JSON');
          setSubmitting(false);
          return;
        }
        const { data } = await api.post('/agents', {
          name: form.name,
          agentType: form.agentType,
          model: form.model,
          endpointUrl: form.endpointUrl,
          apiKey: form.apiKey,
          requestFormat,
          responsePath: form.responsePath,
          systemPrompt: form.systemPrompt || null,
          statedPurpose: form.statedPurpose || null,
          knownGuardrails: form.knownGuardrails || null,
          sensitiveDataScope: form.sensitiveDataScope,
          userAccessLevel: form.userAccessLevel,
        });
        toast.success('Agent connected. Generating security profile…');
        navigate(`/agents/${data.id}`);
      } else {
        // browser mode — agentType is fixed to the sentinel the server expects.
        const settleMs = Number.parseInt(form.responseSettleMs, 10);
        const { data } = await api.post('/agents', {
          name: form.name,
          agentType: 'web_chat',
          model: form.model,
          browserConfig: {
            loginUrl: form.loginUrl,
            chatUrl: form.chatUrl,
            username: form.browserUsername,
            selectors: {
              loginUsername: form.selLoginUsername,
              loginPassword: form.selLoginPassword,
              loginSubmit: form.selLoginSubmit,
              chatInput: form.selChatInput,
              chatSend: form.selChatSend,
              chatResponse: form.selChatResponse,
            },
            responseSettleMs: Number.isFinite(settleMs) ? settleMs : undefined,
            sendByEnter: form.sendByEnter,
          },
          browserPassword: form.browserPassword,
          systemPrompt: form.systemPrompt || null,
          statedPurpose: form.statedPurpose || null,
          knownGuardrails: form.knownGuardrails || null,
          sensitiveDataScope: form.sensitiveDataScope,
          userAccessLevel: form.userAccessLevel,
        });
        toast.success('Browser agent connected. Generating security profile…');
        navigate(`/agents/${data.id}`);
      }
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Connect new agent"
        description="Provide details about the AI agent so Nemesis AI can understand it and tailor a test suite."
        actions={
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Connection-mode picker */}
        <Card>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
            <ModeCard
              active={mode === 'api'}
              onClick={() => setMode('api')}
              icon={<Plug className="h-5 w-5" />}
              title="API endpoint"
              body="You have an HTTPS endpoint + API key. Fastest. Best for production bots you own."
            />
            <ModeCard
              active={mode === 'browser'}
              onClick={() => setMode('browser')}
              icon={<Globe className="h-5 w-5" />}
              title="Web chat (browser)"
              body="You only have the chat UI + login credentials. Slower but works for any deployed chatbot."
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
            <Field label="Agent name" required>
              <Input value={form.name} onChange={(e) => update('name', e.target.value)} required />
            </Field>
            <Field label="Agent type" required>
              <Select value={form.agentType} onValueChange={(v) => update('agentType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AGENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Underlying model" required>
              <Select value={form.model} onValueChange={(v) => update('model', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="User access level" required>
              <Select value={form.userAccessLevel} onValueChange={(v) => update('userAccessLevel', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCESS_LEVELS.map((a) => <SelectItem key={a.v} value={a.v}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* Mode-specific fields */}
        {mode === 'api' && (
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <Field label="API endpoint URL" required hint="HTTPS endpoint that accepts the request format below.">
                <Input
                  value={form.endpointUrl}
                  onChange={(e) => update('endpointUrl', e.target.value)}
                  placeholder="https://api.example.com/chat"
                  required={mode === 'api'}
                />
              </Field>
              <Field label="API key / auth token" required hint="Stored encrypted (AES-256-GCM) at rest.">
                <RevealInput
                  value={form.apiKey}
                  onChange={(v) => update('apiKey', v)}
                  reveal={revealApiKey}
                  toggle={() => setRevealApiKey((v) => !v)}
                  required={mode === 'api'}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Request format (JSON)" hint={requestFormatError ? `Invalid JSON: ${requestFormatError}` : 'Use {{prompt}} as the message placeholder.'}>
                  <Textarea
                    rows={6}
                    className={`font-mono text-xs ${requestFormatError ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
                    value={form.requestFormatStr}
                    onChange={(e) => update('requestFormatStr', e.target.value)}
                    aria-invalid={!!requestFormatError}
                  />
                </Field>
                <Field
                  label="Response path"
                  hint='Dot/bracket notation, e.g. "choices[0].message.content".'
                >
                  <Input value={form.responsePath} onChange={(e) => update('responsePath', e.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === 'browser' && (
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="rounded-md border-l-4 border-indigo-500 bg-indigo-50 p-3 text-xs text-indigo-900">
                <p className="font-semibold">How to find the CSS selectors</p>
                <p className="mt-1">
                  Open the chat UI in Chrome &rarr; right-click the input field &rarr; <b>Inspect</b>. Copy the
                  best-fitting selector (e.g. <code>textarea[name=&quot;message&quot;]</code>). Do the same for the
                  send button and one assistant message bubble.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Login URL" required hint="Page where the login form lives.">
                  <Input value={form.loginUrl} onChange={(e) => update('loginUrl', e.target.value)} placeholder="https://chat.example.com/login" required={mode === 'browser'} />
                </Field>
                <Field label="Chat URL" required hint="Page to navigate to after login.">
                  <Input value={form.chatUrl} onChange={(e) => update('chatUrl', e.target.value)} placeholder="https://chat.example.com/" required={mode === 'browser'} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Username / email" required>
                  <Input value={form.browserUsername} onChange={(e) => update('browserUsername', e.target.value)} required={mode === 'browser'} />
                </Field>
                <Field label="Password" required hint="Stored encrypted (AES-256-GCM) at rest.">
                  <RevealInput
                    value={form.browserPassword}
                    onChange={(v) => update('browserPassword', v)}
                    reveal={revealBrowserPw}
                    toggle={() => setRevealBrowserPw((v) => !v)}
                    required={mode === 'browser'}
                  />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Login form: username selector" required>
                  <Input value={form.selLoginUsername} onChange={(e) => update('selLoginUsername', e.target.value)} required={mode === 'browser'} />
                </Field>
                <Field label="Login form: password selector" required>
                  <Input value={form.selLoginPassword} onChange={(e) => update('selLoginPassword', e.target.value)} required={mode === 'browser'} />
                </Field>
                <Field label="Login form: submit button selector" required>
                  <Input value={form.selLoginSubmit} onChange={(e) => update('selLoginSubmit', e.target.value)} required={mode === 'browser'} />
                </Field>
                <Field label="Chat input selector" required hint="Where probes are typed.">
                  <Input value={form.selChatInput} onChange={(e) => update('selChatInput', e.target.value)} required={mode === 'browser'} />
                </Field>
                <Field label="Send button selector" hint="Leave blank to send by pressing Enter.">
                  <Input value={form.selChatSend} onChange={(e) => update('selChatSend', e.target.value)} placeholder="(optional)" />
                </Field>
                <Field label="Assistant response selector" required hint="Selector that matches assistant message bubbles (one per reply).">
                  <Input value={form.selChatResponse} onChange={(e) => update('selChatResponse', e.target.value)} required={mode === 'browser'} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Response settle (ms)" hint="Wait time after bubble appears, to let streaming finish.">
                  <Input value={form.responseSettleMs} onChange={(e) => update('responseSettleMs', e.target.value)} type="number" min="0" max="60000" />
                </Field>
                <Field label="Send method" hint="How to submit the prompt.">
                  <Select value={form.sendByEnter ? 'enter' : 'click'} onValueChange={(v) => update('sendByEnter', v === 'enter')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enter">Press Enter</SelectItem>
                      <SelectItem value="click">Click send button</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="grid gap-4 pt-6">
            <Field label="System prompt" hint="Paste the agent's system prompt if known (optional).">
              <Textarea
                rows={4}
                value={form.systemPrompt}
                onChange={(e) => update('systemPrompt', e.target.value)}
              />
            </Field>
            <Field label="Stated purpose" hint="What is this agent supposed to do?">
              <Textarea
                rows={3}
                value={form.statedPurpose}
                onChange={(e) => update('statedPurpose', e.target.value)}
              />
            </Field>
            <Field label="Known guardrails" hint="What restrictions are already in place?">
              <Textarea
                rows={3}
                value={form.knownGuardrails}
                onChange={(e) => update('knownGuardrails', e.target.value)}
              />
            </Field>
            <Field label="Sensitive data scope">
              <div className="flex flex-wrap gap-2">
                {SCOPE_OPTIONS.map((s) => {
                  const on = form.sensitiveDataScope.includes(s);
                  return (
                    <button
                      type="button"
                      key={s}
                      onClick={() => toggleScope(s)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        on
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-border bg-background text-muted-foreground hover:border-slate-400'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Connecting…' : 'Connect agent'}
          </Button>
        </div>
      </form>
    </>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="ml-0.5 text-red-500">*</span>}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
        active
          ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-200'
          : 'border-border bg-background hover:border-slate-400'
      }`}
    >
      <div className={`mt-0.5 ${active ? 'text-indigo-600' : 'text-muted-foreground'}`}>{icon}</div>
      <div>
        <div className={`text-sm font-semibold ${active ? 'text-indigo-900' : 'text-foreground'}`}>{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      </div>
    </button>
  );
}

function RevealInput({
  value,
  onChange,
  reveal,
  toggle,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  reveal: boolean;
  toggle: () => void;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        type={reveal ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="pr-9"
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label={reveal ? 'Hide' : 'Show'}
        title={reveal ? 'Hide' : 'Show'}
      >
        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

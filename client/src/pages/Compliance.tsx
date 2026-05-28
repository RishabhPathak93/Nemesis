import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Download, ShieldAlert, Globe, KeyRound } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';

interface Policy { ipAllowlist: string[]; ssoOnly: boolean; allowedCountries: string[] }
interface Usage {
  agentCount: number; apiKeyCount: number; scheduledReportCount: number; testRunsThisMonth: number;
  capAgents: number | null; capApiKeys: number | null; capScheduledReports: number | null; capTestRunsPerMonth: number | null;
}
interface Dsr { id: string; type: string; status: string; requestedAt: string; completedAt: string | null }
interface SsoConfig { enabled: boolean; idpEntityId: string; idpSsoUrl: string; emailDomains: string[] }
interface SsoBundle { config: SsoConfig | null; sp: { entityId: string; acsUrl: string; metadataUrl: string } }
interface OidcConfig { enabled: boolean; issuerUrl: string; clientId: string; emailDomains: string[]; scopes: string[] }
interface OidcBundle { config: OidcConfig | null; sp: { redirectUri: string } }
interface RequiredAcceptance { docType: string; version: string; alreadyAccepted: boolean }

export default function Compliance() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [dsrs, setDsrs] = useState<Dsr[]>([]);
  const [sso, setSso] = useState<SsoBundle | null>(null);
  const [oidc, setOidc] = useState<OidcBundle | null>(null);
  const [oidcIssuer, setOidcIssuer] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcDomains, setOidcDomains] = useState('');
  const [acceptances, setAcceptances] = useState<RequiredAcceptance[]>([]);
  const [ipAllowlistText, setIpAllowlistText] = useState('');
  const [ssoOnly, setSsoOnly] = useState(false);
  const [idpEntityId, setIdpEntityId] = useState('');
  const [idpSsoUrl, setIdpSsoUrl] = useState('');
  const [idpCertificate, setIdpCertificate] = useState('');
  const [emailDomains, setEmailDomains] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const [p, u, d, s, o, a] = await Promise.all([
        api.get<Policy>('/settings/policy'),
        api.get<Usage>('/settings/usage'),
        api.get<{ requests: Dsr[] }>('/data-subject-requests'),
        api.get<SsoBundle>('/settings/sso'),
        api.get<OidcBundle>('/settings/oidc'),
        api.get<{ required: RequiredAcceptance[] }>('/legal/required'),
      ]);
      setPolicy(p.data);
      setUsage(u.data);
      setDsrs(d.data.requests);
      setSso(s.data);
      setOidc(o.data);
      setAcceptances(a.data.required);
      setIpAllowlistText(p.data.ipAllowlist.join('\n'));
      setSsoOnly(p.data.ssoOnly);
      if (s.data.config) {
        setIdpEntityId(s.data.config.idpEntityId);
        setIdpSsoUrl(s.data.config.idpSsoUrl);
        setEmailDomains(s.data.config.emailDomains.join(','));
      }
      if (o.data.config) {
        setOidcIssuer(o.data.config.issuerUrl);
        setOidcClientId(o.data.config.clientId);
        setOidcDomains(o.data.config.emailDomains.join(','));
      }
    } catch (err) { const m = apiError(err); setLoadError(m); toast.error(m); }
  }
  useEffect(() => { void load(); }, []);

  async function savePolicy() {
    try {
      const list = ipAllowlistText.split('\n').map((s) => s.trim()).filter(Boolean);
      await api.put('/settings/policy', { ipAllowlist: list, ssoOnly });
      toast.success('Policy saved');
      await load();
    } catch (err) { toast.error(apiError(err)); }
  }

  async function saveSso() {
    try {
      await api.put('/settings/sso', {
        enabled: true,
        idpEntityId, idpSsoUrl, idpCertificate,
        emailDomains: emailDomains.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      });
      toast.success('SAML saved');
      await load();
    } catch (err) { toast.error(apiError(err)); }
  }

  async function saveOidc() {
    try {
      const body: Record<string, unknown> = {
        enabled: true,
        issuerUrl: oidcIssuer,
        clientId: oidcClientId,
        emailDomains: oidcDomains.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      };
      if (oidcClientSecret) body.clientSecret = oidcClientSecret;
      await api.put('/settings/oidc', body);
      toast.success('OIDC saved');
      setOidcClientSecret('');
      await load();
    } catch (err) { toast.error(apiError(err)); }
  }

  async function requestDsr(type: 'EXPORT' | 'DELETE') {
    if (!confirm(`Submit a ${type} data-subject request?`)) return;
    try {
      await api.post('/data-subject-requests', { type });
      toast.success(`${type} request submitted`);
      await load();
    } catch (err) { toast.error(apiError(err)); }
  }

  async function acceptDoc(docType: string, version: string) {
    try {
      await api.post('/legal/accept', { docType, version });
      await load();
    } catch (err) { toast.error(apiError(err)); }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} full />;
  if (!policy || !usage) return <FullPageLoader />;

  return (
    <>
      <PageHeader title="Compliance" description="SSO, access policy, quotas, data-subject requests, and legal acceptance." />

      <Tabs defaultValue="sso">
        <TabsList>
          <TabsTrigger value="sso">SSO</TabsTrigger>
          <TabsTrigger value="policy">Access policy</TabsTrigger>
          <TabsTrigger value="quotas">Quotas</TabsTrigger>
          <TabsTrigger value="dsr">Data subject requests</TabsTrigger>
          <TabsTrigger value="legal">Privacy / ToS</TabsTrigger>
        </TabsList>

        <TabsContent value="sso">
          <Card><CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> SAML 2.0</CardTitle>
            <CardDescription>Configure your identity provider. SP metadata link below — give it to your IdP admin.</CardDescription>
          </CardHeader><CardContent className="space-y-4">
            {sso?.sp && (
              <div className="rounded border bg-slate-50 p-3 text-xs">
                <div><strong>SP entityId:</strong> <code className="break-all font-mono">{sso.sp.entityId}</code></div>
                <div><strong>ACS URL:</strong> <code className="break-all font-mono">{sso.sp.acsUrl}</code></div>
                <div><strong>SP metadata:</strong> <a className="text-indigo-600 underline" href={sso.sp.metadataUrl} target="_blank" rel="noopener noreferrer">{sso.sp.metadataUrl}</a></div>
              </div>
            )}
            <div><Label>IdP entity ID</Label><Input value={idpEntityId} onChange={(e) => setIdpEntityId(e.target.value)} placeholder="https://idp.example.com/saml/metadata" /></div>
            <div><Label>IdP SSO URL</Label><Input value={idpSsoUrl} onChange={(e) => setIdpSsoUrl(e.target.value)} placeholder="https://idp.example.com/saml/sso" /></div>
            <div><Label>IdP certificate (PEM)</Label>
              <textarea value={idpCertificate} onChange={(e) => setIdpCertificate(e.target.value)}
                rows={5} placeholder="-----BEGIN CERTIFICATE-----..."
                className="w-full rounded border border-border p-2 font-mono text-xs" />
            </div>
            <div><Label>Email domains (comma-separated)</Label><Input value={emailDomains} onChange={(e) => setEmailDomains(e.target.value)} placeholder="acme.test,acme.io" /></div>
            <Button onClick={saveSso}><Save className="mr-1 h-4 w-4" /> Save SAML</Button>
          </CardContent></Card>

          <Card className="mt-4"><CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> OIDC (OpenID Connect)</CardTitle>
            <CardDescription>OAuth-based federation. Use this for Okta / Azure AD / Google Workspace.</CardDescription>
          </CardHeader><CardContent className="space-y-4">
            {oidc?.sp && (
              <div className="rounded border bg-slate-50 p-3 text-xs">
                <div><strong>Redirect URI:</strong> <code className="break-all font-mono">{oidc.sp.redirectUri}</code></div>
                <div className="text-muted-foreground">Add this as the allowed redirect URI in your OIDC provider.</div>
              </div>
            )}
            <div><Label>Issuer URL</Label><Input value={oidcIssuer} onChange={(e) => setOidcIssuer(e.target.value)} placeholder="https://login.example.com" /></div>
            <div><Label>Client ID</Label><Input value={oidcClientId} onChange={(e) => setOidcClientId(e.target.value)} placeholder="cortexview-spa" /></div>
            <div>
              <Label>Client secret</Label>
              <Input type="password" value={oidcClientSecret} onChange={(e) => setOidcClientSecret(e.target.value)} placeholder={oidc?.config ? '(leave blank to keep current)' : ''} />
            </div>
            <div><Label>Email domains</Label><Input value={oidcDomains} onChange={(e) => setOidcDomains(e.target.value)} placeholder="acme.test" /></div>
            <Button onClick={saveOidc}><Save className="mr-1 h-4 w-4" /> Save OIDC</Button>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="policy">
          <Card><CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> Access policy</CardTitle>
            <CardDescription>IP allowlist (CIDR per line) + SSO-only. Empty allowlist = open.</CardDescription>
          </CardHeader><CardContent className="space-y-4">
            <div><Label>IP allowlist (one CIDR per line)</Label>
              <textarea value={ipAllowlistText} onChange={(e) => setIpAllowlistText(e.target.value)}
                rows={6} placeholder={`10.0.0.0/8\n203.0.113.0/24`}
                className="w-full rounded border border-border p-2 font-mono text-xs" />
            </div>
            <div className="flex items-center gap-3"><Switch checked={ssoOnly} onCheckedChange={setSsoOnly} /><Label>Require SSO for sign-in (block password login)</Label></div>
            <Button onClick={savePolicy}><Save className="mr-1 h-4 w-4" /> Save policy</Button>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="quotas">
          <Card><CardHeader><CardTitle className="text-base">Org usage</CardTitle></CardHeader><CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Resource</TableHead><TableHead>Current</TableHead><TableHead>Cap</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Test runs (this month)</TableCell><TableCell>{usage.testRunsThisMonth}</TableCell><TableCell>{usage.capTestRunsPerMonth ?? '—'}</TableCell></TableRow>
                <TableRow><TableCell>Agents</TableCell><TableCell>{usage.agentCount}</TableCell><TableCell>{usage.capAgents ?? '—'}</TableCell></TableRow>
                <TableRow><TableCell>API keys</TableCell><TableCell>{usage.apiKeyCount}</TableCell><TableCell>{usage.capApiKeys ?? '—'}</TableCell></TableRow>
                <TableRow><TableCell>Scheduled reports</TableCell><TableCell>{usage.scheduledReportCount}</TableCell><TableCell>{usage.capScheduledReports ?? '—'}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="dsr">
          <Card><CardHeader>
            <CardTitle className="text-base">Data subject requests (GDPR / CCPA)</CardTitle>
            <CardDescription>Request a portable export of your data, or schedule deletion (admin approval required).</CardDescription>
          </CardHeader><CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => requestDsr('EXPORT')}><Download className="mr-1 h-4 w-4" /> Request my data export</Button>
              <Button variant="outline" onClick={() => requestDsr('DELETE')}>Request deletion</Button>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Requested</TableHead><TableHead>Completed</TableHead></TableRow></TableHeader>
              <TableBody>
                {dsrs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><Badge>{d.type}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(d.requestedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{d.completedAt ? new Date(d.completedAt).toLocaleString() : '—'}</TableCell>
                  </TableRow>
                ))}
                {dsrs.length === 0 && <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">No requests yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="legal">
          <Card><CardHeader><CardTitle className="text-base">Privacy / ToS / DPA acceptance</CardTitle></CardHeader><CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {acceptances.map((a) => (
                  <TableRow key={a.docType}>
                    <TableCell>{a.docType}</TableCell>
                    <TableCell className="font-mono text-xs">{a.version}</TableCell>
                    <TableCell>{a.alreadyAccepted ? <Badge>accepted</Badge> : <Badge variant="outline">pending</Badge>}</TableCell>
                    <TableCell className="text-right">
                      {!a.alreadyAccepted && (
                        <Button size="sm" variant="outline" onClick={() => acceptDoc(a.docType, a.version)}>Accept</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

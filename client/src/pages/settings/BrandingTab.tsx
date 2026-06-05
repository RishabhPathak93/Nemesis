import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Palette, Image as ImageIcon, Trash2 } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BrandingProfile {
  orgId: string;
  primaryColor: string | null;
  logoMime: string | null;
  logoSizeBytes: number | null;
  logoChecksum: string | null;
}

import { API_BASE_URL as baseURL } from '@/lib/baseUrl';
const ACCESS_KEY = 'cv_token';

export function BrandingTab() {
  const [profile, setProfile] = useState<BrandingProfile | null>(null);
  const [color, setColor] = useState('#4f46e5');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const { data } = await api.get<BrandingProfile>('/settings/branding');
      setProfile(data);
      if (data.primaryColor) setColor(data.primaryColor);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveColor() {
    setSaving(true);
    try {
      const { data } = await api.put<BrandingProfile>('/settings/branding', { primaryColor: color });
      setProfile(data);
      toast.success('Brand colour saved');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onLogoSelect(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) {
      toast.error('Logo too large — max 1 MB');
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append('logo', f);
    try {
      // multipart/form-data needs a fresh axios call without our default JSON content-type header.
      const tok = localStorage.getItem(ACCESS_KEY);
      const res = await fetch(`${baseURL}/settings/branding/logo`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `upload failed (${res.status})`);
      }
      const data = (await res.json()) as BrandingProfile;
      setProfile(data);
      toast.success('Logo uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    try {
      const { data } = await api.delete<BrandingProfile>('/settings/branding/logo');
      setProfile(data);
      toast.success('Logo removed');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  const logoUrl = profile?.logoChecksum
    ? `${baseURL}/settings/branding/logo?v=${profile.logoChecksum}`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette className="h-4 w-4" /> Branding</CardTitle>
        <CardDescription>Logo and primary colour for reports, scheduled emails, and shared links.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label className="mb-2 block">Primary colour</Label>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 cursor-pointer p-1"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#4f46e5"
                className="font-mono"
              />
              <Button onClick={saveColor} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Logo</Label>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt="org logo" className="h-12 w-12 rounded border bg-card object-contain p-1" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded border bg-muted text-muted-foreground">
                  <ImageIcon className="h-5 w-5" />
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onLogoSelect} className="hidden" />
              <Button variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : profile?.logoChecksum ? 'Replace' : 'Upload'}
              </Button>
              {profile?.logoChecksum && (
                <Button variant="outline" onClick={removeLogo}>
                  <Trash2 className="mr-1 h-4 w-4" /> Remove
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">PNG, SVG, JPEG, or WebP. Max 1 MB.</p>
          </div>
        </div>

        {(color || profile?.logoChecksum) && (
          <div>
            <Label className="mb-2 block">Live preview</Label>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-3" style={{ borderBottom: `2px solid ${color}` }}>
                {logoUrl && <img src={logoUrl} alt="" className="h-10 w-10 object-contain" />}
                <div>
                  <div className="text-lg font-semibold" style={{ color }}>Security Audit Report</div>
                  <div className="text-xs text-muted-foreground">Sample — your colour and logo will appear in PDF + HTML exports</div>
                </div>
              </div>
              <div className="mt-3 text-sm text-foreground">
                Findings, severity ratings, and recommendations render with this brand colour as the primary accent.
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

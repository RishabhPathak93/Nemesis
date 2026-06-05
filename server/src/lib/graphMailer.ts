import axios from 'axios';
import { logger } from './logger';
import type { OutboundEmail } from './email';

/**
 * Microsoft Graph outbound email (application / client-credentials flow).
 *
 * Sends mail as MS_GRAPH_SENDER_EMAIL using an Entra ID app registration that
 * has been granted the `Mail.Send` application permission (admin-consented).
 * Used as the env-level transport when SMTP_HOST is not configured.
 *
 * Env:
 *   MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET,
 *   MS_GRAPH_SENDER_EMAIL
 */

const TENANT = process.env.MS_GRAPH_TENANT_ID || '';
const CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET || '';
const SENDER = process.env.MS_GRAPH_SENDER_EMAIL || '';

export function graphConfigured(): boolean {
  return Boolean(TENANT && CLIENT_ID && CLIENT_SECRET && SENDER);
}

let tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.exp - 60_000 > now) return tokenCache.token;

  const url = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    url,
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
  );
  tokenCache = { token: data.access_token, exp: now + (data.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

/** Send one message via Graph. Throws on failure so the caller can fall back. */
export async function sendViaGraph(msg: OutboundEmail): Promise<void> {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER)}/sendMail`;
  const message = {
    subject: msg.subject,
    body: { contentType: msg.html ? 'HTML' : 'Text', content: msg.html ?? msg.text },
    toRecipients: [{ emailAddress: { address: msg.to } }],
  };
  await axios.post(
    url,
    { message, saveToSentItems: false },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20_000,
    },
  );
}

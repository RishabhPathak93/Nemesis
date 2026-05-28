import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { decrypt, encrypt } from '../../lib/crypto';
import { sendEmail } from '../../lib/email';
import { logger } from '../../lib/logger';

/** Normalised notification carried by every adapter. */
export interface Notification {
  subject: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  link?: string;
}

interface EmailConfig { to: string[] }
interface SlackConfig { incomingWebhookUrl: string }
interface TeamsConfig { incomingWebhookUrl: string }
interface WebhookCfgRef { webhookId: string }
// v2.0 — Jira + ServiceNow ticket auto-creation channels.
interface JiraConfig { baseUrl: string; email: string; apiToken: string; projectKey: string; issueType?: string }
interface ServiceNowConfig { baseUrl: string; user: string; password: string; tableName?: string }

type AnyChannelConfig = EmailConfig | SlackConfig | TeamsConfig | WebhookCfgRef | JiraConfig | ServiceNowConfig;

const SEVERITY_COLOR: Record<Notification['severity'], string> = {
  info: '#0ea5e9',
  warning: '#f59e0b',
  critical: '#dc2626',
};

export function encodeChannelConfig(cfg: unknown): string {
  return encrypt(JSON.stringify(cfg));
}

export function decodeChannelConfig(enc: string): AnyChannelConfig {
  return JSON.parse(decrypt(enc)) as AnyChannelConfig;
}

async function sendViaEmail(cfg: EmailConfig, n: Notification, orgId: string): Promise<void> {
  const recipients = cfg.to.filter(Boolean);
  if (recipients.length === 0) return;
  await sendEmail({
    to: recipients.join(','),
    subject: n.subject,
    text: n.body + (n.link ? `\n\n${n.link}` : ''),
    html: `<p style="border-left:3px solid ${SEVERITY_COLOR[n.severity]};padding-left:8px;">${n.body.replace(/\n/g, '<br>')}</p>${n.link ? `<p><a href="${n.link}">${n.link}</a></p>` : ''}`,
  }, orgId);
}

async function sendViaSlack(cfg: SlackConfig, n: Notification): Promise<void> {
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: n.subject } },
    { type: 'section', text: { type: 'mrkdwn', text: n.body } },
  ];
  if (n.link) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open' }, url: n.link }] });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `severity: *${n.severity}*` }] });
  await axios.post(cfg.incomingWebhookUrl, { text: n.subject, blocks }, { timeout: 10_000 });
}

async function sendViaJira(cfg: JiraConfig, n: Notification): Promise<void> {
  // Atlassian Cloud REST API v3. Auth: basic with email + API token.
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
  const body = {
    fields: {
      project: { key: cfg.projectKey },
      summary: n.subject,
      issuetype: { name: cfg.issueType || 'Task' },
      description: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: n.body }] },
          ...(n.link ? [{ type: 'paragraph', content: [{ type: 'text', text: n.link, marks: [{ type: 'link', attrs: { href: n.link } }] }] }] : []),
          { type: 'paragraph', content: [{ type: 'text', text: `Severity: ${n.severity}` }] },
        ],
      },
    },
  };
  await axios.post(`${cfg.baseUrl.replace(/\/$/, '')}/rest/api/3/issue`, body, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    timeout: 15_000,
  });
}

async function sendViaServiceNow(cfg: ServiceNowConfig, n: Notification): Promise<void> {
  // ServiceNow Table API — default to incident creation.
  const auth = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  const body = {
    short_description: n.subject,
    description: n.body + (n.link ? `\n\n${n.link}` : ''),
    impact: n.severity === 'critical' ? '1' : n.severity === 'warning' ? '2' : '3',
    urgency: n.severity === 'critical' ? '1' : '2',
  };
  const table = cfg.tableName || 'incident';
  await axios.post(`${cfg.baseUrl.replace(/\/$/, '')}/api/now/table/${table}`, body, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 15_000,
  });
}

async function sendViaTeams(cfg: TeamsConfig, n: Notification): Promise<void> {
  const card = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: SEVERITY_COLOR[n.severity].replace('#', ''),
    summary: n.subject,
    title: n.subject,
    sections: [{ text: n.body }],
    potentialAction: n.link
      ? [{ '@type': 'OpenUri', name: 'Open', targets: [{ os: 'default', uri: n.link }] }]
      : undefined,
  };
  await axios.post(cfg.incomingWebhookUrl, card, { timeout: 10_000 });
}

// v2.0 — per-channel rate limit. In-memory token bucket keyed by channelId.
// Survives within a process; multi-replica deployments rely on Redis-based
// rate limiting at the next pass (the existing `lib/rateLimits.ts` infra
// already runs on Redis when CV_RATE_LIMIT_REDIS=true).
interface Bucket { count: number; windowStart: number }
const channelBuckets = new Map<string, Bucket>();
const BUCKET_WINDOW_MS = 60_000;

function consumeChannelToken(channelId: string, perMinute: number | null | undefined): boolean {
  if (perMinute == null || perMinute <= 0) return true;
  const now = Date.now();
  const bucket = channelBuckets.get(channelId);
  if (!bucket || now - bucket.windowStart >= BUCKET_WINDOW_MS) {
    channelBuckets.set(channelId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= perMinute) return false;
  bucket.count++;
  return true;
}

/**
 * Dispatch a normalised notification to a channel. Returns ok/error per call.
 * Caller may collect per-channel results into ScheduledReportRun.channelResults.
 */
export async function sendToChannel(channelId: string, n: Notification): Promise<{ ok: true } | { ok: false; error: string }> {
  const channel = await prisma.notificationChannel.findUnique({ where: { id: channelId } });
  if (!channel || !channel.enabled) return { ok: false, error: 'channel disabled or not found' };
  // v2.0 — rate-limit gate.
  if (!consumeChannelToken(channelId, channel.rateLimitPerMinute)) {
    return { ok: false, error: `channel rate limit exceeded (>${channel.rateLimitPerMinute}/min)` };
  }
  try {
    const cfg = decodeChannelConfig(channel.configEnc);
    switch (channel.kind) {
      case 'EMAIL':
        await sendViaEmail(cfg as EmailConfig, n, channel.orgId);
        break;
      case 'SLACK':
        await sendViaSlack(cfg as SlackConfig, n);
        break;
      case 'TEAMS':
        await sendViaTeams(cfg as TeamsConfig, n);
        break;
      case 'WEBHOOK': {
        const ref = cfg as WebhookCfgRef;
        const { emitWebhookEvent } = await import('../../queues/webhookQueue');
        // For "linked webhook" channels, emit a synthetic event tagged with the channel.
        await emitWebhookEvent(channel.orgId, 'cortexview.notification', { subject: n.subject, body: n.body, severity: n.severity, link: n.link, viaWebhookId: ref.webhookId });
        break;
      }
      case 'JIRA':
        await sendViaJira(cfg as JiraConfig, n);
        break;
      case 'SERVICENOW':
        await sendViaServiceNow(cfg as ServiceNowConfig, n);
        break;
      default:
        return { ok: false, error: `unknown channel kind: ${channel.kind}` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err, channelId }, 'channel send failed');
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

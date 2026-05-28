import axios from 'axios';
import { prisma } from '../lib/prisma';
import { decrypt, encrypt } from '../lib/crypto';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/audit';

/**
 * SIEM forwarder (v2.0). Streams every audit-log row to operator-configured
 * Splunk HEC / Datadog Logs / syslog-over-HTTP receivers. Configured per org;
 * a single org can have multiple forwarders (e.g. one to Splunk and one to
 * Datadog).
 *
 * Each forwarder filters by `actionFilter[]` (empty = forward all). Failures
 * increment `failureCount` and audit `siem.delivery.failed` once per
 * threshold (every 10th failure) so a flapping receiver doesn't drown the log.
 */

interface SiemConfigSplunkHec { url: string; token: string; index?: string; sourcetype?: string }
interface SiemConfigDatadog { site: string; apiKey: string; service?: string; ddsource?: string }
interface SiemConfigSyslogHttp { url: string; bearerToken?: string }

export type SiemConfig = SiemConfigSplunkHec | SiemConfigDatadog | SiemConfigSyslogHttp;

export function encodeSiemConfig(cfg: unknown): string {
  return encrypt(JSON.stringify(cfg));
}
function decodeSiemConfig(enc: string): SiemConfig {
  return JSON.parse(decrypt(enc)) as SiemConfig;
}

interface AuditRow {
  id: string;
  orgId: string;
  action: string;
  actorId: string | null;
  actorType: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: Date;
}

async function sendSplunkHec(cfg: SiemConfigSplunkHec, row: AuditRow): Promise<void> {
  await axios.post(`${cfg.url.replace(/\/$/, '')}/services/collector/event`, {
    time: Math.floor(row.createdAt.getTime() / 1000),
    host: 'cortexview',
    source: cfg.sourcetype || 'cortexview:audit',
    sourcetype: cfg.sourcetype || 'cortexview:audit',
    index: cfg.index,
    event: row,
  }, {
    headers: { Authorization: `Splunk ${cfg.token}`, 'Content-Type': 'application/json' },
    timeout: 10_000,
  });
}

async function sendDatadog(cfg: SiemConfigDatadog, row: AuditRow): Promise<void> {
  await axios.post(`https://http-intake.logs.${cfg.site}/api/v2/logs`, [
    {
      ddsource: cfg.ddsource || 'cortexview',
      service: cfg.service || 'cortexview',
      timestamp: row.createdAt.toISOString(),
      hostname: 'cortexview',
      message: `${row.action} actor=${row.actorId ?? 'system'} target=${row.targetType ?? '-'}/${row.targetId ?? '-'}`,
      ...row,
    },
  ], {
    headers: { 'DD-API-KEY': cfg.apiKey, 'Content-Type': 'application/json' },
    timeout: 10_000,
  });
}

async function sendSyslogHttp(cfg: SiemConfigSyslogHttp, row: AuditRow): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.bearerToken) headers.Authorization = `Bearer ${cfg.bearerToken}`;
  await axios.post(cfg.url, {
    timestamp: row.createdAt.toISOString(),
    severity: 'info',
    facility: 'cortexview',
    message: row,
  }, { headers, timeout: 10_000 });
}

/**
 * Public entry point — call after every `writeAudit`. Fans out the row to
 * every enabled SIEM forwarder for the org that matches the action filter.
 * Failures are swallowed (logged + counted) so SIEM downtime never blocks
 * the audit write itself.
 */
export async function forwardToSiem(row: AuditRow): Promise<void> {
  const forwarders = await prisma.siemForwarder.findMany({
    where: { orgId: row.orgId, enabled: true },
  });
  if (forwarders.length === 0) return;

  for (const fw of forwarders) {
    if (fw.actionFilter.length > 0 && !fw.actionFilter.some((p) => row.action.startsWith(p))) continue;
    try {
      const cfg = decodeSiemConfig(fw.configEnc);
      switch (fw.kind) {
        case 'SPLUNK_HEC':
          await sendSplunkHec(cfg as SiemConfigSplunkHec, row);
          break;
        case 'DATADOG':
          await sendDatadog(cfg as SiemConfigDatadog, row);
          break;
        case 'SYSLOG_HTTP':
          await sendSyslogHttp(cfg as SiemConfigSyslogHttp, row);
          break;
        default:
          throw new Error(`unknown SIEM kind: ${fw.kind}`);
      }
      await prisma.siemForwarder.update({
        where: { id: fw.id },
        data: { lastForwardedAt: new Date(), failureCount: 0 },
      });
    } catch (err) {
      logger.warn({ err, forwarderId: fw.id, kind: fw.kind }, 'SIEM forward failed');
      const next = fw.failureCount + 1;
      await prisma.siemForwarder.update({
        where: { id: fw.id },
        data: { failureCount: next },
      });
      // Audit every 10th failure to surface flapping receivers without
      // drowning the audit log.
      if (next % 10 === 0) {
        await writeAudit({
          orgId: fw.orgId,
          action: 'siem.delivery.failed',
          actorType: 'system',
          targetType: 'siem_forwarder',
          targetId: fw.id,
          metadata: { kind: fw.kind, consecutiveFailures: next },
        });
      }
    }
  }
}

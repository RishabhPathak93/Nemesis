import axios from 'axios';
import { Agent } from '@prisma/client';
import { decrypt } from '../lib/crypto';
import { getByPath } from '../lib/json';
import { sendOnce as sendOnceViaBrowser } from './browserChat';
import { assertOutboundUrlAllowed, safeHttpsAgent } from '../lib/urlValidation';

/**
 * Browser-driven chat agents have agentType == BROWSER_AGENT_TYPE. They
 * bypass the HTTP path entirely and use the Playwright adapter instead.
 */
export const BROWSER_AGENT_TYPE = 'web_chat';

/**
 * Substitutes the {{prompt}} placeholder anywhere in a JSON template.
 */
function substituteTemplate(template: unknown, prompt: string): unknown {
  if (typeof template === 'string') {
    return template.replace(/\{\{\s*prompt\s*\}\}/g, prompt);
  }
  if (Array.isArray(template)) {
    return template.map((v) => substituteTemplate(v, prompt));
  }
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template as Record<string, unknown>)) {
      out[k] = substituteTemplate(v, prompt);
    }
    return out;
  }
  return template;
}

export async function sendToAgent(agent: Agent, prompt: string): Promise<string> {
  // Browser-driven chat agents skip the HTTP path entirely.
  if (agent.agentType === BROWSER_AGENT_TYPE) {
    return sendOnceViaBrowser(agent, prompt);
  }

  const apiKey = decrypt(agent.apiKey);

  const body = substituteTemplate(agent.requestFormat as unknown, prompt);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Heuristic auth header: support `Bearer` style and OpenAI-style headers
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }

  try {
    // NEM-2026-001: re-validate at send time to defeat DNS rebinding — a
    // host that resolved to a public IP at agent-create time may resolve
    // to 169.254.169.254 / 127.0.0.1 today.
    try {
      await assertOutboundUrlAllowed(agent.endpointUrl);
    } catch (err) {
      return `[AGENT_ERROR] Refusing to send to ${agent.endpointUrl}: ${(err as Error).message}`;
    }
    const res = await axios.post(agent.endpointUrl, body, {
      headers,
      timeout: 30_000,
      // NEM-2026-024: pin TLS verification on so a stray
      // NODE_TLS_REJECT_UNAUTHORIZED=0 cannot weaken outbound calls.
      httpsAgent: safeHttpsAgent(),
      // SSRF defense — never follow redirects (a malicious server can
      // redirect us to an internal address after passing pre-flight).
      maxRedirects: 0,
      validateStatus: () => true, // we handle non-2xx ourselves
    });

    if (res.status >= 400) {
      return `[AGENT_ERROR ${res.status}] ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`;
    }

    const value = getByPath(res.data, agent.responsePath);
    if (value == null) {
      return `[AGENT_ERROR] No value at responsePath '${agent.responsePath}'. Raw: ${JSON.stringify(res.data).slice(0, 500)}`;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[AGENT_ERROR] ${msg}`;
  }
}

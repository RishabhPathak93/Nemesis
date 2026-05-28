/**
 * v2.1 — Public surface for the browser-chat adapter.
 *
 * Two entry points:
 *
 *   sendOnce(agent, prompt) — open browser, login, send ONE prompt, close.
 *      Used by the test-connection endpoint and the seam in sendToAgent().
 *
 *   openSession(agent) — open browser, login, return a session you can call
 *      send() on many times. The test-run worker uses this to amortise the
 *      login cost across an entire probe suite.
 *
 * Both functions accept an Agent row (with `browserConfig` and
 * `browserPasswordEnc`) and decrypt the password just-in-time.
 */
import type { Agent } from '@prisma/client';
import { decrypt } from '../../lib/crypto';
import { openBrowserChatSession } from './adapter';
import type { BrowserChatConfig, BrowserChatSession } from './types';

export * from './types';

class BrowserChatConfigError extends Error {
  constructor(msg: string) {
    super(`[BROWSER_CHAT_CONFIG] ${msg}`);
  }
}

function parseConfig(agent: Agent): { config: BrowserChatConfig; password: string } {
  if (!agent.browserConfig) {
    throw new BrowserChatConfigError('agent.browserConfig is missing.');
  }
  if (!agent.browserPasswordEnc) {
    throw new BrowserChatConfigError('agent.browserPasswordEnc is missing.');
  }
  const cfg = agent.browserConfig as unknown as BrowserChatConfig;
  // Minimal shape check — full validation happens at create-agent time.
  if (!cfg.loginUrl || !cfg.chatUrl || !cfg.username || !cfg.selectors) {
    throw new BrowserChatConfigError('browserConfig is missing required fields.');
  }
  const sel = cfg.selectors;
  for (const key of ['loginUsername', 'loginPassword', 'loginSubmit', 'chatInput', 'chatResponse'] as const) {
    if (!sel[key]) {
      throw new BrowserChatConfigError(`selectors.${key} is required.`);
    }
  }
  const password = decrypt(agent.browserPasswordEnc);
  if (!password) {
    throw new BrowserChatConfigError('Failed to decrypt browserPasswordEnc.');
  }
  return { config: cfg, password };
}

/**
 * Open a re-usable session. Caller is responsible for calling session.close().
 */
export async function openSession(agent: Agent): Promise<BrowserChatSession> {
  const { config, password } = parseConfig(agent);
  return openBrowserChatSession(config, password);
}

/**
 * One-shot helper: open a browser, send one prompt, tear down. Used by
 * test-connection and by sendToAgent() when no pooled session is supplied.
 *
 * Returns the agent's reply, or a string starting with `[AGENT_ERROR ...]`
 * so it slots into the existing error-handling convention used elsewhere.
 */
export async function sendOnce(agent: Agent, prompt: string): Promise<string> {
  let session: BrowserChatSession | undefined;
  try {
    session = await openSession(agent);
    const reply = await session.send(prompt);
    return reply;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[AGENT_ERROR] ${msg}`;
  } finally {
    if (session) await session.close().catch(() => {});
  }
}

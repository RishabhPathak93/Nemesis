/**
 * v2.1 — Playwright-driven browser chat adapter.
 *
 * Lifecycle:
 *   const session = await openBrowserChatSession(cfg);
 *   try {
 *     const reply = await session.send("hi");
 *     ...
 *   } finally {
 *     await session.close();
 *   }
 *
 * Re-use a session for all probes in a test run — login is the most expensive
 * step, and many chat UIs lose context if you reopen the page mid-conversation.
 * Closing always tears down the browser even if a send() rejected.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserChatConfig, BrowserChatSession } from './types';

const DEFAULT_SETTLE_MS = 4_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 60_000;
const NAV_TIMEOUT_MS = 30_000;

/**
 * Launch a fresh browser, log into the target chat UI, and return a handle
 * you can call send(prompt) on repeatedly.
 *
 * Throws if login appears to have failed (selectors not found, still on the
 * login URL after submit, etc.) so callers see the failure early.
 */
export async function openBrowserChatSession(
  cfg: BrowserChatConfig,
  password: string,
): Promise<BrowserChatSession> {
  const browser: Browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    // Reasonable default UA so the target doesn't immediately flag us
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  });
  const page: Page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  try {
    // ── Login ─────────────────────────────────────────────────────────────
    await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(cfg.selectors.loginUsername, { timeout: NAV_TIMEOUT_MS });
    await page.fill(cfg.selectors.loginUsername, cfg.username);
    await page.fill(cfg.selectors.loginPassword, password);
    // The submit click may navigate or just XHR. Race both so we don't hang.
    const navPromise = page
      .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      .catch(() => null);
    await page.click(cfg.selectors.loginSubmit);
    await navPromise;

    // Sanity-check: if we're still on the login form, treat as failure.
    const stillOnLogin = await page
      .locator(cfg.selectors.loginPassword)
      .count()
      .then((n: number) => n > 0)
      .catch(() => false);
    if (stillOnLogin && page.url().includes(new URL(cfg.loginUrl).pathname)) {
      throw new Error(
        'Login failed — password field still present after submit. Check credentials or selectors.',
      );
    }

    // ── Navigate to the chat surface ──────────────────────────────────────
    if (page.url() !== cfg.chatUrl) {
      await page.goto(cfg.chatUrl, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForSelector(cfg.selectors.chatInput, { timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw err;
  }

  const settleMs = cfg.responseSettleMs ?? DEFAULT_SETTLE_MS;
  const responseTimeoutMs = cfg.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;

  return {
    async send(prompt: string): Promise<string> {
      // Snapshot how many assistant bubbles exist BEFORE we send, so we can
      // detect the new one without confusing it with prior history.
      const before = await page.locator(cfg.selectors.chatResponse).count();

      // Fill the chat input. Most chat UIs use a <textarea> or
      // contenteditable; page.fill() handles both via the "fill" Action.
      await page.fill(cfg.selectors.chatInput, prompt);

      if (cfg.sendByEnter || !cfg.selectors.chatSend) {
        await page.press(cfg.selectors.chatInput, 'Enter');
      } else {
        await page.click(cfg.selectors.chatSend);
      }

      // Wait for a new bubble to appear.
      await page
        .locator(cfg.selectors.chatResponse)
        .nth(before)
        .waitFor({ state: 'visible', timeout: responseTimeoutMs });

      // Let token streaming finish.
      await page.waitForTimeout(settleMs);

      // Grab the newest bubble's full text.
      const responses = page.locator(cfg.selectors.chatResponse);
      const total = await responses.count();
      if (total <= before) {
        throw new Error('No new response detected after settle window.');
      }
      const text = await responses.nth(total - 1).innerText();
      return text.trim();
    },
    async close(): Promise<void> {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

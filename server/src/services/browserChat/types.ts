/**
 * v2.1 — Browser-driven chat adapter (Playwright).
 *
 * Used when the operator only has the *web chat UI* of a target bot, not the
 * underlying API key. Instead of POSTing JSON, the engine logs into the chat
 * UI in a headless browser, types each probe prompt, and scrapes the bot's
 * reply.
 *
 * Persisted on Agent.browserConfig (Json). Password is stored separately in
 * Agent.browserPasswordEnc, encrypted with the platform ENCRYPTION_KEY.
 */
export interface BrowserChatSelectors {
  /** CSS for the login-form username/email field. */
  loginUsername: string;
  /** CSS for the login-form password field. */
  loginPassword: string;
  /** CSS for the submit button on the login form. */
  loginSubmit: string;
  /** CSS for the chat input (textarea or contenteditable div). */
  chatInput: string;
  /** CSS for the "send" button. If empty, we press Enter instead. */
  chatSend: string;
  /**
   * CSS selector that matches one assistant message bubble. We snapshot the
   * count before sending and wait for it to grow by 1, then read the last
   * one. The selector should NOT match user-side messages.
   */
  chatResponse: string;
}

export interface BrowserChatConfig {
  /** URL to navigate to first (the login page). */
  loginUrl: string;
  /** URL to navigate to after a successful login (the chat page). */
  chatUrl: string;
  /** Username/email to type into the login form. Not encrypted — usernames aren't secret. */
  username: string;
  /** CSS selectors driving login + chat interactions. */
  selectors: BrowserChatSelectors;
  /**
   * How long to wait after the assistant bubble appears before reading it.
   * Many chat UIs stream the reply token-by-token; this lets it finish.
   * Default: 4000ms.
   */
  responseSettleMs?: number;
  /**
   * Hard timeout for waiting for any single response to appear (ms).
   * Default: 60000ms.
   */
  responseTimeoutMs?: number;
  /**
   * Whether to require an explicit "Enter" key press to send (true) or to
   * click the chatSend button (false / default). Set to true if the target
   * UI auto-sends on Enter and has no visible button.
   */
  sendByEnter?: boolean;
}

export interface BrowserChatSession {
  /** Send one prompt, return the bot's reply text. Reusable across many calls. */
  send(prompt: string): Promise<string>;
  /** Close the browser. Always call this when done. */
  close(): Promise<void>;
}

export interface BrowserChatProbeResult {
  ok: boolean;
  response?: string;
  error?: string;
  latencyMs: number;
}

import axios from 'axios';
import { env } from '../../lib/env';
import { decrypt } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface SearchProviderConfig {
  provider: 'tavily' | 'brave';
  apiKey: string;
}

/** Resolves an org's preferred search provider, falling back to server env. */
export async function resolveSearchProvider(orgId: string): Promise<SearchProviderConfig | null> {
  const org = await prisma.org.findUnique({ where: { id: orgId } });
  if (!org) return null;
  if (!org.enableResearch) return null;

  // Org-level config takes priority
  if (org.searchProvider && org.searchApiKey) {
    try {
      return {
        provider: org.searchProvider as 'tavily' | 'brave',
        apiKey: decrypt(org.searchApiKey),
      };
    } catch {
      // fall through to env
    }
  }
  // Server-level fallback
  if (env.searchProvider === 'tavily' && env.tavilyApiKey) {
    return { provider: 'tavily', apiKey: env.tavilyApiKey };
  }
  if (env.searchProvider === 'brave' && env.braveSearchApiKey) {
    return { provider: 'brave', apiKey: env.braveSearchApiKey };
  }
  return null;
}

/** Provider-agnostic web search. Returns up to env.researchMaxResults hits. */
export async function webSearch(
  cfg: SearchProviderConfig,
  query: string,
  maxResults: number = env.researchMaxResults,
): Promise<SearchResult[]> {
  if (cfg.provider === 'tavily') return searchTavily(cfg.apiKey, query, maxResults);
  if (cfg.provider === 'brave') return searchBrave(cfg.apiKey, query, maxResults);
  throw new Error(`Unknown search provider: ${cfg.provider}`);
}

async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const res = await axios.post(
    'https://api.tavily.com/search',
    {
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_answer: false,
    },
    { timeout: 20_000 },
  );
  const hits = (res.data?.results as Array<Record<string, unknown>>) || [];
  return hits.map((h) => ({
    title: String(h.title || ''),
    url: String(h.url || ''),
    snippet: String(h.content || h.snippet || ''),
    publishedAt: h.published_date ? String(h.published_date) : undefined,
  }));
}

async function searchBrave(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const res = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
    params: { q: query, count: maxResults },
    timeout: 20_000,
  });
  const hits = (res.data?.web?.results as Array<Record<string, unknown>>) || [];
  return hits.map((h) => ({
    title: String(h.title || ''),
    url: String(h.url || ''),
    snippet: String(h.description || ''),
    publishedAt: h.age ? String(h.age) : undefined,
  }));
}

/**
 * Fetches a URL and returns plain-text excerpt (best effort, capped).
 * Strips scripts/styles and tags. Used to give Claude a deeper read on
 * search results that look promising.
 */
export async function fetchUrlText(url: string, maxBytes: number = env.researchMaxFetchBytes): Promise<string> {
  try {
    const res = await axios.get(url, {
      timeout: 15_000,
      maxContentLength: maxBytes * 4,
      responseType: 'text',
      headers: { 'User-Agent': 'NemesisAIResearchBot/1.0 (+security-testing)' },
      validateStatus: () => true,
    });
    if (res.status >= 400) return `[fetch ${res.status} ${url}]`;
    const html = String(res.data || '');
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, maxBytes);
  } catch (err) {
    return `[fetch error ${url}: ${err instanceof Error ? err.message : 'unknown'}]`;
  }
}

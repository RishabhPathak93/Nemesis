import { Agent } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getLlmClient, PIPELINE_TIMEOUTS } from '../../lib/llm';
import { extractJson } from '../../lib/json';
import { resolveSearchProvider, webSearch, fetchUrlText, SearchResult } from './webSearch';

export interface ResearchDigest {
  topic: string;
  query: string;
  summary: string;
  findings: Array<{ title: string; url: string; snippet: string; publishedAt?: string }>;
}

const SYSTEM_PROMPT = `You are an AI security researcher. You read raw web search results about LLM security threats and produce a tight, actionable digest of current adversarial techniques relevant to a specific AI agent's context.`;

/**
 * Builds a focused research query from an agent's profile and asks
 * Claude to suggest the best search query for it.
 */
async function buildQueryForAgent(agent: Agent): Promise<string> {
  const client = await getLlmClient(agent.orgId);
  const text = await client.call({
    system: 'You generate concise web search queries (single line, no quotes, no markdown).',
    user: `Generate one Google-style search query (8-15 words) to find current (2024-2026) adversarial techniques against an AI agent with this profile.

Profile:
- type: ${agent.agentType}
- model: ${agent.model}
- access: ${agent.userAccessLevel}
- data scope: ${agent.sensitiveDataScope.join(', ') || 'none'}

Return only the query string.`,
    maxTokens: 100,
    temperature: 0.4,
    timeoutMs: PIPELINE_TIMEOUTS.research,
    // Plain text — this call wants a raw query string, not JSON.
    responseFormat: 'text',
  });
  return text.trim().split('\n')[0].slice(0, 200);
}

/**
 * Runs research for an agent: query → search → fetch top results →
 * Claude digest → persist a ResearchSnapshot. Safe to call any time
 * (returns null and logs if research is disabled or no key configured).
 */
export async function researchForAgent(agent: Agent): Promise<ResearchDigest | null> {
  const cfg = await resolveSearchProvider(agent.orgId);
  if (!cfg) return null;

  const query = await buildQueryForAgent(agent);
  let results: SearchResult[];
  try {
    results = await webSearch(cfg, query);
  } catch (err) {
    console.error('Web search failed:', err);
    return null;
  }
  if (results.length === 0) return null;

  // Fetch a brief excerpt from the top 3 hits for richer context.
  const enriched = await Promise.all(
    results.slice(0, 3).map(async (r) => {
      const excerpt = await fetchUrlText(r.url);
      return { ...r, snippet: r.snippet || excerpt.slice(0, 600) };
    }),
  );
  const allFindings = [...enriched, ...results.slice(3)];

  // Have the LLM distil into a short digest grounded in the citations.
  const client = await getLlmClient(agent.orgId);
  const digestText = await client.call({
    system: SYSTEM_PROMPT,
    user: `Agent profile:
- type: ${agent.agentType}
- model: ${agent.model}
- access: ${agent.userAccessLevel}
- data scope: ${agent.sensitiveDataScope.join(', ') || 'none'}

Search query used: "${query}"

Web findings (raw):
${allFindings.map((f, i) => `[${i + 1}] ${f.title}\n${f.url}\n${f.snippet}`).join('\n\n')}

Return a JSON object with:
- topic: short topic label (5-10 words) describing the research focus
- summary: 6-10 sentence digest of the most relevant adversarial techniques to test against THIS agent. Cite findings inline as [1], [2], etc.

Return only valid JSON.`,
    maxTokens: 1200,
    temperature: 0.4,
    timeoutMs: PIPELINE_TIMEOUTS.research,
    responseFormat: 'json',
  });

  const parsed = extractJson<{ topic: string; summary: string }>(digestText);

  const snapshot = await prisma.researchSnapshot.create({
    data: {
      orgId: agent.orgId,
      topic: parsed.topic,
      query,
      summary: parsed.summary,
      findings: allFindings as unknown as object,
    },
  });

  return {
    topic: snapshot.topic,
    query: snapshot.query,
    summary: snapshot.summary,
    findings: allFindings,
  };
}

/** Used for ad-hoc research from the Knowledge UI. */
export async function researchAdHoc(orgId: string, topic: string): Promise<ResearchDigest | null> {
  const cfg = await resolveSearchProvider(orgId);
  if (!cfg) return null;

  const results = await webSearch(cfg, topic);
  if (results.length === 0) return null;

  const enriched = await Promise.all(
    results.slice(0, 3).map(async (r) => {
      const excerpt = await fetchUrlText(r.url);
      return { ...r, snippet: r.snippet || excerpt.slice(0, 600) };
    }),
  );
  const allFindings = [...enriched, ...results.slice(3)];

  const client = await getLlmClient(orgId);
  const digestText = await client.call({
    system: SYSTEM_PROMPT,
    user: `Topic: ${topic}

Web findings:
${allFindings.map((f, i) => `[${i + 1}] ${f.title}\n${f.url}\n${f.snippet}`).join('\n\n')}

Return JSON: { "topic": "<short label>", "summary": "<6-10 sentence digest with [n] citations>" }`,
    maxTokens: 1200,
    temperature: 0.4,
    timeoutMs: PIPELINE_TIMEOUTS.research,
    responseFormat: 'json',
  });
  const parsed = extractJson<{ topic: string; summary: string }>(digestText);

  const snapshot = await prisma.researchSnapshot.create({
    data: {
      orgId,
      topic: parsed.topic,
      query: topic,
      summary: parsed.summary,
      findings: allFindings as unknown as object,
    },
  });

  return {
    topic: snapshot.topic,
    query: snapshot.query,
    summary: snapshot.summary,
    findings: allFindings,
  };
}

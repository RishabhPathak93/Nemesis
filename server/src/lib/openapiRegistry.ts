import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * v2.0 — auto-generated OpenAPI registry. Controllers register their Zod
 * schemas + paths via `registry.registerPath(...)` and we generate a fresh
 * spec on demand. This complements the hand-curated `lib/openapi.ts`:
 *
 *   /api/v1/openapi.json          — hand-curated (stability contract)
 *   /api/v1/openapi-derived.json  — auto-derived (full coverage; less polished)
 *
 * Adoption: controllers don't need to change all at once. Each controller
 * that wants its endpoints reflected in the derived spec calls
 * `registerEndpoint({ method, path, ... })` at module load.
 */

export const openapiRegistry = new OpenAPIRegistry();

// Re-export z so controllers don't have to chase the augmented import path
// from @asteasolutions/zod-to-openapi.
export { z };

interface RegisterArgs {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  summary: string;
  tags?: string[];
  request?: {
    body?: z.ZodType;
    query?: z.ZodType;
  };
  response: {
    description: string;
    schema?: z.ZodType;
  };
  errorCodes?: number[];
}

export function registerEndpoint(a: RegisterArgs): void {
  openapiRegistry.registerPath({
    method: a.method,
    path: a.path,
    summary: a.summary,
    tags: a.tags,
    request: a.request
      ? {
          body: a.request.body
            ? { content: { 'application/json': { schema: a.request.body } } }
            : undefined,
          query: a.request.query as never,
        }
      : undefined,
    responses: {
      [String(a.response.description.startsWith('Created') ? 201 : 200)]: {
        description: a.response.description,
        content: a.response.schema
          ? { 'application/json': { schema: a.response.schema } }
          : undefined,
      },
      ...(a.errorCodes ?? []).reduce<Record<string, { description: string }>>((acc, code) => {
        acc[String(code)] = { description: `Error ${code}` };
        return acc;
      }, {}),
    },
  });
}

export function generateDerivedOpenApi(): unknown {
  const generator = new OpenApiGeneratorV31(openapiRegistry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Nemesis AI API (auto-derived)',
      version: '2.0.0',
      description:
        'Endpoints registered by controllers via `registerEndpoint`. ' +
        'Stability is best-effort — the contract guarantee lives at /api/v1/openapi.json.',
    },
    servers: [{ url: '/api/v1' }],
  });
}

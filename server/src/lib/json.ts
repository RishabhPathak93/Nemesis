// =============================================================================
// Sanitisation
// =============================================================================
//
// Strip characters that break Prisma's JSON wire format or PostgreSQL's text
// column validation. Apply to ANY string sourced from an LLM or external agent
// before it reaches the database.
//
// Removes: null bytes (U+0000), C0 controls except U+0009/U+000A/U+000D, all
// C1 controls (U+007F to U+009F), and lone UTF-16 surrogates.
//
// Patterns are built via the RegExp constructor with literal backslash-u
// escapes in string form so the source file itself contains zero
// control-character bytes.

const NULL_BYTE_RE = new RegExp('\\u0000', 'g');
const C0_CONTROLS_RE = new RegExp('[\\u0001-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
const C1_CONTROLS_RE = new RegExp('[\\u007F-\\u009F]', 'g');
const LONE_HIGH_SURROGATE_RE = new RegExp('[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])', 'g');
const LONE_LOW_SURROGATE_RE = new RegExp('(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]', 'g');
const REPLACEMENT_CHAR = '�';

export function sanitizeForDb(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return s ?? '';
  return s
    .replace(NULL_BYTE_RE, '')
    .replace(LONE_HIGH_SURROGATE_RE, REPLACEMENT_CHAR)
    .replace(LONE_LOW_SURROGATE_RE, REPLACEMENT_CHAR)
    .replace(C0_CONTROLS_RE, '')
    .replace(C1_CONTROLS_RE, '');
}

// =============================================================================
// JSON extraction with repair
// =============================================================================

/**
 * Extracts a JSON value from an LLM response. Tolerates markdown code fences,
 * surrounding chatter, trailing commas, and truncation (auto-balances braces
 * and discards an unterminated tail item from arrays).
 *
 * On total failure, throws an error containing a 400-char preview of the raw
 * response so test-run errorMessage actually points at the malformed output.
 */
export function extractJson<T = unknown>(raw: string): T {
  const original = raw;
  const trimmed = raw.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* fall through */
  }

  const span = findJsonSpan(candidate);
  if (!span) {
    throw new JsonExtractError('No JSON object/array found in response', original);
  }

  try {
    return JSON.parse(span.text) as T;
  } catch {
    /* fall through */
  }

  const repairs = [stripTrailingCommas, repairUnbalanced, repairTruncatedArray];
  let working = span.text;
  for (const fn of repairs) {
    working = fn(working);
    try {
      return JSON.parse(working) as T;
    } catch {
      /* try next repair */
    }
  }

  throw new JsonExtractError('Could not parse JSON after repair attempts', original);
}

class JsonExtractError extends Error {
  constructor(reason: string, raw: string) {
    const preview = raw.length > 400 ? raw.slice(0, 200) + ' … ' + raw.slice(-200) : raw;
    super(`${reason}. Raw response (clipped): ${preview}`);
    this.name = 'JsonExtractError';
  }
}

function findJsonSpan(text: string): { text: string; complete: boolean } | null {
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  if (firstObj === -1 && firstArr === -1) return null;

  let start: number;
  let opener: string;
  let closer: string;
  if (firstObj === -1 || (firstArr !== -1 && firstArr < firstObj)) {
    start = firstArr;
    opener = '[';
    closer = ']';
  } else {
    start = firstObj;
    opener = '{';
    closer = '}';
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        return { text: text.slice(start, i + 1), complete: true };
      }
    }
  }
  return { text: text.slice(start), complete: false };
}

function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

function repairUnbalanced(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let repaired = text;
  if (inString) repaired += '"';
  while (stack.length) repaired += stack.pop();
  return stripTrailingCommas(repaired);
}

function repairTruncatedArray(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) return text;
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastSafeEnd = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 1) lastSafeEnd = i;
    }
  }
  if (lastSafeEnd === -1) return text;
  return trimmed.slice(0, lastSafeEnd + 1) + ']';
}

// =============================================================================
// Type coercion helpers (LLM outputs are unreliable about types)
// =============================================================================

export function toInt(value: unknown, fallback = 0, opts: { min?: number; max?: number } = {}): number {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const cleaned = value.replace(/[%,\s]/g, '');
    n = parseFloat(cleaned);
  } else {
    return fallback;
  }
  if (!Number.isFinite(n)) return fallback;
  n = Math.round(n);
  if (opts.min !== undefined) n = Math.max(opts.min, n);
  if (opts.max !== undefined) n = Math.min(opts.max, n);
  return n;
}

export function toFloat(value: unknown, fallback = 0, opts: { min?: number; max?: number } = {}): number {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const cleaned = value.replace(/[%,\s]/g, '');
    n = parseFloat(cleaned);
  } else {
    return fallback;
  }
  if (!Number.isFinite(n)) return fallback;
  if (opts.min !== undefined) n = Math.max(opts.min, n);
  if (opts.max !== undefined) n = Math.min(opts.max, n);
  return n;
}

/**
 * Coerce an LLM-emitted "long-form text" field into a clean string, even
 * when the model returned an array or an object instead.
 *
 * Classic failure mode this fixes: model returns
 *   "executive_summary": [{...}, {...}]
 * which produced "[object Object],[object Object]" with naive String(x).
 */
export function toRichString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => toRichString(v, ''))
      .filter((s) => s.length > 0)
      .join('\n\n');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const TEXT_KEYS = ['text', 'content', 'body', 'value', 'summary', 'paragraph', 'detail', 'description'];
    for (const k of TEXT_KEYS) {
      if (typeof obj[k] === 'string' && (obj[k] as string).trim()) {
        return (obj[k] as string).trim();
      }
    }
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const s = toRichString(v, '');
      if (s) {
        const label = k.replace(/[_-]+/g, ' ').replace(/(^|\s)\S/g, (m) => m.toUpperCase());
        parts.push(`**${label}**: ${s}`);
      }
    }
    return parts.join('\n\n') || fallback;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

// =============================================================================
// Streaming case-counter
// =============================================================================

/**
 * Counts complete top-level objects inside a JSON array embedded in a
 * (possibly partial) text stream. Drives the live "N test cases generated
 * so far" counter while a streaming LLM call is still emitting tokens.
 *
 * Supports {"test_cases": [...]} or a bare array.
 */
export function countCompleteCases(partial: string): number {
  if (!partial) return 0;

  let arrStart = -1;
  const wrapped = partial.match(/"(?:test_cases|testCases|cases|tests|patterns)"\s*:\s*\[/);
  if (wrapped && wrapped.index !== undefined) {
    arrStart = wrapped.index + wrapped[0].length - 1;
  } else {
    const firstBracket = partial.indexOf('[');
    const firstBrace = partial.indexOf('{');
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      arrStart = firstBracket;
    }
  }
  if (arrStart < 0) return 0;

  let depth = 0;
  let count = 0;
  let inString = false;
  let escape = false;
  for (let i = arrStart + 1; i < partial.length; i++) {
    const ch = partial[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) count++;
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return count;
}

// =============================================================================
// Path lookup helper
// =============================================================================

/**
 * Look up a value in an object by dot/bracket notation path,
 * e.g. "choices[0].message.content".
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const tokens: (string | number)[] = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(parseInt(m[2], 10));
  }
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[t];
  }
  return cur;
}

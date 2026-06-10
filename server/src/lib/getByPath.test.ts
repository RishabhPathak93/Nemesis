import { describe, it, expect } from 'vitest';
import { getByPath } from './json';

/** Covers M-09: getByPath must not index into non-objects (which previously
 *  returned a stray character / primitive that was treated as the agent reply). */
describe('getByPath', () => {
  it('extracts a valid nested path (OpenAI-style)', () => {
    const obj = { choices: [{ message: { content: 'hi there' } }] };
    expect(getByPath(obj, 'choices[0].message.content')).toBe('hi there');
    expect(getByPath(obj, 'choices.0.message.content')).toBe('hi there');
  });
  it('returns undefined when indexing INTO a string (M-09)', () => {
    expect(getByPath({ a: 'hello' }, 'a.0')).toBeUndefined();
    expect(getByPath({ a: 'hello' }, 'a.length')).toBeUndefined();
  });
  it('returns undefined when indexing into a number/boolean', () => {
    expect(getByPath({ a: 5 }, 'a.b')).toBeUndefined();
    expect(getByPath({ a: true }, 'a.x')).toBeUndefined();
  });
  it('returns undefined for a missing path', () => {
    expect(getByPath({ a: { b: 1 } }, 'a.c.d')).toBeUndefined();
  });
  it('returns the whole object for an empty path', () => {
    const o = { x: 1 };
    expect(getByPath(o, '')).toBe(o);
  });
});

/**
 * v2.2 — Language detection wrapper (C4).
 *
 * Used by the oracle combiner to flag responses that aren't in the same
 * language as the prompt — a common bypass pattern is "ask in English,
 * receive unsafe content in Mandarin / Hindi / Russian", and the English-only
 * regex detectors miss it.
 *
 * `franc` is a small (~50 KB) dependency-free trigram-based detector. It's
 * accurate to ISO-639-3 language codes (e.g. "eng", "cmn", "rus"). Returns
 * "und" (undetermined) for inputs too short to be confident.
 */

import { franc, francAll } from 'franc';

/** Minimum bytes before we trust the detector. Shorter texts get "und". */
const MIN_LENGTH = 50;

export interface DetectedLanguage {
  /** ISO-639-3 code ("eng", "rus", …) or "und" if undetermined. */
  iso: string;
  /** Confidence in [0,1] of the top guess (relative). */
  confidence: number;
  /** Top-3 candidates with relative confidence. */
  candidates: { iso: string; confidence: number }[];
}

const UND: DetectedLanguage = { iso: 'und', confidence: 0, candidates: [] };

export function detectLanguage(text: string | null | undefined): DetectedLanguage {
  if (!text || text.length < MIN_LENGTH) return UND;
  const top = franc(text);
  if (top === 'und') return UND;
  const all = francAll(text, { only: [] }).slice(0, 3);
  // franc returns [iso, confidence(0..1)] pairs
  const candidates = all.map(([iso, c]) => ({ iso, confidence: c }));
  const conf = candidates.find((c) => c.iso === top)?.confidence ?? 0;
  return { iso: top, confidence: conf, candidates };
}

/**
 * Did the response use a language other than the prompt? Used as a signal
 * for the oracle combiner — non-English responses to English prompts are
 * frequently encoded-exfil attempts.
 */
export function isLanguagePivot(promptText: string, responseText: string): {
  pivoted: boolean;
  promptLang: string;
  responseLang: string;
} {
  const p = detectLanguage(promptText);
  const r = detectLanguage(responseText);
  return {
    pivoted: p.iso !== 'und' && r.iso !== 'und' && p.iso !== r.iso,
    promptLang: p.iso,
    responseLang: r.iso,
  };
}

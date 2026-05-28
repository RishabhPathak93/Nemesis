/**
 * Barrel that triggers side-effect registration of every builtin technique.
 *
 * Adding a new technique = one new file in this directory + one `import` line
 * below. No other module needs to change.
 */

import './encodings';
import './framings';
import './composites';

// LLM-assisted families (multilingual translate, suffix-corpus) load
// themselves from their respective service modules — they require a live LLM
// client + outbound HTTP, so we don't pull them in at registry-init time.

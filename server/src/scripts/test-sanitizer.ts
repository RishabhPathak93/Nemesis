import { sanitizeForDb } from '../lib/json';

const NULL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const SOH = String.fromCharCode(1);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const HIGH_LONE = String.fromCharCode(0xd800);
const LOW_LONE = String.fromCharCode(0xdc00);

const tests = [
  { name: 'null bytes',          input: 'foo' + NULL + 'bar' + NULL,    expected: 'foobar' },
  { name: 'C0 controls',         input: 'a' + SOH + BEL + 'b',           expected: 'ab' },
  { name: 'TAB/LF/CR preserved', input: 'a' + TAB + 'b' + LF + 'c' + CR, expected: 'a' + TAB + 'b' + LF + 'c' + CR },
  { name: 'lone high surrogate', input: 'x' + HIGH_LONE + 'y',           expected: 'x�y' },
  { name: 'lone low surrogate',  input: 'p' + LOW_LONE + 'q',            expected: 'p�q' },
  { name: 'clean string',        input: 'hello world',                   expected: 'hello world' },
];

let pass = 0;
let fail = 0;
for (const t of tests) {
  const out = sanitizeForDb(t.input);
  const ok = out === t.expected;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? '✓' : '✗'} ${t.name}: in=${JSON.stringify(t.input)} out=${JSON.stringify(out)}`,
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

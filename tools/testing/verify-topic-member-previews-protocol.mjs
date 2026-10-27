// Diagnostic edits must not silently change the preregistered launch decision.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const path = 'tools/testing/measure-topic-member-previews.mjs';
const baseline = execFileSync('git', ['show', `87ced4d0:${path}`]);
const current = readFileSync(new URL('./measure-topic-member-previews.mjs', import.meta.url));
const sections = [
  ['header', '/**', "import assert from 'node:assert/strict';"],
  ['PROTOCOL', 'export const PROTOCOL', 'export function buildPlan'],
  ['Cartesian matrix', 'export function buildPlan', 'const previewReasons'],
  ['populations and summary', 'function summarize', 'export function decide'],
  ['decide', 'export function decide', '// Sources must be closed'],
  ['collection populations', '        for (let n = 0; n < 3;', '        const production ='],
  ['retained and series decisions', '        entry.retained =', '      } finally {'],
];
function section(bytes, start, end) {
  const a = bytes.indexOf(start), b = bytes.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'section markers missing');
  return bytes.subarray(a,b);
}
for (const [label,start,end] of sections) {
  const a = section(baseline,start,end), b = section(current,start,end);
  assert.ok(a.equals(b), `${label} changed`);
  console.log(`${label}: byte-identical (${b.length} bytes; SHA-256 ${createHash('sha256').update(b).digest('hex')})`);
}
console.log(`${sections.length} sections compared against 87ced4d0`);

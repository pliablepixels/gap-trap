#!/usr/bin/env node
/**
 * Count ratchet (AGENTS.md C7). Reference implementation from gap-trap.
 *
 * A rule that says "do not do X" and has a backlog of X cannot be a hard
 * gate on day one, and an advisory check lets the backlog grow for free.
 * This records each count in a baseline file and fails when a count grows.
 * Lowering is welcome; raising a number by hand needs a reason in the
 * commit message.
 *
 *   node ratchet.mjs            check against the baseline
 *   node ratchet.mjs --update   rewrite the baseline from the current tree
 *
 * Wire it into the unit suite (import `currentCounts` and compare) or run it
 * as its own CI step. ADAPT: fill `counters` with the counts this repo needs.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const baselinePath = path.join(root, '.quality-baseline.json');
// A baseline this far above the real count is a raised number nobody lowered back.
const SLACK = 5;

function walk(dir, match, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, match, acc);
    else if (match.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Files under `dir` whose text matches `pattern`, as repo-relative paths. */
export function filesMatching(dir, fileMatch, pattern) {
  return walk(path.join(root, dir), fileMatch)
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f));
}

/** Total occurrences of `pattern` across files under `dir`. */
export function occurrences(dir, fileMatch, pattern) {
  return walk(path.join(root, dir), fileMatch).reduce(
    (n, f) => n + (readFileSync(f, 'utf8').match(pattern)?.length ?? 0),
    0,
  );
}

// ADAPT: one entry per count. Names are stable keys in the baseline file.
// Examples from the origin repo:
//   internalMockFiles: () => filesMatching('src', /\.test\.tsx?$/, /vi\.mock\(\s*['"]\.{1,2}\/(?:[^'"]*\/)?(stores|hooks|services|components)\//).length,
//   existenceAssertions: () => occurrences('src', /\.test\.tsx?$/, /(?<!\.not)\.toBeInTheDocument\(\)|\.toBeDefined\(\)/g),
//   fixedSleeps: () => occurrences('tests/steps', /\.ts$/, /waitForTimeout\(/g),
export const counters = {};

export function currentCounts() {
  return Object.fromEntries(Object.entries(counters).map(([name, count]) => [name, count()]));
}

/** Compare counts to the baseline. Returns the lines to print and an exit code. */
export function check(counts, baseline) {
  const lines = [];
  let code = 0;
  for (const [name, count] of Object.entries(counts)) {
    const allowed = baseline[name] ?? 0;
    if (count > allowed) {
      lines.push(`${name}: ${allowed} allowed, ${count} found (+${count - allowed})`);
      code = 1;
    } else if (allowed - count > SLACK) {
      lines.push(`${name}: baseline ${allowed} is ${allowed - count} above the ${count} found; run --update`);
      code = 1;
    } else if (count < allowed) {
      lines.push(`${name}: ${allowed} -> ${count}, run --update to lock the gain in`);
    }
  }
  return { lines, code };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = currentCounts();
  if (process.argv.includes('--update')) {
    writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
    console.log('Baseline written:', counts);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const { lines, code } = check(counts, baseline);
  for (const line of lines) console.log(line);
  if (code) console.log('Fix the new problems, or raise the number deliberately and say why in the commit message.');
  else console.log('Counts within baseline:', counts);
  process.exit(code);
}

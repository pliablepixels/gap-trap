#!/usr/bin/env node
/**
 * Count ratchet (AGENTS.md C7). Reference implementation from gap-trap.
 *
 * A rule that says "do not do X" and has a backlog of X cannot be a hard
 * gate on day one, and an advisory check lets the backlog grow for free.
 * This records each count in a baseline file and fails when a count grows.
 *
 *   node ratchet.mjs            check against the baseline
 *   node ratchet.mjs --update   lower the baseline to the current counts
 *
 * `--update` only ever lowers. A count that rose, or a counter that left the
 * config, needs a hand edit to the baseline file, so the raise arrives as a
 * reviewable diff with a reason in the commit message instead of as a flag
 * the agent can reach for. A counter that cannot run is an error, never a
 * zero: a broken command that counted as 0 used to read as a clean sweep.
 *
 * Wire it into the unit suite (import `currentCounts` and compare) or run it
 * as its own CI step. ADAPT: fill `counters` with the counts this repo needs.
 *
 * Exit codes: 0 within baseline, 1 a count grew or drifted, 2 the ratchet
 * could not run (broken counter, missing baseline).
 */
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
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

/**
 * Run every counter. A counter that throws, or that returns anything but a
 * whole number, is a broken counter and stops the run: counting it as 0 would
 * report the backlog as swept and invite `--update` to lock the zero in.
 */
export function currentCounts(config = counters) {
  const out = {};
  for (const [name, count] of Object.entries(config)) {
    let value;
    try {
      value = count();
    } catch (error) {
      throw new Error(`counter "${name}" failed to run: ${error.message}`);
    }
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`counter "${name}" returned ${JSON.stringify(value)}, which is not a count`);
    }
    out[name] = value;
  }
  return out;
}

/**
 * Compare counts to the baseline. Returns the lines to print and an exit code.
 * Every baseline name is checked too, so deleting a counter from the config
 * cannot retire the number it was holding.
 */
export function check(counts, baseline) {
  const lines = [];
  let code = 0;
  for (const name of [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort()) {
    if (!(name in counts)) {
      lines.push(`${name}: in the baseline but no counter is configured; restore the counter, or delete the baseline entry and say why in the commit message`);
      code = 1;
      continue;
    }
    const count = counts[name];
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

/**
 * What `--update` would do. It writes only when every count holds or falls and
 * every baseline name still has a counter; anything else has to be a hand edit.
 */
export function planUpdate(counts, baseline) {
  const refusals = [];
  for (const [name, count] of Object.entries(counts)) {
    const allowed = baseline[name];
    if (allowed !== undefined && count > allowed) {
      refusals.push(`${name}: ${allowed} -> ${count} is a rise`);
    }
  }
  for (const name of Object.keys(baseline)) {
    if (!(name in counts)) refusals.push(`${name}: in the baseline but no counter is configured`);
  }
  return { refusals, next: { ...baseline, ...counts } };
}

function run(argv) {
  let counts;
  try {
    counts = currentCounts();
  } catch (error) {
    console.error(`ratchet: ${error.message}`);
    return 2;
  }
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    if (!argv.includes('--update')) {
      console.error(`ratchet: cannot read ${baselinePath}: ${error.message}`);
      return 2;
    }
  }
  if (argv.includes('--update')) {
    const { refusals, next } = planUpdate(counts, baseline);
    if (refusals.length > 0) {
      for (const line of refusals) console.log(line);
      console.log('--update only lowers. Edit the baseline by hand and say why in the commit message (C7).');
      return 1;
    }
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log('Baseline written:', next);
    return 0;
  }
  const { lines, code } = check(counts, baseline);
  for (const line of lines) console.log(line);
  if (code) console.log('Fix the new problems, or raise the number deliberately in the baseline file and say why in the commit message.');
  else console.log('Counts within baseline:', counts);
  return code;
}

// Compare real paths: a checkout reached through a symlink (macOS /tmp and
// /var are symlinks) made argv[1] and import.meta.url disagree, and the gate
// exited 0 having run nothing at all.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (invokedDirectly()) {
  process.exit(run(process.argv.slice(2)));
}

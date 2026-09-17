#!/usr/bin/env node
/**
 * Proven-red gate (AGENTS.md P2). Reference implementation from gap-trap.
 *
 * P2 says a failing test precedes every feature and bugfix. Nothing checked
 * it in the origin repo: three tests passed on the code they were meant to
 * catch, each found only because someone stashed the fix and re-ran by
 * hand. This script does that by machine.
 *
 * For a range base..head it takes the test files changed since the two
 * forked, runs them in a throwaway worktree that holds the fork-point code
 * plus the head tests, and fails when they pass there. A test that is green
 * on the code it claims to guard proves nothing. The normal unit-test job
 * proves the same tests are green on head.
 *
 *   node scripts/proven-red.mjs <base> <head> [--title "<pr title>"]
 *
 * Every changed test file is judged on its own. One file that fails carries
 * no proof for the others: a run that batched them together let a test which
 * passed on the old code ride out on a failing sibling's exit code.
 *
 * Skips, and says so: a range that changes no source; a range whose only
 * source changes are the gate scripts themselves (proven red by scratch
 * violation); a range whose only changed tests are end-to-end steps, which
 * need a live server. Two skips are bypasses rather than proofs, and say so
 * as a CI warning: a skip-type title, which is unverified text, and the
 * end-to-end case. Fails when a behavior change arrives with no changed
 * test. A changed unit test is always proved, whatever the title claims.
 *
 * A red run is not one proof but two. A test that fails an assertion on the
 * old code shows the assertion bites. A test that fails only because it
 * references a symbol the fork point does not have (`x is not a function`,
 * `Cannot find module`) shows the code is new and nothing about the
 * assertions; that is the only red a new module can ever give against the
 * fork point. The job reads each file's failures and names the files whose
 * red is of the second kind, so a reviewer knows which assertions still need
 * a look (M2: read what a gate measured).
 *
 * Exit codes: 0 proved or skipped, 1 a test proved nothing, 2 the gate could
 * not run (no report, a test file the runner never opened).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKIP_TYPES = ['docs', 'chore', 'ci', 'refactor', 'build', 'style', 'test'];

// ADAPT: the classifiers below are the whole port. Unit tests are what gets
// proven. End-to-end tests are real tests that cannot run here, so they skip
// with a warning. Test support travels with the tests but is not a test and
// never excuses one. Gate files are proven red by scratch violation instead.
// Non-code never counts as a behavior change. UNIT_TEST wins where more than
// one matches. The origin repo's values are shown. APP_DIR is the directory
// the test runner runs from, relative to the repo root ('' for the root).
const APP_DIR = 'app';
const UNIT_TEST = /^app\/src\/(?!tests\/).*\.test\.(ts|tsx)$/;
const E2E_TEST = /^app\/tests\/steps\//;
const TEST_SUPPORT = /^app\/src\/tests\/|\/__tests__\//;
const GATE_FILE = /^scripts\/|instruction-gate|proven-red|ratchet/;
const NON_CODE = /^(docs\/|agents\/|\.github\/|.*\.md$|.*\.rst$|app\/\.[\w-]+-baseline\.json$)/;
// ADAPT: the runner and its JSON report. vitest: `--reporter=json --outputFile=<path>`.
// pytest: `--json-report --json-report-file=<path>` (pytest-json-report), and
// map its `tests[].nodeid` and `longrepr` into readFileResults. go test: `-json`.
const TEST_CMD = ['npx', 'vitest', 'run'];

/**
 * Split a changed-file list into what to run, what to carry along, and what
 * counts as behavior. `deleted` names the paths gone at head: a deleted test
 * cannot be proven and must not be run, because the fork-point worktree still
 * holds its old copy, which passes and reads as a test that proves nothing.
 */
export function classify(files, deleted = new Set()) {
  const live = (f) => !deleted.has(f);
  const unitTests = files.filter((f) => UNIT_TEST.test(f) && live(f));
  const e2eTests = files.filter((f) => E2E_TEST.test(f) && !UNIT_TEST.test(f) && live(f));
  const testSupport = files.filter(
    (f) => TEST_SUPPORT.test(f) && !UNIT_TEST.test(f) && !E2E_TEST.test(f) && live(f),
  );
  const source = files.filter(
    (f) =>
      !UNIT_TEST.test(f) && !E2E_TEST.test(f) && !TEST_SUPPORT.test(f) && !NON_CODE.test(f),
  );
  return { unitTests, e2eTests, testSupport, source };
}

/**
 * Why a range needs no red proof, or null when it does. `warn` marks a skip
 * that is a bypass rather than a proof, so CI can say so out loud.
 */
export function skipReason(title, { unitTests, e2eTests, source }) {
  if (source.length === 0) return { reason: 'no source file changed', warn: false };
  // The title is unverified input, so it cannot excuse a changed test from the
  // proof: a behavior change mislabelled `refactor:` used to skip the gate
  // entirely. A skip-type title still excuses a source change that brings no
  // test, which is what a real refactor looks like, and that skip is warned
  // about because nothing verified the claim.
  if (unitTests.length > 0) return null;
  if (source.every((f) => GATE_FILE.test(f))) {
    return { reason: 'only gate files changed; a gate is proven red by scratch violation', warn: false };
  }
  const type = /^([a-z]+)(\(.+\))?!?:/.exec(title ?? '')?.[1];
  if (type && SKIP_TYPES.includes(type)) {
    return { reason: `title type "${type}" carries no behavior change`, warn: true };
  }
  if (e2eTests.length > 0) {
    return { reason: 'the only changed tests are end-to-end steps, which need a live server', warn: true };
  }
  return null;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const lines = (text) => text.split('\n').filter(Boolean);

/** A failure that says the symbol or module is missing, not that a value was wrong. */
const MISSING_REFERENCE =
  /is not a function|is not defined|is not a constructor|Cannot find module|Failed to resolve import|does not provide an export|has no exported member/;

/** Sort one file's failure messages into assertion failures and missing references. */
export function classifyFailures(failures) {
  const missing = failures.filter((m) => MISSING_REFERENCE.test(m));
  return { assertion: failures.length - missing.length, missing: missing.length, sample: missing[0] };
}

/** Match a report entry to the repo-relative path the diff named. */
function resultFor(fileResults, rel) {
  return fileResults.find((r) => r.file === rel || r.file.endsWith(`/${rel}`) || rel.endsWith(r.file));
}

/**
 * Judge each changed test file on its own run result. Returns the lines to
 * print, the lines to raise as CI warnings, and an exit code, so the whole
 * verdict is testable without git.
 */
export function judge(relative, { code, fileResults }) {
  const out = [];
  const warnings = [];
  if (!Array.isArray(fileResults) || fileResults.length === 0) {
    out.push(
      `proven-red: the test command exited ${code} without producing a report. ` +
        'That is a runner that did not run, not a test that went red. Fix the command or the worktree setup.',
    );
    return { lines: out, warnings, code: 2 };
  }
  const green = [];
  const missingOnly = [];
  let assertions = 0;
  let missing = 0;
  for (const rel of relative) {
    const result = resultFor(fileResults, rel);
    if (!result) {
      out.push(`proven-red: ${rel} is in the range but the runner never opened it; the gate cannot prove it.`);
      return { lines: out, warnings, code: 2 };
    }
    if (result.status !== 'failed') {
      green.push(rel);
      continue;
    }
    const kinds = classifyFailures(result.messages ?? []);
    assertions += kinds.assertion;
    missing += kinds.missing;
    if (kinds.assertion === 0 && kinds.missing > 0) missingOnly.push({ rel, sample: kinds.sample });
  }
  if (green.length > 0) {
    out.push(
      `proven-red: ${green.length} changed test file(s) pass on the pre-change code; ` +
        `they cannot catch the bug they claim to: ${green.join(', ')}`,
    );
    return { lines: out, warnings, code: 1 };
  }
  if (missingOnly.length > 0) {
    const names = missingOnly.map((m) => m.rel).join(', ');
    warnings.push(
      'proven-red: these files fail on the pre-change code only because they reference code it does not ' +
        `have, e.g. "${(missingOnly[0].sample ?? '').split('\n')[0]}": ${names}. That proves the code is new, ` +
        'not that the assertions would catch a wrong value. Check those assertions in review, or run the ' +
        'mutation smoke on the module.',
    );
  }
  out.push(
    `proven-red: changed tests fail on the pre-change code, as they should ` +
      `(${assertions} assertion failure(s), ${missing} missing reference(s) across ${relative.length} file(s)).`,
  );
  return { lines: out, warnings, code: 0 };
}

/**
 * Run the head tests against the base code in a worktree.
 * `runTests(appDir, files)` returns `{ code, fileResults }`; injectable for tests.
 */
export function proveRed({ base, head, repo, title, runTests = runVitest, log = console.log }) {
  // The fork point, not `base` itself. CI passes
  // github.event.pull_request.base.sha, which is the base branch's tip at
  // event time, so on a branch whose base has moved since it was cut, a
  // two-dot diff reports the base branch's own newer commits as this range's
  // changes. Those tests then rightly pass on `base` and the gate fails a PR
  // that did nothing wrong. The same tip is also the wrong worktree to prove
  // against: the pre-change code is the fork point, not whatever landed on
  // the base branch afterwards.
  const forkPoint = git(['merge-base', base, head], repo);
  const range = `${forkPoint}..${head}`;
  const files = lines(git(['diff', '--name-only', range], repo));
  const deleted = new Set(lines(git(['diff', '--name-only', '--diff-filter=D', range], repo)));
  const split = classify(files, deleted);
  const skip = skipReason(title, split);
  if (skip) {
    const message = `proven-red: skipped, ${skip.reason}.`;
    log(skip.warn && process.env.GITHUB_ACTIONS ? `::warning title=Proven red skipped::${message}` : message);
    return 0;
  }
  if (split.unitTests.length === 0) {
    log('proven-red: a behavior change arrived with no changed test (P2).');
    return 1;
  }

  const worktree = mkdtempSync(path.join(tmpdir(), 'proven-red-'));
  try {
    git(['worktree', 'add', '--detach', '-q', worktree, forkPoint], repo);
    // Read the head versions from git, not the working tree: locally the
    // checkout may be on another branch, and a test copied from there
    // proves nothing. CI checks out head, so the two agree there.
    for (const f of [...split.unitTests, ...split.testSupport]) {
      const content = execFileSync('git', ['show', `${head}:${f}`], { cwd: repo, encoding: 'utf8' });
      mkdirSync(path.dirname(path.join(worktree, f)), { recursive: true });
      writeFileSync(path.join(worktree, f), content);
    }
    // ADAPT: share installed dependencies with the worktree instead of reinstalling.
    const modules = path.join(repo, APP_DIR, 'node_modules');
    if (existsSync(modules)) {
      mkdirSync(path.join(worktree, APP_DIR), { recursive: true });
      symlinkSync(modules, path.join(worktree, APP_DIR, 'node_modules'));
    }

    const prefix = APP_DIR ? `${APP_DIR}/` : '';
    const relative = split.unitTests.map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));
    const verdict = judge(relative, runTests(path.join(worktree, APP_DIR), relative));
    for (const line of verdict.warnings) {
      log(process.env.GITHUB_ACTIONS ? `::warning title=Red by missing symbol only::${line}` : line);
    }
    for (const line of verdict.lines) log(line);
    return verdict.code;
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktree], repo);
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

/** Run vitest; the JSON report beside the default one is how the failures get read. */
function runVitest(appDir, files) {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'proven-red-report-')), 'vitest.json');
  const args = [...TEST_CMD.slice(1), ...files, '--reporter=default', '--reporter=json', `--outputFile=${report}`];
  let code = 0;
  try {
    execFileSync(TEST_CMD[0], args, { cwd: appDir, stdio: 'inherit' });
  } catch (error) {
    code = error.status ?? 1;
  }
  return { code, fileResults: readFileResults(report) };
}

/**
 * One entry per test file in a vitest JSON report: its status and every
 * failure message, including the file-level one when the file could not even
 * load. Per file, not pooled: a file's own result is the only thing that says
 * whether that file proved anything.
 */
export function readFileResults(report) {
  if (!existsSync(report)) return [];
  return (JSON.parse(readFileSync(report, 'utf8')).testResults ?? []).map((file) => {
    const perTest = (file.assertionResults ?? []).flatMap((t) => t.failureMessages ?? []);
    const messages = perTest.length === 0 && file.status === 'failed' && file.message ? [file.message] : perTest;
    return { file: file.name, status: file.status, messages };
  });
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
  const argv = process.argv.slice(2);
  const titleIndex = argv.indexOf('--title');
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== titleIndex + 1);
  const [base, head] = positional;
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!base || !head) {
    console.error('usage: proven-red.mjs <base> <head> [--title "<title>"]');
    process.exit(2);
  }
  // An empty --title (a push event has no PR title) falls back to the head subject.
  const title = (titleIndex > -1 && argv[titleIndex + 1]) || git(['log', '-1', '--format=%s', head], repo);
  process.exit(proveRed({ base, head, repo, title }));
}

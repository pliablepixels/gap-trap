// Proven-red gate. Each case names the defect it guards against; the comment
// says what the gate used to do instead.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { GATES, commit, git, makeRepo, sh, tempDir, writeFiles } from './helpers.mjs';

const { classify, skipReason, judge, readFileResults, proveRed } = await import(
  path.join(GATES, 'proven-red.mjs')
);

const UNIT = 'app/src/thing.test.ts';
const OTHER = 'app/src/other.test.ts';

describe('classify', () => {
  it('splits unit tests, e2e, support and source', () => {
    const split = classify([
      UNIT,
      'app/tests/steps/login.ts',
      'app/src/tests/factory.ts',
      'app/src/thing.ts',
      'README.md',
    ]);
    assert.deepEqual(split.unitTests, [UNIT]);
    assert.deepEqual(split.e2eTests, ['app/tests/steps/login.ts']);
    assert.deepEqual(split.testSupport, ['app/src/tests/factory.ts']);
    assert.deepEqual(split.source, ['app/src/thing.ts']);
  });

  // N2: a test deleted at head stayed in the run list, so the worktree's own
  // older copy ran, passed, and was reported as a test that proves nothing.
  it('N2: a test deleted at head is not something to run', () => {
    const split = classify([UNIT, 'app/src/thing.ts'], new Set([UNIT]));
    assert.deepEqual(split.unitTests, []);
    assert.deepEqual(split.source, ['app/src/thing.ts']);
  });
});

describe('skipReason', () => {
  const split = (over = {}) => ({ unitTests: [], e2eTests: [], testSupport: [], source: ['app/src/thing.ts'], ...over });

  it('skips a range with no source change', () => {
    assert.match(skipReason('feat: x', split({ source: [] })).reason, /no source file changed/);
  });

  it('never skips when a unit test changed, whatever the title says', () => {
    assert.equal(skipReason('refactor: x', split({ unitTests: [UNIT] })), null);
  });

  it('skips a gate-only change, which is proven red by scratch violation', () => {
    const reason = skipReason('fix: x', split({ source: ['scripts/ratchet.mjs'] }));
    assert.match(reason.reason, /only gate files changed/);
    assert.equal(reason.warn, false);
  });

  // N5: the skip was silent, so an unverified one-word title bought a pass
  // that nobody ever saw go by.
  it('N5: a skip-type title still skips, but says out loud that it is a bypass', () => {
    const reason = skipReason('refactor: x', split());
    assert.match(reason.reason, /title type "refactor"/);
    assert.equal(reason.warn, true);
  });

  // N1: any file under a test-support path granted a skip, so adding one
  // throwaway helper turned P2 off for a real behavior change.
  it('N1: a test-support file does not excuse a source change with no test', () => {
    assert.equal(skipReason('feat: x', split({ testSupport: ['app/src/tests/factory.ts'] })), null);
  });

  it('skips when the only changed tests are e2e, and says it is a bypass', () => {
    const reason = skipReason('feat: x', split({ e2eTests: ['app/tests/steps/login.ts'] }));
    assert.match(reason.reason, /end-to-end/);
    assert.equal(reason.warn, true);
  });
});

describe('judge', () => {
  const failed = (file, ...messages) => ({ file, status: 'failed', messages });
  const passed = (file) => ({ file, status: 'passed', messages: [] });

  it('a file that failed an assertion on the old code is a proof', () => {
    const v = judge([UNIT], { code: 1, fileResults: [failed(UNIT, 'expected 1 to be 2')] });
    assert.equal(v.code, 0);
    assert.deepEqual(v.warnings, []);
    assert.match(v.lines[0], /as they should/);
  });

  it('a file that passed on the old code fails the gate', () => {
    const v = judge([UNIT], { code: 0, fileResults: [passed(UNIT)] });
    assert.equal(v.code, 1);
    assert.match(v.lines[0], /pass on the pre-change code/);
  });

  // D9: every changed file's failures were pooled into one list and one exit
  // status, so a file that passed on the old code rode out on a failing
  // sibling and a file red only by missing symbol lost its warning to one.
  it('D9: a passing file is caught even when a sibling failed', () => {
    const v = judge([UNIT, OTHER], {
      code: 1,
      fileResults: [passed(UNIT), failed(OTHER, 'expected 1 to be 2')],
    });
    assert.equal(v.code, 1);
    assert.match(v.lines[0], new RegExp(UNIT));
    assert.doesNotMatch(v.lines[0], new RegExp(OTHER));
  });

  // Both orders: judging against a running total instead of the file's own
  // failures only shows up when the assertion failure is seen first.
  for (const [first, second] of [[UNIT, OTHER], [OTHER, UNIT]]) {
    it(`D9: a sibling assertion failure does not vouch for a missing-symbol red (${first} first)`, () => {
      const results = {
        [UNIT]: failed(UNIT, 'thing is not a function'),
        [OTHER]: failed(OTHER, 'expected 1 to be 2'),
      };
      const v = judge([first, second], { code: 1, fileResults: [results[first], results[second]] });
      assert.equal(v.code, 0);
      assert.equal(v.warnings.length, 1);
      assert.match(v.warnings[0], new RegExp(UNIT));
      assert.doesNotMatch(v.warnings[0], new RegExp(OTHER));
    });
  }

  it('warns when a file is red only by missing symbol', () => {
    const v = judge([UNIT], { code: 1, fileResults: [failed(UNIT, 'Cannot find module "./new"')] });
    assert.equal(v.code, 0);
    assert.match(v.warnings[0], /reference code it does not have/);
  });

  // D8: a non-zero status with no report at all was printed as "as they
  // should", so a runner that never started read as a proof.
  it('D8: no report is a gate that could not run, not a red', () => {
    const v = judge([UNIT], { code: 1, fileResults: [] });
    assert.equal(v.code, 2);
    assert.match(v.lines[0], /runner that did not run/);
  });

  it('D8: a test file the runner never opened is a gate that could not run', () => {
    const v = judge([UNIT, OTHER], { code: 1, fileResults: [failed(OTHER, 'expected 1 to be 2')] });
    assert.equal(v.code, 2);
    assert.match(v.lines[0], /never opened it/);
  });
});

describe('readFileResults', () => {
  it('keeps failures with the file they came from', () => {
    const dir = tempDir();
    const report = path.join(dir, 'vitest.json');
    writeFileSync(
      report,
      JSON.stringify({
        testResults: [
          { name: `/repo/${UNIT}`, status: 'failed', assertionResults: [{ failureMessages: ['boom'] }] },
          { name: `/repo/${OTHER}`, status: 'passed', assertionResults: [{ failureMessages: [] }] },
        ],
      }),
    );
    const results = readFileResults(report);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { file: `/repo/${UNIT}`, status: 'failed', messages: ['boom'] });
    assert.deepEqual(results[1].messages, []);
  });

  it('keeps the file-level message when a file could not even load', () => {
    const dir = tempDir();
    const report = path.join(dir, 'vitest.json');
    writeFileSync(
      report,
      JSON.stringify({ testResults: [{ name: UNIT, status: 'failed', assertionResults: [], message: 'Failed to resolve import' }] }),
    );
    assert.deepEqual(readFileResults(report)[0].messages, ['Failed to resolve import']);
  });

  it('an absent report is no results, which judge reads as a gate that could not run', () => {
    assert.deepEqual(readFileResults('/nonexistent/vitest.json'), []);
  });
});

describe('proveRed over a real range', () => {
  const repoWithChange = (head) => {
    const dir = makeRepo({
      'app/src/thing.ts': 'export const thing = () => 1;\n',
      'app/src/thing.test.ts': 'test("old", () => {});\n',
      'README.md': '# fixture\n',
    });
    commit(dir, head, 'change');
    return dir;
  };

  it('passes when the changed test goes red on the old code', () => {
    const dir = repoWithChange({
      'app/src/thing.ts': 'export const thing = () => 2;\n',
      'app/src/thing.test.ts': 'test("new", () => { expect(thing()).toBe(2); });\n',
    });
    const lines = [];
    const code = proveRed({
      base: 'HEAD~1',
      head: 'HEAD',
      repo: dir,
      title: 'fix: thing',
      log: (l) => lines.push(l),
      runTests: (_dir, files) => ({
        code: 1,
        fileResults: files.map((f) => ({ file: f, status: 'failed', messages: ['expected 1 to be 2'] })),
      }),
    });
    assert.equal(code, 0);
    assert.match(lines.join('\n'), /as they should/);
  });

  it('fails when the changed test is green on the old code', () => {
    const dir = repoWithChange({
      'app/src/thing.ts': 'export const thing = () => 2;\n',
      'app/src/thing.test.ts': 'test("new", () => { expect(true).toBe(true); });\n',
    });
    const lines = [];
    const code = proveRed({
      base: 'HEAD~1',
      head: 'HEAD',
      repo: dir,
      title: 'fix: thing',
      log: (l) => lines.push(l),
      runTests: (_dir, files) => ({
        code: 0,
        fileResults: files.map((f) => ({ file: f, status: 'passed', messages: [] })),
      }),
    });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /pass on the pre-change code/);
  });

  // N2
  it('N2: deleting a test is not a test to run; the change still needs one', () => {
    const dir = repoWithChange({
      'app/src/thing.ts': 'export const thing = () => 2;\n',
      'app/src/thing.test.ts': null,
    });
    const lines = [];
    const code = proveRed({
      base: 'HEAD~1',
      head: 'HEAD',
      repo: dir,
      title: 'fix: thing',
      log: (l) => lines.push(l),
      runTests: () => assert.fail('the deleted test must not be run'),
    });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /no changed test/);
  });
});

describe('proven-red.sh', () => {
  const fakeOutputs = {
    // Measured on go 1.26: a brand-new function is the one Go shape the old
    // MISSING_RE caught.
    goUndefined: ['# m [m.test]\n./lib_test.go:6:5: undefined: NewThing\nFAIL\tm [build failed]\nFAIL\n', 1],
    // D11: a new method on an existing type, which is what most new Go code
    // looks like. MISSING_RE had no pattern for it, so it read as a real red.
    goUndefinedMethod: ['./lib_test.go:3:44: x.NewThing undefined (type T has no field or method NewThing)\nFAIL\tm [build failed]\nFAIL\n', 1],
    goMissingPackage: ['lib_test.go:2:20: no required module provides package m/helper\nFAIL\tm [setup failed]\nFAIL\n', 1],
    goAssertion: ['--- FAIL: TestAdd (0.00s)\n    lib_test.go:8: got 3, want 4\nFAIL\nFAIL\tm\t0.2s\n', 1],
    // D11: pytest echoes the failing source line, so the word "assert" is in
    // the output of every failure and the old whole-output ASSERTION_RE
    // suppressed the warning for every pytest missing-symbol red there is.
    pytestMissing: [
      'F [100%]\n=== FAILURES ===\n    def test_new():\n>       assert mymod.new_thing() == 2\nE       AttributeError: module \'mymod\' has no attribute \'new_thing\'\n\ntest_new.py:3: AttributeError\nFAILED test_new.py::test_new - AttributeError: module has no attribute\n1 failed in 0.01s\n',
      1,
    ],
    pytestAssertion: [
      'F [100%]\n=== FAILURES ===\n>       assert add(1, 2) == 4\nE       assert 3 == 4\n\ntest_x.py:3: AssertionError\nFAILED test_x.py::test_x - assert 3 == 4\n1 failed in 0.01s\n',
      1,
    ],
    green: ['ok\tm\t0.1s\n', 0],
    commandMissing: ['sh: npx: command not found\n', 127],
    silentFailure: ['', 1],
  };

  /** A repo with the gate installed, its run_tests stubbed with canned output. */
  function setup({ head, base = {}, outputs = {}, env = {} }) {
    const dir = makeRepo({
      'src/thing.js': 'module.exports = () => 1;\n',
      'src/thing.test.js': 'test("old", () => {});\n',
      'README.md': '# fixture\n',
      ...base,
    });
    commit(dir, head, 'change');
    // Canned runner output lives outside the commit: anything committed here
    // would show up in the range as another changed file.
    const fakes = path.join(dir, '.fakes');
    for (const [file, key] of Object.entries(outputs)) {
      const [out, code] = fakeOutputs[key];
      const flat = file.replaceAll('/', '_');
      writeFiles(dir, { [`.fakes/${flat}.out`]: out, [`.fakes/${flat}.code`]: String(code) });
    }
    // The stub is the only thing the environment cannot configure; everything
    // else goes through the GT_* variables the template already reads.
    const src = readFileSync(path.join(GATES, 'proven-red.sh'), 'utf8').replace(
      /run_tests\(\) \{[\s\S]*?\n\}/,
      'run_tests() {\n  key=$(printf \'%s\' "$1" | tr \'/\' \'_\')\n  cat "$GT_FAKE_DIR/$key.out" 2>/dev/null\n  return "$(cat "$GT_FAKE_DIR/$key.code" 2>/dev/null || echo 1)"\n}',
    );
    const script = path.join(dir, 'proven-red-adapted.sh');
    writeFileSync(script, src);
    return {
      dir,
      script,
      env: {
        ...process.env,
        GT_FAKE_DIR: fakes,
        GT_APP_DIR: '.',
        GT_UNIT_TEST_RE: '\\.test\\.js$',
        GT_E2E_TEST_RE: '(^|/)e2e/',
        GT_TEST_SUPPORT_RE: '(^|/)__tests__/',
        GT_GATE_FILE_RE: '^scripts/',
        GT_NON_CODE_RE: '.*\\.md$',
        ...env,
      },
    };
  }

  const runGate = (fixture, args = ['HEAD~1', 'HEAD']) =>
    sh(fixture.script, args, { cwd: fixture.dir, env: fixture.env });

  it('passes when the changed test fails an assertion on the old code', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'goAssertion' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 0);
    assert.match(out, /as they should/);
    assert.doesNotMatch(out, /only because they reference/);
  });

  it('fails when the changed test is green on the old code', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'green' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 1);
    assert.match(out, /pass on the pre-change code/);
  });

  // D9
  it('D9: a green file is caught even when a sibling file goes red', () => {
    const fixture = setup({
      head: {
        'src/thing.js': 'module.exports = () => 2;\n',
        'src/thing.test.js': 'new\n',
        'src/other.test.js': 'new\n',
      },
      outputs: { 'src/thing.test.js': 'green', 'src/other.test.js': 'goAssertion' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 1);
    assert.match(out, /src\/thing\.test\.js/);
  });

  // D11
  it('D11: an undefined Go method is a missing-symbol red, not a proof', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'goUndefinedMethod' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 0);
    assert.match(out, /only because they reference code it does not have/);
  });

  it('D11: a Go missing package is a missing-symbol red', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'goMissingPackage' },
    });
    assert.match(runGate(fixture).out, /only because they reference code it does not have/);
  });

  it('D11: a Go undefined function still warns, as it did before', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'goUndefined' },
    });
    assert.match(runGate(fixture).out, /only because they reference code it does not have/);
  });

  it('D11: pytest echoing the assert line does not hide a missing attribute', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'pytestMissing' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 0);
    assert.match(out, /only because they reference code it does not have/);
  });

  it('D11: a real pytest assertion failure is not called a missing symbol', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'pytestAssertion' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 0);
    assert.doesNotMatch(out, /only because they reference/);
  });

  // D8
  it('D8: a test command that cannot run exits 2, not 0', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'commandMissing' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 2);
    assert.match(out, /could not be run/);
    assert.doesNotMatch(out, /as they should/);
  });

  it('D8: a non-zero exit with no sign the runner started exits 2', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'silentFailure' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 2);
    assert.match(out, /no sign it ran/);
  });

  // N1
  it('N1: a test-support file does not excuse a source change with no test', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/__tests__/helper.js': 'helper\n' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 1);
    assert.match(out, /no changed test/);
  });

  // N2
  it('N2: a deleted test is not run, and the change still needs a test', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': null },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 1);
    assert.match(out, /no changed test/);
  });

  // N5
  it('N5: a skip-type title skips, and CI hears about the bypass', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n' },
      env: { GITHUB_ACTIONS: 'true' },
    });
    const { status, out } = sh(fixture.script, ['HEAD~1', 'HEAD', '--title', 'refactor: tidy'], {
      cwd: fixture.dir,
      env: fixture.env,
    });
    assert.equal(status, 0);
    assert.match(out, /::warning title=Proven red skipped/);
  });

  it('a gate-only change skips quietly, proven red by scratch violation', () => {
    const fixture = setup({ head: { 'scripts/ratchet.sh': 'echo hi\n' } });
    const { status, out } = sh(fixture.script, ['HEAD~1', 'HEAD', '--title', 'fix: gate'], {
      cwd: fixture.dir,
      env: fixture.env,
    });
    assert.equal(status, 0);
    assert.match(out, /proven red by scratch violation/);
  });

  it('a behavior change with no test at all fails P2', () => {
    const fixture = setup({ head: { 'src/thing.js': 'module.exports = () => 2;\n' } });
    const { status, out } = sh(fixture.script, ['HEAD~1', 'HEAD', '--title', 'feat: thing'], {
      cwd: fixture.dir,
      env: fixture.env,
    });
    assert.equal(status, 1);
    assert.match(out, /no changed test/);
  });

  // APP_DIR went into a sed regex, and the common value "." matches any
  // character, so a test one directory down lost its first path segment and
  // the runner was handed a path that does not exist. On the original script
  // this case still read green, because the run that found nothing to run was
  // reported as a red (D8); it fails if either fix is reverted alone.
  it('a single-character directory keeps its name when APP_DIR is "."', () => {
    const fixture = setup({
      base: { 'a/thing.test.js': 'test("old", () => {});\n' },
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'a/thing.test.js': 'new\n' },
      outputs: { 'a/thing.test.js': 'goAssertion' },
    });
    const { status, out } = runGate(fixture);
    assert.equal(status, 0, out);
    assert.match(out, /as they should/);
  });

  it('D10: a failing verdict survives without a writable TMPDIR handoff', () => {
    const fixture = setup({
      head: { 'src/thing.js': 'module.exports = () => 2;\n', 'src/thing.test.js': 'new\n' },
      outputs: { 'src/thing.test.js': 'green' },
    });
    const { status } = runGate(fixture);
    assert.equal(status, 1);
  });
});

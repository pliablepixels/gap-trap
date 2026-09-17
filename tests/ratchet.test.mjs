// Ratchet gate. Each case names the defect it guards against; the comment
// says what the gate used to do instead.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { GATES, run, sh, tempDir, writeFiles } from './helpers.mjs';

const { check, planUpdate, currentCounts } = await import(path.join(GATES, 'ratchet.mjs'));

describe('ratchet.mjs check', () => {
  it('passes when every count holds', () => {
    assert.deepEqual(check({ a: 3 }, { a: 3 }), { lines: [], code: 0 });
  });

  it('fails when a count grows', () => {
    const { lines, code } = check({ a: 7 }, { a: 3 });
    assert.equal(code, 1);
    assert.match(lines[0], /3 allowed, 7 found/);
  });

  it('reports an improvement without failing', () => {
    const { lines, code } = check({ a: 2 }, { a: 3 });
    assert.equal(code, 0);
    assert.match(lines[0], /3 -> 2/);
  });

  it('fails when the baseline sits far above the real count', () => {
    const { code, lines } = check({ a: 1 }, { a: 20 });
    assert.equal(code, 1);
    assert.match(lines[0], /above the 1 found/);
  });

  // D6: the loop ran over the configured counters only, so deleting a counter
  // from the config retired the number it was holding and the gate went green.
  it('D6: fails when a baseline name has no counter configured', () => {
    const { lines, code } = check({}, { rawPrints: 3 });
    assert.equal(code, 1);
    assert.match(lines[0], /rawPrints: in the baseline but no counter is configured/);
  });

  it('D6: a new counter still has to start at zero', () => {
    assert.equal(check({ fresh: 2 }, {}).code, 1);
    assert.equal(check({ fresh: 0 }, {}).code, 0);
  });
});

describe('ratchet.mjs currentCounts', () => {
  it('collects the counts', () => {
    assert.deepEqual(currentCounts({ a: () => 1, b: () => 0 }), { a: 1, b: 0 });
  });

  // D7's Node sibling: a counter that blows up must not read as a clean sweep.
  it('D7: a counter that throws is an error, not a zero', () => {
    assert.throws(
      () => currentCounts({ a: () => { throw new Error('no such path'); } }),
      /counter "a" failed to run: no such path/,
    );
  });

  it('D7: a counter that returns a non-count is an error', () => {
    assert.throws(() => currentCounts({ a: () => undefined }), /not a count/);
    assert.throws(() => currentCounts({ a: () => 1.5 }), /not a count/);
    assert.throws(() => currentCounts({ a: () => -1 }), /not a count/);
  });
});

describe('ratchet.mjs planUpdate', () => {
  it('lowers a baseline that fell', () => {
    const { refusals, next } = planUpdate({ a: 1 }, { a: 5 });
    assert.deepEqual(refusals, []);
    assert.deepEqual(next, { a: 1 });
  });

  // D5: --update rewrote the baseline from the current tree whichever way the
  // numbers moved, so an agent could bless its own regression with one flag.
  it('D5: refuses to write a rise', () => {
    const { refusals } = planUpdate({ a: 7 }, { a: 3 });
    assert.equal(refusals.length, 1);
    assert.match(refusals[0], /a: 3 -> 7 is a rise/);
  });

  it('D5/D6: refuses to write when a baseline name lost its counter', () => {
    const { refusals } = planUpdate({}, { a: 3 });
    assert.match(refusals[0], /no counter is configured/);
  });
});

describe('ratchet.mjs end to end', () => {
  const install = (dir, counters) => {
    const src = readFileSync(path.join(GATES, 'ratchet.mjs'), 'utf8').replace(
      'export const counters = {};',
      `export const counters = ${counters};`,
    );
    writeFiles(dir, { 'scripts/ratchet.mjs': src });
    return path.join(dir, 'scripts/ratchet.mjs');
  };

  it('D7: exits 2 when a counter cannot run, so nothing reads as swept', () => {
    const dir = tempDir();
    const script = install(dir, '{ a: () => { throw new Error("boom"); } }');
    writeFiles(dir, { '.quality-baseline.json': '{"a": 4}\n' });
    const { status, out } = run('node', [script]);
    assert.equal(status, 2);
    assert.match(out, /counter "a" failed to run/);
  });

  it('D5: --update leaves the baseline alone when a count rose', () => {
    const dir = tempDir();
    const script = install(dir, '{ a: () => 9 }');
    const baseline = path.join(dir, '.quality-baseline.json');
    writeFileSync(baseline, '{"a": 2}\n');
    const { status, out } = run('node', [script, '--update']);
    assert.equal(status, 1);
    assert.match(out, /--update only lowers/);
    assert.equal(readFileSync(baseline, 'utf8'), '{"a": 2}\n');
  });

  it('--update does lock in a genuine gain', () => {
    const dir = tempDir();
    const script = install(dir, '{ a: () => 1 }');
    const baseline = path.join(dir, '.quality-baseline.json');
    writeFileSync(baseline, '{"a": 4}\n');
    assert.equal(run('node', [script, '--update']).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(baseline, 'utf8')), { a: 1 });
  });
});

describe('ratchet.sh', () => {
  const script = path.join(GATES, 'ratchet.sh');
  const setup = (counters, baseline) => {
    const dir = tempDir();
    writeFiles(dir, { '.ratchet-counters': counters, '.ratchet-baseline': baseline });
    return dir;
  };

  it('passes when counts hold', () => {
    const dir = setup('a\techo 3\n', 'a 3\n');
    assert.equal(sh(script, [], { cwd: dir }).status, 0);
  });

  it('fails when a count grows', () => {
    const dir = setup('a\techo 9\n', 'a 3\n');
    const { status, out } = sh(script, [], { cwd: dir });
    assert.equal(status, 1);
    assert.match(out, /3 allowed, 9 found/);
  });

  // D6
  it('D6: fails when a baseline name has no counter configured', () => {
    const dir = setup('b\techo 0\n', 'a 3\nb 0\n');
    const { status, out } = sh(script, [], { cwd: dir });
    assert.equal(status, 1);
    assert.match(out, /a: in the baseline but no counter is configured/);
  });

  // D7: the command ran with stderr thrown away and an empty result defaulted
  // to 0, so a typo in a counter read as the whole backlog being cleared.
  it('D7: a counter command that fails exits 2 instead of counting zero', () => {
    const dir = setup('a\tno_such_command_xyz\n', 'a 4\n');
    const { status, out } = sh(script, [], { cwd: dir });
    assert.equal(status, 2);
    assert.match(out, /command exited 127/);
    assert.doesNotMatch(out, /improved/);
  });

  it('D7: a counter that prints something other than one number exits 2', () => {
    const dir = setup('a\tprintf "1\\n2\\n"\n', 'a 4\n');
    assert.equal(sh(script, [], { cwd: dir }).status, 2);
    const words = setup('a\techo many\n', 'a 4\n');
    assert.equal(sh(script, [], { cwd: words }).status, 2);
  });

  // D5
  it('D5: --update refuses a rise and leaves the baseline alone', () => {
    const dir = setup('a\techo 9\n', 'a 2\n');
    const { status, out } = sh(script, ['--update'], { cwd: dir });
    assert.equal(status, 1);
    assert.match(out, /--update only lowers/);
    assert.equal(readFileSync(path.join(dir, '.ratchet-baseline'), 'utf8'), 'a 2\n');
  });

  it('--update does lock in a genuine gain', () => {
    const dir = setup('a\techo 1\n', 'a 4\n');
    assert.equal(sh(script, ['--update'], { cwd: dir }).status, 0);
    assert.match(readFileSync(path.join(dir, '.ratchet-baseline'), 'utf8'), /a 1/);
  });

  // D10: the verdict travelled through a predictable /tmp file, and a tee that
  // could not write turned a failing run into a silent exit 0.
  it('D10: the failing exit status survives without a /tmp handoff', () => {
    const dir = setup('a\techo 9\n', 'a 3\n');
    const { status } = sh(script, [], { cwd: dir, env: { ...process.env, TMPDIR: '/nonexistent-tmpdir' } });
    assert.equal(status, 1);
  });
});

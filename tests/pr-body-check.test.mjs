// PR body check. The gate with no coverage before; these are its basic
// contract plus the one case that used to produce a verdict it had not earned.
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { symlinkSync } from 'node:fs';
import { GATES, run, tempDir } from './helpers.mjs';

const script = path.join(GATES, 'pr-body-check.sh');
const check = (title, body, env = {}) =>
  run('sh', [script], { env: { ...process.env, PR_TITLE: title, PR_BODY: body, ...env } });

describe('pr-body-check.sh', () => {
  it('passes a body with acceptance content', () => {
    assert.equal(check('fix: thing', '## Acceptance\n- the bug is gone\n').status, 0);
  });

  it('fails a body with no acceptance section', () => {
    const { status, out } = check('fix: thing', '## Summary\nstuff\n');
    assert.equal(status, 1);
    assert.match(out, /No acceptance lines/);
  });

  it('fails an acceptance section holding only an HTML comment', () => {
    assert.equal(check('fix: thing', '## Acceptance\n<!-- fill this in -->\n').status, 1);
  });

  it('a feat PR needs a spec section too', () => {
    assert.equal(check('feat: thing', '## Acceptance\n- it works\n').status, 1);
    assert.equal(check('feat: thing', '## Acceptance\n- it works\n\n## Spec\n- see #12\n').status, 0);
  });

  it('a non-feat PR does not need a spec section', () => {
    assert.equal(check('chore: thing', '## Acceptance\n- tidy\n').status, 0);
  });

  // perl is the one tool this gate needs that the others do not. Without it
  // the section came back empty and every PR was reported as missing its
  // acceptance lines: a verdict the check had not earned.
  it('says it cannot run when perl is missing, instead of failing the PR', () => {
    // An empty PATH is the whole point: the guard runs before any external
    // tool is needed, and without it the pipeline below yields an empty
    // section and reports a verdict it did not earn.
    const bin = tempDir();
    symlinkSync('/bin/sh', path.join(bin, 'sh'));
    const { status, out } = check('fix: thing', '## Acceptance\n- the bug is gone\n', { PATH: bin });
    assert.equal(status, 2, out);
    assert.match(out, /perl is not installed/);
  });
});

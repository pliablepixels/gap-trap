// Shared rig for the gate tests: throwaway git repos, config-block swapping,
// and a runner that captures exit status with stdout and stderr together.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../gap-trap/templates/gates',
);

const scratch = [];
process.on('exit', () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = 'gap-trap-test-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** Write a {path: contents} map under `dir`, creating directories as needed. */
export function writeFiles(dir, files) {
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
}

export function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** A git repo holding `files`, committed. Returns its path. */
export function makeRepo(files, message = 'base') {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'gate@example.test');
  git(dir, 'config', 'user.name', 'Gate Test');
  writeFiles(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', message);
  return dir;
}

/** Add a commit. `files` with a null value deletes that path. */
export function commit(dir, files, message) {
  for (const [rel, contents] of Object.entries(files)) {
    if (contents === null) rmSync(path.join(dir, rel), { force: true });
    else writeFiles(dir, { [rel]: contents });
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/**
 * Copy a gate template, replacing everything between its config markers. The
 * templates are meant to be adapted on install, and the markers are how the
 * install does it, so the tests adapt them the same way.
 */
export function installGate(name, dir, target, config) {
  const src = readFileSync(path.join(GATES, name), 'utf8');
  const line = name.endsWith('.py') ? '#' : '//';
  const start = `${line} ---- config`;
  const end = `${line} ---- end config`;
  const from = src.indexOf(start);
  const to = src.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`${name} has no config block to adapt`);
  const head = src.slice(0, from);
  const tail = src.slice(src.indexOf('\n', to) + 1);
  const full = path.join(dir, target);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, `${head}${config}\n${tail}`);
  return full;
}

/** Run a command, returning status and the two streams joined. */
export function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export const sh = (script, args, options) => run('sh', [script, ...args], options);

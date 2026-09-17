/**
 * Instruction gate. Reference implementation from gap-trap (vitest).
 *
 * The instruction files are read by every session, so they are checked like
 * code: every name a contract cites exists where the contract says it lives,
 * the portable core stays portable, the always-loaded files stay small, cited
 * commits exist, and no private data leaks into knowledge files. The grep
 * gates at the bottom are the contract Never clauses a text search settles.
 *
 * Every check here also asserts its own denominator: how many tokens it
 * resolved, how many files it scanned. A check that quietly measures nothing
 * reports the same green as a check that measured everything, and that is how
 * a gate dies without anyone noticing (M2).
 *
 * ADAPT the constants in the config block; the assertions stay as they are.
 */
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---- config ---------------------------------------------------------------
// ADAPT: repo root relative to this file, and the source tree contracts name.
const repoRoot = path.resolve(__dirname, '../../..');
const SRC_DIR = 'app/src';
const SOURCE_EXT = /\.(ts|tsx)$/;
/** Directories under SRC_DIR that hold tests or gates, skipped by the grep gates. */
const TEST_DIRS = ['__tests__', 'tests'];
/** ADAPT: project-specific tokens that must never appear in the portable core. */
const FORBIDDEN_IN_CORE = ['{{PRODUCT}}', '{{FRAMEWORK}}', SRC_DIR, 'agents/project'];
/** ADAPT: current count plus room. Raising it needs a reason in the commit message (C7). */
const WORD_BUDGET = 4000;
const MIN_CONTRACTS = 2; // the honest count; never pad
/** ADAPT: the files loaded into every session. All of them must exist. */
const ALWAYS_LOADED = ['AGENTS.md', 'AGENTS.project.md', 'CLAUDE.md'];
const KNOWLEDGE_FILES = [
  'agents/project/domain-context.md',
  'agents/project/glossary.md',
  'agents/project/out-of-scope.md',
  'agents/generic/agent-workflows.md',
];
/** ADAPT: where developer docs live, or '' to skip the rule-ID check. */
const DOCS_DIR = 'docs/developer-guide';
const DOC_EXT = /\.(rst|md)$/;
/**
 * ADAPT: one entry per contract Never clause a grep settles. `exempt` names
 * the sanctioned file(s). Comments are stripped before matching.
 */
const GREP_GATES: { name: string; pattern: RegExp; exempt?: (rel: string) => boolean }[] = [
  { name: 'Logging: no console calls outside the logger', pattern: /\bconsole\.\w/, exempt: (f) => f === 'lib/logger.ts' || f.startsWith('lib/log-file/') },
  { name: 'HTTP: no raw fetch or axios outside lib/http', pattern: /(^|[^.\w])fetch\s*\(|\baxios\b/, exempt: (f) => f.startsWith('lib/http') },
];
// ---- end config -----------------------------------------------------------

const appSrc = path.join(repoRoot, SRC_DIR);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, acc);
    } else if (SOURCE_EXT.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const read = (f: string) => fs.readFileSync(f, 'utf8');
const sourceFiles = walk(appSrc);
const isTestPath = (rel: string) => TEST_DIRS.some((d) => rel.split(path.sep).includes(d));
/** A contract symbol found only in a test file is not a symbol the code uses. */
const nonTestSourceText = sourceFiles
  .filter((f) => !isTestPath(path.relative(appSrc, f)))
  .map(read)
  .join('\n');

/** The text under a repo-relative path, file or directory, for symbol lookups. */
function textUnder(rel: string): string {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) return '';
  if (fs.statSync(full).isDirectory()) return walk(full).map(read).join('\n');
  return read(full);
}

function parseContracts(md: string): { name: string; body: string }[] {
  const section = md.split('## Architecture contracts')[1]?.split('\n## ')[0] ?? '';
  return section
    .split('\n### ')
    .slice(1)
    .map((block) => {
      const [name, ...rest] = block.split('\n');
      return { name: name.trim(), body: rest.join('\n') };
    });
}

/**
 * Fold a contract body's wrapped lines back into the field they continue.
 * Markdown prose wraps, and a `Path:` line long enough to wrap used to have
 * everything past the wrap silently dropped from the check.
 */
export function foldFields(body: string): string[] {
  const out: string[] = [];
  let open = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) {
      open = false;
    } else if (/^(Owns|Path|Never|Gate):/.test(line)) {
      out.push(line);
      open = true;
    } else if (open) {
      out[out.length - 1] += ` ${line}`;
    }
  }
  return out;
}

// Remove comments and leave strings alone. A plain regex for block comments
// treats the "/*" inside a glob such as "src/**/*.ts" as the start of one and
// deletes every line up to the next "*/", carrying real violations out with
// it, after which the gate reports clean. Quoted strings end at the line
// break, as JS string literals do, so an apostrophe in JSX text costs one
// line rather than the rest of the file. Newlines survive either way.
// ponytail: no regex-literal state, so a literal ending in "\/" followed by
// "/" reads as a line comment. Add one if a repo trips it.
export function stripComments(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const multiline = c === '`';
      out += c;
      i += 1;
      while (i < code.length && code[i] !== c && (multiline || code[i] !== '\n')) {
        if (code[i] === '\\' && i + 1 < code.length) {
          out += code[i] + code[i + 1];
          i += 2;
          continue;
        }
        out += code[i];
        i += 1;
      }
      if (i < code.length && code[i] === c) {
        out += c;
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const backtickTokens = (line: string) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, ''));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('AGENTS.project.md architecture contracts', () => {
  const md = read(path.join(repoRoot, 'AGENTS.project.md'));
  const contracts = parseContracts(md);

  it(`holds at least ${MIN_CONTRACTS} contracts with all four lines`, () => {
    expect(contracts.length).toBeGreaterThanOrEqual(MIN_CONTRACTS);
    for (const c of contracts) {
      const fields = foldFields(c.body);
      for (const field of ['Owns:', 'Path:', 'Never:', 'Gate:']) {
        expect(fields.some((l) => l.startsWith(field)), `${c.name} missing ${field}`).toBe(true);
      }
    }
  });

  it('every symbol and path named in Path/Gate lines exists where the contract says', () => {
    let checkedOverall = 0;
    for (const c of contracts) {
      const fields = foldFields(c.body).filter((l) => l.startsWith('Path:') || l.startsWith('Gate:'));
      let checked = 0;
      for (const line of fields) {
        const tokens = backtickTokens(line);
        const paths = tokens.filter((t) => t.includes('/'));
        const symbols = tokens.filter((t) => !t.includes('/'));
        for (const token of paths) {
          expect(fs.existsSync(path.join(repoRoot, token)), `${c.name}: path ${token} missing`).toBe(true);
          checked += 1;
        }
        // A Path line names where the subsystem lives, so its symbols are
        // looked for there. Resolving them anywhere in the tree let a symbol
        // that had moved out of its own module keep the contract green.
        const scoped = line.startsWith('Path:') && paths.length > 0;
        const haystack = scoped ? paths.map(textUnder).join('\n') : nonTestSourceText;
        const where = scoped ? paths.join(', ') : `${SRC_DIR} (non-test files)`;
        for (const token of symbols) {
          expect(
            new RegExp(`\\b${escape(token)}\\b`).test(haystack),
            `${c.name}: symbol ${token} not found in ${where}`,
          ).toBe(true);
          checked += 1;
        }
      }
      expect(checked, `${c.name}: its Path/Gate lines name nothing the gate can check`).toBeGreaterThan(0);
      checkedOverall += checked;
    }
    expect(checkedOverall, 'no contract token was checked at all').toBeGreaterThan(0);
  });
});

describe('AGENTS.md stays portable and small', () => {
  it('contains no project-specific tokens', () => {
    const core = read(path.join(repoRoot, 'AGENTS.md')).toLowerCase();
    for (const token of FORBIDDEN_IN_CORE) {
      expect(core.includes(token.toLowerCase()), `AGENTS.md contains "${token}"`).toBe(false);
    }
  });

  it('the always-loaded files stay inside the word budget', () => {
    // Every file has to be there. Summing whatever happens to exist means
    // deleting an always-loaded file reads as coming in under budget.
    for (const f of ALWAYS_LOADED) {
      expect(fs.existsSync(path.join(repoRoot, f)), `${f} is missing; the budget would fall for free`).toBe(true);
    }
    const words = (f: string) => read(path.join(repoRoot, f)).split(/\s+/).filter(Boolean).length;
    const total = ALWAYS_LOADED.reduce((n, f) => n + words(f), 0);
    expect(total, `combined ${total} words > budget ${WORD_BUDGET}`).toBeLessThanOrEqual(WORD_BUDGET);
  });
});

describe('knowledge files stay evidence-backed and private-data-free (M5)', () => {
  it('every commit hash cited in domain-context exists in this repo', () => {
    const md = read(path.join(repoRoot, 'agents/project/domain-context.md'));
    // 7 to 40 hex chars with a digit: --oneline prints 7, and the digit keeps
    // English words made of a-f (acceded, defaced) out.
    const hashes = [...new Set([...md.matchAll(/\b[0-9a-f]{7,40}\b/g)].map((m) => m[0]).filter((h) => /\d/.test(h)))];
    for (const hash of hashes) {
      expect(
        () => execSync(`git cat-file -e ${hash}^{commit}`, { cwd: repoRoot, stdio: 'pipe' }),
        `cited commit ${hash} not found in history`,
      ).not.toThrow();
    }
  });

  it('knowledge files contain no emails or IP addresses', () => {
    for (const file of KNOWLEDGE_FILES) {
      const full = path.join(repoRoot, file);
      if (!fs.existsSync(full)) continue;
      const text = read(full);
      expect(text, `${file} contains an IP address`).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      // The domain needs a letter TLD, or a pinned version such as
      // `vitest@1.2.3` reads as an email and the gate cries wolf.
      expect(text, `${file} contains an email address`).not.toMatch(/\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/);
    }
  });
});

describe('developer docs cite rule IDs that exist', () => {
  it('every "rule <id>" reference resolves', () => {
    if (!DOCS_DIR || !fs.existsSync(path.join(repoRoot, DOCS_DIR))) return;
    const core = read(path.join(repoRoot, 'AGENTS.md'));
    const valid = new Set([...core.matchAll(/^- ([IPCM][0-9]+)\./gm)].map((m) => m[1]));
    expect(valid.size).toBeGreaterThan(0);
    for (const file of fs.readdirSync(path.join(repoRoot, DOCS_DIR)).filter((f) => DOC_EXT.test(f))) {
      const text = read(path.join(repoRoot, DOCS_DIR, file));
      for (const m of text.matchAll(/\brules? ([IPCM][0-9]+)\b/gi)) {
        expect(valid.has(m[1].toUpperCase()), `${file}: unknown rule id "${m[1]}"`).toBe(true);
      }
    }
  });
});

describe('contract Never clauses a grep can decide', () => {
  const codeFiles = sourceFiles
    .map((f) => [path.relative(appSrc, f), f] as const)
    .filter(([rel]) => !isTestPath(rel))
    .map(([rel, f]) => [rel, stripComments(read(f))] as const);

  it('scans source files at all', () => {
    // Without this the suite is green after any path move (M2).
    expect(codeFiles.length).toBeGreaterThan(5);
  });

  for (const gate of GREP_GATES) {
    it(gate.name, () => {
      const offenders = codeFiles.filter(([rel, code]) => !(gate.exempt?.(rel) ?? false) && gate.pattern.test(code)).map(([rel]) => rel);
      expect(offenders).toEqual([]);
    });
  }
});

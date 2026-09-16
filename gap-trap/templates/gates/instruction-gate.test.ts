/**
 * Instruction gate. Reference implementation from gap-trap (vitest).
 *
 * The instruction files are read by every session, so they are checked like
 * code: every name a contract cites exists, the portable core stays
 * portable, the always-loaded files stay small, cited commits exist, and no
 * private data leaks into knowledge files. The grep gates at the bottom are
 * the contract Never clauses a text search settles.
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
const sourceText = sourceFiles.map(read).join('\n');
const isTestPath = (rel: string) => TEST_DIRS.some((d) => rel.split(path.sep).includes(d));

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

const backtickTokens = (line: string) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, ''));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('AGENTS.project.md architecture contracts', () => {
  const md = read(path.join(repoRoot, 'AGENTS.project.md'));
  const contracts = parseContracts(md);

  it(`holds at least ${MIN_CONTRACTS} contracts with all four lines`, () => {
    expect(contracts.length).toBeGreaterThanOrEqual(MIN_CONTRACTS);
    for (const c of contracts) {
      for (const field of ['Owns:', 'Path:', 'Never:', 'Gate:']) {
        expect(c.body, `${c.name} missing ${field}`).toContain(field);
      }
    }
  });

  it('every symbol and path named in Path/Gate lines exists', () => {
    for (const c of contracts) {
      const lines = c.body.split('\n').filter((l) => l.startsWith('Path:') || l.startsWith('Gate:'));
      for (const token of lines.flatMap(backtickTokens)) {
        if (token.includes('/')) {
          expect(fs.existsSync(path.join(repoRoot, token)), `${c.name}: path ${token} missing`).toBe(true);
        } else {
          expect(new RegExp(`\\b${escape(token)}\\b`).test(sourceText), `${c.name}: symbol ${token} not found in ${SRC_DIR}`).toBe(true);
        }
      }
    }
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
    const words = (f: string) => read(path.join(repoRoot, f)).split(/\s+/).filter(Boolean).length;
    const total = words('AGENTS.md') + words('AGENTS.project.md') + words('CLAUDE.md');
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
      expect(text, `${file} contains an email address`).not.toMatch(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/);
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
  const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
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

// Instruction gate, all four ports against the same fixtures. Each case names
// the defect it guards against; the comment says what the gate used to do.
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { GATES, git, installGate, makeRepo, run, sh, writeFiles } from './helpers.mjs';

// ---- what the ports need to be present -------------------------------------
const vitest = run('npx', ['--yes', 'vitest@3', '--version']);
const HAS_VITEST = vitest.status === 0;
const PYTHON = process.env.GT_PYTEST || 'python3';
const HAS_PYTEST = run(PYTHON, ['-m', 'pytest', '--version']).status === 0;
if (!HAS_VITEST) console.log('NOT RUN: the vitest port (npx vitest@3 unavailable)');
if (!HAS_PYTEST) console.log(`NOT RUN: the pytest port (${PYTHON} -m pytest unavailable; set GT_PYTEST)`);

// ---- fixture ---------------------------------------------------------------
const CORE = `# Core Instructions

Rules every session loads.

- I1. Read the contracts before editing.
- P2. A failing test precedes every behavior change.
- C7. Counts may fall, never rise.
- M2. Read what a gate measured.
`;

const clean = (ext) => ({
  'AGENTS.md': CORE,
  'CLAUDE.md': 'Read AGENTS.md first.\n',
  'AGENTS.project.md': contracts(ext),
  'agents/project/domain-context.md': 'The billing window closes on the last weekday.\n',
  'agents/project/glossary.md': 'Window: the billing period.\n',
  'agents/project/out-of-scope.md': 'No new payment providers.\n',
  'agents/generic/agent-workflows.md': 'One task per session.\n',
  'docs/guide.md': 'Follow rule I1 when editing.\n',
  // Seven non-test TypeScript files: the vitest port refuses to report clean
  // on a tree it barely scanned.
  'src/app.ts': 'import { logger } from "./lib/logger";\nexport const start = () => logger("up");\n',
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': 'export const b = 2;\n',
  'src/c.ts': 'export const c = 3;\n',
  'src/d.ts': 'export const d = 4;\n',
  'src/lib/logger.ts': 'export const logger = (m: string) => console.log(m);\n',
  'src/lib/http/client.ts': 'export const get = (u: string) => fetch(u);\n',
  'src/__tests__/helper.ts': 'export const helperOnlySymbol = () => 1;\n',
  'src/app.py': 'from .lib.logger import logger\n\ndef start():\n    logger("up")\n',
  'src/lib/logger.py': 'def logger(message):\n    print(message)\n',
  'src/lib/http/client.py': 'import requests\n\ndef get(url):\n    return requests.get(url)\n',
  'src/tests/helper_support.py': 'def helper_only_symbol():\n    return 1\n',
});

function contracts(ext, over = {}) {
  const logPath = over.logPath ?? `src/lib/logger.${ext}`;
  const logSymbol = over.logSymbol ?? 'logger';
  const pathLine = over.pathLine ?? `Path: \`${logSymbol}\` (\`${logPath}\`).`;
  const gateLine = over.gateLine ?? 'Gate: the instruction gate greps for it.';
  return `# Fixture Project Instructions

## Architecture contracts

### Logging
Owns: every line that leaves the process.
${pathLine}
Never: a raw console or print call outside the logger.
${gateLine}

### HTTP
Owns: outbound calls.
Path: \`get\` (\`src/lib/http/client.${ext}\`).
Never: a raw client outside the wrapper.
Gate: the instruction gate greps for it.

## Project rules

- Run commands from the repo root.
`;
}

const TS_CONFIG = `const repoRoot = path.resolve(__dirname, '..');
const SRC_DIR = 'src';
const SOURCE_EXT = /\\.(ts|tsx)$/;
const TEST_DIRS = ['__tests__', 'tests'];
const FORBIDDEN_IN_CORE = ['{{PRODUCT}}', 'agents/project'];
const WORD_BUDGET = 4000;
const MIN_CONTRACTS = 2;
const ALWAYS_LOADED = ['AGENTS.md', 'AGENTS.project.md', 'CLAUDE.md'];
const KNOWLEDGE_FILES = [
  'agents/project/domain-context.md',
  'agents/project/glossary.md',
  'agents/project/out-of-scope.md',
  'agents/generic/agent-workflows.md',
];
const DOCS_DIR = 'docs';
const DOC_EXT = /\\.(rst|md)$/;
const GREP_GATES: { name: string; pattern: RegExp; exempt?: (rel: string) => boolean }[] = [
  { name: 'Logging: no console calls outside the logger', pattern: /\\bconsole\\.\\w/, exempt: (f) => f === 'lib/logger.ts' },
  { name: 'HTTP: no raw fetch outside lib/http', pattern: /(^|[^.\\w])fetch\\s*\\(/, exempt: (f) => f.startsWith('lib/http') },
];`;

const PY_CONFIG = `REPO = Path(__file__).resolve().parents[1]
SRC_DIR = "src"
SOURCE_EXT = (".py",)
TEST_DIRS = {"tests", "test", "__tests__"}
FORBIDDEN_IN_CORE = ["{{PRODUCT}}", "agents/project"]
WORD_BUDGET = 4000
MIN_CONTRACTS = 2
ALWAYS_LOADED = ["AGENTS.md", "AGENTS.project.md", "CLAUDE.md"]
KNOWLEDGE_FILES = [
    "agents/project/domain-context.md",
    "agents/project/glossary.md",
    "agents/project/out-of-scope.md",
    "agents/generic/agent-workflows.md",
]
DOCS_DIR = "docs"
GREP_GATES = [
    ("Logging: no print outside the logger", re.compile(r"\\bprint\\("), lambda rel: rel == "lib/logger.py"),
    ("HTTP: no raw requests outside the wrapper", re.compile(r"\\brequests\\.(get|post)\\("), lambda rel: rel.startswith("lib/http")),
]`;

const SH_ENV = {
  GT_SRC_DIR: 'src',
  GT_DOCS_DIR: 'docs',
};

/** A fixture repo with all four gates installed. `files` overrides the clean set. */
function fixture(ext, files = {}) {
  const base = { ...clean(ext), ...files };
  for (const [k, v] of Object.entries(files)) if (v === null) delete base[k];
  const dir = makeRepo(base);
  installGate('instruction-gate.test.ts', dir, 'scripts/gate.test.ts', TS_CONFIG);
  installGate('instruction_gate_test.py', dir, 'scripts/gate_test.py', PY_CONFIG);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'gates');
  return dir;
}

const runTs = (dir) =>
  run('npx', ['--yes', 'vitest@3', 'run', '--root', dir, 'scripts/gate.test.ts'], { cwd: dir });
const runPy = (dir) => run(PYTHON, ['-m', 'pytest', '-q', 'scripts/gate_test.py'], { cwd: dir });
const runSh = (dir, env = {}) =>
  sh(path.join(GATES, 'instruction-gate.sh'), [], { cwd: dir, env: { ...process.env, ...SH_ENV, ...env } });

/** Run a case against every port that is installed here. */
function eachPort(name, build, expect) {
  it(`${name} [sh]`, () => expect(runSh(fixture('ts', build('ts')))));
  it(`${name} [vitest]`, { skip: !HAS_VITEST }, () => expect(runTs(fixture('ts', build('ts')))));
  it(`${name} [pytest]`, { skip: !HAS_PYTEST }, () => expect(runPy(fixture('py', build('py')))));
}

const passes = ({ status, out }) => assert.equal(status, 0, `expected a pass, got ${status}:\n${out}`);
const failsWith = (re) => ({ status, out }) => {
  assert.notEqual(status, 0, `expected a failure, got 0:\n${out}`);
  assert.match(out, re);
};

describe('instruction gate', () => {
  eachPort('a clean repo passes', () => ({}), passes);

  // D2: the field check read raw lines, so a Path: line long enough to wrap
  // had everything past the wrap silently dropped and never looked up.
  eachPort(
    'D2: a wrapped Path line is still scanned',
    (ext) => ({
      'AGENTS.project.md': contracts(ext, {
        pathLine: `Path: \`logger\`\n(\`src/lib/logger.${ext}\`) and also\n\`noSuchSymbolAnywhere\`.`,
      }),
    }),
    failsWith(/noSuchSymbolAnywhere/),
  );

  // D3: a bare symbol was looked for anywhere in the source tree, so a symbol
  // that had moved out of its own module kept the contract green.
  eachPort(
    'D3: a symbol outside the path the contract names fails',
    (ext) => ({ 'AGENTS.project.md': contracts(ext, { logSymbol: 'get' }) }),
    failsWith(/symbol get not found in src\/lib\/logger/),
  );

  // N4: the haystack included test files, so a symbol deleted from production
  // code but still named in a test kept its contract green.
  eachPort(
    'N4: a symbol that survives only in a test file fails',
    (ext) => ({
      'AGENTS.project.md': contracts(ext, {
        gateLine: `Gate: the gate greps \`${ext === 'ts' ? 'helperOnlySymbol' : 'helper_only_symbol'}\`.`,
      }),
    }),
    failsWith(/helper_?[Oo]nly/),
  );

  // D4: the sum skipped files that were not there, so deleting an
  // always-loaded file made the repo come in under budget.
  eachPort(
    'D4: a deleted always-loaded file fails instead of shrinking the budget',
    () => ({ 'CLAUDE.md': null }),
    failsWith(/CLAUDE\.md/),
  );

  // N3: the email pattern accepted any domain, so a pinned version in a
  // playbook was reported as a leaked address.
  eachPort(
    'N3: a pinned version is not an email address',
    () => ({ 'agents/project/glossary.md': 'Pin vitest@1.2.3 and eslint@8.57.0.\n' }),
    passes,
  );

  eachPort(
    'a real email address in a knowledge file still fails',
    () => ({ 'agents/project/glossary.md': 'Ask someone@example.com about it.\n' }),
    failsWith(/email address/),
  );

  // The denominator: a contract that cites nothing used to resolve nothing and
  // report the same green as one that resolved every name it named.
  eachPort(
    'a contract that cites nothing the gate can check fails',
    () => ({
      'AGENTS.project.md': `# Fixture

## Architecture contracts

### Logging
Owns: logs.
Path: the logger module.
Never: raw console calls.
Gate: review.

### HTTP
Owns: calls.
Path: the http module.
Never: raw clients.
Gate: review.
`,
    }),
    failsWith(/nothing the gate can check|no contract token was checked/),
  );

  // One contract citing real names must not cover for a neighbour that cites
  // nothing: a repo-wide denominator alone reports green on the pair.
  eachPort(
    'a contract that cites nothing fails even beside one that cites plenty',
    (ext) => ({
      'AGENTS.project.md': `# Fixture

## Architecture contracts

### Logging
Owns: logs.
Path: \`logger\` (\`src/lib/logger.${ext}\`).
Never: raw console calls.
Gate: the instruction gate greps for it.

### HTTP
Owns: calls.
Path: the http module.
Never: raw clients.
Gate: review.
`,
    }),
    failsWith(/HTTP.*nothing the gate can check/),
  );

  eachPort(
    'a path a contract names but the repo lacks fails',
    (ext) => ({ 'AGENTS.project.md': contracts(ext, { logPath: 'src/lib/gone.ts' }) }),
    failsWith(/path src\/lib\/gone\.ts missing/),
  );

  eachPort(
    'docs citing a rule ID that does not exist fail',
    () => ({ 'docs/guide.md': 'Follow rule I9 when editing.\n' }),
    failsWith(/I9/),
  );
});

describe('instruction gate: the denominator', () => {
  const unparseable = {
    'AGENTS.project.md': `# Fixture

## Contracts

### Logging
Owns: logs.
Path: \`logger\` (\`src/lib/logger.ts\`).
Never: raw console calls.
Gate: the instruction gate greps for it.
`,
  };

  it('a contracts heading the parser cannot find fails the token check too [vitest]', { skip: !HAS_VITEST }, () => {
    const { status, out } = runTs(fixture('ts', unparseable));
    assert.notEqual(status, 0);
    assert.match(out, /no contract token was checked at all/);
  });

  it('a contracts heading the parser cannot find fails the token check too [pytest]', { skip: !HAS_PYTEST }, () => {
    const { status, out } = runPy(fixture('py', unparseable));
    assert.notEqual(status, 0);
    assert.match(out, /no contract token was checked at all/);
  });

  it('the shell port fails it on the contract count instead [sh]', () => {
    const { status, out } = runSh(fixture('ts', unparseable));
    assert.notEqual(status, 0);
    assert.match(out, /only 0 contracts/);
  });
});

describe('instruction gate: comment handling', () => {
  // D1: block comments were stripped with a regex, so the "/*" inside a glob
  // such as "src/**/*.ts" opened a comment that swallowed every line up to the
  // next "*/", violations included, and the gate reported clean.
  it('D1: a glob in a string does not blind the grep gate [vitest]', { skip: !HAS_VITEST }, () => {
    const dir = fixture('ts', {
      'src/app.ts': [
        'const glob = "src/**/*.ts";      // a string holding /*',
        'export function danger() {',
        '  console.log("boom");           // the violation the gate must catch',
        '}',
        'const close = "*/";',
        'export const use = [glob, close];',
      ].join('\n'),
    });
    failsWith(/console calls outside the logger/)(runTs(dir));
  });

  it('D1: comment delimiters held in constants do not blind it [vitest]', { skip: !HAS_VITEST }, () => {
    const dir = fixture('ts', {
      'src/app.ts': [
        'export const OPEN = "/*";',
        'export function danger() {',
        '  console.log("boom");',
        '}',
        'export const CLOSE = "*/";',
      ].join('\n'),
    });
    failsWith(/console calls outside the logger/)(runTs(dir));
  });

  it('a benign glob is still handled [vitest]', { skip: !HAS_VITEST }, () => {
    const dir = fixture('ts', { 'src/app.ts': 'export const glob = "src/**/*.ts";\n' });
    passes(runTs(dir));
  });

  it('a genuine comment is still stripped [vitest]', { skip: !HAS_VITEST }, () => {
    const dir = fixture('ts', {
      'src/app.ts': '// console.log("in a comment")\n/* console.log("in a block") */\nexport const ok = 1;\n',
    });
    passes(runTs(dir));
  });

  it('an apostrophe in JSX text costs one line, not the file [vitest]', { skip: !HAS_VITEST }, () => {
    const dir = fixture('ts', {
      'src/app.ts': "export const text = \"don't\";\nexport function danger() {\n  console.log('boom');\n}\n",
    });
    failsWith(/console calls outside the logger/)(runTs(dir));
  });

  // The pytest port dropped whole-line comments only, so a commented-out call
  // on the end of a line failed the gate that exists to find real ones.
  it('a trailing comment is not a violation [pytest]', { skip: !HAS_PYTEST }, () => {
    const dir = fixture('py', { 'src/app.py': 'x = 1  # print("not a real call")\n' });
    passes(runPy(dir));
  });

  it('a hash inside a string is not a comment [pytest]', { skip: !HAS_PYTEST }, () => {
    const dir = fixture('py', { 'src/app.py': 'colour = "#fff"\n\ndef danger():\n    print("boom")\n' });
    failsWith(/print outside the logger/)(runPy(dir));
  });
});

describe('instruction-gate.sh specifics', () => {
  // N6: the shell port left the source tree name out of the forbidden list
  // that the other two ports carried.
  it('N6: the portable core may not name the source tree', () => {
    const dir = fixture('ts', { 'AGENTS.md': `${CORE}\nEdit files under src/ carefully.\n` });
    const { status, out } = runSh(dir);
    assert.notEqual(status, 0);
    assert.match(out, /AGENTS\.md contains "src"/);
  });

  // D10: the verdict travelled through a predictable /tmp file, and a tee that
  // could not write turned a failing run into a silent exit 0.
  it('D10: a contract failure survives an unwritable TMPDIR', () => {
    const dir = fixture('ts', { 'AGENTS.project.md': contracts('ts', { logPath: 'src/lib/gone.ts' }) });
    const { status, out } = runSh(dir, { TMPDIR: '/nonexistent-tmpdir' });
    assert.equal(status, 1);
    assert.match(out, /path src\/lib\/gone\.ts missing/);
  });

  it('D10: no gate hands its verdict through a shared /tmp path', () => {
    // The old pattern was `... | tee /tmp/gt-grep.$$ ; grep -q FAIL /tmp/...`.
    // A tee that could not write, or a pre-created symlink at that guessable
    // path, turned a failing run into a silent exit 0.
    for (const gate of ['instruction-gate.sh', 'proven-red.sh', 'ratchet.sh']) {
      const src = readFileSync(path.join(GATES, gate), 'utf8');
      assert.doesNotMatch(src, /\/tmp\/\S*\$\$/, `${gate} routes a verdict through a guessable /tmp path`);
      assert.doesNotMatch(src, /\|\s*tee\s+\/tmp/, `${gate} tees a verdict into /tmp`);
    }
  });

  it('D10: a docs rule failure survives an unwritable TMPDIR', () => {
    const dir = fixture('ts', { 'docs/guide.md': 'Follow rule I9.\n' });
    const { status } = runSh(dir, { TMPDIR: '/nonexistent-tmpdir' });
    assert.equal(status, 1);
  });

  it('reports what it measured, so a gate that scanned nothing is visible', () => {
    const { status, out } = runSh(fixture('ts'));
    assert.equal(status, 0);
    assert.match(out, /instruction gate: ok \(2 contracts, \d+ cited names, \d+ source files, \d+ words\)/);
  });

  it('fails when the source tree has moved out from under it', () => {
    const dir = fixture('ts');
    rmSync(path.join(dir, 'src'), { recursive: true, force: true });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'move src');
    const { status, out } = runSh(dir);
    assert.notEqual(status, 0);
    assert.match(out, /does not exist|scanned no source files/);
  });
});

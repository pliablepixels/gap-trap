# Discovery

Output: a plan file in your scratch directory with the sections below.
Every claim in it is verified by a command you ran. Do not guess a
symbol name; grep it.

## 1. Stack and commands

Record, with the file that proves each:

- Languages and the primary one (by file count under the source dirs).
- Package manager and the working directory npm/pip/cargo/go commands
  run from (a monorepo may have several; pick the one agents will edit).
- Test runner and its single-run command. Lint command(s). Type check.
  Build. One combined "gates" command exists? If not, you will add one.
- CI provider and workflow files. Branch protection (`gh api
  repos/{owner}/{repo}/branches/{default}/protection` when `gh` works).
  Pre-commit hooks (husky, pre-commit, lefthook).
- Existing instruction files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
  `.github/copilot-instructions.md`, `CONTRIBUTING.md`. Their rules are
  kept, not replaced.
- Docs: user docs, developer docs, ADRs, and where they live.

## 2. History probes (skip if fewer than 50 commits)

Count with `git rev-list --count HEAD`, never a piped `wc`.

- Reverts: `git log --grep=revert -i --oneline`. Each is a paid
  experiment; the lesson is what not to retry.
- Fix chains: `git log --format=%s | grep -oE '^fix\(([^)]+)\)' | sort |
  uniq -c | sort -rn`. A scope with many fixes is one misunderstanding
  coming back.
- Churn files: files touched most by fix commits. Read the fix bodies.
- Same-day fix pairs: a PR followed by a fix within a day is a review
  gap.

Each probe yields candidate `domain-context.md` entries (one fact, the
hashes behind it) and candidate contracts (a recurring class).

## 3. Contract candidates

A contract exists where the code has one sanctioned path. Find them:

- **Wrappers with bypasses.** A module that wraps a platform API
  (`http.ts` over `fetch`, `logger.ts` over `console`, `settings.ts` over
  storage, `db.py` over the driver) and raw uses of the same API
  elsewhere. Grep the raw API, list the files. The wrapper is the Path,
  the raw uses are today's violations, and the grep is the gate.
- **Fan-in modules.** Modules imported from many places (count
  importers). Each is a concern something owns.
- **Security paths.** Token storage, auth refresh, secrets in logs or
  URLs. These get a contract even without a violation.
- **State.** The store or context library and its subscription rules.
- **Recurring fix scopes** from the history probes.

For each candidate write the four lines with real names, then grep every
name in `Path:` to confirm it exists. Rank by violations today and by
blast radius. Take at most six for setup. Note which Never clauses a
text search can settle (those get a grep gate) and which cannot (`Gate:
review`).

## 4. Gate plan

For each gate in `reference/gates.md`, record: applies here (yes/no and
why), the file it will live in, the command that runs it, and the
scratch violation that will prove it red.

## 5. Questions for the user

Only what discovery could not settle: which of two test commands is
canonical, whether a candidate contract's bypasses are deliberate,
whether CI secrets exist for integration tests. If nothing is open,
say so and proceed after showing the plan.

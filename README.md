# gap-trap

Turns vibe coding into high quality code. Complements SDD if you are using it (think of it as the inner loop within)

## The problem

An agent writes most of your code. It is fast, so you stop reading
every diff. Quality drifts, and you find out when something breaks.

The drift looks the same in every codebase. The agent writes a helper
that already exists. It crosses a layer boundary because the shortcut
compiled. It writes a test that asserts the code ran, not that it did
the right thing. It follows a rule in your instructions file for a
week and then forgets it.

Nothing stops any of this. The rules are text, and the only thing that
reads them is the agent that breaks them.

## What gap-trap does

Run it once in a repository. It reads the code, writes the rules that
fit that codebase, and adds a gate for each rule. A gate is a check that
fails the commit or the CI run when the rule is broken. The agent cannot
skip a gate.

It sets up four things:

| | What it is |
|---|---|
| **Contracts** | One entry per part of the code that has one right way to do things (HTTP, logging, settings, auth). Each says what to use, what never to use, and which check finds bypasses. |
| **Proven red** | A CI job that runs every new test against the old code and fails when the test passes there. A test that cannot fail proves nothing. |
| **Ratchets** | Counts of known problems, such as the lint backlog or files over 400 lines. They may go down, never up. |
| **Playbooks** | The facts the project learned the hard way, written down so the next session does not learn them again. |

It also installs [slop-mop](https://github.com/pliablepixels/slop-mop),
a sibling skill, so the agent's docs, commit messages, and PR bodies read
like a person wrote them.

Works with any language. Node and Python repos get gates inside their
test suite; everything else (Go, Rust, Java, Ruby, .NET, PHP, Swift, C++)
gets shell versions that need only git, grep, awk, and your test command.

## Install

With the [skills](https://github.com/vercel-labs/skills) CLI:

```
npx skills add pliablepixels/gap-trap
```

Or by hand, for Claude Code:

```
git clone https://github.com/pliablepixels/gap-trap.git
mkdir -p ~/.claude/skills
cp -r gap-trap/gap-trap ~/.claude/skills/
```

The skill runs on Opus or a more capable model and stops on anything
smaller. Choosing the wrong contracts costs every later session.

## Run

In the repository you want to set up:

```
/gap-trap setup
```

The skill reads the repo, shows you a short plan (contracts, gates,
commands), asks about anything it could not settle, then writes the
files, proves each gate red, and commits. It does not push.

Later, after the first incidents or about once a month:

```
/gap-trap refine
```

This looks for rules without gates, contracts that name code that no
longer exists, and lessons in the commit history nobody wrote down. It
proposes one PR.

## Where it comes from

The framework is the one [zmNinjaNg](https://github.com/ZoneMinder/zmNinjaNg)
runs on. Agents write most of its code and no one reads the diffs line
by line. Chapter 14 of its developer guide,
[Agent development model](https://zmninjang.readthedocs.io/en/latest/developer-guide/14-agent-development-model.html),
is the inspiration for gap-trap. It explains rules, contracts, and
gates, and follows one feature from spec to merge.

## What it costs

The origin repo's full gate set (4,400 unit tests, a build, three lints)
runs in about a minute locally. The instruction gate adds about a second.
Proven red runs only in CI.

## Layout

```
gap-trap/
  SKILL.md          the skill: model gate, setup, refine
  reference/        the framework, discovery, gates, refine
  templates/        AGENTS.md, AGENTS.project.md, playbooks, gate scripts
```

## License

MIT.

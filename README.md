# gap-trap

A setup skill for coding agents. Point it at a repository and it builds a quality framework for the code agents write there: rules with gates, contracts for the parts of the code that have one right way to do things, a CI check that proves each new test can fail, and playbooks that hold what the project has learned. It also installs [slop-mop](https://github.com/pliablepixels/slop-mop) for the prose.

The framework comes from [zmNinjaNg](https://github.com/ZoneMinder/zmNinjaNg), where agents write most of the code and no one reads the diffs line by line. Chapter 14 of its [developer guide](https://github.com/ZoneMinder/zmNinjaNg/blob/main/docs/developer-guide/14-agent-development-model.rst) describes the model and the evidence behind it. gap-trap is that model made portable.

## What you get

- `AGENTS.md`, the rules that apply to any project. Each rule has an ID, a one-clause reason, and the gate that enforces it. Copied unchanged, and a test keeps project names out of it.
- `AGENTS.project.md`, the contracts for your codebase. A contract is four lines for one subsystem: what it owns, the one sanctioned way to use it, the bypasses that count as bugs even when they work, and the gate that catches them. The skill finds candidates by looking for wrappers with bypasses, modules everything imports, and the scopes your fix commits keep returning to.
- `agents/`, playbooks that load only for work in their area: testing, documentation, a glossary, declined requests, and a domain file for the facts the project paid for.
- Gates, in your own test runner or as shell scripts for any language: a test over the instruction files themselves, a proven-red job that runs each change's tests against the pre-change code, a ratchet for counts that may fall but never grow, and a PR body check.
- A self-improvement protocol: when something breaks that a rule would have caught, the fix PR also proposes the rule and its gate. The `refine` mode is the periodic sweep for what nobody wrote down at the time.

The instruction files are written for agents, not people: short statements with IDs and gate names. The human-readable explanation stays in your docs.

## Install

Clone this repo, then copy the skill directory into your agent's skills folder. For Claude Code:

```
git clone https://github.com/pliablepixels/gap-trap.git
mkdir -p ~/.claude/skills
cp -r gap-trap/gap-trap ~/.claude/skills/
```

The skill runs on Opus or a more capable model and stops on anything smaller. Discovery decides which parts of your code get a contract, and a wrong contract costs every later session.

## Run

From a session in the repository you want to set up:

```
/gap-trap setup
```

The skill reads the repo (stack, commands, CI, existing instruction files, commit history), shows you a short plan (the contracts it will write, the gates it will add, the commands it found), asks about anything it could not settle, and then writes the files, proves each gate red with a scratch violation, and commits. It does not push.

Later, after the first incidents or about once a month:

```
/gap-trap refine
```

This audits rules that have no gate, contracts whose names no longer exist, and the commit history since the last refine, and proposes one PR: new gates proven red, facts for the domain file with the commits behind them, and rules to delete because nothing they prevent has ever happened.

## What it costs

The origin repo's full gate set (4,400 unit tests, a build, three lints) runs in about a minute locally. The instruction gate adds about a second. Proven red and the mutation smoke run only in CI. The skill refuses to add a gate whose input it has not read once, and a coverage threshold nothing runs is on its list of things not to add.

## Layout

```
gap-trap/
  SKILL.md                 the skill: model gate, setup, refine
  reference/
    framework.md           the model in agent terms
    discovery.md           how the skill reads a repo and finds contracts
    gates.md               each gate's spec and how to port it
    refine.md              the periodic sweep
  templates/
    AGENTS.md              the portable core, copied unchanged
    AGENTS.project.md      contracts, project rules, verification, playbooks
    CLAUDE.md              the Claude Code shim
    agents/                playbook skeletons
    gates/                 reference implementations (Node, vitest, GitHub Actions)
    pull_request_template.md
```

The gates come in three forms: vitest and pytest ports that run inside the test suite for Node and Python repos, and shell versions that need only git, grep, awk, and your test command for everything else (Go, Rust, Java, Ruby, .NET, PHP, Swift, C++). The shell versions were run against a Go repo and the origin TypeScript repo. The skill picks by manifest and keeps the same assertions whichever form it uses.

## License

MIT.

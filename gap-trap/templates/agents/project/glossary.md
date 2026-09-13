# Glossary

One name per concept, for code identifiers, briefs, docs, and commit
messages. Each entry says what the thing is, not what it does, and lists
the words to stop using for it. User-facing copy follows the product
wording and is exempt. A quality ratchet may count avoided terms in agent
and developer prose.

## Process

**Contract**:
An architecture entry in `AGENTS.project.md`: what it owns, the sanctioned
path, forbidden bypasses, and its gate.
_Avoid_: architecture rule, architecture convention

**Gate**:
A command that fails a commit, push, or CI run when a rule breaks.
_Avoid_: blocking check, guard script

**Brief**:
The requirements file handed to a subagent for one task.
_Avoid_: task prompt, instructions file

**Spec**:
A design document approved before a plan is written.
_Avoid_: design doc

**Seam**:
The interface a test exercises; the highest one that reaches the behavior.
_Avoid_: test boundary, layer under test

**Proven red**:
A new test that was run against the pre-change code and shown to fail there.
_Avoid_: verified failing, shown failing

## {{DOMAIN}}

**{{Term}}**:
{{What it is.}}
_Avoid_: {{synonyms to stop using}}

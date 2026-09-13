# Refine

Periodic sweep for a repo that already has the framework. Output is one
PR through the self-improvement protocol (M3) plus a report in the
session. Every proposal carries evidence: a commit hash, a grep count,
or a gate's output. No evidence, no proposal.

## 1. Read what exists

`AGENTS.md`, `AGENTS.project.md`, every file under `agents/`. Only new
lessons get proposed; re-reporting a covered fact is noise.

## 2. Rules without gates (M1)

For each rule and each contract `Gate:` line, classify: gated by a
script, `review`, or nothing. For every `review` or nothing, ask
whether a text search settles it. Grep it. Three outcomes:

- Grep is clean today: add a zero-tolerance gate. Cost is milliseconds.
- Grep finds violations: add a ratchet at today's count and list the
  sites.
- No text search settles it: leave `Gate: review`, and check the rule
  has an incident behind it (step 4). A review-only rule with no
  incident is a deletion candidate.

## 3. Contract truth

Run the instruction gate. Then, for each contract, grep the `Path:`
symbols and confirm the sanctioned path is what the code does. A
code/contract mismatch is a finding either way: the code drifted, or the
contract is wrong.

## 4. History since last refine

Window: since the last commit whose message contains `history-mined`,
or the full history the first time. Run the probes in
`reference/discovery.md` section 2. For each candidate:

| Signal | Verdict |
|---|---|
| Reverted approach with a working alternative | domain entry: what failed, what works, do not retry |
| 3+ fixes, one misunderstanding | domain entry stating the stable fact |
| Recurring class across dozens of commits | contract candidate with Owns/Path/Never/Gate |
| Security-shaped fix | contract Never-line candidate |
| One-off fix, no reusable fact | skip |
| Fix predates the rule that now covers it | already handled; list it |

## 5. Cost

Rules load into every session. For each rule, find the incident it
prevented (domain-context, history). None found: propose deletion.
Duplicate facts across files: keep one home. Gates that overlap (two
tests on one invariant): keep one. Report the words removed against the
words added; the PR should not grow the always-loaded files without a
gate to show for it.

## 6. Propose

One PR: instruction edits, new gates proven red, baseline updates,
domain entries verbatim with hashes. Commit message includes
`history-mined`. Report in the session: proposals with evidence, the
checked-and-already-covered list, and the word count before and after.

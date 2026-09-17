"""Instruction gate. Reference implementation from gap-trap (pytest).

Same assertions as instruction-gate.test.ts: every name a contract cites
exists where the contract says it lives, the portable core stays portable,
the always-loaded files stay small, cited commits exist, knowledge files hold
no private data, docs cite rule IDs that exist, and the grep gates settle the
contract Never clauses a text search can.

Every check also asserts its own denominator: how many tokens it resolved,
how many files it scanned. A check that quietly measures nothing reports the
same green as one that measured everything (M2).

ADAPT the config block; keep the assertions.
"""
from __future__ import annotations

import io
import re
import subprocess
import tokenize
from pathlib import Path

import pytest

# ---- config ---------------------------------------------------------------
REPO = Path(__file__).resolve().parents[1]          # ADAPT: repo root relative to this file
SRC_DIR = "src"                                     # ADAPT
SOURCE_EXT = (".py",)
TEST_DIRS = {"tests", "test", "__tests__"}
FORBIDDEN_IN_CORE = ["{{PRODUCT}}", "{{FRAMEWORK}}", SRC_DIR, "agents/project"]  # ADAPT
WORD_BUDGET = 4000                                  # ADAPT: current count plus room (C7)
MIN_CONTRACTS = 2  # the honest count; never pad
ALWAYS_LOADED = ["AGENTS.md", "AGENTS.project.md", "CLAUDE.md"]  # ADAPT: loaded every session
KNOWLEDGE_FILES = [
    "agents/project/domain-context.md",
    "agents/project/glossary.md",
    "agents/project/out-of-scope.md",
    "agents/generic/agent-workflows.md",
]
DOCS_DIR = "docs"                                   # ADAPT: "" skips the rule-ID check
# ADAPT: (name, pattern over comment-stripped source, exempt-path predicate)
GREP_GATES = [
    ("Logging: no print outside the logger", re.compile(r"\bprint\("), lambda rel: rel == "lib/logger.py"),
    ("HTTP: no raw requests/httpx outside the wrapper", re.compile(r"\b(requests|httpx)\.(get|post|put|delete|request)\("), lambda rel: rel.startswith("lib/http")),
]
# ---- end config -----------------------------------------------------------

SRC = REPO / SRC_DIR
FIELD_RE = re.compile(r"^(Owns|Path|Never|Gate):")


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def source_files() -> list[Path]:
    return [p for p in SRC.rglob("*") if p.suffix in SOURCE_EXT and "node_modules" not in p.parts]


def is_test_path(p: Path) -> bool:
    rel = p.relative_to(SRC)
    return any(part in TEST_DIRS for part in rel.parts) or p.name.startswith("test_") or p.name.endswith("_test.py")


def parse_contracts(md: str) -> list[tuple[str, str]]:
    section = md.split("## Architecture contracts", 1)[1].split("\n## ", 1)[0] if "## Architecture contracts" in md else ""
    out = []
    for block in section.split("\n### ")[1:]:
        name, _, body = block.partition("\n")
        out.append((name.strip(), body))
    return out


def fold_fields(body: str) -> list[str]:
    """Fold a contract body's wrapped lines back into the field they continue.

    Markdown prose wraps, and a ``Path:`` line long enough to wrap used to
    have everything past the wrap silently dropped from the check.
    """
    out: list[str] = []
    open_field = False
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            open_field = False
        elif FIELD_RE.match(line):
            out.append(line)
            open_field = True
        elif open_field:
            out[-1] += " " + line
    return out


def backtick_tokens(line: str) -> list[str]:
    return [t.removesuffix("()") for t in re.findall(r"`([^`]+)`", line)]


def text_under(rel: str) -> str:
    """The text under a repo-relative path, file or directory."""
    p = REPO / rel
    if not p.exists():
        return ""
    if p.is_dir():
        return "\n".join(read(f) for f in p.rglob("*") if f.suffix in SOURCE_EXT and f.is_file())
    return read(p)


CONTRACTS = parse_contracts(read(REPO / "AGENTS.project.md"))
# A contract symbol found only in a test file is not a symbol the code uses.
NON_TEST_SOURCE_TEXT = "\n".join(read(p) for p in source_files() if not is_test_path(p))


def test_contracts_have_all_four_lines():
    assert len(CONTRACTS) >= MIN_CONTRACTS
    for name, body in CONTRACTS:
        fields = fold_fields(body)
        for field in ("Owns:", "Path:", "Never:", "Gate:"):
            assert any(l.startswith(field) for l in fields), f"{name} missing {field}"


def test_every_symbol_and_path_in_contracts_exists():
    checked_overall = 0
    for name, body in CONTRACTS:
        lines = [l for l in fold_fields(body) if l.startswith(("Path:", "Gate:"))]
        checked = 0
        for line in lines:
            tokens = backtick_tokens(line)
            paths = [t for t in tokens if "/" in t]
            symbols = [t for t in tokens if "/" not in t]
            for token in paths:
                assert (REPO / token).exists(), f"{name}: path {token} missing"
                checked += 1
            # A Path line names where the subsystem lives, so its symbols are
            # looked for there. Resolving them anywhere in the tree let a
            # symbol that had moved out of its own module keep the contract
            # green.
            scoped = line.startswith("Path:") and paths
            haystack = "\n".join(text_under(p) for p in paths) if scoped else NON_TEST_SOURCE_TEXT
            where = ", ".join(paths) if scoped else f"{SRC_DIR} (non-test files)"
            for token in symbols:
                assert re.search(rf"\b{re.escape(token)}\b", haystack), f"{name}: symbol {token} not found in {where}"
                checked += 1
        assert checked > 0, f"{name}: its Path/Gate lines name nothing the gate can check"
        checked_overall += checked
    assert checked_overall > 0, "no contract token was checked at all"


def test_core_is_portable():
    core = read(REPO / "AGENTS.md").lower()
    for token in FORBIDDEN_IN_CORE:
        assert token.lower() not in core, f'AGENTS.md contains "{token}"'


def test_always_loaded_files_within_word_budget():
    # Every file has to be there. Summing whatever happens to exist means
    # deleting an always-loaded file reads as coming in under budget.
    for f in ALWAYS_LOADED:
        assert (REPO / f).exists(), f"{f} is missing; the budget would fall for free"
    total = sum(len(read(REPO / f).split()) for f in ALWAYS_LOADED)
    assert total <= WORD_BUDGET, f"combined {total} words > budget {WORD_BUDGET}"


def test_cited_commit_hashes_exist():
    md = read(REPO / "agents/project/domain-context.md")
    # 7 to 40 hex chars with a digit: --oneline prints 7, and the digit keeps
    # English words made of a-f (acceded, defaced) out.
    for h in sorted({h for h in re.findall(r"\b[0-9a-f]{7,40}\b", md) if re.search(r"\d", h)}):
        r = subprocess.run(["git", "cat-file", "-e", f"{h}^{{commit}}"], cwd=REPO, capture_output=True)
        assert r.returncode == 0, f"cited commit {h} not found in history"


def test_knowledge_files_hold_no_private_data():
    for f in KNOWLEDGE_FILES:
        p = REPO / f
        if not p.exists():
            continue
        text = read(p)
        assert not re.search(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", text), f"{f} contains an IP address"
        # The domain needs a letter TLD, or a pinned version such as
        # `pytest@1.2.3` reads as an email and the gate cries wolf.
        assert not re.search(r"\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b", text), f"{f} contains an email address"


def test_docs_cite_rule_ids_that_exist():
    if not DOCS_DIR or not (REPO / DOCS_DIR).exists():
        pytest.skip("no docs dir")
    valid = set(re.findall(r"^- ([IPCM]\d+)\.", read(REPO / "AGENTS.md"), re.M))
    assert valid
    for p in (REPO / DOCS_DIR).rglob("*"):
        if p.suffix not in (".md", ".rst"):
            continue
        for m in re.finditer(r"\brules? ([IPCM]\d+)\b", read(p), re.I):
            assert m.group(1).upper() in valid, f"{p.name}: unknown rule id {m.group(1)}"


def _strip_comments(code: str) -> str:
    """Blank out comments, leaving strings and line positions untouched.

    A regex over ``#`` cannot tell a comment from a ``#`` inside a string, and
    dropping only whole-line comments left trailing ones in, so a commented-out
    ``print(`` failed the gate that exists to find real ones. ``tokenize`` knows
    the difference.
    """
    lines = code.splitlines(keepends=True)
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(code).readline))
    except (tokenize.TokenError, SyntaxError, IndentationError):
        return re.sub(r"(?m)^\s*#.*$", "", code)
    for tok in tokens:
        if tok.type != tokenize.COMMENT:
            continue
        row, col = tok.start
        end_col = tok.end[1]
        line = lines[row - 1]
        lines[row - 1] = line[:col] + " " * (end_col - col) + line[end_col:]
    return "".join(lines)


def _code_files() -> list[tuple[str, str]]:
    return [
        (p.relative_to(SRC).as_posix(), _strip_comments(read(p)))
        for p in source_files()
        if not is_test_path(p)
    ]


def test_grep_gates_scan_files_at_all():
    # Without this the suite is green after any path move (M2).
    assert len(_code_files()) > 0


@pytest.mark.parametrize("name,pattern,exempt", GREP_GATES, ids=[g[0] for g in GREP_GATES])
def test_grep_gate(name, pattern, exempt):
    offenders = [rel for rel, code in _code_files() if not exempt(rel) and pattern.search(code)]
    assert offenders == [], f"{name}: {offenders}"

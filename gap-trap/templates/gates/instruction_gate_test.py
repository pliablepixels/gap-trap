"""Instruction gate. Reference implementation from gap-trap (pytest).

Same assertions as instruction-gate.test.ts: every name a contract cites
exists, the portable core stays portable, the always-loaded files stay
small, cited commits exist, knowledge files hold no private data, docs cite
rule IDs that exist, and the grep gates settle the contract Never clauses a
text search can. ADAPT the config block; keep the assertions.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

# ---- config ---------------------------------------------------------------
REPO = Path(__file__).resolve().parents[1]          # ADAPT: repo root relative to this file
SRC_DIR = "src"                                     # ADAPT
SOURCE_EXT = (".py",)
TEST_DIRS = {"tests", "test", "__tests__"}
FORBIDDEN_IN_CORE = ["{{PRODUCT}}", "{{FRAMEWORK}}", SRC_DIR, "agents/project"]  # ADAPT
WORD_BUDGET = 4000                                  # ADAPT: current count plus room (C7)
MIN_CONTRACTS = 3
KNOWLEDGE_FILES = [
    "agents/project/domain-context.md",
    "agents/project/glossary.md",
    "agents/project/out-of-scope.md",
    "agents/generic/claude-workflows.md",
]
DOCS_DIR = "docs"                                   # ADAPT: "" skips the rule-ID check
# ADAPT: (name, pattern over comment-stripped source, exempt-path predicate)
GREP_GATES = [
    ("Logging: no print outside the logger", re.compile(r"\bprint\("), lambda rel: rel == "lib/logger.py"),
    ("HTTP: no raw requests/httpx outside the wrapper", re.compile(r"\b(requests|httpx)\.(get|post|put|delete|request)\("), lambda rel: rel.startswith("lib/http")),
]
# ---- end config -----------------------------------------------------------

SRC = REPO / SRC_DIR


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def source_files() -> list[Path]:
    return [p for p in SRC.rglob("*") if p.suffix in SOURCE_EXT and "node_modules" not in p.parts]


def parse_contracts(md: str) -> list[tuple[str, str]]:
    section = md.split("## Architecture contracts", 1)[1].split("\n## ", 1)[0] if "## Architecture contracts" in md else ""
    out = []
    for block in section.split("\n### ")[1:]:
        name, _, body = block.partition("\n")
        out.append((name.strip(), body))
    return out


def backtick_tokens(line: str) -> list[str]:
    return [t.removesuffix("()") for t in re.findall(r"`([^`]+)`", line)]


CONTRACTS = parse_contracts(read(REPO / "AGENTS.project.md"))
SOURCE_TEXT = "\n".join(read(p) for p in source_files())


def test_contracts_have_all_four_lines():
    assert len(CONTRACTS) >= MIN_CONTRACTS
    for name, body in CONTRACTS:
        for field in ("Owns:", "Path:", "Never:", "Gate:"):
            assert field in body, f"{name} missing {field}"


def test_every_symbol_and_path_in_contracts_exists():
    for name, body in CONTRACTS:
        lines = [l for l in body.splitlines() if l.startswith(("Path:", "Gate:"))]
        for token in {t for l in lines for t in backtick_tokens(l)}:
            if "/" in token:
                assert (REPO / token).exists(), f"{name}: path {token} missing"
            else:
                assert re.search(rf"\b{re.escape(token)}\b", SOURCE_TEXT), f"{name}: symbol {token} not found in {SRC_DIR}"


def test_core_is_portable():
    core = read(REPO / "AGENTS.md").lower()
    for token in FORBIDDEN_IN_CORE:
        assert token.lower() not in core, f'AGENTS.md contains "{token}"'


def test_always_loaded_files_within_word_budget():
    total = sum(len(read(REPO / f).split()) for f in ("AGENTS.md", "AGENTS.project.md", "CLAUDE.md") if (REPO / f).exists())
    assert total <= WORD_BUDGET, f"combined {total} words > budget {WORD_BUDGET}"


def test_cited_commit_hashes_exist():
    md = read(REPO / "agents/project/domain-context.md")
    for h in sorted(set(re.findall(r"\b[0-9a-f]{8}\b", md))):
        r = subprocess.run(["git", "cat-file", "-e", f"{h}^{{commit}}"], cwd=REPO, capture_output=True)
        assert r.returncode == 0, f"cited commit {h} not found in history"


def test_knowledge_files_hold_no_private_data():
    for f in KNOWLEDGE_FILES:
        p = REPO / f
        if not p.exists():
            continue
        text = read(p)
        assert not re.search(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", text), f"{f} contains an IP address"
        assert not re.search(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b", text), f"{f} contains an email address"


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
    return re.sub(r"(?m)^\s*#.*$", "", code)


def _code_files() -> list[tuple[str, str]]:
    out = []
    for p in source_files():
        rel = p.relative_to(SRC).as_posix()
        if any(part in TEST_DIRS for part in p.relative_to(SRC).parts) or p.name.startswith("test_") or p.name.endswith("_test.py"):
            continue
        out.append((rel, _strip_comments(read(p))))
    return out


def test_grep_gates_scan_files_at_all():
    # Without this the suite is green after any path move (M2).
    assert len(_code_files()) > 0


@pytest.mark.parametrize("name,pattern,exempt", GREP_GATES, ids=[g[0] for g in GREP_GATES])
def test_grep_gate(name, pattern, exempt):
    offenders = [rel for rel, code in _code_files() if not exempt(rel) and pattern.search(code)]
    assert offenders == [], f"{name}: {offenders}"

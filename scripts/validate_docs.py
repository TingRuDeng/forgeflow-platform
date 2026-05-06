#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

REQUIRED_HEADINGS = (
    "## 目的",
    "## 适合读者",
    "## 一分钟摘要",
    "## 权威边界",
    "## 如何验证",
)

REQUIRED_AI_KEYS = (
    "authority:",
    "scope:",
    "read_when:",
    "verify_with:",
    "stale_when:",
)

AI_CONTEXT_SECTIONS = (
    "# AI Context",
    "## 权威文档地图",
    "## 任务读取路径",
    "## 关键证据入口",
    "## 高风险误读点",
    "## Optional",
)

AUTHORITY_DOCS = (
    "AGENTS.md",
    "README.md",
    "docs/README.md",
    "docs/DOC_SYNC_CHECKLIST.md",
    "docs/ARCHITECTURE.md",
    "docs/API_ENDPOINTS.md",
    "docs/DATABASE_SCHEMA.md",
    "docs/KNOWN_PITFALLS.md",
    "docs/TECH_DEBT.md",
    "docs/STATE_MACHINE.md",
    "docs/onboarding.md",
    "docs/CONTRIBUTING.md",
    "apps/dispatcher/README.md",
    "scripts/lib/README.md",
)

ACTIVE_DOC_GLOBS = (
    "*.md",
    "docs/*.md",
    "docs/contracts/*.md",
    "docs/runbooks/*.md",
    "apps/*/README.md",
    "packages/*/README.md",
    "scripts/lib/README.md",
    "prompts/*.md",
)

SKIPPED_LINK_PARTS = {
    "node_modules",
    ".git",
}

SKIPPED_DOC_PARTS = {
    "docs/archive",
    "docs/external",
    "docs/plans",
    "docs/research",
    "docs/superpowers",
}

SKIPPED_DOC_FILES = {
    "docs/CODE_REVIEW_REPORT.md",
}

PLACEHOLDER_RE = re.compile(
    r"\b(TBD|TODO|FIXME|placeholder|fill in|coming soon|lorem ipsum)\b|待补充|占位",
    re.IGNORECASE,
)
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
AI_SUMMARY_RE = re.compile(r"```ya?ml\s+(ai_summary:.*?)```", re.DOTALL)


def main(argv: list[str]) -> int:
    root = Path(argv[1]).resolve() if len(argv) > 1 else Path.cwd().resolve()
    issues = validate_repo(root)
    for issue in issues:
        print(issue)
    return 1 if issues else 0


def validate_repo(root: Path) -> list[str]:
    issues: list[str] = []
    issues.extend(validate_authority_docs(root))
    issues.extend(validate_ai_context(root))
    issues.extend(validate_active_docs(root))
    return issues


def validate_authority_docs(root: Path) -> list[str]:
    issues: list[str] = []
    for rel in AUTHORITY_DOCS:
        path = root / rel
        if not path.exists():
            issues.append(f"{rel}: 权威文档不存在")
            continue
        text = read_text(path)
        issues.extend(validate_required_headings(rel, text))
        issues.extend(validate_ai_summary(rel, text))
    return issues


def validate_required_headings(rel: str, text: str) -> list[str]:
    return [f"{rel}: 缺少必备标题 {heading}" for heading in REQUIRED_HEADINGS if heading not in text]


def validate_ai_summary(rel: str, text: str) -> list[str]:
    match = AI_SUMMARY_RE.search(text)
    if not match:
        return [f"{rel}: 缺少 ai_summary 摘要块"]
    block = match.group(1)
    return [f"{rel}: ai_summary 缺少字段 {key}" for key in REQUIRED_AI_KEYS if key not in block]


def validate_ai_context(root: Path) -> list[str]:
    rel = "docs/AI_CONTEXT.md"
    path = root / rel
    if not path.exists():
        return [f"{rel}: 缺少 AI 上下文索引"]
    text = read_text(path)
    issues = validate_ordered_sections(rel, text)
    if len(text.splitlines()) > 120:
        issues.append(f"{rel}: 超过 120 行上下文预算")
    return issues


def validate_ordered_sections(rel: str, text: str) -> list[str]:
    positions: list[int] = []
    issues: list[str] = []
    for section in AI_CONTEXT_SECTIONS:
        index = text.find(section)
        if index < 0:
            issues.append(f"{rel}: 缺少章节 {section}")
        positions.append(index)
    if [position for position in positions if position >= 0] != sorted(position for position in positions if position >= 0):
        issues.append(f"{rel}: 章节顺序错误")
    return issues


def validate_active_docs(root: Path) -> list[str]:
    issues: list[str] = []
    for path in iter_active_markdown(root):
        rel = to_rel(root, path)
        text = read_text(path)
        if PLACEHOLDER_RE.search(text):
            issues.append(f"{rel}: 存在占位词或未完成标记")
        issues.extend(validate_links(root, path, text))
    return issues


def iter_active_markdown(root: Path) -> list[Path]:
    paths: set[Path] = set()
    for pattern in ACTIVE_DOC_GLOBS:
        for path in root.glob(pattern):
            if path.is_file() and not is_skipped_doc(root, path):
                paths.add(path)
    return sorted(paths)


def is_skipped_doc(root: Path, path: Path) -> bool:
    parts = set(path.relative_to(root).parts)
    rel = to_rel(root, path)
    return rel in SKIPPED_DOC_FILES or bool(parts & SKIPPED_LINK_PARTS) or any(rel.startswith(prefix) for prefix in SKIPPED_DOC_PARTS)


def validate_links(root: Path, path: Path, text: str) -> list[str]:
    issues: list[str] = []
    for raw_target in LINK_RE.findall(text):
        target = raw_target.strip()
        if is_external_or_anchor(target):
            continue
        target_path = resolve_markdown_link(root, path, target)
        if target_path and not target_path.exists():
            issues.append(f"{to_rel(root, path)}: 本地链接不存在 {target}")
    return issues


def resolve_markdown_link(root: Path, path: Path, target: str) -> Path | None:
    clean_target = target.split("#", 1)[0]
    if not clean_target:
        return None
    if clean_target.startswith("/"):
        return Path(clean_target)
    return (path.parent / clean_target).resolve()


def is_external_or_anchor(target: str) -> bool:
    return target.startswith("#") or "://" in target or target.startswith("mailto:")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def to_rel(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root).as_posix()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

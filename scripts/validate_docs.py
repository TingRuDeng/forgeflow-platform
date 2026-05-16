#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

AI_CONTEXT_PATH = Path("docs/AI_CONTEXT.md")
DEFAULT_PROFILE = "generic"
GENERIC_REQUIRED_FILES = ("AGENTS.md", "docs/README.md", "docs/AI_CONTEXT.md")
ROOT_AUTHORITY_FILES = ("AGENTS.md",)
ANDROID_REQUIRED_FILES = (
    "docs/BUILD_MATRIX.md",
    "docs/MODULE_MAP.md",
    "docs/TESTING_MATRIX.md",
    "docs/MANIFEST_AND_PERMISSIONS.md",
)
MAX_FILE_BYTES = 1_000_000
MAX_AI_CONTEXT_LINES = 120
REQUIRED_AUTHORITY_HEADINGS = (
    "## Purpose",
    "## Source of truth",
    "## Key facts",
    "## How to verify",
    "## Stale when",
)
AI_CONTEXT_SECTIONS = (
    "## Project Snapshot",
    "## Core Directories",
    "## Documentation Map",
    "## Common Task Reading Paths",
    "## High-Risk Areas",
    "## Validation Commands",
    "## Stale when",
)
REQUIRED_AI_KEYS = ("purpose", "read_when", "source_of_truth", "verify_with", "stale_when")
COMMAND_PREFIXES = ("./", "bash ", "git ", "make ", "node ", "npm ", "pnpm ", "python ", "python3 ", "yarn ")
SKIPPED_DIRS = {".git", ".worktrees", ".next", "archive", "coverage", "dist", "external", "node_modules", "plans", "research", "superpowers"}
SKIPPED_AUTHORITY_DOCS = {"docs/AGENT_STARTER_PROMPT.md", "docs/CODE_REVIEW_REPORT.md", "docs/DOC_SYNC_CHECKLIST.md"}
SKIPPED_AUTHORITY_PREFIXES = ("docs/archive/", "docs/contracts/", "docs/external/", "docs/plans/", "docs/research/", "docs/runbooks/", "docs/superpowers/", "docs/templates/")
GENERIC_VALUES = {
    "tbd", "todo", "n/a", "coming soon", "run tests", "check manually",
    "follow best practices", "run appropriate tests", "检查一下", "手动确认",
    "运行测试", "按需验证", "遵循最佳实践", "后续补充", "待补充", "人工检查",
}
PLACEHOLDER_RE = re.compile(r"\b(TBD|TODO|placeholder|fill in|later)\b|待补|待补充|后续补充")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
LEGACY_DOC_SECTION = "## Legacy detail docs"


def validate_root(root: Path | str, profile: str = DEFAULT_PROFILE) -> list[str]:
    base = Path(root).resolve()
    issues = validate_base(base)
    if issues:
        return issues
    legacy_docs = legacy_detail_docs(base)
    issues.extend(validate_profile_files(base, profile))
    issues.extend(validate_authority_docs(base, legacy_docs))
    issues.extend(validate_ai_context(base))
    issues.extend(validate_links(base))
    return issues


def validate_base(base: Path) -> list[str]:
    if not base.exists():
        return [f"{base}: 路径不存在"]
    return [] if base.is_dir() else [f"{base}: 必须是目录"]


def validate_profile_files(base: Path, profile: str) -> list[str]:
    if profile not in ("generic", "android"):
        return [f"{base}: 未知 profile {profile}"]
    return [f"{rel}: 缺少必需文件 {rel}" for rel in required_files_for(profile) if not (base / rel).exists()]


def required_files_for(profile: str) -> tuple[str, ...]:
    """返回当前 profile 的必需文件。"""
    return GENERIC_REQUIRED_FILES + (ANDROID_REQUIRED_FILES if profile == "android" else ())


def validate_authority_docs(base: Path, legacy_docs: set[str]) -> list[str]:
    """校验 docs 根目录下仍属于新契约的权威文档。"""
    issues: list[str] = []
    paths = [base / rel for rel in ROOT_AUTHORITY_FILES]
    paths.extend(sorted((base / "docs").glob("*.md")))
    for path in paths:
        if not path.exists():
            continue
        rel = relative_path(path, base)
        if skip_authority_doc(rel, legacy_docs):
            continue
        text = read_text(path)
        issues.extend(validate_file_text(path, base, text))
        if rel != AI_CONTEXT_PATH.as_posix():
            issues.extend(validate_authority_contract(path, base, text))
    return issues


def validate_authority_contract(path: Path, base: Path, text: str) -> list[str]:
    """检查 authority doc 的章节、摘要和非模板内容。"""
    rel = relative_path(path, base)
    issues = [f"{rel}: 缺少必备标题 {heading}" for heading in REQUIRED_AUTHORITY_HEADINGS if heading not in text]
    issues.extend(validate_ai_summary(rel, text, base))
    issues.extend(validate_generic_sections(rel, text))
    return issues


def validate_ai_context(base: Path) -> list[str]:
    """检查 AI_CONTEXT 的摘要、标准章节和长度预算。"""
    path = base / AI_CONTEXT_PATH
    if not path.exists():
        return []
    text = read_text(path)
    rel = AI_CONTEXT_PATH.as_posix()
    issues = validate_file_text(path, base, text)
    issues.extend(validate_ai_summary(rel, text, base))
    issues.extend(validate_ai_context_sections(rel, text))
    if len(text.splitlines()) > MAX_AI_CONTEXT_LINES:
        issues.append(f"{rel}: 超过 {MAX_AI_CONTEXT_LINES} 行上下文预算")
    return issues


def validate_file_text(path: Path, base: Path, text: str) -> list[str]:
    """检查文档体积和占位词。"""
    rel = relative_path(path, base)
    issues: list[str] = []
    if PLACEHOLDER_RE.search(text):
        issues.append(f"{rel}: 存在占位词或未完成标记")
    if text.count("ai_summary:") > 1:
        issues.append(f"{rel}: 包含多个 ai_summary 摘要块")
    if path.stat().st_size > MAX_FILE_BYTES:
        issues.append(f"{rel}: 文件超过 {MAX_FILE_BYTES} 字节")
    return issues


def validate_ai_summary(rel: str, text: str, base: Path) -> list[str]:
    """检查 frontmatter ai_summary 的字段、路径和命令。"""
    summary = parse_ai_summary(text)
    if not summary:
        return [f"{rel}: 缺少 frontmatter ai_summary"]
    issues = [f"{rel}: ai_summary.{key} 必须填写" for key in REQUIRED_AI_KEYS if not summary_values(summary, key)]
    for entry in summary_values(summary, "source_of_truth"):
        if should_check_path(entry) and not (base / entry).exists():
            issues.append(f"{rel}: source_of_truth 路径不存在 {entry}")
    for command in summary_values(summary, "verify_with"):
        if not specific_command(command):
            issues.append(f"{rel}: verify_with 不是具体命令 {command}")
    return issues


def parse_ai_summary(text: str) -> dict[str, str | list[str]]:
    match = FRONTMATTER_RE.search(text)
    return parse_summary_block(match.group(1)) if match else {}


def parse_summary_block(block: str) -> dict[str, str | list[str]]:
    """解析 ai_summary 下的标量和列表。"""
    data: dict[str, str | list[str]] = {}
    in_summary = False
    current_key = ""
    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line == "ai_summary:":
            in_summary = True
            continue
        if not in_summary:
            continue
        if line.startswith("- ") and current_key:
            data.setdefault(current_key, [])
            cast_list(data[current_key]).append(clean_value(line[2:]))
        elif ":" in line:
            current_key, value = [part.strip() for part in line.split(":", 1)]
            data[current_key] = [] if clean_value(value) in ("", "[]") else clean_value(value)
    return data


def cast_list(value: str | list[str]) -> list[str]:
    if not isinstance(value, list):
        raise TypeError("ai_summary 列表字段解析异常")
    return value


def summary_values(summary: dict[str, str | list[str]], key: str) -> list[str]:
    value = summary.get(key, [])
    return value if isinstance(value, list) else [value]


def validate_ai_context_sections(rel: str, text: str) -> list[str]:
    """检查 AI_CONTEXT 章节完整性和顺序。"""
    positions = [text.find(section) for section in AI_CONTEXT_SECTIONS]
    issues = [f"{rel}: AI_CONTEXT 缺少章节 {section}" for section, position in zip(AI_CONTEXT_SECTIONS, positions) if position < 0]
    known_positions = [position for position in positions if position >= 0]
    if known_positions != sorted(known_positions):
        issues.append(f"{rel}: AI_CONTEXT 章节顺序错误")
    return issues


def validate_generic_sections(rel: str, text: str) -> list[str]:
    """拒绝空泛模板章节。"""
    issues: list[str] = []
    for heading in REQUIRED_AUTHORITY_HEADINGS:
        if generic_section(section_content(text, heading)):
            issues.append(f"{rel}: 章节 {heading} 内容过于空泛")
    return issues


def validate_links(base: Path) -> list[str]:
    """检查本地 Markdown 链接，跳过依赖、归档和本地运行时目录。"""
    issues: list[str] = []
    for path in sorted(base.rglob("*.md")):
        if skip_path(path, base):
            continue
        text = read_text(path)
        for target in LINK_RE.findall(text):
            if not external_or_anchor(target) and not (path.parent / target.split("#", 1)[0]).resolve().exists():
                issues.append(f"{relative_path(path, base)}: 本地链接不存在 {target}")
    return issues


def legacy_detail_docs(base: Path) -> set[str]:
    """读取 docs/README.md 中标记的旧格式详情文档。"""
    readme = base / "docs/README.md"
    if not readme.exists():
        return set()
    section = section_content(read_text(readme), LEGACY_DOC_SECTION)
    return {rel for target in LINK_RE.findall(section) if (rel := normalize_doc_target(target)).startswith("docs/")}


def section_content(text: str, heading: str) -> str:
    match = re.search(rf"^{re.escape(heading)}\s*$", text, re.MULTILINE)
    if not match:
        return ""
    start = match.end()
    next_match = re.search(r"^## ", text[start:], re.MULTILINE)
    end = start + next_match.start() if next_match else len(text)
    return text[start:end].strip()


def normalize_doc_target(target: str) -> str:
    target = target.split("#", 1)[0]
    for prefix in ("../", "./"):
        if target.startswith(prefix):
            target = target[len(prefix):]
    return target if target.startswith("docs/") else f"docs/{target}"


def skip_authority_doc(rel: str, legacy_docs: set[str]) -> bool:
    return rel in legacy_docs or rel in SKIPPED_AUTHORITY_DOCS or any(rel.startswith(prefix) for prefix in SKIPPED_AUTHORITY_PREFIXES)


def skip_path(path: Path, base: Path) -> bool:
    return bool(set(path.resolve().relative_to(base).parts) & SKIPPED_DIRS)


def should_check_path(entry: str) -> bool:
    return not entry.startswith(("http://", "https://")) and ("/" in entry or "." in Path(entry).name)


def specific_command(command: str) -> bool:
    return command.strip().lower() not in GENERIC_VALUES and command.strip().lower().startswith(COMMAND_PREFIXES)


def generic_section(content: str) -> bool:
    return re.sub(r"[`\s]+", " ", content).strip().lower() in GENERIC_VALUES


def external_or_anchor(target: str) -> bool:
    return target.startswith("#") or "://" in target or target.startswith("mailto:")


def clean_value(value: str) -> str:
    return value.strip().strip('"').strip("'")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def relative_path(path: Path, base: Path) -> str:
    return path.resolve().relative_to(base).as_posix()


def parse_args(args: list[str]) -> tuple[Path, str]:
    root = Path.cwd()
    profile = DEFAULT_PROFILE
    if args and not args[0].startswith("--"):
        root = Path(args[0])
        args = args[1:]
    if "--profile" in args and args.index("--profile") + 1 < len(args):
        profile = args[args.index("--profile") + 1]
    return root, profile


def main(argv: list[str] | None = None) -> int:
    root, profile = parse_args(sys.argv[1:] if argv is None else argv)
    issues = validate_root(root, profile)
    for issue in issues:
        print(issue)
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Check mechanical PRD delivery risks without imposing content structure."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse


PLACEHOLDER_PATTERNS = (
    re.compile(r"\{\{[^{}\n]+\}\}"),
    re.compile(r"(?i)\b(?:xxxx|todo|tbd)\b"),
    re.compile(r"/xxxxx/xxxx"),
    re.compile(r"待补充[：:]?"),
)
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+['\"][^'\"]*['\"])?\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
VAGUE_PATTERNS = (
    re.compile(r"支持(?:相关|各种|多种)?(?:操作|功能|管理)"),
    re.compile(r"合理展示|友好提示|根据实际情况(?:进行)?处理|满足业务需求|符合预期"),
)
DELIVERY_STAGES = ("需求草案", "研发评审稿", "研发基线")


@dataclass
class Issue:
    level: str
    message: str


def local_image(path: Path, target: str) -> Path | None:
    parsed = urlparse(target)
    if parsed.scheme or target.startswith("//"):
        return None
    candidate = (path.parent / unquote(target)).resolve()
    try:
        candidate.relative_to(path.parent.resolve())
    except ValueError:
        return Path("")
    return candidate


def repeated_blocks(text: str) -> list[str]:
    blocks = [re.sub(r"\s+", " ", block).strip() for block in re.split(r"\n\s*\n", text)]
    seen: set[str] = set()
    duplicates: list[str] = []
    for block in blocks:
        if len(block) >= 80 and block in seen and block not in duplicates:
            duplicates.append(block[:60])
        seen.add(block)
    return duplicates


def unresolved_tbd_count(text: str) -> int:
    count = 0
    for line in text.splitlines():
        stripped = line.strip()
        if "待确认" not in stripped:
            continue
        if re.match(r"^#{1,6}\s*(?:\d+(?:\.\d+)*[.、]?\s*)?待确认事项\s*$", stripped):
            continue
        if re.search(r"(?:无|没有|不存在|不包含|未发现)[^。；\n]{0,12}待确认", stripped):
            continue
        count += stripped.count("待确认")
    return count


def validate(path: Path, require_no_tbd: bool) -> tuple[list[Issue], dict[str, int | str]]:
    issues: list[Issue] = []
    if not path.is_file():
        return [Issue("error", f"PRD 文件不存在：{path}")], {"errors": 1, "warnings": 0}
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [Issue("error", "PRD 必须为 UTF-8 Markdown 文件")], {"errors": 1, "warnings": 0}
    if not text.strip():
        issues.append(Issue("error", "PRD 文件为空"))

    headings = [line for line in text.splitlines() if HEADING_RE.match(line)]
    if not headings:
        issues.append(Issue("warning", "未发现 Markdown 标题；请确认文档便于研发定位信息"))
    if len(text.strip()) < 300:
        issues.append(Issue("warning", "正文较短；请人工复核是否足以支撑研发和测试"))

    found_stages = [stage for stage in DELIVERY_STAGES if stage in text]
    delivery_stage = found_stages[-1] if found_stages else "未标记"
    if not found_stages:
        issues.append(Issue("warning", "未标记交付阶段：需求草案、研发评审稿或研发基线"))
    elif len(set(found_stages)) > 1:
        issues.append(Issue("warning", f"发现多个交付阶段：{'、'.join(found_stages)}；请明确当前状态"))

    for pattern in PLACEHOLDER_PATTERNS:
        match = pattern.search(text)
        if match:
            issues.append(Issue("error", f"存在未替换占位内容，示例：{match.group(0)}"))
    for pattern in VAGUE_PATTERNS:
        if pattern.search(text):
            issues.append(Issue("warning", f"发现可能无法验收的模糊表述：{pattern.pattern}"))

    image_hashes: dict[str, list[str]] = {}
    image_count = 0
    for alt, target in IMAGE_RE.findall(text):
        image_count += 1
        if not alt.strip():
            issues.append(Issue("warning", f"图片缺少替代文本：{target}"))
        resolved = local_image(path, target)
        if resolved is None:
            issues.append(Issue("warning", f"图片使用网络地址，无法验证交付完整性：{target}"))
        elif not str(resolved):
            issues.append(Issue("error", f"图片路径跳出 PRD 所在目录：{target}"))
        elif not resolved.is_file():
            issues.append(Issue("error", f"图片文件不存在：{target}"))
        else:
            digest = hashlib.sha256(resolved.read_bytes()).hexdigest()
            image_hashes.setdefault(digest, []).append(target)
    for targets in image_hashes.values():
        if len(set(targets)) > 1:
            issues.append(Issue("warning", f"多个图片文件内容相同：{', '.join(sorted(set(targets)))}"))

    for block in repeated_blocks(text):
        issues.append(Issue("warning", f"发现重复正文，示例：{block}"))

    tbd_count = unresolved_tbd_count(text)
    if tbd_count:
        level = "error" if require_no_tbd else "warning"
        issues.append(Issue(level, f"文档包含 {tbd_count} 处未解决的“待确认”"))
        if delivery_stage == "研发基线":
            issues.append(Issue("warning", "研发基线仍有待确认项；需人工确认其不阻断页面、接口或核心业务实现"))

    issues.append(Issue("warning", "本脚本不验证页面、控件、接口或业务逻辑覆盖完整性；交付前必须对照输入材料人工/模型逐项复核"))
    stats: dict[str, int | str] = {
        "headings": len(headings),
        "images": image_count,
        "delivery_stage": delivery_stage,
        "errors": sum(item.level == "error" for item in issues),
        "warnings": sum(item.level == "warning" for item in issues),
    }
    return issues, stats


def main() -> int:
    parser = argparse.ArgumentParser(description="检查 Markdown PRD 的机械交付风险，不要求固定结构")
    parser.add_argument("prd", help="PRD Markdown 文件")
    parser.add_argument("--require-no-tbd", action="store_true", help="将未解决的待确认项视为错误")
    parser.add_argument("--warnings-as-errors", action="store_true", help="将警告作为失败")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()
    issues, stats = validate(Path(args.prd).resolve(), args.require_no_tbd)
    has_error = any(item.level == "error" for item in issues)
    has_warning = any(item.level == "warning" for item in issues)
    valid = not has_error and not (args.warnings_as_errors and has_warning)
    payload = {"valid": valid, "stats": stats, "issues": [item.__dict__ for item in issues]}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for item in issues:
            print(f"{item.level.upper()}: {item.message}")
        print(json.dumps(stats, ensure_ascii=False))
        if valid:
            print("OK: mechanical PRD checks passed; coverage review still required")
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())

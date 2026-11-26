#!/usr/bin/env python3
"""Validate generated requirement-spec Markdown output.

The checks are intentionally conservative. They catch common drift caused by
mixing requirement layers, but they do not try to prove product correctness.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


USER_STORY_BLACKLIST = [
    "顶部导航",
    "左侧菜单",
    "搜索区",
    "表格",
    "工具栏",
    "按钮",
    "图标按钮",
    "抽屉",
    "弹窗",
    "字段",
    "查询",
    "重置",
    "刷新",
    "列配置",
    "新建任务",
    "编辑",
    "删除",
    "任务配置",
    "点击",
    "跳转",
    "iframe",
    "外部工具",
    "系统名",
    "平台名",
    "菜单名",
    "接口名",
    "系统应",
]

LIST_REQUIRED_SECTIONS = [
    "### 1. 功能范围",
    "### 2. 页面内容",
    "### 3. 交互规则",
    "### 4. 业务规则",
    "### 5. 验收结果",
]


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


LAYER_HEADING_PATTERN = r"^##\s+(用户故事|功能需求[:：].*|研发需求[:：].*|研发需求名称)\s*$"


def layer_section_spans(text: str, heading_pattern: str) -> list[tuple[int, int, str]]:
    matches = list(re.finditer(heading_pattern, text, re.MULTILINE))
    all_layer_headings = list(re.finditer(LAYER_HEADING_PATTERN, text, re.MULTILINE))
    spans: list[tuple[int, int, str]] = []
    for match in matches:
        following = [heading.start() for heading in all_layer_headings if heading.start() > match.start()]
        end = following[0] if following else len(text)
        spans.append((match.start(), end, text[match.start() : end]))
    return spans


def add_issue(issues: list[str], text: str, offset: int, message: str) -> None:
    issues.append(f"line {line_number(text, offset)}: {message}")


def check_user_story(text: str, issues: list[str]) -> None:
    spans = layer_section_spans(text, r"^## 用户故事\s*$")
    for start, end, body in spans:
        next_layer = re.search(r"^## (功能需求|研发需求|研发需求名称)\b", body, re.MULTILINE)
        story_body = body[: next_layer.start()] if next_layer else body
        for term in USER_STORY_BLACKLIST:
            hit = story_body.find(term)
            if hit != -1:
                add_issue(issues, text, start + hit, f"用户故事包含手段或系统向表达：{term}")


def check_function_requirements(text: str, issues: list[str]) -> None:
    for start, end, body in layer_section_spans(text, r"^## 功能需求[:：].*$"):
        required = ["### 功能范围", "### 关键信息", "### 业务规则", "### 验收标准"]
        for heading in required:
            if heading not in body:
                add_issue(issues, text, start, f"功能需求缺少小节：{heading}")
        if "用户应能够" in body:
            add_issue(issues, text, start + body.find("用户应能够"), "功能需求 AC 不应使用用户故事验收主语")


def check_rd_requirements(text: str, issues: list[str]) -> None:
    for start, end, body in layer_section_spans(text, r"^## 研发需求[:：].*$"):
        if "### 需求描述" not in body:
            add_issue(issues, text, start, "常规研发需求缺少：### 需求描述")
        if "### 验收标准" not in body:
            add_issue(issues, text, start, "常规研发需求缺少：### 验收标准")
        if "> **公式**" in body or "【简要说明" in body:
            add_issue(issues, text, start, "常规研发需求仍包含模板公式或占位说明")
        for heading in LIST_REQUIRED_SECTIONS:
            if heading in body:
                add_issue(issues, text, start + body.find(heading), "常规研发需求混入产品研发需求清单五节结构")


def check_product_rd_lists(text: str, issues: list[str]) -> None:
    for start, end, body in layer_section_spans(text, r"^## 研发需求名称\s*$"):
        for heading in LIST_REQUIRED_SECTIONS:
            if heading not in body:
                add_issue(issues, text, start, f"产品研发需求清单缺少小节：{heading}")
        if "### 需求描述" in body or "### 数据与状态" in body:
            add_issue(issues, text, start, "产品研发需求清单混入常规研发需求结构")


def check_ac_numbering(text: str, issues: list[str]) -> None:
    ac_matches = list(re.finditer(r"^#{3,4}\s+AC(\d+)", text, re.MULTILINE))
    if not ac_matches:
        return
    for match in ac_matches:
        number = int(match.group(1))
        if number < 1:
            add_issue(issues, text, match.start(), "AC 编号必须从 1 开始")


def validate(text: str) -> list[str]:
    issues: list[str] = []
    check_user_story(text, issues)
    check_function_requirements(text, issues)
    check_rd_requirements(text, issues)
    check_product_rd_lists(text, issues)
    check_ac_numbering(text, issues)
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated requirement-spec Markdown.")
    parser.add_argument("markdown_file", help="Path to generated Markdown output")
    args = parser.parse_args()

    path = Path(args.markdown_file)
    if not path.exists():
        print(f"[ERROR] File not found: {path}", file=sys.stderr)
        return 2

    text = path.read_text(encoding="utf-8")
    issues = validate(text)
    if issues:
        print("[FAIL] Requirement output validation failed:")
        for issue in issues:
            print(f"- {issue}")
        return 1

    print("[OK] Requirement output validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

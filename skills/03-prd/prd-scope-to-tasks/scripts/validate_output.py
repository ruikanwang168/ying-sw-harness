#!/usr/bin/env python3
"""校验版本任务、功能清单的机械规则，不判断业务覆盖是否完整。"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


TASK_COLUMNS = ["用户故事", "任务描述", "任务详细说明", "变更类型", "人员角色", "人员", "预计工时"]
FUNCTION_COLUMNS = ["模块", "一级菜单", "二级菜单", "三级菜单", "功能描述", "功能说明", "变更类型"]
TITLES = {"任务拆分清单": "tasks", "本次版本全量功能清单": "functions"}
CHANGE_TYPES = {"新增", "修改", "删除"}
ROLES = {"前端", "后端", "测试"}


def cells(line: str) -> list[str]:
    return [cell.strip().replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip()[1:-1])]


def collect_rows(text: str, issues: list[str]) -> dict[str, list[tuple[int, list[str]]]]:
    rows: dict[str, list[tuple[int, list[str]]]] = {"tasks": [], "functions": []}
    current = None
    table = None
    fenced = False
    lines = text.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            fenced = not fenced
            continue
        if fenced:
            continue
        heading = re.fullmatch(r"#{1,2}\s+(.+?)\s*", stripped)
        if heading:
            current = TITLES.get(heading.group(1))
            table = None
            continue
        if not (stripped.startswith("|") and stripped.endswith("|")):
            table = None
            continue
        if current is None:
            continue
        values = cells(stripped)
        if all(re.fullmatch(r":?-{3,}:?", value) for value in values):
            continue
        if table is None:
            expected = TASK_COLUMNS if current == "tasks" else FUNCTION_COLUMNS
            table = current
            if values != expected:
                issues.append(f"第 {index + 1} 行：{current} 表头应为 {'、'.join(expected)}")
                table = "invalid"
            if index + 1 >= len(lines) or not all(
                re.fullmatch(r":?-{3,}:?", value)
                for value in cells(lines[index + 1])
            ):
                issues.append(f"第 {index + 1} 行：表头后缺少 Markdown 表格分隔行")
            continue
        if table == "invalid":
            continue
        if len(values) != 7:
            issues.append(f"第 {index + 1} 行：应有 7 列，实际为 {len(values)} 列")
            continue
        rows[table].append((index + 1, values))
    return rows


def identifiers(text: str, prefix: str) -> set[str]:
    return set(re.findall(rf"\b{prefix}-\d+\b", text))


def validate(text: str, only: str | None = None, allow_filled_estimates: bool = False) -> list[str]:
    issues: list[str] = []
    rows = collect_rows(text, issues)
    required = [only] if only else ["tasks", "functions"]
    for kind in required:
        if not rows[kind]:
            title = next(title for title, value in TITLES.items() if value == kind)
            issues.append(f"缺少有效的{title}数据行（空文档或只有表头不能通过）")
    if only and rows["functions" if only == "tasks" else "tasks"]:
        issues.append("单份交付模式中包含了另一份清单，请改用双清单模式校验")

    function_ids: set[str] = set()
    for number, row in rows["functions"]:
        if not all(row):
            issues.append(f"第 {number} 行：功能字段不得留空；没有菜单层级请写“无”")
        if row[6] not in CHANGE_TYPES:
            issues.append(f"第 {number} 行：功能变更类型只能为新增、修改、删除")
        found = identifiers(row[4], "F")
        if len(found) != 1:
            issues.append(f"第 {number} 行：功能描述须包含唯一的 F-数字 编号")
        if function_ids & found:
            issues.append(f"第 {number} 行：功能编号重复")
        function_ids.update(found)
        for label in ("现状", "本次变化"):
            if not re.search(rf"{label}[：:]\s*[^；;。\s]", row[5]):
                issues.append(f"第 {number} 行：功能说明缺少有效的“{label}”")

    task_ids: set[str] = set()
    used_functions: set[str] = set()
    dependencies: list[tuple[int, set[str]]] = []
    for number, row in rows["tasks"]:
        if not all(row[:5]):
            issues.append(f"第 {number} 行：任务前五列必须填写")
        if row[3] not in CHANGE_TYPES:
            issues.append(f"第 {number} 行：任务变更类型只能为新增、修改、删除")
        if row[4] not in ROLES:
            issues.append(f"第 {number} 行：人员角色只能为前端、后端、测试")
        if not allow_filled_estimates and (row[5] or row[6]):
            issues.append(f"第 {number} 行：人员与预计工时默认必须留空")
        found = identifiers(row[1], "T")
        if len(found) != 1:
            issues.append(f"第 {number} 行：任务描述须包含唯一的 T-数字 编号")
        if task_ids & found:
            issues.append(f"第 {number} 行：任务编号重复")
        task_ids.update(found)
        for label in ("关联功能", "本次工作内容", "验收要点", "依赖项"):
            if not re.search(rf"{label}[：:]\s*[^；;。\s]", row[2]):
                issues.append(f"第 {number} 行：任务详细说明缺少有效的“{label}”")
        association = re.search(r"关联功能[：:]([^；;]+)", row[2])
        referenced = identifiers(association.group(1), "F") if association else set()
        if not referenced:
            issues.append(f"第 {number} 行：关联功能须引用 F-数字 编号")
        used_functions.update(referenced)
        dependency = re.search(r"依赖项[：:]([^；;]+)", row[2])
        referenced_tasks = identifiers(dependency.group(1), "T") if dependency else set()
        if found & referenced_tasks:
            issues.append(f"第 {number} 行：任务不能依赖自身")
        dependencies.append((number, referenced_tasks))

    for number, referenced in dependencies:
        if missing := referenced - task_ids:
            issues.append(f"第 {number} 行：依赖任务不存在：{'、'.join(sorted(missing))}")
    if only is None and rows["tasks"] and rows["functions"]:
        if missing := used_functions - function_ids:
            issues.append(f"任务引用不存在的功能：{'、'.join(sorted(missing))}")
        if uncovered := function_ids - used_functions:
            issues.append(f"功能没有对应任务：{'、'.join(sorted(uncovered))}")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="校验本次版本任务拆分清单与功能清单")
    parser.add_argument("markdown_file", help="清单 Markdown 文件路径")
    parser.add_argument("--only", choices=("tasks", "functions"), help="仅校验指定的一份清单")
    parser.add_argument("--allow-filled-estimates", action="store_true", help="允许用户已明确提供的人员和工时")
    args = parser.parse_args()
    try:
        text = Path(args.markdown_file).read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        print(f"[错误] 无法读取文件：{exc}", file=sys.stderr)
        return 2
    issues = validate(text, args.only, args.allow_filled_estimates)
    if issues:
        print("[未通过] 清单机械校验：")
        for issue in issues:
            print(f"- {issue}")
        return 1
    print("[通过] 清单机械校验；业务范围、现状差异和任务粒度仍需对照材料复核。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

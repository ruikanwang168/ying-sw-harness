#!/usr/bin/env python3
"""用完整示例及损坏交付验证清单校验器。"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from validate_output import validate


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = (ROOT / "references/example.md").read_text(encoding="utf-8")
FUNCTION_TITLE = "## 本次版本全量功能清单"


class OutputValidationTests(unittest.TestCase):
    def test_complete_delivery_with_multiple_stories_and_shared_work(self):
        self.assertEqual(validate(EXAMPLE), [])

    def test_empty_or_header_only_delivery_is_rejected(self):
        for text in ("", "# 版本清单\n", "## 任务拆分清单\n| 用户故事 | 任务描述 | 任务详细说明 | 变更类型 | 人员角色 | 人员 | 预计工时 |\n| --- | --- | --- | --- | --- | --- | --- |\n"):
            with self.subTest(text=text):
                self.assertTrue(validate(text))

    def test_single_deliverable_requires_matching_mode(self):
        tasks, functions = EXAMPLE.split(FUNCTION_TITLE, 1)
        functions = FUNCTION_TITLE + functions
        self.assertTrue(validate(tasks))
        self.assertTrue(validate(functions))
        self.assertEqual(validate(tasks, only="tasks"), [])
        self.assertEqual(validate(functions, only="functions"), [])
        self.assertTrue(validate(EXAMPLE, only="tasks"))

    def test_role_and_change_type_cannot_be_merged(self):
        for before, after in (("| 修改 | 前端 |", "| 修改 | 前端/后端 |"), ("| 新增 | 后端 |", "| 新增/修改 | 后端 |")):
            with self.subTest(after=after):
                self.assertTrue(validate(EXAMPLE.replace(before, after, 1)))

    def test_unassigned_people_and_hours_are_blank_by_default(self):
        filled = EXAMPLE.replace("| 修改 | 前端 | | |", "| 修改 | 前端 | 张三 | 8 |", 1)
        self.assertTrue(validate(filled))
        self.assertEqual(validate(filled, allow_filled_estimates=True), [])

    def test_unresolved_change_type_is_not_a_confirmed_row(self):
        self.assertTrue(validate(EXAMPLE.replace("| 修改 | 前端 |", "| 待确认 | 前端 |", 1)))

    def test_details_need_actual_content_and_acceptance_and_dependencies(self):
        for before, after in (("本次工作内容：现有列表", "范围：现有列表"), ("验收要点：异常原因", "验收要点：；异常原因"), ("依赖项：无", "依赖项：")):
            with self.subTest(after=after):
                self.assertTrue(validate(EXAMPLE.replace(before, after, 1)))

    def test_missing_function_reference_and_uncovered_scope_are_rejected(self):
        self.assertTrue(validate(EXAMPLE.replace("F-001、F-002", "F-999", 1)))
        self.assertTrue(validate(EXAMPLE.replace("F-002 退款核对结果导出", "F-003 退款核对结果导出", 1)))

    def test_duplicate_estimation_rows_are_rejected(self):
        self.assertTrue(validate(EXAMPLE.replace("T-002 退款进度查询接口调整", "T-001 退款进度查询接口调整", 1)))
        self.assertTrue(validate(EXAMPLE.replace("F-002 退款核对结果导出", "F-001 退款核对结果导出", 1)))

    def test_missing_or_self_dependencies_are_rejected(self):
        for value in ("T-999", "T-002"):
            with self.subTest(value=value):
                text = EXAMPLE.replace("依赖项：无", f"依赖项：{value}", 1)
                self.assertTrue(validate(text))

    def test_existing_function_comparison_cannot_be_omitted(self):
        self.assertTrue(validate(EXAMPLE.replace("现状：支持查看", "说明：支持查看", 1)))
        self.assertTrue(validate(EXAMPLE.replace("本次变化：为客服", "本次变化：；为客服", 1)))

    def test_nonexistent_menu_level_can_be_explicitly_absent(self):
        self.assertEqual(validate(EXAMPLE), [])
        self.assertTrue(validate(EXAMPLE.replace("| 退款管理 | 无 | F-001", "| 退款管理 | | F-001", 1)))

    def test_extra_columns_and_broken_rows_are_rejected(self):
        self.assertTrue(validate(EXAMPLE.replace("| 人员 | 预计工时 |", "| 人员 | 预计工时 | 接口路径 |", 1)))
        self.assertTrue(validate(EXAMPLE.replace("| 修改 | 前端 | | |", "| 修改 | 前端 | |", 1)))

    def test_fenced_example_is_not_mistaken_for_real_delivery(self):
        self.assertTrue(validate("```markdown\n" + EXAMPLE + "\n```"))

    def test_cli_exit_codes_and_single_delivery_flags(self):
        script = ROOT / "scripts/validate_output.py"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "清单.md"
            path.write_text(EXAMPLE, encoding="utf-8")
            good = subprocess.run([sys.executable, str(script), str(path)], capture_output=True, text=True)
            self.assertEqual(good.returncode, 0, good.stdout + good.stderr)
            path.write_text(EXAMPLE.split(FUNCTION_TITLE, 1)[0], encoding="utf-8")
            single = subprocess.run([sys.executable, str(script), str(path), "--only", "tasks"], capture_output=True, text=True)
            self.assertEqual(single.returncode, 0, single.stdout + single.stderr)
            path.write_text("", encoding="utf-8")
            bad = subprocess.run([sys.executable, str(script), str(path)], capture_output=True, text=True)
            self.assertEqual(bad.returncode, 1)
            missing = subprocess.run([sys.executable, str(script), str(path.parent / "不存在.md")], capture_output=True, text=True)
            self.assertEqual(missing.returncode, 2)


if __name__ == "__main__":
    unittest.main()

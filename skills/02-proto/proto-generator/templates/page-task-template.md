---
last_updated: 2026-11-27
status: active
owner: ying
---

# Page Task Execution Template

> 用途：每次执行一个页面任务时使用。  
> 原则：本轮只生成一个页面或一个小模块。

---

## 1. Current Task

| Field | Content |
|---|---|
| Task ID |  |
| Function Module |  |
| Page Name |  |
| Page Type |  |
| Source Section |  |
| Source Type |  |
| Previous Page |  |
| Trigger Operation |  |
| Next Page |  |
| Core Components |  |
| Key Fields |  |
| Required Route | Yes / No |
| Suggested File Path |  |
| 工程与复用依据 | 实际工程根目录、布局、组件、样式及参考页面；独立模式可不填 |
| 路由与菜单接入 | 实际接入位置及方式 |
| 接口与 Mock 接入 | 现有接口封装、数据类型、Mock 配置及本次数据需求 |
| 验证命令与场景 | 适用工程检查命令，以及本任务关键交互 |
| Status Before Execution |  |

---

## 2. Execution Requirements

1. Only generate this page or small module.
2. Do not generate other pages not assigned to this task.
3. Ensure navigation from the previous page if needed.
4. Ensure navigation to the next page if needed.
5. Add or update route if required.
6. Add or update mock data if required.
7. Use placeholder content only when information is missing, and record it.
8. After generation, update `prototype-index.md`.
9. After generation, update `prototype-generation-log.md`.
10. 已有工程中沿用原技术栈、布局、样式和组件，不要求 design-system/、shared/ 或特定生成脚本。
11. 按现有接口封装与 Mock 机制补充模拟数据和交互，不另建并行 Mock 方案。
12. 执行适用工程检查，验证页面入口、导航和关键 Mock 交互，记录实际结果及未验证项。

---

## 3. Generated Result

| Item | Content |
|---|---|
| Generated files |  |
| Updated files |  |
| Routes added / updated |  |
| Components added / updated |  |
| Mock data added / updated |  |
| Run / preview status |  |
| 复用资源与接口接入 |  |
| 工程检查与 Mock 交互验证结果 | 实际命令、场景、结果及未验证项 |

---

## 4. Task Status Update

| Field | Content |
|---|---|
| New Status | Completed / Needs Fix / Needs Confirmation / Needs Input |
| Check Result |  |
| Notes |  |

---

## 5. Next Suggested Task

| Field | Content |
|---|---|
| Next Task ID |  |
| Next Page Name |  |
| Reason |  |

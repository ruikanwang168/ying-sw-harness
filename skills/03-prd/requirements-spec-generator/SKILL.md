---
name: requirements-spec-generator
description: 输出用户故事、功能需求、常规研发需求、产品研发需求清单。Use when the user asks for 用户故事、功能需求、研发需求、需求规格、研发需求清单、页面级需求、给前端/给开发/给研发落地。用户故事必须把页面、按钮、字段、系统名、集成方案抽象为业务价值；功能需求写产品能力；常规研发需求写系统处理、集成、状态、回写和数据落点；产品研发需求清单写页面/能力交付、字段、交互、业务规则和验收结果。给前端、页面、表单、列表、弹窗、抽屉、清单优先用产品研发需求清单；给后端、集成、接口协作、状态同步、回写、实现处理优先用常规研发需求；笼统“给开发”按输入内容判定，不明时短问一句。
---

# 需求规格生成器

## 任务目标

将功能想法、页面描述、业务痛点或集成方案转化为 **用户故事 → 功能需求 → 研发落地文档**。用户可只要其中一层或多层；研发落地有两种并列形态，按输入内容选择，勿混用结构：

| 层级 | 核心回答 | 模板 |
|------|----------|------|
| 用户故事 | 谁在什么场景下，**为什么**需要这个能力 | [assets/user-story-template.md](assets/user-story-template.md) |
| 功能需求 | 产品需要提供**什么功能**来满足用户故事 | [assets/functional-requirements-template.md](assets/functional-requirements-template.md) |
| 常规研发需求 | 功能在系统中**具体如何处理**（集成、状态、回写） | [assets/rd-requirements-template.md](assets/rd-requirements-template.md) |
| 产品研发需求清单 | 研发要交付什么**页面/能力**（字段、交互、规则） | [assets/product-rd-requirements-list-template.md](assets/product-rd-requirements-list-template.md) |

层级不明确、用户要多层输出或同时出现页面与集成细节时，先读 [references/requirements-layers.md](references/requirements-layers.md)。单层明确时只读对应模板和指南。

## 层级选择

1. **用户明确指定层级时，严格执行**：只要用户故事、只要功能需求、只要研发需求、只要清单、全套、三层等，不擅自增减。
2. **给前端 / 页面级 / 清单 / 表单 / 列表 / 弹窗 / 抽屉**：输出产品研发需求清单；若还要产品能力，先输出功能需求。
3. **给后端 / 给研发 / 集成 / 接口协作 / 状态同步 / 回写 / 具体实现处理**：输出常规研发需求；若没有功能需求基线，先补功能需求或关联用户提供的功能需求。
4. **笼统“给开发落地”**：按输入内容判断。页面字段交互为主用清单；系统处理与集成为主用常规研发需求；两者都有则分别输出；仍不明时短问一句。
5. **未指定层级**：业务痛点为主只输出用户故事；功能/页面/能力为主默认输出用户故事 + 功能需求；含集成或页面交付时按第 2、3、4 条升格。

完整决策树见 [references/requirements-layers.md](references/requirements-layers.md#默认输出策略)。

## 生成前必做

在输出正文前，内部完成这四步，不必把分析过程输出给用户，除非用户要求：

1. **核心诉求列表**：按独立用户角色、业务目标、业务结果识别一个或多个核心诉求；用户故事中默认不含产品名、模块名、页面名、按钮名、工具名。
2. **手段清单**：抽取页面、字段、按钮、菜单、跳转、iframe、外部工具、系统名、集成方案；标记为“不写入用户故事”。
3. **功能清单**：从产品视角拆成功能需求条目。
4. **实现边界**：集成/处理/状态/回写用常规研发需求；页面/表单/列表/交互用产品研发需求清单；两者都有则分别输出。

用户故事黑名单：顶部导航、左侧菜单、搜索区、表格、工具栏、按钮、图标按钮、抽屉、弹窗、字段、查询、重置、刷新、列配置、新建任务、编辑、删除、任务配置、点击、跳转、iframe、外部工具、系统名、平台名、菜单名、接口名、`系统应`。

若用户故事生成后仍依赖这些词才能成立，先改写为业务目标，再继续生成后续层级。

## 输出规则

### 用户故事

- 读 [assets/user-story-template.md](assets/user-story-template.md) 和 [references/user-story-guidelines.md](references/user-story-guidelines.md)。
- 写用户要获得的业务价值，验收主语用“用户应能够”。
- 先判断需要几条：单一业务目标输出 1 条；调研记录、会议纪要、需求清单等包含多个独立业务目标时，每个独立业务目标输出 1 条。
- 不按页面、按钮、字段、菜单、查询条件、表格列、跳转步骤拆用户故事；这些手段下放到功能需求或研发落地文档。

### 功能需求

- 读 [assets/functional-requirements-template.md](assets/functional-requirements-template.md) 和 [references/functional-requirements-guidelines.md](references/functional-requirements-guidelines.md)。
- 写产品提供什么能力，结构为 `## 功能需求：...` + 功能范围 + 关键信息 + 业务规则 + AC1-AC5。
- 不写接口协议、表结构、代码、算法；这些只在用户明确要求或常规研发需求中表达为行为规格。

### 常规研发需求

- 读 [assets/rd-requirements-template.md](assets/rd-requirements-template.md) 和 [references/rd-requirements-guidelines.md](references/rd-requirements-guidelines.md)。
- 结构为 `## 研发需求：...` + 关联功能需求 + 需求描述 + 可选数据与状态 + 验收标准。
- 需求描述先简要说明系统能力、覆盖范围、预期结果，再把关键处理写成“当...系统应根据...完成...并返回/展示/保存/更新...”。
- 不输出模板中的“公式”blockquote、撰写说明或占位符。

### 产品研发需求清单

- 读 [assets/product-rd-requirements-list-template.md](assets/product-rd-requirements-list-template.md) 和 [references/product-rd-requirements-list-guidelines.md](references/product-rd-requirements-list-guidelines.md)。
- 每个可交付页面、弹窗、抽屉或独立能力一条 `## 研发需求名称`，命名为“【模块/业务对象】-【页面/动作/能力】”。
- 验收标准固定为五节：功能范围、页面内容、交互规则、业务规则、验收结果。
- 页面能力描述不是用户故事，不要反向复制到用户故事。

## 资源加载

| 需要 | 读取 |
|------|------|
| 层级选择、边界冲突 | [references/requirements-layers.md](references/requirements-layers.md) |
| 用户故事 | [assets/user-story-template.md](assets/user-story-template.md), [references/user-story-guidelines.md](references/user-story-guidelines.md) |
| 功能需求 | [assets/functional-requirements-template.md](assets/functional-requirements-template.md), [references/functional-requirements-guidelines.md](references/functional-requirements-guidelines.md) |
| 常规研发需求 | [assets/rd-requirements-template.md](assets/rd-requirements-template.md), [references/rd-requirements-guidelines.md](references/rd-requirements-guidelines.md) |
| 产品研发需求清单 | [assets/product-rd-requirements-list-template.md](assets/product-rd-requirements-list-template.md), [references/product-rd-requirements-list-guidelines.md](references/product-rd-requirements-list-guidelines.md) |
| 复杂验收句式 | [references/ears-syntax.md](references/ears-syntax.md) |
| 端到端参照 | [references/examples.md](references/examples.md) |
| 维护回归测试 | [references/test-prompts.md](references/test-prompts.md) |
| 全量结构索引 | [assets/template.md](assets/template.md) |

## 输出前自检

生成后检查：

- 用户故事没有“系统应”、页面、按钮、字段、跳转、iframe、工具名、系统名。
- 功能需求不写接口、表结构、代码级实现。
- 常规研发需求不使用产品研发需求清单的五节页面结构。
- 产品研发需求清单不使用常规研发需求的“需求描述 + 数据与状态 + AC”结构。
- 多层输出按用户故事 → 功能需求 → 常规研发需求 / 产品研发需求清单的顺序组织，并保持后层关联前层。

若输出保存为 Markdown 文件，可运行：

```bash
python3 scripts/validate_output.py <output.md>
```

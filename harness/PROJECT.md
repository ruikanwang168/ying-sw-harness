---
last_updated: 2026-11-25
status: active
owner: ying
---

# 项目概览与技术基准

## 一、项目概述

`ying-sw-harness` 是按研发阶段组织的 AI Skill 集合，供 Codex、Claude Code 等智能体读取技能入口、条件加载参考文件并运行配套工具。当前有五个含 `SKILL.md` 的独立技能目录，覆盖需求分析、DDD 业务基线、研发规格 PRD、项目规则生成及 PRD 到执行计划。阶段分类目录本身不是独立 Skill，跨阶段的业务衔接不等于技能文件相互依赖。

可执行代码集中在两个 Skill 的 `scripts/`：PRD 盘点与机械校验，以及执行清单校验、续跑与状态维护。不存在应用服务启动入口；当前文件清单中未见统一依赖清单、构建配置、CI 或 lint/format/typecheck 配置。当前工作目录未初始化为 Git 仓库。

依据：各技能 `SKILL.md`、`skills/rule.md`、两个脚本目录及当前目录清单。根目录 `agents/` 和部分阶段目录为空，不代表已有代理配置或相应阶段功能。

## 二、核心技术栈

- Markdown：Skill 入口、规则、需求与实施说明；格式版本未声明，不自动替换已有业务结构。
- YAML：技能发现元信息和 Agent 界面配置；格式版本未声明。保留 `name`、`description` 和已有界面字段。
- Python 3：命令行工具与回归测试；本次核验环境为 3.13.3，项目未声明最低支持版本。所读五个脚本均使用标准库，不能把当前环境版本当成项目最低版本。
- Python `unittest`：执行清单跟踪器回归测试，版本随 Python 运行时。
- JSON / CSV：执行清单、接口契约和测试用例产物。当前执行清单 Schema 为 `1.6`，技术选型清单 Schema 为 `1.1`；接口契约由跟踪器检查为 OpenAPI `3.1.x`。
- 技术红线：技能目录自包含，不依赖其他 Skill 目录文件；跟踪 Schema、确认字段与状态语义的变更须与本技能说明、参考文件及脚本保持一致。不把被分析目标系统的数据库、框架或第三方服务当成本项目依赖。

## 三、核心架构与目录规约

以下层级来自实际目录。规则文件与研发资料位于项目根目录 `harness/`；Skill 自带的 `references/` 属于可复用技能的一部分，两者用途不同。

```text
ying-sw-harness/
├── AGENTS.md                         # Codex 主协作入口
├── CLAUDE.md                         # Claude Code 短指针入口
├── agents/                           # 当前为空，尚无代理配置
├── harness/
│   ├── PROJECT.md                    # 项目快照与技术约束
│   ├── USER_RULES.md                 # 用户维护，增量更新不覆盖
│   ├── AI_IGNORE.md                  # 用户维护，扫描前必读
│   ├── plan/                         # 按计划归档，目前为空
│   └── design/                       # 长期设计资料，目前为空
└── skills/
    ├── AGENTS.md                     # Skill 局部规则入口
    ├── CLAUDE.md                     # 既有 Claude Code 局部入口
    ├── rule.md                       # 所有 Skill 的编写标准
    ├── 01-disc/
    │   ├── disc-xuqiu/               # name 为 xuqiu-analyzer；需求澄清与 PRD
    │   │   ├── SKILL.md
    │   │   ├── README.md
    │   │   └── references/
    │   └── disc-ddd-analysis/         # DDD 新业务基线与增量说明
    │       ├── SKILL.md
    │       ├── agents/openai.yaml
    │       └── references/
    ├── 02-proto/                     # 当前为空
    ├── 03-prd/
    │   └── prd-gen/                  # 从材料、原型与代码形成研发规格
    │       ├── SKILL.md
    │       ├── agents/openai.yaml
    │       ├── references/
    │       └── scripts/
    │           ├── inventory_project.py  # 只读盘点；--output 显式写出 JSON
    │           └── validate_prd.py       # PRD 图片、占位与交付风险检查
    ├── 04-coding/
    │   ├── coding-airule-gen/        # name 为 airule-init；规则生成技能
    │   │   ├── SKILL.md
    │   │   └── references/           # 模板、增量迁移和写入检查
    │   └── coding-prd2plan/          # 分阶段确认并生成故事实施包
    │       ├── SKILL.md
    │       ├── agents/openai.yaml
    │       ├── references/           # 共享规则、续跑与各阶段规范
    │       └── scripts/
    │           ├── tracker.py       # validate / status / next / set
    │           ├── test_tracker.py  # 临时目录与 CLI 子进程回归测试
    │           └── build_catalog.py # 绑定特定外部材料的生成脚本
    ├── 05-qa/                        # 当前为空
    └── 06-uat/                       # 当前为空
```

`SKILL.md` 决定触发、边界与参考文件加载条件；`references/` 承载细节；`scripts/` 承载可重复执行的逻辑；`agents/openai.yaml` 提供显示名称和默认提示词。以入口元信息里的 `name` 为技能名，不根据文件夹名自动重命名。

`tracker.py` 以传入 JSON 所在目录为产物边界：`safe_artifact_path` 拒绝绝对路径、`..`、反斜线及解析后逃逸的路径。跟踪器关联确认 Markdown 的 SHA-256，检查故事依赖、操作/页面/接口引用、实施 Markdown、OpenAPI JSON 和测试 CSV。它不访问真实数据库或远程服务；OpenAPI 是交付契约文件，不是本仓库提供的在线 API。

`build_catalog.py` 在模块顶层读取写死的外部目录与需求文件并写出清单，且写死业务故事和时间。它不是通用 CLI，导入也会执行顶层逻辑；检查其源码即可，不把它列为默认运行、自动发现或验证入口。是否重构为可复用工具待确认。

## 四、代码规范与常用命令

Skill 编写以 `skills/rule.md` 为准：一个 Skill 解决一个明确问题，入口简洁，详细内容按条件加载；不要批量套用同一个业务输出模板。Python 主工具使用 `argparse`、`pathlib`、类型标注和 UTF-8 文件读写；这是现有风格，尚无统一格式化配置或行数门槛。

下列命令从项目根目录执行。尖括号是参数说明，实际执行时替换为本次真实路径，含空格的路径使用引号。依据为相应脚本的 CLI 定义、PRD 技能入口及 `tracker-and-resume.md`。

盘点用户指定项目（默认只输出到标准输出；使用前核对该目标的扫描边界，内置排除项不能替代自定义 AI_IGNORE）：

```bash
python3 skills/03-prd/prd-gen/scripts/inventory_project.py <项目目录>
```

检查 PRD（属于机械校验，仍须人工或智能体核对业务覆盖）：

```bash
python3 skills/03-prd/prd-gen/scripts/validate_prd.py <PRD.md>
```

校验、统计与续跑执行清单（均为读取操作）：

```bash
python3 skills/04-coding/coding-prd2plan/scripts/tracker.py validate <AI执行清单.json> --check-artifacts
python3 skills/04-coding/coding-prd2plan/scripts/tracker.py status <AI执行清单.json>
python3 skills/04-coding/coding-prd2plan/scripts/tracker.py next <AI执行清单.json> --phase plan
```

阶段 4 的实施包结构校验和直接开发语义核验均通过后，才可写入计划生成状态：

```bash
python3 skills/04-coding/coding-prd2plan/scripts/tracker.py set <AI执行清单.json> <故事ID> --field plan_generated --value true --check-artifacts
```

`set` 会写入目标清单，不作为规则初始化或测试环境探测命令；研发、自测状态只能由实际执行者依据结果维护。旧下游状态遇到过期计划时，按 `tracker-and-resume.md` 获取保留或重置的决定。

现有回归测试入口为 `test_tracker.py` 中的 `unittest.main()`：

```bash
python3 skills/04-coding/coding-prd2plan/scripts/test_tracker.py
```

修改跟踪器行为时运行该回归测试，并同步相关技能说明及参考文件；仅修改规则时核验元信息、链接、文件边界与项目事实，不为文案变更新增重复测试。当前未见 PRD 两个工具的独立测试文件；不声称已有统一 CI、覆盖率门槛或包管理安装命令。

## 五、硬性规则（必须遵守）

- S001 独立技能目录：每个交付 Skill 必须包含 `SKILL.md`；`agents/`、`references/`、`scripts/` 等均为可选项，不为凑结构机械创建空目录；检查：逐个核对含技能内容的目录与入口，阶段分类目录和根目录研发资料不按 Skill 验收；例外：无。
- S002 技能间依赖：独立 Skill 中的文件引用、脚本加载或导入不得依赖另一 Skill 目录中的文件；检查：定位相对链接、导入及文件读取路径，解析目标后确认仍在本技能目录内；对目标项目文件的业务输入读取不属于跨 Skill 依赖；例外：无。仓库级规则入口可引用 `skills/rule.md`。
- S003 参考加载：Skill 存在 `references/` 时，`SKILL.md` 必须写清每个参考文件的读取条件；检查：列出该 Skill 参考文件，逐一核对入口中的文件定位及对应场景，不接受只有“按需读取 references”的笼统说明；例外：无。
- S004 执行计划确认与状态：实际使用 `coding-prd2plan` 时，阶段 1、2、3 按其既有确认门推进；确认 Markdown 未 confirmed 或 hash 不一致时，不覆盖正式 JSON，不进入阶段 4；不得把 `plan_generated` 当作研发或自测完成；检查：按 `tracker-and-resume.md` 核对确认材料和状态含义，再运行 `tracker.py validate --check-artifacts` 检查结构与引用；语义就绪另按阶段 4 规范核验；例外：已确认且 hash 未变化的同一确认文档可按技能规定重新派生缺失或旧版 JSON，无需重复确认。

以上规则依据 `skills/rule.md`、`coding-prd2plan/SKILL.md` 及其 `tracker-and-resume.md`。修改人工规则时保留原适用范围和已有例外，不能用自动生成规则替换用户决定。

待确认：Python 最低支持版本和跨版本验证范围、Skill 发布/安装方式、是否为 PRD 工具补充独立测试、是否将 `build_catalog.py` 改为通用工具。已有规则入口和参考文档多数缺少 `last_updated/status/owner`，按待检查资料使用，不据此认定废弃或批量改写。

---
last_updated: 2026-11-27
status: active
owner: unassigned
---

# 原型同步差异契约

## 局部比对

`scripts/compare_frontend.mjs` 使用正式前端目录、原型目录和报告目录运行。它从正式前端的依赖解析 TypeScript，读取 `.ts`、`.tsx`、`.js`、`.jsx` 和 Vue SFC 的 script block，比较路由对象、常见 HTTP 客户端调用和 Vue 页面交互表面。

下面以用户管理为例。运行前将 `SKILL_DIR`、`FORMAL_FRONTEND`、`PROTOTYPE` 和 `REPO_ROOT` 指向实际目录，并根据源码将示例路径缩小到本轮需求的文件。

```bash
node "$SKILL_DIR/scripts/compare_frontend.mjs" \
  --source "$FORMAL_FRONTEND" \
  --prototype "$PROTOTYPE" \
  --output "$PROTOTYPE/prototype-sync" \
  --ignore-file "$REPO_ROOT/harness/AI_IGNORE.md" \
  --baseline "$PROTOTYPE/prototype-sync/accepted-baseline.json" \
  --scope apps/web-antd/src/views/system/user \
  --scope apps/web-antd/src/api/system/user/index.ts
```

每个 `--scope` 对应两侧同一个相对路径。目录包括子目录，文件精确匹配。路径使用 `/` 分隔。多次传参可覆盖页面、API、菜单、权限或模拟所需的几个路径。脚本跳过范围外的目录和文件。文件已在两侧移除时，仍可凭历史基线检查该路径。范围内没有可核对文件时，先检查相对路径和忽略规则。

`--ignore-file` 可省略或重复传入。它读取 `AI_IGNORE.md` 的“忽略列表”代码块，支持 `*`、`**`、`?`、`regex:` 和 `!`，模式相对于该文件声明的项目根目录。`--exclude` 可重复传入额外路径。依赖缓存、版本控制目录、凭据、本地环境文件及符号链接默认跳过。报告目录和基线文件也在扫描范围外。报告列出两端文件、静态路由、API 调用和 Vue 文件计数。使用 JavaScript 或缺少 TypeScript 依赖的项目，可以通过 `--typescript-root` 指定已安装 TypeScript 的工作区。

## 写入验收基线

- **新项目首次全量初始化**。使用 `--full` 代替所有 `--scope`。全量验收通过后附加 `--write-baseline`，创建 `accepted-baseline.json`。
- **已有原型局部验收**。保留比对时的 `--scope`，附加 `--write-baseline --accept apps/web-antd/src/api/system/user/index.ts`。每个 `--accept` 只接受一个已完整验收的文件，包括已核实删除的历史文件。JSON 保存两侧该路径的 SHA-256，某侧已删除时移除对应条目。其余文件维持原记录。共用文件内仍有其他需求的改动时，留待后续整文件验收。
- **已有原型缺少基线**。可按同一命令保存局部基线。`fullSnapshot: false` 和 `acceptedPaths` 记录历史覆盖范围，其他路径只比较当前两侧文件。`acceptedAt` 是最近一次写入的时间，局部写入不代表全工程已验收。

基线存在时保持两侧根目录及忽略配置一致。默认只生成报告，基线写入需要显式参数。基线已存在时，全量写入会拒绝执行。运行脚本后把实际纳入范围、验收结果和仍待处理的共享文件记入同步记录。

使用 `PROTOTYPE_SYNC_FRONTEND="$FORMAL_FRONTEND" node --test "$SKILL_DIR/scripts/compare_frontend.test.mjs"` 运行回归测试。指定目录需能解析 TypeScript。

## 报告字段

JSON 与 Markdown 报告写入指定输出目录。

- `scope`：本次模式、扫描路径和显式选择写入基线的路径
- `files.current.sourceOnly`：当前正式侧有、原型侧没有的路径
- `files.current.prototypeOnly`：当前原型侧有、正式侧没有的路径
- `files.current.changed`：两侧同路径但内容哈希不同
- `files.current.identical`：两侧当前内容相同
- `files.history.sourceAdded/sourceDeleted/sourceModified`：历史接受基线以来正式侧变化
- `files.history.prototypeAdded/prototypeDeleted/prototypeModified`：历史接受基线以来原型侧变化
- `files.history.untracked`：局部基线尚无历史记录的当前文件
- `files.history.conflicts`：两侧同路径均变化且结果不同，需逐段合并
- `files.history.aligned`：两侧均变化且结果哈希相同
- `routes`：两侧路由清单及差异，按同文件的路由名匹配，无名时用路径。比较路径、组件、重定向和元信息
- `apis`：两侧已识别调用清单及差异。先匹配同文件同调用函数内的相同调用，再匹配唯一的同端点或同调用函数剩余项。行号用于定位。`unresolved` 列出已识别但需要查证动态地址的调用点
- `surfaces.missingInPrototype`：正式 Vue 页面存在但原型同路径页面缺少的常见交互表面标记
- `manualReview`：必须人工核对的静态分析边界

结合页面和 API 的真实调用链，核对正式侧独有文件是否属于当前需求，以及应如何接入原型模拟。

## 静态识别范围

- 路由从 `router` 或 `routes` 目录的 TypeScript/JavaScript 对象中提取字符串 `path`、`name` 和 `component`。
- API 使用 TypeScript AST 识别常见 `requestClient`、`baseRequestClient`、`axios`、`http`、`httpClient`、`request` 方法调用和 `fetch`。报告记录方法、字符串/模板路径、调用函数、类型参数和实参源码。
- 请求包装器别名、动态反射、运行时拼接的 URL、服务端菜单及生成路由不一定能静态解析，必须从注册入口和浏览器行为补查。
- Vue 页面扫描弹窗、抽屉、文件、实时连接、iframe、权限、表单和表格的常见词/标签。这些仅是交互候选，不代表识别了所有控件或行为。

## 功能完整性验收矩阵

按正式前端实际实现的功能维护 `prototype-index.md` 与 `prototype-completeness-check.md`。首次覆盖全部模块。增量覆盖用户选定的功能及其受影响场景，只更新相关记录。

| 对象 | 必查项目 |
| --- | --- |
| 模块与页面 | 用户角色、路由、菜单可达、面包屑、页面主体、加载/空/错误状态、关联页面和返回路径 |
| 列表 | 搜索、筛选、分页、排序、列展示、刷新、行操作、批量操作和权限差异 |
| 表单 | 字段、默认值、必填、格式/范围/跨字段校验、提交、重复提交、取消和成功/失败反馈 |
| 详情与关联数据 | 全部重要字段、子表/关联数据、编辑入口、返回列表、刷新后状态和跳转 |
| 弹窗、抽屉和确认 | 触发入口、展示内容、确认、取消、校验、关闭方式、操作反馈和下一步 |
| API 与模拟器 | 每个调用点有处理器；参数和响应类型匹配；成功/失败/权限响应；持久化副作用；刷新回显 |
| 专用能力 | 文件选择/上传/下载/失败/取消、导入校验和结果、扫码、实时连接断开/重连、iframe 本地替代 |
| 隔离性 | 浏览器网络记录中没有业务后端请求；不会使用正式前端的凭据或真实用户数据；模拟数据可重置 |
| 验证 | 类型检查、已有测试、构建、本地启动、逐页浏览器操作和失败路径证据 |

每个场景记录入口、角色、前置数据、触发操作、期望状态、成功/失败/取消路径及验证证据。将 `implemented` 仅用于已实际运行验证的功能。静态发现标记为 `static-only`，未做完或失败标记为 `pending` 并记录原因。

## 不得直接覆盖的原型专用内容

请求适配层、模拟引擎、事件总线、种子数据、持久化结构和迁移、原型工作台、同步清单、验证脚本及原型独有页面均需保留。正式源文件中的同名实现不能直接覆盖原型实现。先说明差异及其行为影响，再将业务页面变化适配到原型层并复测。

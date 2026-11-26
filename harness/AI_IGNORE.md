---
last_updated: 2026-11-25
status: active
owner: ying
---

# AI 忽略规则

本文件由项目维护者手动维护，用于声明 AI 在扫描、总结、生成或更新规则时默认跳过的文件、目录和匹配模式。

所有匹配模式均相对于项目根目录解释，不相对于本文件所在的 `harness/` 目录。

`airule-init` 初始化时只创建本文件；后续增量更新不会自动修改或覆盖这里的内容。

## 写法

- 目录：`node_modules/`
- 文件或 glob：`*.log`、`dist/**`
- 正则：`regex:^tmp/.*\.json$`
- 允许读取例外：`!.env.example`

## 忽略列表

```gitignore
# 版本控制
.git/
.svn/
.hg/

# 依赖与缓存
node_modules/
vendor/
.venv/
venv/
__pycache__/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.cache/

# 构建产物与覆盖率
dist/
build/
out/
target/
coverage/
.next/
.nuxt/
.turbo/

# 日志与临时文件
*.log
logs/
tmp/
temp/

# 本地环境与敏感信息
.env
.env.*
*.pem
*.key
*.p12
*.secret*
secrets/

# 允许读取的模板或非敏感示例
!.env.example
!.env.template
```

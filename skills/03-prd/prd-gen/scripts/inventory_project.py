#!/usr/bin/env python3
"""Create a read-only inventory of likely frontend/backend evidence roots."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


EXCLUDED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".cache",
    "target",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
}

MANIFESTS = {
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Pipfile",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "go.mod",
    "Cargo.toml",
    "composer.json",
    "Gemfile",
}

LOCKFILE_MANAGERS = {
    "package-lock.json": "npm",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "bun.lockb": "bun",
    "bun.lock": "bun",
    "poetry.lock": "poetry",
    "Pipfile.lock": "pipenv",
    "uv.lock": "uv",
    "Cargo.lock": "cargo",
    "composer.lock": "composer",
    "Gemfile.lock": "bundler",
}

DOC_NAMES = {
    "readme.md",
    "readme.txt",
    "contributing.md",
    "development.md",
    "getting-started.md",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
}

ENTRY_NAMES = {
    "main.ts",
    "main.tsx",
    "main.js",
    "main.jsx",
    "app.ts",
    "app.tsx",
    "app.js",
    "app.jsx",
    "index.ts",
    "index.tsx",
    "index.js",
    "index.jsx",
    "manage.py",
    "wsgi.py",
    "asgi.py",
    "server.py",
    "main.py",
    "application.py",
}

CODE_SUFFIXES = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".vue",
    ".svelte",
    ".py",
    ".java",
    ".kt",
    ".kts",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".cs",
    ".scala",
    ".sql",
    ".graphql",
    ".gql",
}

CONFIG_SUFFIXES = {".json", ".yaml", ".yml", ".toml", ".xml"}

ROUTE_MARKERS = (
    "route",
    "router",
    "urls",
    "controller",
    "endpoint",
    "menu",
    "navigation",
)

MODEL_MARKERS = (
    "model",
    "entity",
    "schema",
    "migration",
    "enum",
    "permission",
    "policy",
    "guard",
)

FRONTEND_MARKERS = {"react", "vue", "nuxt", "@angular/core", "svelte", "solid-js", "vite"}
BACKEND_MARKERS = {"express", "nestjs", "@nestjs/core", "koa", "fastify", "@hapi/hapi"}
FULLSTACK_MARKERS = {"next", "nuxt"}


def rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix() or "."
    except ValueError:
        return str(path)


def is_code_or_config(path: Path) -> bool:
    return path.suffix.lower() in CODE_SUFFIXES | CONFIG_SUFFIXES


def project_kind(frameworks: set[str]) -> str:
    if frameworks & FULLSTACK_MARKERS:
        return "fullstack"
    has_frontend = bool(frameworks & FRONTEND_MARKERS)
    has_backend = bool(frameworks & BACKEND_MARKERS)
    if has_frontend and has_backend:
        return "fullstack"
    if has_frontend:
        return "frontend"
    if has_backend:
        return "backend"
    return "unknown"


def read_package_json(path: Path, root: Path, lockfiles: dict[Path, list[str]]) -> dict[str, Any]:
    relative = rel(path, root)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {"path": relative, "error": "无法解析 package.json"}
    dependencies: dict[str, Any] = {}
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        value = payload.get(key)
        if isinstance(value, dict):
            dependencies.update(value)
    frameworks = {
        name
        for name in FRONTEND_MARKERS | BACKEND_MARKERS | FULLSTACK_MARKERS
        if name in dependencies
    }
    scripts = payload.get("scripts") if isinstance(payload.get("scripts"), dict) else {}
    startup_scripts = {
        key: scripts[key]
        for key in ("dev", "start", "serve", "preview", "build")
        if key in scripts and isinstance(scripts[key], str)
    }
    managers = sorted(set(lockfiles.get(path.parent, [])))
    return {
        "path": relative,
        "project_root": rel(path.parent, root),
        "name": payload.get("name"),
        "private": payload.get("private"),
        "kind": project_kind(frameworks),
        "framework_markers": sorted(frameworks),
        "package_managers": managers,
        "startup_scripts": startup_scripts,
    }


def inventory(root: Path, max_files: int) -> dict[str, Any]:
    root = root.resolve()
    result: dict[str, Any] = {
        "root": str(root),
        "exists": root.exists(),
        "is_directory": root.is_dir(),
        "git_repository": (root / ".git").exists(),
        "files_scanned": 0,
        "truncated": False,
        "project_boundaries": [],
        "manifests": [],
        "lockfiles": [],
        "documentation": [],
        "source_directories": [],
        "entry_candidates": [],
        "route_candidates": [],
        "model_permission_candidates": [],
        "environment_examples": [],
        "environment_local_files": [],
        "package_projects": [],
        "warnings": [],
    }
    if not root.is_dir():
        return result

    manifests: list[Path] = []
    lockfiles_by_dir: dict[Path, list[str]] = {}
    source_dirs: set[str] = set()

    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS and not d.startswith(".tmp"))
        current_path = Path(current)
        for filename in sorted(files):
            result["files_scanned"] += 1
            if result["files_scanned"] > max_files:
                result["truncated"] = True
                dirs[:] = []
                break

            path = current_path / filename
            lowered = filename.lower()
            relative = rel(path, root)

            if filename in MANIFESTS:
                manifests.append(path)
                result["manifests"].append(relative)
                result["project_boundaries"].append(rel(path.parent, root))
            if filename in LOCKFILE_MANAGERS:
                result["lockfiles"].append(relative)
                lockfiles_by_dir.setdefault(path.parent, []).append(LOCKFILE_MANAGERS[filename])
            if lowered in DOC_NAMES or lowered.startswith("readme"):
                result["documentation"].append(relative)

            if path.suffix.lower() in CODE_SUFFIXES:
                relative_path = Path(relative)
                source_dirs.add(relative_path.parts[0] if len(relative_path.parts) > 1 else ".")
            if filename in ENTRY_NAMES and path.suffix.lower() in CODE_SUFFIXES:
                result["entry_candidates"].append(relative)
            if is_code_or_config(path) and any(marker in lowered for marker in ROUTE_MARKERS):
                result["route_candidates"].append(relative)
            if is_code_or_config(path) and any(marker in lowered for marker in MODEL_MARKERS):
                result["model_permission_candidates"].append(relative)

            if lowered.startswith(".env"):
                if any(token in lowered for token in ("example", "sample", "template")):
                    result["environment_examples"].append(relative)
                else:
                    result["environment_local_files"].append(relative)
        if result["truncated"]:
            break

    for path in manifests:
        if path.name == "package.json":
            result["package_projects"].append(read_package_json(path, root, lockfiles_by_dir))

    result["source_directories"] = sorted(source_dirs)
    for key in (
        "project_boundaries",
        "manifests",
        "lockfiles",
        "documentation",
        "entry_candidates",
        "route_candidates",
        "model_permission_candidates",
        "environment_examples",
        "environment_local_files",
    ):
        result[key] = sorted(set(result[key]))

    if result["truncated"]:
        result["warnings"].append(f"扫描超过 {max_files} 个文件，结果已截断")
    if len(result["project_boundaries"]) > 1:
        result["warnings"].append("发现多个项目边界，需要用户确认分析范围")
    if result["package_projects"] and not result["lockfiles"]:
        result["warnings"].append("发现 Node.js 项目但没有锁文件，不应直接选择包管理器或安装依赖")
    if not result["documentation"]:
        result["warnings"].append("没有发现启动说明，运行项目前需要确认命令和依赖")
    if result["environment_local_files"]:
        result["warnings"].append("发现本地环境文件；只确认变量名和用途，不读取或输出密钥值")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="只读盘点 PRD 分析所需的项目依据入口")
    parser.add_argument("paths", nargs="+", help="一个或多个项目目录")
    parser.add_argument("--output", help="将 JSON 写入文件；默认输出到 stdout")
    parser.add_argument("--max-files", type=int, default=12000, help="每个目录最多扫描文件数")
    args = parser.parse_args()

    payload = {"projects": [inventory(Path(item), args.max_files) for item in args.paths]}
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0 if all(item["exists"] and item["is_directory"] for item in payload["projects"]) else 2


if __name__ == "__main__":
    raise SystemExit(main())

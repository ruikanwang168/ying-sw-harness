#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, rename, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

const IGNORED_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'dist', 'coverage', '.turbo',
  '.cache', '.codebase-memory', '.pnpm', 'secrets',
]);
const IGNORED_FILE = /(^|\/)(\.DS_Store|\.env(?:\..*)?|.*\.log|.*\.(pem|key|p12|secret[^/]*))$/i;
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue']);

function parseArgs(values) {
  const parsed = { ignoreFiles: [], excludes: [], scopes: [], accepted: [] };
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key = token.slice(2);
    if (key === 'write-baseline') {
      parsed.writeBaseline = true;
      continue;
    }
    if (key === 'full') {
      parsed.full = true;
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
    index += 1;
    if (key === 'ignore-file') parsed.ignoreFiles.push(value);
    else if (key === 'exclude') parsed.excludes.push(value);
    else if (key === 'scope') parsed.scopes.push(value);
    else if (key === 'accept') parsed.accepted.push(value);
    else if (['source', 'prototype', 'output', 'baseline', 'typescript-root'].includes(key)) parsed[key] = value;
    else throw new Error(`无法识别参数：${token}`);
  }
  return parsed;
}

function relativePaths(values) {
  return [...new Set(values.map((value) => {
    const path = value.replace(/\/+$/, '');
    if (!path || /[\\:*?]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('请使用相对于前端根目录的文件或目录路径：' + value);
    }
    return path;
  }))].sort();
}

function includesPath(scopes, path) {
  return scopes.length === 0 || scopes.some((scope) => path === scope || path.startsWith(scope + '/'));
}

function globRegex(pattern) {
  const normalized = pattern.replaceAll('\\', '/').replace(/^\//, '');
  let body = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      index += 1;
      if (normalized[index + 1] === '/') {
        index += 1;
        body += '(?:.*/)?';
      } else body += '.*';
    } else if (character === '*') body += '[^/]*';
    else if (character === '?') body += '[^/]';
    else body += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  const hasSlash = normalized.includes('/');
  return new RegExp(hasSlash ? `^${body}$` : `(?:^|/)${body}$`);
}

async function readIgnorePatterns(paths) {
  const rules = [];
  for (const path of paths) {
    const ignorePath = await realpath(resolve(path));
    const contents = await readFile(ignorePath, 'utf8');
    const section = contents.split(/^## 忽略列表\s*$/m)[1] || '';
    const block = section.match(/```(?:gitignore)?\s*\n([\s\S]*?)\n```/);
    if (!block) throw new Error(`未找到“忽略列表”代码块：${ignorePath}`);
    const baseRoot = dirname(ignorePath).split(sep).at(-1) === 'harness'
      ? resolve(dirname(ignorePath), '..')
      : dirname(ignorePath);
    for (const raw of block[1].split(/\r?\n/)) {
      const pattern = raw.trim();
      if (!pattern || pattern.startsWith('#')) continue;
      rules.push({ baseRoot, pattern });
    }
  }
  return rules;
}

function compileIgnoreRules(rules) {
  return rules.map(({ baseRoot, pattern }) => {
    const negated = pattern.startsWith('!');
    const body = negated ? pattern.slice(1) : pattern;
    return {
      baseRoot,
      negated,
      matcher: body.startsWith('regex:') ? new RegExp(body.slice(6)) : globRegex(body.replace(/\/$/, '')),
    };
  });
}

function isIgnored(path, absolute, rules) {
  let ignored = IGNORED_FILE.test(path);
  for (const { baseRoot, negated, matcher } of rules) {
    const projectPath = relative(baseRoot, absolute).split(sep).join('/');
    if (!projectPath.startsWith('../') && projectPath !== '..' && matcher.test(projectPath)) ignored = !negated;
  }
  return ignored;
}

async function walk(root, current, rules, excluded, scopes) {
  const entries = await readdir(current, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    const rel = relative(root, absolute).split(sep).join('/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!includesPath(scopes, rel) && !scopes.some((scope) => scope.startsWith(rel + '/'))) continue;
      if (IGNORED_DIRS.has(entry.name) || excluded.has(rel)) continue;
      if (!isIgnored(rel, absolute, rules)) result.push(...await walk(root, absolute, rules, excluded, scopes));
    } else if (entry.isFile() && includesPath(scopes, rel) && !excluded.has(rel) && !isIgnored(rel, absolute, rules)) {
      result.push({ absolute, relative: rel });
    }
  }
  return result;
}

function loadTypeScript(sourceRoot) {
  const require = createRequire(resolve(sourceRoot, 'package.json'));
  try {
    return require('typescript');
  } catch {
    throw new Error(`无法从正式前端解析 TypeScript。请确认其依赖已安装：${sourceRoot}`);
  }
}

function textOf(node, file) {
  return node ? node.getText(file) : '';
}

function staticString(node, ts) {
  if (!node) return '';
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `\${${span.expression.getText()}}${span.literal.text}`).join('');
  }
  return '';
}

function functionName(node, ts) {
  let parent = node.parent;
  while (parent) {
    if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name) return parent.name.getText();
    if (ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText();
    parent = parent.parent;
  }
  return '';
}

function extractApis(source, path, ts, unresolved) {
  const apis = [];
  const clients = new Set(['requestClient', 'baseRequestClient', 'axios', 'http', 'httpClient', 'request']);
  const methods = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'upload', 'download']);
  const scripts = path.endsWith('.vue')
    ? [...source.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi)].map((match) => ({
      code: match[2],
      lineOffset: source.slice(0, match.index + match[1].length).split('\n').length - 1,
      kind: /\blang=["'](?:tsx|jsx)["']/.test(match[1]) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    }))
    : [{ code: source, lineOffset: 0 }];
  for (const { code, lineOffset, kind } of scripts) {
    const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, kind);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        let method = '';
        let client = '';
        let urlNode = node.arguments[0];
        if (ts.isPropertyAccessExpression(node.expression)) {
          client = node.expression.expression.getText(file);
          method = node.expression.name.text.toLowerCase();
          if (!clients.has(client) || (!methods.has(method) && method !== 'request')) method = '';
        } else if (ts.isIdentifier(node.expression)) {
          client = node.expression.text;
          if (client === 'fetch') method = 'get';
          if (client === 'axios' || client === 'request') method = 'request';
        }
        const config = client === 'fetch' ? node.arguments[1] : method === 'request' ? urlNode : null;
        if (config && ts.isObjectLiteralExpression(config)) {
          const properties = objectProperties(config, file, ts);
          method = staticString(properties.get('method'), ts).toLowerCase() || method;
          if (client !== 'fetch') urlNode = properties.get('url');
        }
        if (method) {
          const url = staticString(urlNode, ts);
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + lineOffset + 1;
          const name = functionName(node, ts);
          if (url) {
            apis.push({
              method, path: url.split('?')[0], url, client, functionName: name, line,
              typeArguments: (node.typeArguments || []).map((item) => item.getText(file)),
              arguments: node.arguments.map((item) => item.getText(file)),
              file: path,
            });
          }
          if (!url || url.includes('${')) unresolved.push({ file: path, line, method, client });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return apis;
}

function objectProperties(node, file, ts) {
  return new Map(node.properties.filter(ts.isPropertyAssignment).map((item) => [
    item.name.getText(file).replace(/^['"]|['"]$/g, ''), item.initializer,
  ]));
}

function extractRoutes(source, path, ts) {
  if (path.endsWith('.vue') || !/(^|\/)(router|routes)(\/|$)/i.test(path)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const routes = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = objectProperties(node, file, ts);
      const routePath = staticString(properties.get('path'), ts);
      if (routePath) routes.push({
        path: routePath,
        name: staticString(properties.get('name'), ts),
        component: textOf(properties.get('component'), file),
        meta: textOf(properties.get('meta'), file),
        redirect: textOf(properties.get('redirect'), file),
        file: path,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return routes;
}

function extractSurfaces(source, path) {
  if (!/\.vue$/.test(path)) return [];
  const patterns = [
    ['dialog', /\b(?:dialog|modal|drawer|side.?panel|confirm)\b/i],
    ['file', /\b(?:upload|download|import|export|preview)\b/i],
    ['realtime', /\b(?:websocket|eventsource|sse|broadcastchannel)\b/i],
    ['iframe', /\biframe\b/i],
    ['permission', /\b(?:hasAccess|v-access|permission)\b/i],
    ['form', /<(?:a-)?form\b|<n-form\b/i],
    ['table', /<(?:a-)?table\b|<n-data-table\b/i],
  ];
  return patterns.filter(([, pattern]) => pattern.test(source)).map(([kind]) => ({ kind, file: path }));
}

async function collect(root, ts, rules, excluded, scopes) {
  const files = await walk(root, root, rules, excluded, scopes);
  const hashes = Object.create(null);
  const routes = [];
  const apis = [];
  const surfaces = [];
  const unresolved = [];
  for (const item of files) {
    const content = await readFile(item.absolute);
    hashes[item.relative] = createHash('sha256').update(content).digest('hex');
    if (!CODE_EXTENSIONS.has(extname(item.relative))) continue;
    const source = content.toString('utf8');
    routes.push(...extractRoutes(source, item.relative, ts));
    apis.push(...extractApis(source, item.relative, ts, unresolved));
    surfaces.push(...extractSurfaces(source, item.relative));
  }
  return { hashes, routes, apis, surfaces, unresolved };
}

function inventory(project, routes) {
  const paths = Object.keys(project.hashes);
  return {
    files: paths.length,
    routes: routes.length,
    apis: project.apis.length,
    pages: paths.filter((path) => path.endsWith('.vue')).length,
    pagesWithDetectedSurfaces: new Set(project.surfaces.map((item) => item.file)).size,
  };
}

function unique(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

function objectsDiff(source, prototype, key) {
  const sourceMap = new Map(source.map((item) => [key(item), item]));
  const prototypeMap = new Map(prototype.map((item) => [key(item), item]));
  return {
    added: source.filter((item) => !prototypeMap.has(key(item))),
    missingInSource: prototype.filter((item) => !sourceMap.has(key(item))),
    changed: source.filter((item) => prototypeMap.has(key(item)) && JSON.stringify(item) !== JSON.stringify(prototypeMap.get(key(item)))).map((item) => ({ source: item, prototype: prototypeMap.get(key(item)) })),
  };
}

function compareApis(source, prototype) {
  const caller = (item) => JSON.stringify([item.file, item.functionName]);
  const signature = ({ line, ...item }) => JSON.stringify(item);
  const endpoint = (item) => JSON.stringify([caller(item), item.method, item.path]);
  const changed = [];
  function pairUnique(left, right, key) {
    const group = (items) => {
      const groups = new Map();
      for (const item of items) {
        const id = key(item);
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(item);
      }
      return groups;
    };
    const leftGroups = group(left);
    const rightGroups = group(right);
    const matched = new Set();
    for (const [id, items] of leftGroups) {
      const others = rightGroups.get(id);
      if (items.length !== 1 || others?.length !== 1) continue;
      changed.push({ source: items[0], prototype: others[0] });
      matched.add(id);
    }
    return [left.filter((item) => !matched.has(key(item))), right.filter((item) => !matched.has(key(item)))];
  }

  const exactMatches = new Map();
  for (const item of prototype) {
    const id = signature(item);
    exactMatches.set(id, (exactMatches.get(id) || 0) + 1);
  }
  const sourceRemaining = source.filter((item) => {
    const id = signature(item);
    const count = exactMatches.get(id);
    if (!count) return true;
    exactMatches.set(id, count - 1);
    return false;
  });
  const prototypeRemaining = prototype.filter((item) => {
    const id = signature(item);
    const count = exactMatches.get(id);
    if (!count) return false;
    exactMatches.set(id, count - 1);
    return true;
  });
  const [sourceUnpaired, prototypeUnpaired] = pairUnique(sourceRemaining, prototypeRemaining, endpoint);
  const [added, missingInSource] = pairUnique(sourceUnpaired, prototypeUnpaired, caller);
  return { added, missingInSource, changed };
}

function currentFileDiff(source, prototype) {
  const paths = [...new Set([...Object.keys(source), ...Object.keys(prototype)])].sort();
  return {
    sourceOnly: paths.filter((path) => source[path] && !prototype[path]),
    prototypeOnly: paths.filter((path) => prototype[path] && !source[path]),
    changed: paths.filter((path) => source[path] && prototype[path] && source[path] !== prototype[path]),
    identical: paths.filter((path) => source[path] && source[path] === prototype[path]),
  };
}

function historicalDiff(baseline, source, prototype, scopes) {
  const changes = {
    sourceAdded: [], sourceDeleted: [], sourceModified: [],
    prototypeAdded: [], prototypeDeleted: [], prototypeModified: [],
    untracked: [], conflicts: [], aligned: [],
  };
  const paths = new Set([...Object.keys(baseline.files.source), ...Object.keys(baseline.files.prototype), ...Object.keys(source), ...Object.keys(prototype)]);
  const previouslyAccepted = new Set(baseline.acceptedPaths || []);
  function record(side, path, previous, current) {
    if (previous === current) return false;
    const change = previous === undefined ? 'Added' : current === undefined ? 'Deleted' : 'Modified';
    changes[side + change].push(path);
    return true;
  }
  for (const path of [...paths].sort()) {
    if (!includesPath(scopes, path)) continue;
    if (baseline.fullSnapshot === false && !previouslyAccepted.has(path)) {
      changes.untracked.push(path);
      continue;
    }
    const previousSource = Object.hasOwn(baseline.files.source, path) ? baseline.files.source[path] : undefined;
    const previousPrototype = Object.hasOwn(baseline.files.prototype, path) ? baseline.files.prototype[path] : undefined;
    const sourceChanged = record('source', path, previousSource, source[path]);
    const prototypeChanged = record('prototype', path, previousPrototype, prototype[path]);
    if (sourceChanged && prototypeChanged) changes[source[path] === prototype[path] ? 'aligned' : 'conflicts'].push(path);
  }
  return changes;
}

function acceptedSnapshot(baseline, source, prototype, accepted, full) {
  if (full) return { fullSnapshot: true, files: { source, prototype } };
  const fullSnapshot = Boolean(baseline && baseline.fullSnapshot !== false);
  const files = {};
  for (const [side, current] of Object.entries({ source, prototype })) {
    const hashes = new Map(Object.entries(baseline?.files[side] || {}));
    for (const path of accepted) {
      if (Object.hasOwn(current, path)) hashes.set(path, current[path]);
      else hashes.delete(path);
    }
    files[side] = Object.fromEntries(hashes);
  }
  return fullSnapshot
    ? { fullSnapshot, files }
    : { fullSnapshot, files, acceptedPaths: [...new Set([...(baseline?.acceptedPaths || []), ...accepted])].sort() };
}

function relativeExcludes(root, paths) {
  const result = new Set();
  for (const path of paths) {
    const absolute = resolve(path);
    const rel = relative(root, absolute);
    if (rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) result.add(rel.split(sep).join('/'));
  }
  return result;
}

function within(path, root) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

async function canonical(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return resolve(await canonical(dirname(path)), relative(dirname(path), path));
  }
}

function markdown(report) {
  const api = (item) => `- \`${item.method.toUpperCase()} ${item.path}\`（${item.file}，${item.functionName || '未知调用点'}）`;
  const route = (item) => `- \`${item.path}\` ${item.name || ''}（${item.file}）`;
  const sections = [
    ['当前正式侧独有文件', report.files.current.sourceOnly],
    ['当前原型侧独有文件（可能是原型专用内容）', report.files.current.prototypeOnly],
    ['当前同路径内容不一致', report.files.current.changed],
    ['历史基线以来正式侧新增', report.files.history?.sourceAdded || []],
    ['历史基线以来正式侧删除', report.files.history?.sourceDeleted || []],
    ['历史基线以来正式侧修改', report.files.history?.sourceModified || []],
    ['历史基线以来原型侧新增', report.files.history?.prototypeAdded || []],
    ['历史基线以来原型侧删除', report.files.history?.prototypeDeleted || []],
    ['历史基线以来原型侧修改', report.files.history?.prototypeModified || []],
    ['没有历史验收记录的文件', report.files.history?.untracked || []],
    ['两侧并行变更冲突', report.files.history?.conflicts || []],
    ['两侧已收敛相同内容', report.files.history?.aligned || []],
    ['正式侧路由新增候选', report.routes.added, route],
    ['原型有而正式侧没有的路由', report.routes.missingInSource, route],
    ['路由同键差异', report.routes.changed, (item) => `- source \`${item.source.path}\` ${item.source.component || '无组件'}；prototype \`${item.prototype.path}\` ${item.prototype.component || '无组件'}`],
    ['正式侧 API 新增候选', report.apis.added, api],
    ['原型有而正式侧没有的 API', report.apis.missingInSource, api],
    ['API 同调用点签名差异', report.apis.changed, (item) => `- source \`${item.source.method.toUpperCase()} ${item.source.path}\`（${item.source.file}:${item.source.line}）prototype \`${item.prototype.method.toUpperCase()} ${item.prototype.path}\`（${item.prototype.file}:${item.prototype.line}）`],
    ['正式页面中原型缺少的交互表面候选', report.surfaces.missingInPrototype, (item) => `- ${item.kind}（${item.file}）`],
    ['正式侧待核对的动态请求地址', report.apis.unresolved.source, (item) => `- ${item.client}.${item.method}（${item.file}:${item.line}）`],
    ['静态检查限制与人工复核', report.manualReview],
  ];
  return [
    '# 前端与 prototype-starter 差异报告', '',
    `生成时间：${report.generatedAt}`,
    `正式前端：${report.sourceRoot}`,
    `原型工程：${report.prototypeRoot}`,
    `历史基线：${report.baseline ? report.baseline.acceptedAt : '未提供，仅报告当前状态'}`,
    `本次扫描范围：${report.scope.mode === 'full' ? '全量' : report.scope.paths.join('、')}`,
    `清单计数：正式端 ${report.inventory.source.files} 文件、${report.inventory.source.routes} 静态路由、${report.inventory.source.apis} API 调用、${report.inventory.source.pages} Vue 页面（${report.inventory.source.pagesWithDetectedSurfaces} 个含交互标记）；原型端 ${report.inventory.prototype.files} 文件、${report.inventory.prototype.routes} 静态路由、${report.inventory.prototype.apis} API 调用、${report.inventory.prototype.pages} Vue 页面（${report.inventory.prototype.pagesWithDetectedSurfaces} 个含交互标记）`,
    '',
    ...sections.map(([title, values, render = (value) => `- ${value}`]) => `## ${title}\n\n${values.length ? values.map(render).join('\n') : '无'}\n`),
  ].join('\n');
}

async function writeAtomically(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { flag: 'wx' });
  await rename(temporary, path);
}

function json(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

async function readBaseline(path, sourceRoot, prototypeRoot, ignoreRules, extraExcludes) {
  if (!path) return null;
  try {
    const baseline = JSON.parse(await readFile(path, 'utf8'));
    if (baseline.version !== 1 || baseline.sourceRoot !== sourceRoot || baseline.prototypeRoot !== prototypeRoot) {
      throw new Error('基线版本或源/原型路径与本次输入不匹配。请检查 --baseline 路径。');
    }
    if (JSON.stringify(baseline.ignoreRules) !== JSON.stringify(ignoreRules) ||
        JSON.stringify(baseline.extraExcludes) !== JSON.stringify(extraExcludes)) {
      throw new Error('忽略规则与历史基线不同。请核对忽略范围，保留已有验收记录。');
    }
    return baseline;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.prototype || !args.output) {
    throw new Error('用法：node compare_frontend.mjs --source <正式前端> --prototype <原型> --output <报告目录> (--scope <相对路径>... | --full) [--baseline <JSON>] [--write-baseline --accept <文件>...]');
  }
  const scopes = relativePaths(args.scopes);
  const accepted = relativePaths(args.accepted);
  if (Boolean(args.full) === Boolean(scopes.length)) {
    throw new Error('请指定 --scope <文件或目录>。首次初始化的全量检查使用 --full。');
  }
  if ((!args.writeBaseline || args.full) && accepted.length) {
    throw new Error('--accept 仅用于按范围写入基线。');
  }
  if (args.writeBaseline && !args.full && (!accepted.length || accepted.some((path) => !includesPath(scopes, path)))) {
    throw new Error('局部基线写入需要用 --accept 逐个指定扫描范围内已验收的文件。');
  }
  const [sourceRoot, prototypeRoot, output, baselinePath] = await Promise.all([
    realpath(resolve(args.source)),
    realpath(resolve(args.prototype)),
    canonical(resolve(args.output)),
    args.baseline ? canonical(resolve(args.baseline)) : '',
  ]);
  if (within(sourceRoot, prototypeRoot)) throw new Error('请使用不同的正式前端与原型目录。');
  if (within(prototypeRoot, output) || within(sourceRoot, output)) {
    throw new Error('报告目录应使用原型下的专用子目录或独立目录。');
  }
  for (const path of [output, baselinePath].filter(Boolean)) {
    if (within(path, sourceRoot) && !within(path, prototypeRoot)) throw new Error('输出位置落在正式前端中：' + path);
  }
  const reportPaths = ['diff-report.json', 'diff-report.md'].map((filename) => resolve(output, filename));
  if (reportPaths.includes(baselinePath)) throw new Error('基线路径与报告文件名冲突。');
  if (args.writeBaseline && !baselinePath) throw new Error('--write-baseline 需要同时指定 --baseline <json>');
  const ignoreRules = await readIgnorePatterns(args.ignoreFiles || []);
  const ts = loadTypeScript(args['typescript-root'] ? resolve(args['typescript-root']) : sourceRoot);
  const extraExcludes = [...new Set(await Promise.all(args.excludes.map((path) => canonical(resolve(path)))))].sort();
  const lockPath = baselinePath && baselinePath + '.lock';
  const excludedPaths = [output, ...[baselinePath, lockPath].filter(Boolean), ...extraExcludes];
  const options = { args, scopes, accepted, sourceRoot, prototypeRoot, output, baselinePath, reportPaths, ignoreRules, ts, extraExcludes, excludedPaths };
  if (!args.writeBaseline) {
    await compare(options);
    return;
  }
  await mkdir(dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw new Error('基线正在写入，请确认没有其他写入任务后再重试：' + lockPath);
    throw error;
  });
  try {
    await compare(options);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function compare({
  args, scopes, accepted, sourceRoot, prototypeRoot, output, baselinePath,
  reportPaths, ignoreRules, ts, extraExcludes, excludedPaths,
}) {
  const baseline = await readBaseline(baselinePath, sourceRoot, prototypeRoot, ignoreRules, extraExcludes);
  if (args.full && args.writeBaseline && baseline) {
    throw new Error('已有验收基线，请按验收范围更新文件条目。');
  }
  const matchers = compileIgnoreRules(ignoreRules);
  const [source, prototype] = await Promise.all([
    collect(sourceRoot, ts, matchers, relativeExcludes(sourceRoot, [...excludedPaths, prototypeRoot]), scopes),
    collect(prototypeRoot, ts, matchers, relativeExcludes(prototypeRoot, excludedPaths), scopes),
  ]);
  const knownPaths = new Set([
    ...Object.keys(source.hashes), ...Object.keys(prototype.hashes),
    ...Object.keys(baseline?.files.source || {}), ...Object.keys(baseline?.files.prototype || {}),
  ]);
  for (const scope of scopes) {
    if (!knownPaths.has(scope) && ![...knownPaths].some((path) => path.startsWith(scope + '/'))) {
      throw new Error('范围内没有可比对的当前或历史文件：' + scope);
    }
  }
  for (const path of accepted) {
    if (!knownPaths.has(path)) throw new Error('验收条目必须是当前或历史基线中的文件：' + path);
  }
  const routeKey = (item) => JSON.stringify([item.file, item.name || item.path]);
  const sourceRoutes = unique(source.routes, routeKey);
  const prototypeRoutes = unique(prototype.routes, routeKey);
  const sourceApis = source.apis;
  const prototypeApis = prototype.apis;
  const sourceSurfaces = unique(source.surfaces, (item) => `${item.kind} ${item.file}`);
  const prototypeSurfaceKeys = new Set(prototype.surfaces.map((item) => `${item.kind} ${item.file}`));
  const report = {
    generatedAt: new Date().toISOString(), sourceRoot, prototypeRoot,
    baseline: baseline ? { acceptedAt: baseline.acceptedAt, fullSnapshot: baseline.fullSnapshot !== false } : null,
    scope: { mode: args.full ? 'full' : 'scoped', paths: scopes, acceptedPaths: accepted },
    ignoreRules,
    inventory: {
      source: inventory(source, sourceRoutes),
      prototype: inventory(prototype, prototypeRoutes),
    },
    files: {
      current: currentFileDiff(source.hashes, prototype.hashes),
      history: baseline ? historicalDiff(baseline, source.hashes, prototype.hashes, scopes) : null,
    },
    routes: { ...objectsDiff(sourceRoutes, prototypeRoutes, routeKey), source: sourceRoutes, prototype: prototypeRoutes },
    apis: {
      ...compareApis(sourceApis, prototypeApis), source: sourceApis, prototype: prototypeApis,
      unresolved: { source: source.unresolved, prototype: prototype.unresolved },
    },
    surfaces: {
      source: sourceSurfaces,
      prototype: unique(prototype.surfaces, (item) => `${item.kind} ${item.file}`),
      missingInPrototype: sourceSurfaces.filter((item) => !prototypeSurfaceKeys.has(`${item.kind} ${item.file}`)),
    },
    manualReview: [
      '文件哈希、路由对象和 API 调用只发现静态候选，不能证明页面行为完整。需运行新增/修改页面并检查菜单可达、表单校验、错误与取消路径。',
      '需人工核对运行时菜单、权限注入、代码生成路由、动态 URL、导入的 API 包装器和无法静态展开的请求。',
      '交互表面扫描仅检查 Vue 文件中的常见标记，需结合页面索引、弹窗/抽屉清单和浏览器操作验证深层交互。',
      ...sourceRoutes.filter((item) => /build|codegen|iframe|monitor|auth/i.test(item.path)).map((item) => `特殊路由需检查完整操作流程：${item.path}`),
      ...sourceApis.filter((item) => /upload|download|sse|websocket|oauth|auth|captcha|file/i.test(item.path)).map((item) => `专用 API 需实现成功、失败和取消路径：${item.method.toUpperCase()} ${item.path}`),
    ],
  };

  await writeAtomically(reportPaths[0], json(report));
  await writeAtomically(reportPaths[1], markdown(report) + '\n');
  if (args.writeBaseline) {
    const nextBaseline = {
      version: 1,
      acceptedAt: new Date().toISOString(),
      sourceRoot,
      prototypeRoot,
      ignoreRules,
      extraExcludes,
      ...acceptedSnapshot(baseline, source.hashes, prototype.hashes, accepted, args.full),
    };
    await writeAtomically(baselinePath, json(nextBaseline));
  }
  console.log(JSON.stringify({
    output,
    baseline: baselinePath || null,
    baselineWritten: Boolean(args.writeBaseline),
    scope: report.scope,
    inventory: report.inventory,
    current: Object.fromEntries(Object.entries(report.files.current).map(([key, value]) => [key, value.length])),
    history: report.files.history && Object.fromEntries(Object.entries(report.files.history).map(([key, value]) => [key, value.length])),
    routes: { added: report.routes.added.length, missingInSource: report.routes.missingInSource.length, changed: report.routes.changed.length },
    apis: { added: report.apis.added.length, missingInSource: report.apis.missingInSource.length, changed: report.apis.changed.length },
    missingSurfaces: report.surfaces.missingInPrototype.length,
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

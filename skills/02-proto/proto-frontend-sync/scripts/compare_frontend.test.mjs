import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'compare_frontend.mjs');
const frontendRoot = process.env.PROTOTYPE_SYNC_FRONTEND;

async function fixture(context) {
  assert.ok(frontendRoot, 'set PROTOTYPE_SYNC_FRONTEND to a frontend directory with TypeScript installed');
  const requireFromFrontend = createRequire(resolve(frontendRoot, 'package.json'));
  const typescriptPath = dirname(dirname(requireFromFrontend.resolve('typescript')));
  const root = await mkdtemp(resolve(tmpdir(), 'prototype-sync-test-'));
  context.after(async () => rm(root, { recursive: true, force: true }));

  const source = resolve(root, 'formal-frontend');
  const prototype = resolve(root, 'prototype-starter');
  const output = resolve(root, 'reports');
  const baseline = resolve(root, 'source-manifest.json');
  for (const directory of [source, prototype]) {
    await mkdir(resolve(directory, 'node_modules'), { recursive: true });
    await symlink(typescriptPath, resolve(directory, 'node_modules/typescript'));
  }
  const parameters = ['--source', source, '--prototype', prototype, '--output', output, '--baseline', baseline];
  const run = (...args) => execFileSync(process.execPath, [script, ...parameters, ...args], { encoding: 'utf8' });
  const reject = (message, ...args) => {
    const result = spawnSync(process.execPath, [script, ...parameters, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, message);
  };
  const report = async () => JSON.parse(await readFile(resolve(output, 'diff-report.json'), 'utf8'));
  return { root, source, prototype, baseline, run, reject, report };
}

test('reports current API signatures and historical two-sided changes without accepting the baseline', async (context) => {
  const { root, source, prototype, baseline, run, report } = await fixture(context);
  await mkdir(resolve(source, 'src/api'), { recursive: true });
  await mkdir(resolve(source, 'src/router/routes'), { recursive: true });
  await mkdir(resolve(source, 'src/views/people'), { recursive: true });
  await mkdir(resolve(prototype, 'src/api'), { recursive: true });
  await mkdir(resolve(prototype, 'src/router/routes'), { recursive: true });
  await mkdir(resolve(prototype, 'src/views/people'), { recursive: true });

  const apiPath = 'src/api/people.ts';
  const routePath = 'src/router/routes/people.ts';
  const routeOtherPath = 'src/router/routes/other.ts';
  const pagePath = 'src/views/people/index.vue';
  const api = (type) => `export function listPeople() { return requestClient.get<${type}[]>('/system/people', { params: query }); }\n`;
  const route = (path) => `export default [{ path: '${path}', name: 'People', component: () => import('@/views/people/index.vue') }];\n`;
  const page = '<template><a-form><a-table /></a-form></template><script setup>const drawer = true;</script>\n';
  for (const [path, contents] of [[apiPath, api('Person')], [routePath, route('/people')], [routeOtherPath, route('/other')], [pagePath, page]]) {
    await writeFile(resolve(source, path), contents);
    await writeFile(resolve(prototype, path), contents);
  }
  await writeFile(resolve(source, 'src/api/removed.ts'), "export function removed() { return requestClient.get('/removed'); }\n");
  await writeFile(resolve(prototype, 'src/api/removed.ts'), await readFile(resolve(source, 'src/api/removed.ts')));
  const stableApiPath = 'src/api/stable.ts';
  const stableApi = "export function stable() { return requestClient.get('/stable'); }\n";
  await writeFile(resolve(source, stableApiPath), stableApi);
  await writeFile(resolve(prototype, stableApiPath), stableApi);
  const ignore = resolve(root, 'AI_IGNORE.md');
  await writeFile(ignore, ['## 忽略列表', '', '```gitignore', 'regex:^formal-frontend/.+\\.private\\.ts$', 'node_modules/', '```', ''].join('\n'));
  await writeFile(resolve(source, 'src/api/skip.private.ts'), "requestClient.get('/private');\n");

  const options = ['--full', '--ignore-file', ignore];
  run(...options);
  const initial = await report();
  assert.equal(initial.inventory.source.apis, 3);
  assert.equal(initial.inventory.prototype.apis, 3);
  assert.equal(initial.inventory.source.routes, 2);
  assert.deepEqual(initial.files.current.sourceOnly, []);
  assert.equal(initial.files.history, null);
  assert.deepEqual(initial.files.current.prototypeOnly, []);

  run(...options, '--write-baseline');
  const acceptedBaseline = await readFile(baseline, 'utf8');
  await writeFile(resolve(source, apiPath), `${api('PersonDTO')}export function countPeople() { return requestClient.get<number>('/system/people/count'); }\n`);
  await writeFile(resolve(prototype, apiPath), api('PrototypePerson'));
  await writeFile(resolve(source, stableApiPath), '// Same call, different line.\n' + stableApi);
  await writeFile(resolve(source, routePath), route('/people/list'));
  await writeFile(resolve(prototype, routePath), route('/people'));
  await rm(resolve(source, 'src/api/removed.ts'));
  await writeFile(resolve(source, 'src/api/new.ts'), "export function newList() { return requestClient.get<NewPerson[]>('/system/people/new'); }\n");
  await mkdir(resolve(prototype, 'prototype-sync'), { recursive: true });
  await writeFile(resolve(prototype, 'prototype-sync/custom-adapter.ts'), 'export const prototypeOnly = true;\n');

  run(...options);
  const next = await report();
  assert.ok(next.files.history.conflicts.includes(apiPath));
  assert.ok(next.files.history.sourceDeleted.includes('src/api/removed.ts'));
  assert.ok(next.files.history.sourceAdded.includes('src/api/new.ts'));
  assert.ok(next.files.history.prototypeAdded.includes('prototype-sync/custom-adapter.ts'));
  assert.ok(next.apis.changed.some((item) => item.source.typeArguments[0] === 'PersonDTO[]' && item.prototype.typeArguments[0] === 'PrototypePerson[]'));
  assert.ok(next.apis.added.some((item) => item.path === '/system/people/count'));
  assert.ok(!next.apis.changed.some((item) => item.source.file === stableApiPath));
  assert.ok(!next.apis.added.some((item) => item.file === stableApiPath));
  assert.ok(next.routes.changed.some((item) => item.source.path === '/people/list' && item.prototype.path === '/people'));
  assert.equal(await readFile(baseline, 'utf8'), acceptedBaseline);
});

test('limits scans and advances only the explicitly accepted file hashes', async (context) => {
  const { source, prototype, baseline, run, reject, report } = await fixture(context);
  const included = 'users/import.ts';
  const shared = 'users/shared.ts';
  const removed = 'users/obsolete.ts';
  const unrelated = 'roles/index.ts';
  for (const project of [source, prototype]) {
    for (const directory of ['users', 'roles']) await mkdir(resolve(project, directory));
    for (const path of [included, shared, removed, unrelated]) {
      await writeFile(resolve(project, path), "requestClient.get('/before');\n");
    }
  }
  reject(/--scope/);
  run('--full', '--write-baseline');
  const previous = JSON.parse(await readFile(baseline, 'utf8'));
  // Existing baselines had complete coverage without the fullSnapshot property.
  delete previous.fullSnapshot;
  await writeFile(baseline, JSON.stringify(previous));
  for (const path of [included, shared, unrelated]) {
    await writeFile(resolve(source, path), "requestClient.get('/after');\n");
  }
  await writeFile(resolve(prototype, included), "requestClient.get('/after');\n");
  await writeFile(resolve(prototype, unrelated), "requestClient.get('/custom');\n");
  await rm(resolve(source, removed));
  await rm(resolve(prototype, removed));
  run('--scope', 'users');
  const scoped = await report();
  assert.deepEqual(scoped.scope.paths, ['users']);
  assert.deepEqual(scoped.files.history.sourceModified, [included, shared]);
  assert.deepEqual(scoped.files.history.sourceDeleted, [removed]);
  assert.deepEqual(scoped.files.history.prototypeDeleted, [removed]);
  assert.equal(scoped.inventory.source.files, 2);
  assert.ok(scoped.apis.source.every((call) => call.file.startsWith('users/')));

  reject(/逐个指定/, '--scope', 'users', '--write-baseline');
  reject(/扫描范围内/, '--scope', 'users', '--write-baseline', '--accept', unrelated);
  reject(/必须是当前或历史/, '--scope', 'users', '--write-baseline', '--accept', 'users');
  reject(/已有验收基线/, '--full', '--write-baseline');
  assert.deepEqual(JSON.parse(await readFile(baseline, 'utf8')), previous);

  run('--scope', 'users', '--write-baseline', '--accept', included, '--accept', removed);
  const updated = JSON.parse(await readFile(baseline, 'utf8'));
  assert.equal(updated.fullSnapshot, true);
  for (const side of ['source', 'prototype']) {
    assert.notEqual(updated.files[side][included], previous.files[side][included]);
    assert.equal(updated.files[side][shared], previous.files[side][shared]);
    assert.equal(updated.files[side][unrelated], previous.files[side][unrelated]);
    assert.ok(!Object.hasOwn(updated.files[side], removed));
  }
  run('--scope', 'users', '--scope', unrelated);
  const followup = await report();
  assert.deepEqual(followup.files.history.sourceModified, [unrelated, shared]);
  assert.deepEqual(followup.files.history.conflicts, [unrelated]);
});

test('starts a partial baseline for an existing prototype with no history', async (context) => {
  const { source, prototype, baseline, run, report } = await fixture(context);
  await writeFile(resolve(source, 'users.ts'), 'export const users = 1;\n');
  await writeFile(resolve(source, 'roles.ts'), 'export const roles = 1;\n');
  await writeFile(resolve(prototype, 'custom.ts'), 'export const custom = 1;\n');
  run('--scope', 'users.ts', '--write-baseline', '--accept', 'users.ts');
  const partial = JSON.parse(await readFile(baseline, 'utf8'));
  assert.equal(partial.fullSnapshot, false);
  assert.deepEqual(partial.acceptedPaths, ['users.ts']);
  await writeFile(resolve(prototype, 'users.ts'), 'export const users = 2;\n');
  run('--scope', 'users.ts', '--scope', 'roles.ts', '--scope', 'custom.ts');
  const result = await report();
  assert.deepEqual(result.files.history.sourceAdded, []);
  assert.deepEqual(result.files.history.prototypeAdded, ['users.ts']);
  assert.deepEqual(result.files.history.untracked, ['custom.ts', 'roles.ts']);
  assert.deepEqual(result.files.current.sourceOnly, ['roles.ts']);
  assert.deepEqual(result.files.current.prototypeOnly, ['custom.ts']);
});

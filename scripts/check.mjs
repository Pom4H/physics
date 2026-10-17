import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const htmlPath = join(dist, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const importMapText = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/)?.[1];
assert.ok(importMapText, 'The self-contained application needs an import map.');
const imports = JSON.parse(importMapText).imports;

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

let checkedReferences = 0;
function localReference(reference, origin, isModule = false) {
  if (!reference || reference.startsWith('#')) return;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
    assert.ok(!isModule, `Bundle remote module locally: ${reference}`);
    return;
  }
  assert.ok(!reference.startsWith('/'), `Use a relative path for GitHub project Pages: ${reference}`);
  if (isModule && !reference.startsWith('.')) {
    assert.ok(imports[reference], `Unmapped module: ${reference}`);
    return localReference(imports[reference], htmlPath, true);
  }
  const target = resolve(dirname(origin), decodeURIComponent(reference.split(/[?#]/)[0]));
  assert.ok(!relative(dist, target).startsWith('..'), `Asset is outside dist: ${reference}`);
  assert.ok(statSync(target), `Missing static resource: ${reference}`);
  checkedReferences++;
}

const modules = [...files(dist), ...files(join(root, 'scripts')), ...files(join(root, 'tests'))]
  .filter(path => /\.(mjs|js)$/.test(path));
for (const path of modules) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `Syntax check failed: ${relative(root, path)}`);
  if (!path.startsWith(dist + '/')) continue;
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(/(?:^|[;\r\n])\s*import\s*(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/g)) {
    localReference(match[1], path, true);
  }
  for (const match of source.matchAll(/(?:^|[;\r\n])\s*export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) {
    localReference(match[1], path, true);
  }
  for (const match of source.matchAll(/(?:new URL\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
    localReference(match[1], path, true);
  }
}

for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) localReference(match[1], htmlPath);
for (const reference of Object.values(imports)) localReference(reference, htmlPath, true);
for (const path of files(dist).filter(path => path.endsWith('.css'))) {
  const css = readFileSync(path, 'utf8');
  for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) localReference(match[1], path);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique.');
console.log(`Checked ${modules.length} JavaScript modules, ${checkedReferences} static references and ${ids.length} unique HTML IDs.`);

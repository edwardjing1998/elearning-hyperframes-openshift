import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');

test('configured websites have unique ids, valid course names and HTTPS URLs', async () => {
  const { sites } = JSON.parse(await readFile(path.join(root,'public/capture-studio/sites.json'),'utf8'));
  assert.ok(Array.isArray(sites) && sites.length >= 3);
  const seen = new Set();
  for (const site of sites) {
    assert.match(site.id,/^[a-z0-9-]+$/);
    assert.match(site.course_id,/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
    assert.ok(!seen.has(site.id)); seen.add(site.id);
    const url=new URL(site.url);
    assert.equal(url.protocol,'https:');
    assert.equal(url.username,''); assert.equal(url.password,'');
  }
  assert.ok(seen.has('azure-storage') && seen.has('databricks') && seen.has('snowflake'));
});

test('capture studio serves configured website list', async () => {
  const server=await readFile(path.join(root,'server.mjs'),'utf8');
  assert.match(server,/route === '\/capture-studio\/sites\.json'/);
  const html=await readFile(path.join(root,'public/capture-studio/index.html'),'utf8');
  assert.match(html,/id="target-site"/);
  assert.match(html,/id="open-site"/);
  assert.match(html,/id="custom-site-url"/);
});

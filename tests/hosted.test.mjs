import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileCatalog} from '../src/catalog.mjs';
import {definitions, foundationSql} from '../src/foundation.mjs';
import {snapshot, makePlan} from '../src/snapshot.mjs';
import {applyPlan} from '../src/apply.mjs';
import {marker, stamp, scopeFor} from '../src/ownership.mjs';
import {main} from '../bin/sourcemedium-metabase.mjs';
import {rows, paidRows, tables, foundationTables, options, fakeMetabase, documented} from './fixtures.mjs';

// Hosted installs pass an ownership map (options.ownership; null before the first apply).
const sql = foundationSql();
const define = (data = rows, synced = tables) => ({...definitions(compileCatalog(data, synced, options.dataset, documented(synced)), synced, sql, options), unsupported: []});
const full = () => define([...rows, ...paidRows], foundationTables);
const writes = calls => calls.filter(c => c.method !== 'GET');
const hosted = ownership => ({...options, ownership});
const changed = actions => actions.filter(a => a.action !== 'unchanged');
async function plan(m, d, ownership = null) {
  const state = await snapshot(m.api, hosted(ownership), d.nodes);
  return {state, plan: makePlan(d, state, hosted(ownership))};
}
// Plan, then apply with the map the plan saved, as the CLI does. Returns the map apply records.
async function install(m, d, ownership = null) {
  const {state, plan: reviewed} = await plan(m, d, ownership);
  return (await applyPlan(m.api, d, hosted(state.ownership), reviewed)).ownership;
}
// A customer's copy, as Metabase duplicates it: the description, ownership line included, comes along.
function copy(m, store, id, changes = {}) {
  const copied = {...structuredClone(m[store].get(id)), id: 5000 + m[store].size, entity_id: `copy-${m[store].size}`,
    creator_id: 2, collection_id: 3, ...changes};
  m[store].set(copied.id, copied);
  return copied.id;
}
const marked = m => [...m.collections.values(), ...m.cards.values(), ...m.dashboards.values(), ...m.snippets.values()]
  .filter(o => marker(o.description)).map(o => marker(o.description).key).sort();

test('a customer copy of a managed question blocks a discovered install, never a recorded one', async () => {
  const d = full();
  // The 2026-10-30 baseline: discovering ownership lines finds the copy as a second claim.
  const discovered = fakeMetabase();
  const installed = await applyPlan(discovered.api, d, options, makePlan(d, await snapshot(discovered.api, options, d.nodes), options));
  copy(discovered, 'cards', installed.ids['question:kpis']);
  const baseline = makePlan(d, await snapshot(discovered.api, options, d.nodes), options);
  assert.equal(baseline.actions.find(a => a.key === 'question:kpis').reason, 'Duplicate managed identities; preserved.');
  assert.deepEqual(baseline.actions.filter(a => a.kind === 'dashboard' && a.action === 'blocked').map(a => a.key),
    ['dashboard:summary', 'dashboard:stores', 'dashboard:foundation']);

  const m = fakeMetabase();
  const map = await install(m, d);
  const kpis = map.objects['question:kpis'].id;
  const summary = map.objects['dashboard:summary'].id;
  m.collections.set(50, {id: 50, name: 'Personal collection', description: null, parent_id: null, personal_owner_id: 2});
  const line = marker(m.cards.get(kpis).description);
  const copies = [copy(m, 'cards', kpis), copy(m, 'cards', kpis, {collection_id: 50, name: 'My KPIs'}),
    copy(m, 'cards', kpis, {description: stamp('Edited copy.', {...line, content: '0'.repeat(64)})})];
  const dashboardCopy = copy(m, 'dashboards', summary, {name: 'Our summary'});
  const before = structuredClone([...copies.map(id => m.cards.get(id)), m.dashboards.get(dashboardCopy)]);
  const {plan: unchanged} = await plan(m, d, map);
  assert.deepEqual(changed(unchanged.actions), []);

  // A new definition updates the original; every copy keeps its own content.
  const next = {...d, nodes: d.nodes.map(n => n.key === 'question:kpis' ?
    {...n, body: ids => ({...n.body(ids), description: 'Updated by SourceMedium.'})} : n)};
  const {plan: refresh} = await plan(m, next, map);
  assert.deepEqual(changed(refresh.actions).map(a => [a.key, a.action, a.id]), [['question:kpis', 'update', kpis]]);
  const refreshed = await applyPlan(m.api, next, hosted(map), refresh);
  assert.equal(refreshed.ownership, map);
  assert.match(m.cards.get(kpis).description, /^Updated by SourceMedium\./);
  assert.deepEqual([...copies.map(id => m.cards.get(id)), m.dashboards.get(dashboardCopy)], before);
  assert.deepEqual(changed((await plan(m, next, map)).plan.actions), []);
});

test('a recorded original that was moved, edited or archived stays a conflict beside its copies', async () => {
  for (const edit of [c => {c.collection_id = 3;}, c => {c.name = 'Renamed';}, c => {c.archived = true;}]) {
    const m = fakeMetabase(); const d = define();
    const map = await install(m, d);
    const id = map.objects['question:kpis'].id;
    copy(m, 'cards', id);
    edit(m.cards.get(id));
    const before = structuredClone(m.cards.get(id));
    const {plan: reviewed} = await plan(m, d, map);
    assert.deepEqual(changed(reviewed.actions).map(a => [a.key, a.action, a.id]),
      [['question:kpis', 'conflict', id], ...['dashboard:summary', 'dashboard:foundation'].map(key => [key, 'blocked', map.objects[key].id])]);
    await applyPlan(m.api, d, hosted(map), reviewed);
    assert.deepEqual(m.cards.get(id), before);
  }
});

test('an interrupted first install resumes from what the installer created, recorded before apply', async () => {
  const m = fakeMetabase(); const d = define();
  let finished = 0;
  m.failWhen((method, path, body) => method === 'PUT' && /^\/api\/card\/\d+$/.test(path) &&
    body?.description?.includes('"pending":false') && ++finished === 3);
  await assert.rejects(install(m, d), /transport failure/);
  m.failWhen(null);
  const created = marked(m);
  const {state, plan: resumed} = await plan(m, d);
  assert.deepEqual([...state.recovered].sort(), created);
  assert.equal(state.ownership.revision, 1);
  assert.equal(resumed.ownership.revision, 1);
  assert.equal(resumed.actions.filter(a => a.action === 'resume').length, 1);
  assert.ok(!resumed.actions.some(a => ['conflict', 'blocked'].includes(a.action)));
  const map = (await applyPlan(m.api, d, hosted(state.ownership), resumed)).ownership;
  assert.equal(map.revision, 2);
  assert.deepEqual(changed((await plan(m, d, map)).plan.actions), []);
  const names = [...m.cards.values()].map(c => c.name);
  assert.equal(new Set(names).size, names.length);
});

test('recovery adopts one installer-created claim only, and never a customer\'s', async () => {
  const interrupted = async () => {
    const m = fakeMetabase(); const d = define();
    let finished = 0;
    m.failWhen((method, path, body) => method === 'PUT' && /^\/api\/card\/\d+$/.test(path) &&
      body?.description?.includes('"pending":false') && ++finished === 3);
    await assert.rejects(install(m, d), /transport failure/);
    m.failWhen(null);
    const card = [...m.cards.values()].find(c => marker(c.description) && !marker(c.description).pending);
    return {m, d, card, key: marker(card.description).key};
  };
  for (const tamper of [
    // Two objects in the managed collection claim the key.
    (m, card) => copy(m, 'cards', card.id, {creator_id: 1, collection_id: card.collection_id}),
    // Another Metabase user created the claim.
    (m, card) => { card.creator_id = 2; },
  ]) {
    const {m, d, card, key} = await interrupted();
    tamper(m, card);
    const {state, plan: reviewed} = await plan(m, d);
    assert.ok(!state.recovered.includes(key));
    assert.equal(reviewed.actions.find(a => a.key === key).action, 'conflict');
    const before = structuredClone(m.cards.get(card.id));
    const start = m.calls.length;
    await applyPlan(m.api, d, hosted(state.ownership), reviewed);
    assert.ok(!writes(m.calls.slice(start)).some(c => c.path.startsWith(`/api/card/${card.id}`)));
    assert.deepEqual(m.cards.get(card.id), before);
  }

  // A snippet a customer named like one a later template adds is never adopted or overwritten.
  const m = fakeMetabase();
  const retiredFirst = define(rows.filter(r => r.metric_name !== 'new_customer_order_count_summary'));
  const map = await install(m, retiredFirst);
  const d = define();
  const name = d.nodes.find(n => n.key === 'snippet:new_customer_order_count_summary').body(new Map()).name;
  m.snippets.set(7000, {id: 7000, name, content: 'customer SQL', description: null, creator_id: 2});
  const {state, plan: reviewed} = await plan(m, d, map);
  assert.ok(!state.recovered.includes('snippet:new_customer_order_count_summary'));
  assert.equal(reviewed.actions.find(a => a.key === 'snippet:new_customer_order_count_summary').action, 'conflict');
  assert.equal(reviewed.actions.find(a => a.key === 'metric:new_customer_order_count_summary').action, 'create');
});

test('a lost map is rebuilt from the managed collection, never from customer copies', async () => {
  const m = fakeMetabase(); const d = define();
  const map = await install(m, d);
  copy(m, 'cards', map.objects['question:kpis'].id);
  copy(m, 'dashboards', map.objects['dashboard:summary'].id);
  const {state, plan: reviewed} = await plan(m, d);
  assert.deepEqual(state.ownership.objects, map.objects);
  assert.deepEqual(changed(reviewed.actions), []);
});

test('a recorded object that no longer exists is reported, not recreated', async () => {
  const m = fakeMetabase(); const d = define();
  const map = await install(m, d);
  const id = map.objects['question:kpis'].id;
  m.cards.delete(id);
  copy(m, 'cards', [...m.cards.keys()][0]);
  const {plan: reviewed} = await plan(m, d, map);
  const action = reviewed.actions.find(a => a.key === 'question:kpis');
  assert.equal(action.action, 'conflict');
  assert.match(action.reason, /no longer exists/);
  assert.ok(!reviewed.actions.some(a => a.action === 'create'));
  const result = await applyPlan(m.api, d, hosted(map), reviewed);
  assert.deepEqual(result.ownership.objects['question:kpis'], {kind: 'card', id});
});

test('a changed, foreign or invalid ownership map is refused before any write', async () => {
  const m = fakeMetabase(); const d = define();
  const map = await install(m, d);
  const {plan: reviewed} = await plan(m, d, map);
  const start = m.calls.length;
  await assert.rejects(applyPlan(m.api, d, hosted({...map, revision: map.revision + 1}), reviewed), /stale or modified/);
  await assert.rejects(plan(m, d, {...map, scope: scopeFor({...options, collection: 4})}), /belongs to another/);
  const kpis = map.objects['question:kpis'];
  for (const invalid of [{...map, format: 2}, {...map, revision: -1}, {...map, objects: []}, {...map, objects: undefined},
    {...map, objects: {...map.objects, 'question:other': kpis}}, {...map, objects: {...map.objects, 'question:kpis': {kind: 'table', id: 1}}}]) {
    await assert.rejects(plan(m, d, invalid), /ownership map is invalid/);
  }
  await assert.rejects(plan(m, d, {...map, objects: {'question:kpis': kpis}}), /not its collection/);
  assert.equal(writes(m.calls.slice(start)).length, 0);
});

// main() against the fake Metabase, as the hosted provisioner runs it.
async function cli(m, folder, extra) {
  const answer = objects => {
    const names = Object.keys(objects[0] ?? {});
    return {status: 'completed', data: {cols: names.map(name => ({name})), rows: objects.map(o => names.map(n => o[n] ?? null)), rows_truncated: false}};
  };
  const api = async (method, path, body) => {
    if (path === '/api/database/1/metadata') return {tables: foundationTables};
    if (path !== '/api/dataset') return m.api(method, path, body);
    if (body.native.query.includes('dim_semantic_metric_catalog')) return answer([...rows, ...paidRows]);
    return answer(documented(foundationTables).map(t => ({...t, columns: JSON.stringify(t.columns)})));
  };
  const original = {fetch: globalThis.fetch, log: console.log};
  try {
    globalThis.fetch = async (url, init) => {
      try {
        return new Response(JSON.stringify(await api(init.method, url.slice(options.url.length),
          init.body === undefined ? undefined : JSON.parse(init.body))) ?? '');
      } catch (error) { if (error.status) return new Response('', {status: error.status}); throw error; }
    };
    console.log = () => {};
    await main(['--url', options.url, '--database-id', '1', '--collection-id', '3', '--dataset', options.dataset,
      '--metadata-dataset', options.metadataDataset, '--store', 'store-a', '--api-key-file', join(folder, 'token'), ...extra]);
  } finally { globalThis.fetch = original.fetch; console.log = original.log; }
}

test('the CLI saves the map apply records, and plans unchanged from it beside a customer copy', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sm-metabase-hosted-test-'));
  const [planFile, mapFile] = ['plan.json', 'ownership.json'].map(f => join(folder, f));
  const m = fakeMetabase();
  try {
    await writeFile(join(folder, 'token'), 'private-test-token');
    await cli(m, folder, ['--ownership-map', mapFile, '--plan', planFile]);
    await assert.rejects(readFile(mapFile), {code: 'ENOENT'});
    assert.equal(JSON.parse(await readFile(planFile, 'utf8')).ownership.revision, 0);
    await cli(m, folder, ['--ownership-map', mapFile, '--apply', planFile]);
    const map = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.equal(map.revision, 1);
    copy(m, 'cards', map.objects['question:kpis'].id);
    await cli(m, folder, ['--ownership-map', mapFile, '--plan', planFile]);
    assert.deepEqual(changed(JSON.parse(await readFile(planFile, 'utf8')).actions), []);
    assert.deepEqual(JSON.parse(await readFile(mapFile, 'utf8')), map);
    await assert.rejects(cli(m, folder, ['--ownership-map', join(folder, 'token'), '--plan', planFile]), /separate file/);
    await assert.rejects(cli(m, folder, ['--ownership-map', planFile, '--plan', planFile]), /separate file/);
  } finally { await rm(folder, {recursive: true}); }
});

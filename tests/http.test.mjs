import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, symlink, unlink, rmdir, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {client, metabaseUrl, readWarehouse, identifier, readStoreRoster} from '../src/http.mjs';
import {argumentsFor, main} from '../bin/sourcemedium-metabase.mjs';
import {options, foundationTables, rows, paidRows, documented, fakeMetabase} from './fixtures.mjs';

test('credentials only go to HTTPS or loopback, and redirects are refused', async () => {
  for (const url of ['http://remote.example', 'https://user:password@example.com', 'https://example.com?token=secret', 'file:///tmp/data']) {
    assert.throws(() => metabaseUrl(url));
  }
  let request;
  const api = client('https://example.com/metabase/', 'test-token', {fetch: async (url, options) => {
    request = {url, options}; return new Response('{}');
  }});
  await api('GET', '/api/card');
  assert.equal(request.url, 'https://example.com/metabase/api/card');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers['X-API-Key'], 'test-token');
});

test('transport, HTTP and JSON failures never expose response bodies or authentication', async () => {
  for (const response of [() => new Response('private-secret-in-response', {status: 401}),
    () => new Response('private-secret-in-response'), () => {throw new Error('private-secret-in-response');}]) {
    const api = client('http://127.0.0.1:3031', 'private-secret-token', {fetch: async () => response()});
    await assert.rejects(api('GET', '/api/card'), error => !error.message.includes('private-secret'));
  }
  assert.throws(() => client('http://localhost', 'token\r\nheader: bad'));
});

test('catalog and dictionary reads use metadata, group repeated columns and reject truncation', async () => {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({method, path, body});
    if (method === 'GET') return {tables: []};
    if (body.native.query.includes('dim_data_dictionary')) return {status: 'completed', data: {
      cols: [{name: 'dataset_name'}, {name: 'table_name'}, {name: 'columns'}],
      rows: [['tenant_sm_transformed_v2', 'dim_customers', '[{"column_name":"sm_store_id","column_description":"Store"}]']], rows_truncated: false}};
    return {status: 'completed', data: {cols: [{name: 'metric_name'}], rows: [['revenue']], rows_truncated: false}};
  };
  const result = await readWarehouse(api, 7, 'tenant_sm_metadata');
  assert.deepEqual(result.rows, [{metric_name: 'revenue'}]);
  assert.deepEqual(result.dictionary, [{dataset_name: 'tenant_sm_transformed_v2', table_name: 'dim_customers',
    columns: [{column_name: 'sm_store_id', column_description: 'Store'}]}]);
  assert.ok(calls[1].body.native.query.includes('`tenant_sm_metadata.dim_semantic_metric_catalog`'));
  assert.ok(calls[2].body.native.query.includes('`tenant_sm_metadata.dim_data_dictionary`'));
  assert.match(calls[2].body.native.query, /GROUP BY dataset_name, table_name, table_description/);
  assert.ok(!calls.some(c => c.path === '/api/database/7'));
  assert.throws(() => identifier('dataset` UNION SELECT x'));
  await assert.rejects(readWarehouse(async method => method === 'GET' ? {tables: []} :
    {status: 'completed', data: {rows_truncated: true}}, 7, 'sm_metadata'), /truncated/);
});

test('value_format is read from the row so a warehouse without that column still plans', async () => {
  const queries = [];
  const api = async (method, path, body) => {
    if (method === 'GET') return {tables: []};
    queries.push(body.native.query);
    if (body.native.query.includes('dim_data_dictionary')) return {status: 'completed', data: {
      cols: [{name: 'dataset_name'}, {name: 'table_name'}, {name: 'columns'}],
      rows: [['sm_transformed_v2', 'dim_customers', '[{"column_name":"sm_store_id","column_description":"Store"}]']], rows_truncated: false}};
    return {status: 'completed', data: {cols: [{name: 'metric_name'}], rows: [['revenue']], rows_truncated: false}};
  };
  const result = await readWarehouse(api, 7, 'tenant_sm_metadata');
  assert.equal(result.rows[0].metric_name, 'revenue');
  assert.equal('stores' in result, false);
  for (const query of queries) {
    assert.match(query, /JSON_VALUE\(TO_JSON_STRING\((catalog|dictionary)\), '\$\.value_format'\) AS value_format/);
    assert.equal(query.includes('dim_stores'), false);
  }
  await assert.rejects(readWarehouse(async () => ({tables: []}), 7, 'bad`name'), /BigQuery identifiers/);
});

test('an invalid or truncated dictionary cannot silently install an incomplete model inventory', async () => {
  for (const invalid of ['not JSON', null]) {
    const api = async (method, path, body) => {
      if (method === 'GET') return {tables: []};
      if (!body.native.query.includes('dim_data_dictionary')) return {status: 'completed', data: {cols: [], rows: []}};
      return {status: 'completed', data: {cols: [{name: 'columns'}], rows: [[invalid]], rows_truncated: invalid === null}};
    };
    await assert.rejects(readWarehouse(api, 1, 'sm_metadata'), /data dictionary/);
  }
});

// The warehouse answers the dim_stores roster query with a row per store: [store, currency, time zone].
const rosterWarehouse = (roster, queries = []) => async (method, path, body) => {
  queries.push(body.native.query);
  return {status: 'completed', data: {cols: [{name: 'store'}, {name: 'currency'}, {name: 'time_zone'}],
    rows: roster.map(([store, currency, zone = null]) => [store, currency, zone]), rows_truncated: false}};
};
const unscoped = {...options, store: undefined};
const withoutCurrency = foundationTables.map(t => t.name !== 'dim_stores' ? t :
  {...t, fields: t.fields.filter(f => f.name !== 'store_currency_code')});

test('stores in more than one currency are refused unless --store picks one, and the roster is counted either way', async () => {
  const queries = [];
  const two = [['store-a', 'USD', 'America/New_York'], ['store-b', 'USD', 'Europe/London']];
  assert.deepEqual(await readStoreRoster(rosterWarehouse(two, queries), foundationTables, unscoped), {stores: 2, timeZone: null, unchecked: []});
  assert.match(queries[0], /SELECT DISTINCT sm_store_id AS store, store_currency_code AS currency,\s+store_timezone AS time_zone\s+FROM `tenant_sm_transformed_v2\.dim_stores`/);
  await assert.rejects(readStoreRoster(rosterWarehouse([['a', 'EUR'], ['b', 'USD']]), foundationTables, unscoped),
    /tenant_sm_transformed_v2 report in more than one currency \(EUR, USD\)\..*Pass --store STORE_ID/);
  await assert.rejects(readStoreRoster(rosterWarehouse([['a', null], ['b', 'USD']]), foundationTables, unscoped), /\(unset, USD\)/);
  await assert.rejects(readStoreRoster(rosterWarehouse([['a', 'USD']]), foundationTables.map(t => ({...t, schema: 'bad`name'})),
    {...unscoped, dataset: 'bad`name'}), /BigQuery identifiers/);
  // --store picks the reporting store, whose calendar the cohort cutoff follows.
  const mixed = [['store-a', 'EUR', 'Europe/Berlin'], ['store-b', 'USD', 'America/Chicago'], ['store-c', 'USD']];
  assert.deepEqual(await readStoreRoster(rosterWarehouse(mixed), foundationTables, options), {stores: 3, timeZone: 'Europe/Berlin', unchecked: []});
  // So does the only store.
  assert.deepEqual(await readStoreRoster(rosterWarehouse([['store-z', 'USD', 'Australia/Sydney']]), foundationTables, unscoped),
    {stores: 1, timeZone: 'Australia/Sydney', unchecked: []});
  // A time zone that is not an IANA name never reaches the SQL.
  assert.equal((await readStoreRoster(rosterWarehouse([['store-a', 'USD', "UTC') OR ('x"]]), foundationTables, options)).timeZone, null);
});

test('without a synced time zone the roster still checks currencies, and the cutoff follows UTC', async () => {
  const queries = [];
  const tables = foundationTables.map(t => t.name !== 'dim_stores' ? t : {...t, fields: t.fields.filter(f => f.name !== 'store_timezone')});
  assert.deepEqual(await readStoreRoster(rosterWarehouse([['store-a', 'USD']], queries), tables, options), {stores: 1, timeZone: null, unchecked: []});
  assert.match(queries[0], /CAST\(NULL AS STRING\) AS time_zone/);
  await assert.rejects(readStoreRoster(rosterWarehouse([['a', 'EUR'], ['b', 'USD']]), tables, unscoped), /more than one currency/);
});

test('an unsynced roster skips the check and reports why, like a missing source', async () => {
  for (const [tables, reason] of [[foundationTables.filter(t => t.name !== 'dim_stores'), 'Source table is not synced in the selected dataset.'],
    [withoutCurrency, 'dim_stores has no synced store_currency_code.']]) {
    for (const [scope, name] of [[unscoped, 'Store currency check'], [options, 'Store roster check']]) {
      const queries = [];
      assert.deepEqual(await readStoreRoster(rosterWarehouse([['a', 'EUR'], ['b', 'USD']], queries), tables, scope),
        {stores: null, timeZone: null, unchecked: [{name, reason}]});
      assert.deepEqual(queries, []);
    }
  }
});

test('a failed roster query stops a plan without --store, and is reported with it', async () => {
  const failed = async () => ({status: 'failed', error: 'Access Denied: Table p:tenant_sm_transformed_v2.dim_stores'});
  await assert.rejects(readStoreRoster(failed, foundationTables, unscoped),
    /^Error: The store roster query failed: Access Denied: Table p:tenant_sm_transformed_v2\.dim_stores\. No content was changed\.$/);
  await assert.rejects(readStoreRoster(async () => ({status: 'failed'}), foundationTables, unscoped),
    /^Error: The store roster query failed\. No content was changed\.$/);
  // With --store the currency check is not needed, so the plan goes on and keeps the store choice.
  // The reason reaches hosted install summaries, so it never quotes the warehouse's error.
  const unread = {stores: null, timeZone: null, unchecked: [{name: 'Store roster check', reason: 'The store roster could not be read.'}]};
  assert.deepEqual(await readStoreRoster(failed, foundationTables, options), unread);
  // An answer without store IDs, as from a proxy that answers every query alike, counts nothing.
  const other = async () => ({status: 'completed', data: {cols: [{name: 'table_name'}], rows: [['dim_stores'], ['obt_orders']], rows_truncated: false}});
  assert.deepEqual(await readStoreRoster(other, foundationTables, options), unread);
  await assert.rejects(readStoreRoster(other, foundationTables, unscoped), /no store IDs\. No content was changed\.$/);
});

// main() against a fake Metabase: its content API, the database's synced tables, and native
// queries answered as BigQuery would, the roster read failing when its columns do not exist.
// `roster` is [store, currency] per store.
async function planWith(synced, roster, extra = []) {
  const folder = await mkdtemp(join(tmpdir(), 'sm-metabase-currency-test-'));
  const token = join(folder, 'token'); const planFile = join(folder, 'plan.json');
  const metabase = fakeMetabase(); const queries = [];
  const answer = objects => {
    const names = Object.keys(objects[0] ?? {});
    return {status: 'completed', data: {cols: names.map(name => ({name})), rows: objects.map(o => names.map(n => o[n] ?? null)), rows_truncated: false}};
  };
  const api = async (method, path, body) => {
    if (path === '/api/database/1/metadata') return {tables: synced};
    if (path !== '/api/dataset') return metabase.api(method, path, body);
    const query = body.native.query; queries.push(query);
    if (query.includes('dim_semantic_metric_catalog')) return answer([...rows, ...paidRows]);
    if (query.includes('dim_data_dictionary')) return answer(documented(synced).map(t => ({...t, columns: JSON.stringify(t.columns)})));
    return synced.some(t => t.name === 'dim_stores' && t.fields.some(f => f.name === 'store_currency_code')) ?
      answer(roster.map(([store, currency]) => ({store, currency, time_zone: null}))) : {status: 'failed', error: 'Unrecognized name: store_currency_code'};
  };
  const original = {fetch: globalThis.fetch, log: console.log};
  try {
    await writeFile(token, 'private-test-token');
    globalThis.fetch = async (url, init) => new Response(JSON.stringify(await api(init.method, url.slice(options.url.length),
      init.body === undefined ? undefined : JSON.parse(init.body))) ?? '');
    console.log = () => {};
    await main(['--url', options.url, '--database-id', '1', '--collection-id', '3', '--dataset', options.dataset,
      '--metadata-dataset', options.metadataDataset, '--api-key-file', token, '--plan', planFile, ...extra]);
    return {plan: JSON.parse(await readFile(planFile, 'utf8')), rosterQueries: queries.filter(q => q.includes('dim_stores'))};
  } catch (error) {
    await assert.rejects(readFile(planFile), {code: 'ENOENT'});
    throw error;
  } finally { globalThis.fetch = original.fetch; console.log = original.log; await rm(folder, {recursive: true}); }
}
const currencyNote = plan => plan.unsupported.filter(item => item.name === 'Store currency check');

test('without --store, a multi-currency warehouse writes no plan; one currency, or --store, plans', async () => {
  await assert.rejects(planWith(foundationTables, [['store-a', 'CAD'], ['store-b', 'USD']]), /more than one currency \(CAD, USD\)/);
  const single = await planWith(foundationTables, [['store-a', 'USD'], ['store-b', 'USD']]);
  assert.equal(single.rosterQueries.length, 1);
  assert.deepEqual(currencyNote(single.plan), []);
  const scoped = await planWith(foundationTables, [['store-a', 'CAD'], ['store-b', 'USD']], ['--store', 'store-a']);
  assert.equal(scoped.rosterQueries.length, 1);
  assert.deepEqual(scoped.plan.unsupported.filter(item => /^Store (currency|roster) check$/.test(item.name)), []);
});

test('a warehouse with one store installs no store choice and no All stores view', async () => {
  const keys = plan => plan.actions.map(a => a.key);
  const parameters = plan => plan.actions.filter(a => a.kind === 'dashboard')
    .flatMap(a => a.changes.find(c => c.field === 'layout')?.after.parameters ?? []).map(p => p.id);
  for (const extra of [[], ['--store', 'store-a']]) {
    const several = (await planWith(foundationTables, [['store-a', 'USD'], ['store-b', 'USD']], extra)).plan;
    assert.ok(keys(several).includes('dashboard:stores') && keys(several).includes('question:stores'));
    assert.ok(parameters(several).includes('store'));
    const one = (await planWith(foundationTables, [['store-a', 'USD']], extra)).plan;
    assert.ok(!keys(one).includes('dashboard:stores') && !keys(one).includes('question:stores'));
    assert.ok(!parameters(one).includes('store'));
    // Not a limitation: there is nothing to compare, so nothing is reported missing.
    assert.ok(!one.unsupported.some(item => /stores/i.test(item.name)));
  }
});

test('a warehouse without synced store currencies still plans, and the plan lists the skipped check', async () => {
  for (const [synced, reason] of [[foundationTables.filter(t => t.name !== 'dim_stores'), 'Source table is not synced in the selected dataset.'],
    [withoutCurrency, 'dim_stores has no synced store_currency_code.']]) {
    const {plan, rosterQueries} = await planWith(synced, [['store-a', 'CAD'], ['store-b', 'USD']]);
    assert.deepEqual(rosterQueries, []);
    assert.deepEqual(currencyNote(plan), [{name: 'Store currency check', reason, kind: 'content'}]);
    assert.ok(plan.actions.some(a => a.key === 'question:kpis' && a.action === 'create'));
  }
});

test('CLI requires explicit targets, completed months and separate review/apply steps', () => {
  const args = ['--url', 'http://localhost:3031', '--database-id', '1', '--collection-id', '3',
    '--dataset', 'tenant_sm_transformed_v2', '--metadata-dataset', 'tenant_sm_metadata',
    '--api-key-file', '/tmp/customer-token', '--plan', '/tmp/review.json'];
  const options = argumentsFor(args, new Date('2026-10-12T12:00:00Z'));
  // No month: the cohorts roll; --as-of-month pins a completed one.
  assert.equal(options.asOf, null);
  assert.equal(argumentsFor([...args, '--as-of-month', '2026-09-01'], new Date('2026-10-12T12:00:00Z')).asOf, '2026-09-01');
  assert.equal(options.apply, false);
  assert.throws(() => argumentsFor([...args, '--apply', '/tmp/review.json']));
  assert.throws(() => argumentsFor([...args, '--session-file', '/tmp/session.json']));
  assert.throws(() => argumentsFor([...args, '--as-of-month', '2026-10-01'], new Date('2026-10-12T12:00:00Z')));
  assert.throws(() => argumentsFor([...args, '--as-of-month', '2026-13-01']));
});

test('the customer CLI runs when invoked through a symlinked download path', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sm-metabase-cli-test-'));
  const entry = join(folder, 'run.mjs');
  try {
    await symlink(fileURLToPath(new URL('../bin/sourcemedium-metabase.mjs', import.meta.url)), entry);
    const result = spawnSync(process.execPath, [entry], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Supply URL, database ID/);
  } finally { await unlink(entry); await rmdir(folder); }
});

test('planning cannot overwrite its credential file, including a symlink alias', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sm-metabase-token-test-'));
  const token = join(folder, 'token'); const alias = join(folder, 'alias');
  try {
    await writeFile(token, 'private-test-token'); await symlink(token, alias);
    const args = ['--url', 'http://localhost:3031', '--database-id', '1', '--collection-id', '3',
      '--dataset', 'sm_transformed_v2', '--metadata-dataset', 'sm_metadata', '--api-key-file', token];
    await assert.rejects(main([...args, '--plan', alias]), /separate files/);
    assert.equal(await readFile(token, 'utf8'), 'private-test-token');
  } finally { await unlink(alias); await unlink(token); await rmdir(folder); }
});

test('only verified Metabase versions are installed into', async () => {
  const {snapshot} = await import('../src/snapshot.mjs');
  for (const [tag, ok] of [['v0.64.1', true], ['v1.64.3', true], ['v0.65.0-beta', true], ['v0.65.2', true], ['v0.63.20', false], ['v0.66.0', false]]) {
    const api = async path => { if (path === '/api/session/properties') return {version: {tag}}; throw new Error('stop'); };
    await assert.rejects(snapshot((m, p) => api(p), {collection: 3}), ok ? /stop/ : /supports Metabase 0\.64 and 0\.65/, tag);
  }
});

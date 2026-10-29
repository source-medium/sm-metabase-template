import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, symlink, unlink, rmdir, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {client, metabaseUrl, readWarehouse, identifier, requireOneCurrency} from '../src/http.mjs';
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

// The warehouse answers the dim_stores currency query with one row per distinct currency.
const currencyWarehouse = (currencies, queries = []) => async (method, path, body) => {
  queries.push(body.native.query);
  return {status: 'completed', data: {cols: [{name: 'currency'}], rows: currencies.map(c => [c]), rows_truncated: false}};
};
const unscoped = {...options, store: undefined};
const withoutCurrency = foundationTables.map(t => t.name !== 'dim_stores' ? t :
  {...t, fields: t.fields.filter(f => f.name !== 'store_currency_code')});

test('stores in more than one currency are refused unless --store picks one', async () => {
  const queries = [];
  assert.deepEqual(await requireOneCurrency(currencyWarehouse(['USD'], queries), foundationTables, unscoped), []);
  assert.match(queries[0], /SELECT DISTINCT store_currency_code AS currency\s+FROM `tenant_sm_transformed_v2\.dim_stores`/);
  await assert.rejects(requireOneCurrency(currencyWarehouse(['EUR', 'USD']), foundationTables, unscoped),
    /tenant_sm_transformed_v2 report in more than one currency \(EUR, USD\)\..*Pass --store STORE_ID/);
  await assert.rejects(requireOneCurrency(currencyWarehouse([null, 'USD']), foundationTables, unscoped), /\(unset, USD\)/);
  await assert.rejects(requireOneCurrency(currencyWarehouse(['USD']), foundationTables.map(t => ({...t, schema: 'bad`name'})),
    {...unscoped, dataset: 'bad`name'}), /BigQuery identifiers/);
  const skipped = [];
  assert.deepEqual(await requireOneCurrency(currencyWarehouse(['EUR', 'USD'], skipped), foundationTables, options), []);
  assert.deepEqual(skipped, []);
});

test('an unsynced store currency skips the check and reports why, like a missing source', async () => {
  for (const [tables, reason] of [[foundationTables.filter(t => t.name !== 'dim_stores'), 'Source table is not synced in the selected dataset.'],
    [withoutCurrency, 'dim_stores has no synced store_currency_code.']]) {
    const queries = [];
    assert.deepEqual(await requireOneCurrency(currencyWarehouse(['EUR', 'USD'], queries), tables, unscoped),
      [{name: 'Store currency check', reason}]);
    assert.deepEqual(queries, []);
  }
});

test('a failed store currency query names the warehouse error', async () => {
  const failed = async () => ({status: 'failed', error: 'Access Denied: Table p:tenant_sm_transformed_v2.dim_stores'});
  await assert.rejects(requireOneCurrency(failed, foundationTables, unscoped),
    /^Error: The store currency query failed: Access Denied: Table p:tenant_sm_transformed_v2\.dim_stores\. No content was changed\.$/);
  await assert.rejects(requireOneCurrency(async () => ({status: 'failed'}), foundationTables, unscoped),
    /^Error: The store currency query failed\. No content was changed\.$/);
});

// main() against a fake Metabase: its content API, the database's synced tables, and native
// queries answered as BigQuery would, the currency read failing when its column does not exist.
async function planWith(synced, currencies, extra = []) {
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
      answer(currencies.map(currency => ({currency}))) : {status: 'failed', error: 'Unrecognized name: store_currency_code'};
  };
  const original = {fetch: globalThis.fetch, log: console.log};
  try {
    await writeFile(token, 'private-test-token');
    globalThis.fetch = async (url, init) => new Response(JSON.stringify(await api(init.method, url.slice(options.url.length),
      init.body === undefined ? undefined : JSON.parse(init.body))) ?? '');
    console.log = () => {};
    await main(['--url', options.url, '--database-id', '1', '--collection-id', '3', '--dataset', options.dataset,
      '--metadata-dataset', options.metadataDataset, '--api-key-file', token, '--plan', planFile, ...extra]);
    return {plan: JSON.parse(await readFile(planFile, 'utf8')), currencyQueries: queries.filter(q => q.includes('dim_stores'))};
  } catch (error) {
    await assert.rejects(readFile(planFile), {code: 'ENOENT'});
    throw error;
  } finally { globalThis.fetch = original.fetch; console.log = original.log; await rm(folder, {recursive: true}); }
}
const currencyNote = plan => plan.unsupported.filter(item => item.name === 'Store currency check');

test('without --store, a multi-currency warehouse writes no plan; one currency, or --store, plans', async () => {
  await assert.rejects(planWith(foundationTables, ['CAD', 'USD']), /more than one currency \(CAD, USD\)/);
  const single = await planWith(foundationTables, ['USD']);
  assert.equal(single.currencyQueries.length, 1);
  assert.deepEqual(currencyNote(single.plan), []);
  const scoped = await planWith(foundationTables, ['CAD', 'USD'], ['--store', 'store-a']);
  assert.deepEqual(scoped.currencyQueries, []);
  assert.deepEqual(currencyNote(scoped.plan), []);
});

test('a warehouse without synced store currencies still plans, and the plan lists the skipped check', async () => {
  for (const [synced, reason] of [[foundationTables.filter(t => t.name !== 'dim_stores'), 'Source table is not synced in the selected dataset.'],
    [withoutCurrency, 'dim_stores has no synced store_currency_code.']]) {
    const {plan, currencyQueries} = await planWith(synced, ['CAD', 'USD']);
    assert.deepEqual(currencyQueries, []);
    assert.deepEqual(currencyNote(plan), [{name: 'Store currency check', reason}]);
    assert.ok(plan.actions.some(a => a.key === 'question:kpis' && a.action === 'create'));
  }
});

test('CLI requires explicit targets, completed months and separate review/apply steps', () => {
  const args = ['--url', 'http://localhost:3031', '--database-id', '1', '--collection-id', '3',
    '--dataset', 'tenant_sm_transformed_v2', '--metadata-dataset', 'tenant_sm_metadata',
    '--api-key-file', '/tmp/customer-token', '--plan', '/tmp/review.json'];
  const options = argumentsFor(args, new Date('2026-10-12T12:00:00Z'));
  assert.equal(options.asOf, '2026-09-01');
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

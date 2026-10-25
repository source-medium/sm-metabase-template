import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, symlink, unlink, rmdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {client, metabaseUrl, readWarehouse, identifier} from '../src/http.mjs';
import {argumentsFor, main} from '../bin/sourcemedium-metabase.mjs';

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

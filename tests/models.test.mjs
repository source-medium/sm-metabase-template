import test from 'node:test';
import assert from 'node:assert/strict';
import {compileModels} from '../src/models.mjs';
import {compileCatalog} from '../src/catalog.mjs';
import {modelCard} from '../src/content.mjs';
import {definitions} from '../src/foundation.mjs';
import {documented, options, tables, rows} from './fixtures.mjs';

test('documented models do not depend on DATE, Store, data population or supported metrics', () => {
  const dimension = {id: 40, schema: options.dataset, name: 'dim_customers', active: true,
    fields: [{id: 401, name: 'customer_id', base_type: 'type/Text'}, {id: 402, name: 'first_order_at', base_type: 'type/DateTime'}]};
  const all = [...tables, dimension];
  const catalog = compileCatalog(rows.map(r => ({...r, has_filter: true})), all, options.dataset, documented(all));
  assert.equal(catalog.metrics.length, 0);
  assert.deepEqual(catalog.models.map(m => m.name), ['dim_customers', 'rpt_executive_summary_daily']);
  const card = modelCard(catalog.models[0], 1);
  assert.deepEqual(card.dataset_query.query, {'source-table': 40, fields: [['field', 401, null], ['field', 402, null]]});
  assert.equal(card.result_metadata[1].base_type, 'type/DateTime');
});

test('dictionary identity excludes backups and deduplicates store/column descriptions', () => {
  const backup = {...tables[0], id: 99, name: 'rpt_executive_summary_daily_backup'};
  const dictionary = documented(tables);
  dictionary[0].table_description = 'Published daily executive measures.';
  dictionary[0].columns[4].column_description = 'Summary orders, including fractional source counts.';
  const result = compileModels([...dictionary, ...dictionary], [...tables, backup], options.dataset);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].key, `model:${tables[0].name}`);
  const card = modelCard(result.models[0], 1);
  assert.match(card.description, /Published daily executive measures/);
  assert.match(card.result_metadata.find(f => f.name === 'order_count').description, /fractional/);
});

test('different documented datasets get distinct identities and metrics bind to the selected transformed model', () => {
  const extra = {...tables[0], schema: 'tenant_sm_experimental', id: 88};
  const all = [extra, ...tables];
  const catalog = compileCatalog(rows, all, options.dataset, documented(all));
  assert.equal(catalog.models.length, 2);
  assert.equal(new Set(catalog.models.map(m => m.key)).size, 2);
  assert.equal(catalog.models.find(m => m.id === 88).key, `model:tenant_sm_experimental.${extra.name}`);
  assert.equal(catalog.metrics.length, rows.length);
  const definition = definitions(catalog, all, {}, options);
  const metric = definition.nodes.find(n => n.key === 'metric:order_count_summary');
  assert.equal(metric.dependencies[0], `model:${tables[0].name}`);
  assert.match(modelCard(catalog.models.find(m => m.id === 88), 1, options.dataset).name, /^tenant_sm_experimental:/);
});

test('unavailable dictionary tables are reported individually without hiding readable models', () => {
  const missing = {...tables[0], schema: 'tenant_sm_utils', name: 'dim_dates'};
  const inactive = {...tables[0], name: 'dim_inactive', active: false};
  const empty = {...tables[0], name: 'dim_empty', fields: []};
  const result = compileModels(documented([...tables, missing, inactive, empty]), [...tables, inactive, empty], options.dataset);
  assert.equal(result.models.length, 1);
  assert.equal(result.unavailable.length, 3);
  assert.ok(result.unavailable.some(m => m.name === 'Model tenant_sm_utils.dim_dates'));
});

test('public top-level arrays/distributions retain their physical fields while nested and internal fields are omitted', () => {
  const table = {...tables[0], fields: [...tables[0].fields,
    {id: 91, name: 'attribution_distribution', base_type: 'type/Text'},
    {id: 92, name: 'product_array', base_type: 'type/Text'},
    {id: 93, name: 'nested', parent_id: 91, base_type: 'type/Text'},
    {id: 94, name: '_synced_at', base_type: 'type/DateTime'}]};
  const result = compileModels(documented([table]), [table], options.dataset);
  assert.deepEqual(result.models[0].columns.slice(-2).map(f => f.id), [91, 92]);
});

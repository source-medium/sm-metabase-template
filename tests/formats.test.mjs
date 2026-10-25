import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCatalog} from '../src/catalog.mjs';
import {definitions, foundationSql} from '../src/foundation.mjs';
import {snapshot, makePlan} from '../src/snapshot.mjs';
import {applyPlan} from '../src/apply.mjs';
import {cardContent} from '../src/ownership.mjs';
import {questions as recipes, outputFormats, outputDimensions} from '../foundation/questions.mjs';
import {modelColumnFormat, columnSettings, formattingFor, valueFormats} from '../src/formats.mjs';
import {rows, paidRows, foundationTables, tables, options, documented, fakeMetabase, columnFormats, withFormats} from './fixtures.mjs';

const sql = foundationSql();
const all = foundationTables;
const compiled = (catalogRows = withFormats([...rows, ...paidRows]), formats = columnFormats) =>
  compileCatalog(catalogRows, all, options.dataset, documented(all, formats));
const define = catalog => ({...definitions(catalog, all, sql, options), unsupported: [],
  formatting: formattingFor(catalog)});
const card = (definition, key) => definition.nodes.find(n => n.key === key).body(new Map());
const setting = (body, column) => body.visualization_settings.column_settings?.[JSON.stringify(['name', column])];
async function plan(api, definition) { return makePlan(definition, await snapshot(api, options, definition.nodes), options); }

test('every published format maps to Metabase formatting, and an unknown one formats nothing', () => {
  assert.deepEqual(modelColumnFormat('currency'), {settings: {decimals: 2}});
  assert.equal(modelColumnFormat('currency').semantic_type, undefined);
  assert.deepEqual(modelColumnFormat('percent'), {semantic_type: 'type/Percentage', settings: {number_style: 'percent'}});
  assert.deepEqual(modelColumnFormat('count'), {semantic_type: 'type/Quantity'});
  assert.deepEqual(columnSettings('currency'), {decimals: 2});
  assert.equal(columnSettings('currency').currency, undefined);
  assert.deepEqual(columnSettings('ratio'), {decimals: 2});
  assert.deepEqual(columnSettings('identifier'), {number_separators: '.'});
  for (const format of [...valueFormats, null, 'dollars']) assert.equal(typeof columnSettings(format), 'object');
  assert.deepEqual(columnSettings('count'), {}, 'counts keep fractional attributed conversions visible');
  assert.deepEqual(modelColumnFormat(null), {});
});

test('models carry each column\'s unit; store and channel stay categories', () => {
  const definition = define(compiled());
  const model = card(definition, 'model:rpt_executive_summary_daily');
  const column = name => model.result_metadata.find(c => c.name === name);
  assert.equal(column('order_net_revenue').semantic_type, null);
  assert.deepEqual(column('order_net_revenue').settings, {decimals: 2});
  assert.equal(column('order_count').semantic_type, 'type/Quantity');
  assert.equal(column('order_count').settings, undefined);
  assert.equal(column('sm_store_id').semantic_type, 'type/Category');
  assert.equal(column('date').settings, undefined);
});

test('metric cards carry the catalog\'s unit under the column Metabase names', () => {
  const definition = define(compiled());
  assert.deepEqual(setting(card(definition, 'metric:order_net_revenue_summary'), 'sum'), {decimals: 2});
  assert.deepEqual(setting(card(definition, 'metric:marketing_efficiency_ratio_summary'), 'expression'), {decimals: 2});
  assert.deepEqual(setting(card(definition, 'metric:click_through_rate'), 'expression'), {number_style: 'percent'});
  assert.deepEqual(card(definition, 'metric:order_count_summary').visualization_settings, {});
});

test('every native output is a catalog metric, a declared unit or a dimension, and formats from it', () => {
  const types = new Set(['STRING', 'INT64', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOL']);
  for (const recipe of recipes) {
    const aliases = [...sql[recipe.key].matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)].map(m => m[1]).filter(a => !types.has(a));
    const unclassified = aliases.filter(a => !recipe.metrics?.[a] && !(a in outputFormats) && !outputDimensions.includes(a));
    assert.deepEqual(unclassified, [], `${recipe.key} outputs need a unit or dimension`);
    for (const a of Object.keys(recipe.metrics || {})) assert.ok(aliases.includes(a), `${recipe.key}.${a} is not an output`);
  }
  for (const [alias, format] of Object.entries(outputFormats)) {
    assert.ok(valueFormats.includes(format));
    assert.ok(recipes.some(r => new RegExp(`\\bAS\\s+${alias}\\b`, 'i').test(sql[r.key])), `${alias} is in no recipe`);
  }
  const definition = define(compiled());
  const kpis = card(definition, 'question:kpis');
  assert.deepEqual(setting(kpis, 'net_revenue'), {column_title: 'Net revenue', decimals: 2});
  assert.deepEqual(setting(kpis, 'mer'), {column_title: 'MER', decimals: 2});
  assert.deepEqual(setting(kpis, 'summary_orders'), {column_title: 'Summary orders'});
  assert.deepEqual(setting(card(definition, 'question:paid_channel'), 'click_through_rate'),
    {column_title: 'Click-through rate', number_style: 'percent'});
  assert.deepEqual(setting(card(definition, 'question:paid_channel'), 'clicks'), {column_title: 'Clicks'}, 'no forced decimals on counts');
});

test('an install made before formats were published upgrades in place, then plans unchanged', async () => {
  const m = fakeMetabase();
  const unformatted = define(compiled(rows.map(r => ({...r, value_format: null})), {}));
  assert.equal(unformatted.formatting.published, false);
  assert.match(unformatted.formatting.note, /catalog-mapped outputs are unformatted/);
  assert.deepEqual(setting(card(unformatted, 'question:kpis'), 'net_revenue'), {column_title: 'Net revenue'});
  assert.deepEqual(setting(card(unformatted, 'question:retention'), 'second_purchase_rate'), {column_title: 'Second-purchase rate', number_style: 'percent'});
  await applyPlan(m.api, unformatted, options, await plan(m.api, unformatted));
  // Installs made before this adapter formatted anything recorded content digests
  // without a settings key; an unformatted model must still project exactly that, or
  // every existing customer model would plan as a customer edit (a conflict).
  for (const model of [...m.cards.values()].filter(c => c.type === 'model')) {
    assert.ok(cardContent(model).result_metadata.every(c => !('settings' in c)));
  }
  const formatted = define(compiled(withFormats(rows)));
  const upgrade = await plan(m.api, formatted);
  assert.deepEqual(upgrade.actions.filter(a => ['conflict', 'blocked'].includes(a.action)), []);
  assert.equal(upgrade.actions.find(a => a.key === 'model:rpt_executive_summary_daily').action, 'update');
  assert.equal(upgrade.actions.find(a => a.key === 'question:kpis').action, 'update');
  await applyPlan(m.api, formatted, options, upgrade);
  const model = [...m.cards.values()].find(c => c.type === 'model' && c.name.includes('executive summary'));
  assert.deepEqual(model.result_metadata.find(c => c.name === 'ad_spend').settings, {decimals: 2});
  assert.ok((await plan(m.api, formatted)).actions.every(a => a.action === 'unchanged'));
});

test('the plan reports numeric model columns the warehouse publishes no unit for', () => {
  const catalog = compiled(withFormats(rows), {...columnFormats, ad_spend: null});
  const formatting = formattingFor(catalog);
  assert.equal('currency' in formatting, false);
  assert.deepEqual(formatting.unformatted.find(m => m.model.endsWith('rpt_executive_summary_daily')).columns, ['ad_spend']);
  assert.ok(!formatting.unformatted.some(m => m.columns.includes('sm_store_id')), 'only numeric columns');
  assert.equal(compiled(withFormats(rows), {}).metrics.find(m => m.name === 'order_net_revenue_summary').valueFormat, 'currency');
});

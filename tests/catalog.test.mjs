import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCatalog, bind, sqlExpression} from '../src/catalog.mjs';
import {definitions, foundationSql} from '../src/foundation.mjs';
import {rows, tables, simple, options, documented, adTable, paidRows, filteredRows, validChannelFilter, foundationTables} from './fixtures.mjs';
import {metricCard} from '../src/content.mjs';

test('catalog sums and ratios retain physical types and refer to shared metric identities', () => {
  const catalog = compileCatalog(rows, tables, options.dataset, documented(tables));
  assert.equal(catalog.metrics.length, 7);
  assert.equal(catalog.unsupported.length, 0);
  assert.equal(catalog.models[0].columns.find(c => c.name === 'order_count').base_type, 'type/Float');
  const mer = catalog.metrics.find(m => m.name === 'marketing_efficiency_ratio_summary');
  assert.deepEqual(bind(mer.calculation, tables[0].fields, new Map([['order_net_revenue_summary', 44], ['total_ad_spend_summary', 45]])), ['/', ['metric', 44], ['metric', 45]]);
});

test('one bad catalog row leaves independent valid metrics available', () => {
  const bad = [simple('filtered', 'SUM(order_count)', {has_filter: true, filter_condition: 'is_valid'}),
    simple('wrong_type', 'SUM(sm_store_id)'), simple('injection', 'SUM(order_count); DROP TABLE x'),
    simple('unknown', 'SUM(not_a_column)'), simple('window', 'CUMULATIVE_SUM(order_count)', {metric_type: 'cumulative'}),
    simple('wrong_time', 'SUM(order_count)', {metric_time_expression: 'DATE(date)'}),
    simple('day_only', 'SUM(order_count)', {metric_time_grains: 'day'}),
    simple('alias', 'SUM(order_count)', {is_abbreviation: true, preferred_metric_name: 'order_count_summary'})];
  const catalog = compileCatalog([...rows, ...bad], tables, options.dataset, documented(tables));
  assert.equal(catalog.metrics.length, 7);
  assert.equal(catalog.unsupported.length, bad.length);
});

test('models and metric bindings exclude nested fields with ambiguous short names', () => {
  const nested = {...tables[0], fields: [...tables[0].fields, {id: 999, parent_id: 4, name: 'nested_value', base_type: 'type/Decimal'}]};
  const catalog = compileCatalog([...rows, simple('nested', 'SUM(nested_value)')], [nested], options.dataset, documented([nested]));
  assert.ok(catalog.unsupported.some(m => m.name === 'nested'));
  assert.ok(!catalog.models[0].columns.some(c => c.parent_id));
});

test('metrics using excluded model columns are omitted without breaking valid definitions', () => {
  const hidden = {...tables[0], fields: [...tables[0].fields, {id: 999, name: '_internal_measure', base_type: 'type/Decimal'}]};
  const catalog = compileCatalog([...rows, simple('internal', 'SUM(_internal_measure)')], [hidden], options.dataset, documented([hidden]));
  assert.ok(catalog.unsupported.some(m => m.name === 'internal'));
  assert.equal(catalog.metrics.length, rows.length);
  const sql = foundationSql();
  const d = definitions(catalog, [hidden], sql, options);
  const ids = new Map(d.nodes.map((n, i) => [n.key, i + 1]));
  for (const node of d.nodes) assert.doesNotThrow(() => node.body(ids));
});

test('scalar distinct counts are mapped, while cycles and cross-model dependencies are refused', () => {
  const ratio = (name, a, b) => simple(name, `${a} / ${b}`, {metric_type: 'ratio', dependent_metrics: `${a}, ${b}`});
  const catalog = compileCatalog([...rows, simple('stores', 'COUNT(DISTINCT sm_store_id)'),
    ratio('cycle_a', 'cycle_b', 'order_count_summary'), ratio('cycle_b', 'cycle_a', 'order_count_summary')], tables, options.dataset, documented(tables));
  assert.equal(catalog.metrics.find(m => m.name === 'stores').calculation[0], 'distinct');
  assert.ok(catalog.unsupported.some(m => m.name === 'cycle_a'));
  assert.ok(catalog.unsupported.some(m => m.name === 'cycle_b'));
  const other = {...tables[0], id: 20, name: 'other'};
  const cross = compileCatalog([...rows, simple('other_count', 'SUM(order_count)', {underlying_model: 'other'}), ratio('cross', 'other_count', 'order_count_summary')], [...tables, other], options.dataset, documented([...tables, other]));
  assert.ok(cross.unsupported.some(m => m.name === 'cross'));
});

test('duplicate catalog identities cannot silently pick an arbitrary definition', () => {
  const catalog = compileCatalog([...rows, simple('order_count_summary', 'SUM(ad_spend)')], tables, options.dataset, documented(tables));
  assert.ok(catalog.unsupported.some(m => m.name === 'order_count_summary'));
  assert.ok(catalog.metrics.some(m => m.name === 'order_net_revenue_summary'));
});

test('native cards consume canonical snippets and preserve required dates and optional channel filters', () => {
  const catalog = compileCatalog(rows, tables, options.dataset, documented(tables));
  const sql = foundationSql();
  const d = definitions(catalog, tables, sql, options);
  const ids = new Map(d.nodes.map((n, i) => [n.key, i + 1]));
  const card = d.nodes.find(n => n.key === 'question:kpis').body(ids);
  const tags = card.dataset_query.native['template-tags'];
  assert.equal(tags.date.required, true);
  assert.equal(tags.date.default, 'past28days');
  assert.deepEqual(tags.compare, {id: 'compare', name: 'compare', 'display-name': 'Compare with', required: true, type: 'text', default: 'previous'});
  assert.deepEqual(tags.channel.default, ['online_dtc']);
  assert.ok(card.dataset_query.native.query.includes('snippet: SM'));
  assert.ok(card.dataset_query.native.query.includes('[[AND {{channel}}]]'));
  assert.ok(!JSON.stringify(card.dataset_query).includes('round'));
});

test('SQL snippet expressions come from the same parsed graph, including safe weighted ratios', () => {
  const catalog = compileCatalog(rows, tables, options.dataset, documented(tables));
  assert.equal(sqlExpression(catalog.metrics.find(m => m.name === 'marketing_efficiency_ratio_summary'), catalog.metrics),
    'SAFE_DIVIDE(SUM(`order_net_revenue`), SUM(`ad_spend`))');
  const changed = compileCatalog(rows.map(r => r.metric_name === 'order_net_revenue_summary' ? {...r, calculation: 'SUM(order_gross_revenue)'} : r), tables, options.dataset, documented(tables));
  assert.ok(sqlExpression(changed.metrics.find(m => m.name === 'marketing_efficiency_ratio_summary'), changed.metrics).includes('order_gross_revenue'));
});

test('paid questions filter and group by the advertising platform, not the sales channel', () => {
  const all = [...tables, adTable];
  const sql = foundationSql();
  const d = definitions(compileCatalog([...rows, ...paidRows], all, options.dataset, documented(all)), all, sql, options);
  const ids = new Map(d.nodes.map((n, i) => [n.key, i + 1]));
  for (const key of ['question:paid_channel', 'question:paid_campaign']) {
    const native = d.nodes.find(n => n.key === key).body(ids).dataset_query.native;
    assert.deepEqual(native['template-tags'].ad_platform.dimension, ['field', 44, null]);
    assert.equal(native['template-tags'].ad_platform.default, undefined);
    assert.equal(native['template-tags'].channel, undefined);
    assert.match(native.query, /GROUP BY source_system/);
  }
  assert.deepEqual(d.nodes.find(n => n.key === 'dashboard:paid').layout.parameters.map(p => p.id),
    ['date', 'ad_platform', 'store', 'compare', 'compare2', 'grain', 'campaign', 'ad_set', 'ad', 'paid_metric', 'breakdown']);
});

// reporting_queries #2377 (2026-10-24) filtered the summary order measures to valid sales
// channels. A refused filter dropped the KPI, trend, daily and weekly questions and with
// them the executive dashboard; the filter now compiles to a conditional sum.
test('a column-list filter compiles to a conditional sum in metrics, snippets and dashboards', () => {
  const catalog = compileCatalog(filteredRows, tables, options.dataset, documented(tables));
  assert.deepEqual(catalog.unsupported, []);
  const net = catalog.metrics.find(m => m.name === 'order_net_revenue_summary');
  assert.deepEqual(net.calculation, ['sum-where', {field: 'order_net_revenue'},
    {column: 'sm_channel', values: ['online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop']}]);
  assert.equal(sqlExpression(net, catalog.metrics),
    "SUM(IF(`sm_channel` IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), `order_net_revenue`, 0))");
  assert.equal(sqlExpression(catalog.metrics.find(m => m.name === 'marketing_efficiency_ratio_summary'), catalog.metrics),
    "SAFE_DIVIDE(SUM(IF(`sm_channel` IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), `order_net_revenue`, 0)), SUM(`ad_spend`))");
  const model = catalog.models.find(m => m.name === net.table);
  const card = metricCard({...net, valueFormat: 'currency'}, model, options.database, 99, new Map());
  assert.deepEqual(card.dataset_query.query.aggregation, [['sum-where', ['field', 4, null],
    ['=', ['field', 3, null], 'online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop']]]);
  // Observed on Metabase v0.64.1: the conditional sum's column carries its input's name.
  assert.deepEqual(Object.keys(card.visualization_settings.column_settings), [JSON.stringify(['name', 'sum_where_order_net_revenue'])]);
  const built = definitions(catalog, tables, foundationSql(), options);
  for (const key of ['question:kpis', 'question:comparison', 'question:trend', 'question:business', 'dashboard:summary', 'dashboard:foundation']) {
    assert.ok(built.nodes.some(n => n.key === key), key);
  }
});

test('other filtered metrics stay unsupported rather than approximated', () => {
  const cases = [
    simple('filtered_count', 'COUNT(order_count) WHERE [filter applied]', {has_filter: true, filter_condition: validChannelFilter}),
    simple('free_sql', 'SUM(order_count) WHERE [filter applied]', {has_filter: true, filter_condition: "sm_channel <> 'excluded'"}),
    simple('numeric_list', 'SUM(order_count) WHERE [filter applied]', {has_filter: true, filter_condition: "order_count in ('1')"}),
    simple('quoted', 'SUM(order_count) WHERE [filter applied]', {has_filter: true, filter_condition: "sm_channel in ('a'' OR 1=1 --')"}),
    simple('unmarked', 'SUM(order_count)', {has_filter: true, filter_condition: validChannelFilter}),
    simple('flag_off', 'SUM(order_count) WHERE [filter applied]', {has_filter: false, filter_condition: null}),
  ];
  const catalog = compileCatalog(cases, tables, options.dataset, documented(tables));
  assert.deepEqual(catalog.metrics, []);
  assert.deepEqual(catalog.unsupported.map(u => u.name).sort(), cases.map(c => c.metric_name).sort());
});

test('a boolean column filter compiles where the model has that boolean', () => {
  const lines = foundationTables.find(t => t.name === 'obt_orders');
  const model = {...lines, name: 'rpt_executive_summary_daily', id: 10, fields: [...tables[0].fields, {id: 120, name: 'is_order_sm_valid', base_type: 'type/Boolean', display_name: 'valid', active: true}]};
  const catalog = compileCatalog([simple('valid_revenue', 'SUM(order_net_revenue) WHERE [filter applied]',
    {has_filter: true, filter_condition: 'is_order_sm_valid'})], [model], options.dataset, documented([model]));
  assert.equal(sqlExpression(catalog.metrics[0], catalog.metrics), 'SUM(IF(`is_order_sm_valid`, `order_net_revenue`, 0))');
});

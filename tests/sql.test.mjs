import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {compileCatalog, sqlExpression} from '../src/catalog.mjs';
import {foundationSql} from '../src/foundation.mjs';
import {questions, VALID_SALES_CHANNELS} from '../foundation/questions.mjs';
import {filters} from '../src/filters.mjs';
import {foundationTables, documented, options} from './fixtures.mjs';

// The producer snapshot reporting_queries publishes; smstack keeps this copy byte-identical.
const contract = JSON.parse(readFileSync(new URL('../contracts/dashboard-metrics-v1/definitions.json', import.meta.url), 'utf8'));
const sql = foundationSql();
const normalize = text => text.replaceAll('`', '').replace(/\s+/g, ' ').trim().toLowerCase();

// The contract carries no time grains or abbreviations; every summary metric supports all grains.
const catalogRows = contract.metrics.map(m => ({...m, metric_time_grains: m.metric_time_grains ?? 'day, week, month, quarter, year',
  is_abbreviation: false, preferred_metric_name: null}));
// The fixtures model only the columns the foundation reads; add the ones the contract names.
const fields = new Map([['rpt_executive_summary_daily', ['order_net_revenue', 'order_count', 'ad_spend', 'website_sessions']],
  ['rpt_ad_performance_daily', ['ad_spend', 'ad_impressions', 'ad_clicks', 'ad_platform_reported_conversions', 'ad_platform_reported_revenue']]]);
const tables = foundationTables.map(t => ({...t, fields: [...t.fields, ...(fields.get(t.name) || [])
  .filter(name => !t.fields.some(f => f.name === name))
  .map((name, i) => ({name, id: t.id * 100 + i, base_type: 'type/Decimal', display_name: name, active: true}))]}));
const catalog = compileCatalog(catalogRows, tables, options.dataset, documented(tables));

test('the valid sales channels are the published summary filter', () => {
  for (const name of ['order_net_revenue_summary', 'order_count_summary']) {
    const metric = contract.metrics.find(m => m.metric_name === name);
    const values = [.../'([^']+)'/g[Symbol.matchAll](metric.filter_condition)].map(m => m[1]);
    assert.deepEqual(values, VALID_SALES_CHANNELS, name);
  }
});

test('every published summary and paid metric the foundation maps compiles', () => {
  const mapped = new Set(questions.flatMap(q => Object.values(q.metrics || {}).flat()));
  for (const name of mapped) assert.ok(catalog.metrics.some(m => m.name === name), `${name}: ${catalog.unsupported.find(u => u.name === name)?.reason}`);
});

test('each mapped SQL output is the catalog definition, so manual SQL and installed snippets agree', () => {
  for (const question of questions) {
    for (const [alias, metric] of Object.entries(question.metrics || {})) {
      const lines = sql[question.key].split('\n').filter(line => new RegExp(`\\sAS\\s+${alias}\\s*,?\\s*$`, 'i').test(line));
      assert.equal(lines.length, 1, `${question.key}.${alias} must be one output line`);
      const expression = lines[0].replace(new RegExp(`\\s+AS\\s+${alias}\\s*,?\\s*$`, 'i'), '');
      const expected = Array.isArray(metric) ?
        `SAFE_DIVIDE(${metric.map(n => sqlExpression(catalog.metrics.find(m => m.name === n), catalog.metrics)).join(', ')})` :
        sqlExpression(catalog.metrics.find(m => m.name === metric), catalog.metrics);
      assert.equal(normalize(expression), normalize(expected), `${question.key}.${alias}`);
    }
  }
});

// Order measures count valid sales channels; spend, sessions and clicks count every row.
const SALES = ['order_gross_revenue', 'order_discounts', 'order_refunds', 'order_net_revenue', 'order_count',
  'new_customer_order_net_revenue', 'new_customer_order_count', 'repeat_customer_order_net_revenue', 'repeat_customer_order_count'];
test('summary SQL counts order measures only on valid sales channels', () => {
  const valid = `IF(sm_channel IN (${VALID_SALES_CHANNELS.map(c => `'${c}'`).join(', ')}), `;
  for (const question of questions.filter(q => q.table === 'rpt_executive_summary_daily')) {
    for (const column of SALES) {
      for (const match of sql[question.key].matchAll(new RegExp(`\\b${column}\\b`, 'g'))) {
        const before = sql[question.key].slice(0, match.index);
        assert.ok(before.endsWith(valid), `${question.key}: ${column} at ${match.index} is not wrapped in the valid-channel test`);
      }
    }
  }
});

test('every question has its SQL file and every SQL file belongs to a question', () => {
  const files = readdirSync(new URL('../foundation/sql/', import.meta.url)).filter(f => f.endsWith('.sql')).map(f => f.slice(0, -4)).sort();
  assert.deepEqual(files, questions.map(q => q.key).sort());
});

test('field filters see the source table under its unaliased DATASET name', () => {
  for (const question of questions) {
    const text = sql[question.key];
    assert.ok(text.includes(`\`DATASET.${question.table}\``), `${question.key} reads DATASET.${question.table}`);
    for (const use of text.matchAll(new RegExp(`\`DATASET\\.${question.table}\`(\\s*)([A-Za-z_]*)`, 'g'))) {
      const next = use[2].toUpperCase();
      assert.ok(!use[1] || ['', 'WHERE', 'JOIN', 'LEFT', 'ON', 'GROUP', 'ORDER', 'CROSS', 'UNION'].includes(next),
        `${question.key} must not alias ${question.table} (found ${use[2]})`);
    }
    assert.ok(!/`[a-z][a-z0-9-]+\.DATASET\./.test(text), `${question.key} must not name a project`);
    for (const tag of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
      const allowed = filters(question.scope, {}).map(p => p.id);
      assert.ok(allowed.includes(tag[1]), `${question.key} uses {{${tag[1]}}} outside its ${question.scope} filters`);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {compileCatalog, sqlExpression} from '../src/catalog.mjs';
import {foundationSql} from '../src/foundation.mjs';
import {questions, dashboards, VALID_SALES_CHANNELS} from '../foundation/questions.mjs';
import {filtersIn} from '../src/filters.mjs';
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

test('field filters see the source table under its unaliased DATASET or METADATA name', () => {
  for (const question of questions) {
    const text = sql[question.key];
    const home = question.metadata ? 'METADATA' : 'DATASET';
    assert.ok(text.includes(`\`${home}.${question.table}\``), `${question.key} reads ${home}.${question.table}`);
    for (const use of text.matchAll(new RegExp(`\`${home}\\.${question.table}\`(\\s*)([A-Za-z_]*)`, 'g'))) {
      const next = use[2].toUpperCase();
      assert.ok(!use[1] || ['', 'WHERE', 'JOIN', 'LEFT', 'ON', 'GROUP', 'ORDER', 'CROSS', 'UNION'].includes(next),
        `${question.key} must not alias ${question.table} (found ${use[2]})`);
    }
    assert.ok(!/`[a-z][a-z0-9-]+\.(DATASET|METADATA)\./.test(text), `${question.key} must not name a project`);
    assert.doesNotThrow(() => filtersIn(text, options), `${question.key} names only known filters`);
  }
});

// Metabase refuses to run a query whose optional filter has no value outside [[ ... ]].
test('a filter without a default appears only inside an optional clause', () => {
  for (const question of questions) {
    const text = sql[question.key];
    const outside = text.replace(/\[\[[\s\S]*?\]\]/g, '');
    for (const filter of filtersIn(text, options).filter(f => f.default === undefined && !f.required)) {
      assert.ok(!outside.includes(`{{${filter.id}}}`), `${question.key} uses {{${filter.id}}} outside [[ ... ]]`);
    }
  }
});

test('includes expand once, and comments name no filter', () => {
  for (const question of questions) {
    const text = sql[question.key];
    assert.ok(!/-- @include/.test(text), `${question.key} has an unexpanded include`);
    for (const comment of text.matchAll(/--[^\n]*/g)) assert.ok(!comment[0].includes('{{'), `${question.key} comment: ${comment[0]}`);
  }
});

test('tables name channels and ad platforms; filters and keys keep the stored value', () => {
  for (const key of ['orders', 'contributions', 'order_detail'])
    assert.match(sql[key], /WHEN 'online_dtc' THEN 'Online DTC'/, `${key} names sales channels`);
  for (const key of ['paid_channel', 'paid_campaign', 'creatives', 'paid_trend', 'paid_breakdown'])
    assert.match(sql[key], /WHEN 'meta_ads' THEN 'Meta'/, `${key} names ad platforms`);
  // An unknown value shows as stored rather than guessed at.
  assert.match(sql.contributions, /ELSE IFNULL\(sm_channel, '\(none\)'\)/);
  // The breakdown joins its periods on the stored platform, not its display name.
  assert.match(sql.paid_breakdown, /ELSE IFNULL\(source_system, '\(none\)'\)\n {4}END AS breakdown_key/);
  for (const key of ['paid_channel', 'creatives']) assert.ok(sql[key].includes('{{ad_platform}}'), `${key} filters the stored platform`);
});

const rawSql = key => readFileSync(new URL(`../foundation/sql/${key}.sql`, import.meta.url), 'utf8');
const creativeQuestions = ['creative_totals', 'creative_formats', 'creative_launches', 'creatives'];

test('creative questions take first spend from one definition, looking back a year from the selection', () => {
  for (const key of ['creative_totals', 'creative_launches', 'creatives']) {
    assert.match(rawSql(key), /^-- @include first_spend$/m, `${key} uses the shared first spend`);
    assert.doesNotMatch(rawSql(key), /MIN\(date\) AS first_spend/, `${key} defines no first spend of its own`);
    assert.match(sql[key], /DATE_SUB\(start_date, INTERVAL 365 DAY\) FROM selected\) AND \(SELECT end_date FROM selected\)/);
  }
});

test('a creative is its ad platform name and ID wherever creatives are counted', () => {
  for (const key of creativeQuestions) {
    const counts = [...sql[key].matchAll(/COUNT\(DISTINCT IF\([^,]+,([\s\S]*?), NULL\)\)/g)];
    if (key !== 'creatives') assert.ok(counts.length > 0, `${key} counts creatives`);
    for (const count of counts)
      assert.ok(/WHEN 'facebook_ads' THEN 'Meta'[\s\S]*, '\/', ad_creative_id\)/.test(count[1]) || count[1].trim() === 'creative_key',
        `${key} counts a creative by its platform name: ${count[1].trim().slice(0, 60)}`);
  }
});

test('selecting a format, (none) included, filters the tab by the name the formats table shows', () => {
  const formatName = readFileSync(new URL('../foundation/sql/include/creative_format_name.sql', import.meta.url), 'utf8')
    .replace(/^--.*\n/gm, '').trim();
  assert.match(formatName, /ELSE IFNULL\(ad_creative_format, '\(none\)'\)\nEND$/, 'a blank format shows as (none)');
  const click = dashboards().flatMap(d => d.cards).find(c => c.key === 'question:creative_formats')?.clicks;
  assert.deepEqual(click, [{column: 'creative_format', set: {creative_format: 'creative_format'}}]);
  assert.match(sql.creative_formats, /periods\.position,\n {4}latest_formats\.creative_format,/, 'the clicked column is the latest format name');
  assert.ok(!sql.creative_formats.includes('{{creative_format}}'), 'the formats table lists every format');
  for (const key of ['creative_totals', 'creative_launches', 'creatives'])
    assert.equal(sql[key].match(/\{\{creative_format\}\}/g)?.length, 1, `${key} filters its creatives once, by their latest format`);
});

test('a creative counts in one format, its latest, and every creative question compares the same dates', () => {
  const selection = key => sql[key].slice(0, sql[key].indexOf('\n),\n'));
  for (const key of creativeQuestions) {
    assert.match(rawSql(key), /^-- @include latest_format$/m, `${key} uses the shared format`);
    // The format name appears once: inside latest_formats, over each creative's newest non-blank published format.
    assert.equal(sql[key].match(/WHEN 'video' THEN 'Video'/g)?.length, 1, `${key} names no row's own format`);
    assert.match(
      sql[key],
      /ARRAY_AGG\(NULLIF\(TRIM\(ad_creative_format\), ''\) IGNORE NULLS ORDER BY date DESC, NULLIF\(TRIM\(ad_creative_format\), ''\) DESC LIMIT 1\)\[SAFE_OFFSET\(0\)\] AS ad_creative_format\n/,
    );
    assert.ok(!selection(key).includes('creative_format'), `${key} selects its dates before any format`);
    assert.equal(selection(key), selection('creative_formats'), `${key} and the formats table read the same dates`);
  }
});

test('creative ARRAY_AGG lookups use a deterministic tie-breaker on the same date', () => {
  const matches = [...sql.creatives.matchAll(/ARRAY_AGG\(([\s\S]*?) IGNORE NULLS ORDER BY ([\s\S]*?) LIMIT 1\)/g)];
  assert.equal(matches.length, 4, 'expected 4 ARRAY_AGG lookups in creatives SQL');
  for (const [, expr, orderBy] of matches) {
    assert.equal(normalize(orderBy), normalize(`date DESC, ${expr} DESC`), `deterministic tie-breaker for ${normalize(expr)}`);
  }
});

test('creative images and links are HTTPS only, and the unpartitioned inventory returns a bounded list', () => {
  for (const column of ['ad_creative_image_url', 'ad_creative_thumbnail_url', 'ad_creative_post_url', 'ad_creative_facebook_url', 'ad_creative_instagram_url']) {
    const uses = sql.creatives.split(column).length - 1;
    const checked = sql.creatives.split(`IF(STARTS_WITH(${column}, 'https://'), ${column}, NULL)`).length - 1;
    assert.ok(uses > 0 && uses === 2 * checked, `${column} passes only as an HTTPS link`);
  }
  assert.match(sql.creative_assets, /\nLIMIT 500\n?$/);
});

test('creative comparison number includes the selected start date in its result', () => {
  // Metabase 0.65 shows a chart error for smartscalar comparisons without a temporal field.
  assert.match(normalize(sql.creative_totals), /totals as \( select periods\.position, periods\.start_date,/);
  assert.match(normalize(sql.creative_totals), /group by periods\.position, periods\.start_date \) select selection\.\* except \(position\)/);
});

test('cohorts read their own acquisition sales channel, never the shared Channel, and roll without a month', async () => {
  const {fixtureFoundation} = await import('./fixtures.mjs');
  const retention = ['retention', 'retention_matrix', 'retention_segments'];
  for (const key of retention) {
    const ids = filtersIn(sql[key], options).map(f => f.id);
    assert.ok(ids.includes('acquisition_channel') && !ids.includes('channel'), key);
    // Without a chosen channel, the first valid one the scoped stores have, in the catalog's order.
    assert.match(normalize(sql[key]), new RegExp(`sm_channel in \\(${VALID_SALES_CHANNELS.map(c => `'${c}'`).join(', ')}\\)`), key);
    assert.match(sql[key], /COALESCE\(\[\[\{\{as_of_month\}\},\]\] DATE_SUB\(CURRENT_DATE\('REPORTING_TIME_ZONE'\), INTERVAL 1 MONTH\)\)/, key);
  }
  const card = (settings, key) => fixtureFoundation(settings).nodes.find(n => n.key === `question:${key}`).body(new Map());
  const month = settings => card(settings, 'retention').dataset_query.native['template-tags'].as_of_month;
  // No month: an optional filter, so the cutoff moves on each month; --as-of-month pins one.
  assert.equal(month({asOf: null}).required, false);
  assert.equal(month({asOf: null}).default, undefined);
  assert.deepEqual([month({asOf: '2026-09-01'}).required, month({asOf: '2026-09-01'}).default], [true, '2026-09-01']);
  // The latest completed month follows the reporting store's calendar, UTC without one.
  assert.match(card({}, 'retention').dataset_query.native.query, /CURRENT_DATE\('UTC'\)/);
  assert.match(card({timeZone: 'America/Chicago'}, 'retention').dataset_query.native.query, /CURRENT_DATE\('America\/Chicago'\)/);
  const layout = fixtureFoundation().nodes.find(n => n.key === 'dashboard:retention').layout;
  assert.ok(layout.parameters.some(p => p.id === 'acquisition_channel') && !layout.parameters.some(p => p.id === 'channel'));
  // Labels name the month and channel, and the store only when several are in scope.
  assert.match(sql.retention, /FORMAT_DATE\('%B %Y', cohort_month\), ' · ',/);
  assert.match(sql.retention, /IF\(\(SELECT COUNT\(DISTINCT sm_store_id\) FROM store_cells\) > 1, CONCAT\(' · ', sm_store_id\), ''\)\) AS cohort/);
});

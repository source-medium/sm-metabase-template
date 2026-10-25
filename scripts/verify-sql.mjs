#!/usr/bin/env node
// Maintainer check: compile every foundation question in BigQuery with its filters
// expanded the way Metabase expands field filters, using your own `bq` login.
//
//   node scripts/verify-sql.mjs --project sm-democo --dataset sm_transformed_v2 \
//     --metadata-dataset sm_metadata --store democo --from 2026-09-01 --to 2026-09-30 \
//     [--set compare=year --set country=US] [--run --max-bytes 104857600]
//
// Every other filter takes its default; optional filters without one stay unset unless
// --set gives them a value.
//
// Without --run this is a dry run: BigQuery validates names and types and reports the
// bytes each query would process, and nothing is billed. --run executes each query with
// a per-query byte cap and prints its row count. It never prints result rows.
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {questions} from '../foundation/questions.mjs';
import {foundationSql} from '../src/foundation.mjs';
import {filtersIn} from '../src/filters.mjs';

const {values} = parseArgs({options: {
  project: {type: 'string'}, dataset: {type: 'string'}, 'metadata-dataset': {type: 'string', default: 'sm_metadata'}, store: {type: 'string'},
  from: {type: 'string'}, to: {type: 'string'}, 'as-of-month': {type: 'string', default: ''},
  channel: {type: 'string', default: 'online_dtc'}, run: {type: 'boolean', default: false},
  'max-bytes': {type: 'string', default: String(100 * 1024 * 1024)}, only: {type: 'string', default: ''},
  set: {type: 'string', multiple: true, default: []},
}});
const date = /^\d{4}-\d{2}-\d{2}$/;
if (!values.project || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.dataset ?? '') || !values.store ||
    !date.test(values.from ?? '') || !date.test(values.to ?? '')) {
  console.error('Usage: --project P --dataset D --store S --from YYYY-MM-DD --to YYYY-MM-DD [--as-of-month YYYY-MM-01] [--run]');
  process.exit(2);
}
const literal = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const asOf = values['as-of-month'] || `${values.to.slice(0, 7)}-01`;

const settings = Object.fromEntries(values.set.map(pair => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));

/**
 * The SQL Metabase sends for one question: a field filter becomes a predicate on its
 * column, a value filter becomes a literal, and an optional clause whose filters are not
 * all set disappears, as Metabase drops it.
 */
function expand(question, sql, {dataset, store, channel, from, to}) {
  const home = question.metadata ? values['metadata-dataset'] : dataset;
  const column = name => `\`${home}.${question.table}\`.\`${name}\``;
  const tags = {};
  for (const filter of filtersIn(sql, {store, asOf})) {
    const value = settings[filter.id] ?? (Array.isArray(filter.default) ? filter.default[0] : filter.default);
    if (filter.id === 'date') tags.date = `CAST(${column(question.date)} AS DATE) BETWEEN DATE ${literal(from)} AND DATE ${literal(to)}`;
    else if (filter.id === 'as_of_month') tags.as_of_month = `DATE ${literal(settings.as_of_month ?? asOf)}`;
    else if (filter.id === 'channel') tags.channel = `${column('sm_channel')} = ${literal(settings.channel ?? channel)}`;
    else if (filter.id === 'store') tags.store = `${column('sm_store_id')} = ${literal(store)}`;
    else if (value === undefined) continue;
    else if (filter.column) tags[filter.id] = filter.type === 'string/contains' ?
      `STRPOS(LOWER(${column(filter.column)}), LOWER(${literal(value)})) > 0` : `${column(filter.column)} = ${literal(value)}`;
    else tags[filter.id] = filter.variable === 'number' ? String(Number(value)) : literal(String(value));
  }
  const fill = text => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, tag) => {
    if (!tags[tag]) throw new Error(`${question.key}: required filter ${tag} has no test value.`);
    return tags[tag];
  });
  return fill(sql.replaceAll('METADATA', values['metadata-dataset']).replaceAll('DATASET', dataset)
    .replace(/\[\[([\s\S]*?)\]\]/g, (_m, clause) =>
      [...clause.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].every(m => tags[m[1]]) ? clause : ''));
}

let failed = 0;
const sql = foundationSql();
for (const question of questions.filter(q => !values.only || values.only.split(',').includes(q.key))) {
  const query = expand(question, sql[question.key], values);
  const args = ['query', `--project_id=${values.project}`, '--use_legacy_sql=false', '--format=json', '--quiet',
    values.run ? `--maximum_bytes_billed=${values['max-bytes']}` : '--dry_run', query];
  try {
    const out = execFileSync('bq', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024});
    if (values.run) console.log(`ok   ${question.key}: ${JSON.parse(out || '[]').length} rows`);
    else console.log(`ok   ${question.key}: ${/"totalBytesProcessed":\s*"?(\d+)/.exec(out)?.[1] ?? '?'} bytes would be processed`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${question.key}: ${(error.stderr || error.stdout || error.message).toString().trim().split('\n').slice(-3).join(' ')}`);
  }
}
process.exitCode = failed ? 1 : 0;

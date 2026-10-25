#!/usr/bin/env node
// Maintainer check: compile every foundation question in BigQuery with its filters
// expanded the way Metabase expands field filters, using your own `bq` login.
//
//   node scripts/verify-sql.mjs --project sm-democo --dataset sm_transformed_v2 \
//     --store democo --from 2026-09-01 --to 2026-09-30 [--run --max-bytes 104857600]
//
// Without --run this is a dry run: BigQuery validates names and types and reports the
// bytes each query would process, and nothing is billed. --run executes each query with
// a per-query byte cap and prints its row count. It never prints result rows.
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {questions} from '../foundation/questions.mjs';
import {foundationSql} from '../src/foundation.mjs';

const {values} = parseArgs({options: {
  project: {type: 'string'}, dataset: {type: 'string'}, store: {type: 'string'},
  from: {type: 'string'}, to: {type: 'string'}, 'as-of-month': {type: 'string', default: ''},
  channel: {type: 'string', default: 'online_dtc'}, run: {type: 'boolean', default: false},
  'max-bytes': {type: 'string', default: String(100 * 1024 * 1024)}, only: {type: 'string', default: ''},
}});
const date = /^\d{4}-\d{2}-\d{2}$/;
if (!values.project || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.dataset ?? '') || !values.store ||
    !date.test(values.from ?? '') || !date.test(values.to ?? '')) {
  console.error('Usage: --project P --dataset D --store S --from YYYY-MM-DD --to YYYY-MM-DD [--as-of-month YYYY-MM-01] [--run]');
  process.exit(2);
}
const literal = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const asOf = values['as-of-month'] || `${values.to.slice(0, 7)}-01`;

/** The SQL Metabase sends for one question: its field filters become predicates on the mapped column. */
function expand(question, sql, {dataset, store, channel, from, to}) {
  const column = name => `\`${dataset}.${question.table}\`.\`${name}\``;
  const tags = {
    date: question.date ? `CAST(${column(question.date)} AS DATE) BETWEEN DATE ${literal(from)} AND DATE ${literal(to)}` : null,
    channel: `${column('sm_channel')} = ${literal(channel)}`,
    store: `${column('sm_store_id')} = ${literal(store)}`,
    ad_platform: null,
    as_of_month: `DATE ${literal(asOf)}`,
  };
  return sql.replaceAll('DATASET', dataset)
    // An optional clause whose filter is unset disappears, as Metabase drops it.
    .replace(/\[\[([^\]]*?)\{\{\s*(\w+)\s*\}\}([^\]]*?)\]\]/g, (_m, before, tag, after) => tags[tag] ? `${before}${tags[tag]}${after}` : '')
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, tag) => {
      if (!tags[tag]) throw new Error(`${question.key}: required filter ${tag} has no test value.`);
      return tags[tag];
    });
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

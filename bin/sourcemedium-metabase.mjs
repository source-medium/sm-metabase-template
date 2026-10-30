#!/usr/bin/env node
import {readFile, writeFile, realpath, rename} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {client, identifier, metabaseUrl, readWarehouse, requireOneCurrency} from '../src/http.mjs';
import {compileCatalog} from '../src/catalog.mjs';
import {definitions, foundationSql} from '../src/foundation.mjs';
import {formattingFor} from '../src/formats.mjs';
import {snapshot, makePlan} from '../src/snapshot.mjs';
import {applyPlan} from '../src/apply.mjs';

export function argumentsFor(argv, now = new Date()) {
  let values;
  try { ({values} = parseArgs({args: argv, options: {
    url: {type: 'string'}, 'database-id': {type: 'string'}, dataset: {type: 'string'},
    'metadata-dataset': {type: 'string'}, 'collection-id': {type: 'string'},
    'api-key-file': {type: 'string'}, 'session-file': {type: 'string'},
    plan: {type: 'string'}, apply: {type: 'string'}, store: {type: 'string'}, 'as-of-month': {type: 'string'},
    'ownership-map': {type: 'string'},
  }})); } catch { throw new Error('Unknown or missing command option. See README.md.'); }
  const database = Number(values['database-id']);
  const collection = Number(values['collection-id']);
  if (!Number.isSafeInteger(database) || database <= 0 || !Number.isSafeInteger(collection) || collection <= 0 ||
      !values.url || !values.dataset || !values['metadata-dataset'] ||
      Boolean(values.plan) === Boolean(values.apply) || Boolean(values['api-key-file']) === Boolean(values['session-file'])) {
    throw new Error('Supply URL, database ID, dataset, metadata dataset, collection ID, one token file and exactly one of --plan or --apply.');
  }
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const asOf = values['as-of-month'] || previous;
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(asOf) || new Date(asOf) >= month) throw new Error('As-of month must be the first day of a completed month.');
  return {url: metabaseUrl(values.url), database, collection, dataset: identifier(values.dataset),
    metadataDataset: identifier(values['metadata-dataset']), store: values.store, asOf,
    planFile: values.plan || values.apply, apply: !!values.apply, ownershipFile: values['ownership-map'],
    tokenFile: values['api-key-file'] || values['session-file'], session: !!values['session-file']};
}

async function resolved(file, description) {
  try { return await realpath(file); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not resolve the ${description}.`); return resolve(file); }
}

// Hosted installs keep the ID of every managed object in an ownership map (src/ownership.mjs).
// A missing file is a first install. It is replaced whole, so an interruption never leaves half a map.
async function readOwnership(file) {
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Could not read the ownership map.'); }
  try { return JSON.parse(text); } catch { throw new Error('The ownership map is invalid. No content was changed.'); }
}
async function saveOwnership(file, map) {
  await writeFile(file + '.tmp', JSON.stringify(map, null, 2) + '\n', {mode: 0o600});
  await rename(file + '.tmp', file);
}

async function tokenFor(options) {
  try {
    const text = await readFile(options.tokenFile, 'utf8');
    return options.session ? JSON.parse(text).id : text.trim();
  } catch { throw new Error('Could not read the Metabase token file.'); }
}

export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFor(argv);
  const planPath = await resolved(options.planFile, 'plan file');
  const tokenPath = await realpath(options.tokenFile);
  if (planPath === tokenPath) throw new Error('Use separate files for the Metabase credential and the review plan.');
  if (options.ownershipFile) {
    if ([planPath, tokenPath].includes(await resolved(options.ownershipFile, 'ownership map'))) {
      throw new Error('Use a separate file for the ownership map.');
    }
    options.ownership = await readOwnership(options.ownershipFile);
  }
  const api = client(options.url, await tokenFor(options), {session: options.session});
  const sql = foundationSql();
  const warehouse = await readWarehouse(api, options.database, options.metadataDataset);
  const unchecked = await requireOneCurrency(api, warehouse.tables, options);
  const catalog = compileCatalog(warehouse.rows, warehouse.tables, options.dataset, warehouse.dictionary);
  const formatting = formattingFor(catalog);
  const built = definitions(catalog, warehouse.tables, sql, options);
  const definition = {...built, unavailable: [...built.unavailable, ...unchecked],
    unsupported: catalog.unsupported, formatting};
  if (!options.apply) {
    const state = await snapshot(api, options, definition.nodes);
    const plan = makePlan(definition, state, options);
    // Recovered IDs are saved before the plan, so apply reads the map this plan was made with.
    if (state.recovered?.length) await saveOwnership(options.ownershipFile, state.ownership);
    await writeFile(options.planFile, JSON.stringify(plan, null, 2) + '\n', {mode: 0o600});
    const counts = Object.fromEntries(['create', 'update', 'resume', 'unchanged', 'conflict', 'blocked'].map(action => [action, plan.actions.filter(a => a.action === action).length]));
    console.log(JSON.stringify({actions: counts, models: {available: catalog.models.length, unavailable: catalog.unavailable.length},
      unsupported: plan.unsupported.length, retained: plan.retained.length,
      formatting: {unformattedColumns: formatting.unformatted.reduce((n, m) => n + m.columns.length, 0),
        ...(formatting.note ? {note: formatting.note} : {})},
      ...(state.ownership ? {ownership: {revision: state.ownership.revision, recovered: state.recovered}} : {}), digest: plan.digest}));
    console.log('Plan saved. Review its changes, formatting, unavailable models/content, unsupported metrics and retained objects before applying. Metabase content was not changed.');
    return;
  }
  let reviewed;
  try { reviewed = JSON.parse(await readFile(options.planFile, 'utf8')); }
  catch { throw new Error('Could not read the reviewed plan.'); }
  const {ownership, ...result} = await applyPlan(api, definition, options, reviewed, {notify: text => console.log(text)});
  if (ownership) await saveOwnership(options.ownershipFile, ownership);
  console.log(JSON.stringify(ownership ? {...result, ownership: {revision: ownership.revision}} : result));
  if (result.conflicts.length) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main().catch(error => {
    // Our errors exclude headers, credential contents and response bodies, except the
    // warehouse error Metabase reports for a failed query.
    console.error(error instanceof Error && error.constructor === Error ? error.message : 'The adapter could not complete. No credential details were logged.');
    process.exitCode = 1;
  });
}

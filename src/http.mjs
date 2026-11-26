import {missingSource} from './foundation.mjs';

const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;

export function metabaseUrl(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS Metabase URL, or HTTP on localhost, without credentials or query parameters.');
  }
  return url.href.replace(/\/$/, '');
}

export function client(url, token, {session = false, fetch: request = globalThis.fetch} = {}) {
  const base = metabaseUrl(url);
  if (!token || /[\r\n]/.test(token)) throw new Error('The Metabase token file is empty or invalid.');
  return async (method, path, body) => {
    let response;
    try {
      response = await request(base + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: {'Content-Type': 'application/json', Accept: 'application/json',
          [session ? 'X-Metabase-Session' : 'X-API-Key']: token},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
    } catch {
      throw new Error(`Metabase ${method} ${path}: connection failed or timed out.`);
    }
    // The status lets a caller tell a deleted object (404) from a failure.
    if (!response.ok) throw Object.assign(new Error(`Metabase ${method} ${path}: HTTP ${response.status}.`), {status: response.status});
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      // Card and dashboard lists grow with the customer's instance (about 6 KB
      // per card on v0.64.1). This bounds memory, roughly 40,000 cards, rather
      // than turning an established instance away.
      if (size > MAX_RESPONSE_BYTES) throw new Error(`Metabase ${path}: response exceeds the protocol size limit.`);
      chunks.push(chunk);
    }
    try { return size ? JSON.parse(Buffer.concat(chunks).toString()) : null; }
    catch { throw new Error(`Metabase ${path}: invalid JSON response.`); }
  };
}

export function identifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Dataset names must be BigQuery identifiers.');
  return value;
}

// A failed query names the warehouse's own error, as Metabase reports it.
async function metadataRows(api, database, query, label) {
  const result = await api('POST', '/api/dataset', {database, type: 'native', native: {query}});
  if (result.status !== 'completed') {
    throw new Error(`The ${label} query failed${typeof result.error === 'string' ? `: ${result.error}` : ''}. No content was changed.`);
  }
  if (result.data?.rows_truncated) throw new Error(`The ${label} query was truncated. No content was changed.`);
  const names = result.data.cols.map(c => c.name);
  return result.data.rows.map(row => Object.fromEntries(names.map((n, i) => [n, row[i]])));
}

// The store roster decides three things. Without --store the Store filter is empty and the
// dashboards total money across every store, and money is never summed across currencies
// (AGENTS.md rule 4), so a warehouse whose stores report in more than one currency installs only
// with --store. A warehouse with one store gets no store choice and no All stores view. And the
// reporting store (--store, or the only one) sets the time zone whose calendar the cohorts' latest
// completed month follows; without one it is UTC. Like a question, the read needs its source
// synced. When it is not, or when the roster cannot be read with --store given, the dashboards keep
// their store choice and the check is returned for the plan's unsupported list. Without --store a
// failed read stops the plan: the currency check must not be skipped.
export async function readStoreRoster(api, tables, {database, dataset, store}) {
  const check = store ? 'Store roster check' : 'Store currency check';
  const missing = missingSource({table: 'dim_stores', requires: {dim_stores: ['sm_store_id', 'store_currency_code']}}, tables, dataset);
  if (missing) return {stores: null, timeZone: null, unchecked: [{name: check, reason: missing}]};
  // The time zone is optional: without it the cutoff follows UTC, and the currency check still runs.
  const zoned = !missingSource({table: 'dim_stores', requires: {dim_stores: ['store_timezone']}}, tables, dataset);
  const query = `SELECT DISTINCT sm_store_id AS store, store_currency_code AS currency,
    ${zoned ? 'store_timezone' : 'CAST(NULL AS STRING)'} AS time_zone
    FROM \`${identifier(dataset)}.dim_stores\` ORDER BY store`;
  // The reason reaches hosted install summaries, so it never quotes the warehouse's error.
  const unread = {stores: null, timeZone: null, unchecked: [{name: check, reason: 'The store roster could not be read.'}]};
  let rows;
  try { rows = await metadataRows(api, database, query, 'store roster'); }
  catch (error) { if (!store) throw error; return unread; }
  if (!rows.every(row => typeof row.store === 'string')) {
    if (!store) throw new Error('The store roster query returned no store IDs. No content was changed.');
    return unread;
  }
  // Unset first, as BigQuery orders NULL.
  const currencies = [...new Set(rows.map(row => row.currency ?? null))].sort((a, b) => a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
  if (!store && currencies.length > 1) {
    throw new Error(`Stores in ${dataset} report in more than one currency (${currencies.map(c => c ?? 'unset').join(', ')}). ` +
      'Without --store, the dashboards total money across every store. ' +
      'Pass --store STORE_ID to install for one store. No content was changed.');
  }
  const stores = new Set(rows.map(row => row.store)).size;
  const reporting = rows.find(row => row.store === store) ?? (stores === 1 ? rows[0] : null);
  // Written into SQL as a literal, so only an IANA name (or UTC) is used.
  const timeZone = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(reporting?.time_zone ?? '') ? reporting.time_zone : null;
  return {stores, timeZone, unchecked: []};
}

// value_format is read through the row's JSON so a warehouse whose metadata predates
// it still plans: the field is then NULL and the plan says formats are unpublished.
const valueFormat = alias => `JSON_VALUE(TO_JSON_STRING(${alias}), '$.value_format') AS value_format`;

export async function readWarehouse(api, database, metadataDataset) {
  const schema = identifier(metadataDataset);
  const query = `SELECT metric_name, metric_label, metric_type, calculation, has_filter,
    filter_condition, underlying_model, metric_time_expression, metric_time_grains, dependent_metrics,
    metric_description, is_abbreviation, preferred_metric_name, ${valueFormat('catalog')}
    FROM \`${schema}.dim_semantic_metric_catalog\` AS catalog`;
  // One row per documented table/description keeps column-level dictionaries
  // below Metabase's ordinary result-row limit without reading business data.
  const dictionaryQuery = `SELECT dataset_name, table_name, table_description,
    TO_JSON_STRING(ARRAY_AGG(STRUCT(column_name, column_description, value_format) ORDER BY column_name)) AS columns
    FROM (SELECT DISTINCT dataset_name, table_name, table_description, column_name, column_description,
      ${valueFormat('dictionary')} FROM \`${schema}.dim_data_dictionary\` AS dictionary)
    GROUP BY dataset_name, table_name, table_description`;
  const [metadata, rows, dictionary] = await Promise.all([
    api('GET', `/api/database/${database}/metadata`),
    metadataRows(api, database, query, 'semantic catalog'),
    metadataRows(api, database, dictionaryQuery, 'data dictionary'),
  ]);
  try {
    return {tables: metadata.tables, rows,
      dictionary: dictionary.map(row => ({...row, columns: JSON.parse(row.columns)}))};
  } catch {
    throw new Error('The data dictionary returned invalid column metadata. No content was changed.');
  }
}

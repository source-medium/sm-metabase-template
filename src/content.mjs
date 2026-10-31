import {bind, field} from './catalog.mjs';
import {scopeFor} from './ownership.mjs';
import {modelColumnFormat, columnSettings} from './formats.mjs';
import {filtersIn} from './filters.mjs';
import {columnTitles, outputFormats} from '../foundation/questions.mjs';

export function modelCard(model, database, dataset = model.schema) {
  const title = model.name.replace(/^rpt_/, '').replaceAll('_', ' ');
  return {name: model.schema === dataset ? title : `${model.schema}: ${title}`, type: 'model', display: 'table',
    description: `SourceMedium ${model.schema}.${model.name}. ${model.description}\nExplore at this table's published grain. Apply bounded dates where available and a single reporting currency for financial measures. Warehouse logic and types are preserved.`,
    visualization_settings: {}, parameters: [],
    dataset_query: {database, type: 'query', query: {'source-table': model.id, fields: model.columns.map(field)}},
    result_metadata: model.columns.map(f => {
      const format = modelColumnFormat(f.value_format);
      return {name: f.name, display_name: f.display_name || f.name,
        base_type: f.base_type, effective_type: f.base_type, field_ref: field(f), id: f.id, source: 'fields',
        description: f.description || null,
        semantic_type: format.semantic_type || f.semantic_type || (['sm_store_id', 'sm_channel'].includes(f.name) ? 'type/Category' : null),
        ...(format.settings ? {settings: format.settings} : {})};
    })};
}

// Metabase names a metric's result column after its aggregation; a conditional sum
// also names its column (v0.64.1 returns `sum_where_order_net_revenue`).
const resultColumn = ([fn, input]) => fn === 'sum-where' ? `sum_where_${input.field}` :
  {'/': 'expression', distinct: 'count', count: 'count', sum: 'sum', avg: 'avg', min: 'min', max: 'max'}[fn];

// The catalog's own unit, so a metric displays correctly even where its model column
// carries none, and a ratio, which inherits nothing, displays at all.
export function metricCard(metric, model, database, modelId, metricIds) {
  const settings = columnSettings(metric.valueFormat);
  const column = JSON.stringify(['name', resultColumn(metric.calculation)]);
  return {name: metric.label, type: 'metric', display: 'line', parameters: [],
    visualization_settings: Object.keys(settings).length ? {column_settings: {[column]: settings}} : {},
    description: `${metric.description}\nCanonical metric: ${metric.name}. Definition source: sm_metadata.dim_semantic_metric_catalog. Calculation: ${metric.canonical.calculation}. Time: ${metric.time}. Refresh with the SourceMedium adapter to check for definition drift.`,
    dataset_query: {database, type: 'query', query: {'source-table': `card__${modelId}`,
      aggregation: [bind(metric.calculation, model.columns, metricIds)]}}};
}

/** Every name the SQL gives with AS, outside comments. */
export const outputAliases = sql => [...sql.replace(/--[^\n]*/g, '').matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)].map(m => m[1]);

// A comparison output (compare_net_revenue, compare2_net_revenue) displays like its base.
export function outputFormat(recipe, alias, metrics) {
  const metric = recipe.metrics?.[alias];
  if (typeof metric === 'string') return metrics.find(m => m.name === metric)?.valueFormat ?? null;
  if (Array.isArray(metric)) return outputFormats[alias] ?? null;
  if (alias in outputFormats) return outputFormats[alias];
  const base = /^compare2?_(.+)$/.exec(alias)?.[1];
  return base ? outputFormat(recipe, base, metrics) : null;
}

// A comparison output takes its base column's title, marked with the comparison it shows.
function titleOf(name) {
  if (columnTitles[name]) return columnTitles[name];
  const [, slot, base] = /^(compare2?)_(.+)$/.exec(name) || [];
  return base && columnTitles[base] ? `${columnTitles[base]} (${slot === 'compare' ? 'comparison' : 'second comparison'})` : null;
}

// The filters the SQL names become its template tags: a field filter on a column of the
// question's own table, or a value the SQL reads.
function templateTags(recipe, sql, options, table) {
  const tags = {};
  for (const filter of filtersIn(sql, options)) {
    const common = {id: filter.id, name: filter.id, 'display-name': filter.name, required: !!filter.required};
    const name = filter.column === 'date' ? recipe.date : filter.column;
    const column = name && table.fields.find(f => f.name === name && f.active !== false);
    if (name && !column) throw new Error(`Missing ${recipe.table} filter column ${name}.`);
    if (filter.variable) {
      // A variable takes one value; its dashboard filter keeps Metabase's list form.
      const value = Array.isArray(filter.default) ? filter.default[0] : filter.default;
      tags[filter.id] = {...common, type: filter.variable, ...(value === undefined ? {} : {default: value})};
      continue;
    }
    tags[filter.id] = {...common, type: 'dimension', dimension: field(column), 'widget-type': filter.type,
      ...(filter.default === undefined ? {} : {default: filter.default})};
  }
  return tags;
}

export function nativeCard(recipe, sql, options, table, metrics = []) {
  if (options.store) {
    // Keep the store predicate mandatory even when the question is opened outside a
    // dashboard. Source tables are unaliased, including metadata questions.
    const dataset = recipe.metadata ? 'METADATA' : 'DATASET';
    sql = sql.replaceAll('[[AND {{store}}]]', `AND \`${dataset}.${recipe.table}\`.sm_store_id = {{store}}`);
  }
  const tags = templateTags(recipe, sql, options, table);
  const column_settings = Object.fromEntries([...new Set([...Object.keys(columnTitles), ...outputAliases(sql)])].flatMap(name => {
    const title = titleOf(name);
    const settings = {...(title ? {column_title: title} : {}), ...columnSettings(outputFormat(recipe, name, metrics)),
      ...recipe.columns?.[name]};
    return Object.keys(settings).length ? [[JSON.stringify(['name', name]), settings]] : [];
  }));
  // Metabase's comparison number throws when rows exist but the selected value
  // is null (for example, revenue / order with no orders). Keep undefined ratios
  // undefined and return no rows so Metabase uses its normal empty state. Zero
  // is still a valid value, and comparison columns retain their original values.
  if (recipe.display === 'smartscalar' && recipe.settings?.['scalar.field']) {
    const column = recipe.settings['scalar.field'].replaceAll('\\', '\\\\').replaceAll('`', '\\`');
    sql = `SELECT * FROM (\n${sql.trim().replace(/;$/, '')}\n) AS number_card\nWHERE number_card.\`${column}\` IS NOT NULL\n`;
  }
  return {name: recipe.name, type: 'question', display: recipe.display || 'table', parameters: [],
    description: recipe.description, visualization_settings: {column_settings, ...(recipe.settings || {})},
    dataset_query: {database: options.database, type: 'native', native: {
      query: sql.replaceAll('METADATA', options.metadataDataset).replaceAll('DATASET', options.dataset), 'template-tags': tags}}};
}

export const snippetName = (metric, options) => `SM ${scopeFor(options).slice(0, 8)} ${metric}`;

export function sharedSqlCard(recipe, sql, options, table, ids, metrics = []) {
  const tags = {};
  const use = metric => {
    const name = snippetName(metric, options);
    const tag = `snippet: ${name}`;
    tags[tag] = {id: tag, name: tag, 'display-name': name, type: 'snippet', 'snippet-name': name,
      'snippet-id': ids.get(`snippet:${metric}`) || 0};
    return `{{${tag}}}`;
  };
  for (const [alias, metric] of Object.entries(recipe.metrics || {})) {
    const pattern = new RegExp(`^([ \\t]*)([^\\n]+?)([ \\t]+AS[ \\t]+${alias}[ \\t]*,?[ \\t]*)$`, 'gmi');
    if ([...sql.matchAll(pattern)].length !== 1) throw new Error(`SQL output contract changed: ${recipe.key}.${alias}.`);
    const expression = Array.isArray(metric) ? `SAFE_DIVIDE(${metric.map(use).join(', ')})` : use(metric);
    sql = sql.replace(pattern, (_match, indent, _previous, suffix) => indent + expression + suffix);
  }
  const card = nativeCard(recipe, sql, options, table, metrics);
  Object.assign(card.dataset_query.native['template-tags'], tags);
  return card;
}

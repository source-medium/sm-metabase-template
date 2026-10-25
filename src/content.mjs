import {bind, field} from './catalog.mjs';
import {scopeFor} from './ownership.mjs';
import {modelColumnFormat, columnSettings} from './formats.mjs';
import {filters} from './filters.mjs';
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

// Metabase names a metric's result column after its aggregation.
const resultColumn = {'/': 'expression', distinct: 'count', count: 'count', sum: 'sum', 'sum-where': 'sum_where', avg: 'avg', min: 'min', max: 'max'};

// The catalog's own unit, so a metric displays correctly even where its model column
// carries none, and a ratio, which inherits nothing, displays at all.
export function metricCard(metric, model, database, modelId, metricIds) {
  const settings = columnSettings(metric.valueFormat);
  const column = JSON.stringify(['name', resultColumn[metric.calculation[0]]]);
  return {name: metric.label, type: 'metric', display: 'line', parameters: [],
    visualization_settings: Object.keys(settings).length ? {column_settings: {[column]: settings}} : {},
    description: `${metric.description}\nCanonical metric: ${metric.name}. Definition source: sm_metadata.dim_semantic_metric_catalog. Calculation: ${metric.canonical.calculation}. Time: ${metric.time}. Refresh with the SourceMedium adapter to check for definition drift.`,
    dataset_query: {database, type: 'query', query: {'source-table': `card__${modelId}`,
      aggregation: [bind(metric.calculation, model.columns, metricIds)]}}};
}

export function outputFormat(recipe, alias, metrics) {
  const metric = recipe.metrics?.[alias];
  return typeof metric === 'string' ? metrics.find(m => m.name === metric)?.valueFormat ?? null : outputFormats[alias] ?? null;
}

export function nativeCard(recipe, sql, options, table, metrics = []) {
  const parameters = filters({...options, paid: recipe.scope === 'paid', cohort: recipe.scope === 'cohort'});
  const tags = {};
  // sm_channel is the sales channel in every report. In the ad report,
  // source_system is the advertising platform that delivered the ad.
  const columns = {date: recipe.date, store: 'sm_store_id', channel: 'sm_channel', ad_platform: 'source_system'};
  for (const p of parameters) {
    const basic = p.id === 'as_of_month';
    const column = basic ? null : table.fields.find(f => f.name === columns[p.id]);
    if (!basic && !column) throw new Error(`Missing ${recipe.table} filter column.`);
    tags[p.id] = {id: p.id, name: p.id, 'display-name': p.name, type: basic ? 'date' : 'dimension',
      ...(basic ? {} : {dimension: field(column), 'widget-type': p.type}), required: !!p.required,
      ...(p.default === undefined ? {} : {default: p.default})};
  }
  const aliases = [...sql.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)].map(m => m[1]);
  const column_settings = Object.fromEntries([...new Set([...Object.keys(columnTitles), ...aliases])].flatMap(name => {
    const settings = {...(columnTitles[name] ? {column_title: columnTitles[name]} : {}), ...columnSettings(outputFormat(recipe, name, metrics))};
    return Object.keys(settings).length ? [[JSON.stringify(['name', name]), settings]] : [];
  }));
  return {name: recipe.name, type: 'question', display: recipe.display || 'table', parameters: [],
    description: recipe.description, visualization_settings: {column_settings, ...(recipe.settings || {})},
    dataset_query: {database: options.database, type: 'native', native: {
      query: sql.replaceAll('DATASET', options.dataset), 'template-tags': tags}}};
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

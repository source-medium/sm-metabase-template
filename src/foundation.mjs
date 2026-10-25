import {readFileSync} from 'node:fs';
import {modelCard, metricCard, sharedSqlCard, snippetName} from './content.mjs';
import {sqlExpression} from './catalog.mjs';
import {questions, dashboards, combinedDashboard} from '../foundation/questions.mjs';

/** Each question's SQL, read from foundation/sql/<key>.sql. */
export function foundationSql(list = questions, directory = new URL('../foundation/sql/', import.meta.url)) {
  return Object.fromEntries(list.map(question => {
    try { return [question.key, readFileSync(new URL(`${question.key}.sql`, directory), 'utf8')]; }
    catch { throw new Error(`Missing foundation/sql/${question.key}.sql.`); }
  }));
}

// Compose only available dashboards. Questions and calculations are shared with the
// standalone dashboards, never copied.
export function combine(layouts, combined = combinedDashboard) {
  const parameters = new Map();
  const tabs = [];
  const cards = [];
  for (const layout of layouts) {
    const offset = tabs.length;
    tabs.push(...(layout.tabs.length ? layout.tabs : [layout.label]));
    cards.push(...layout.cards.map(card => ({...card, tab: offset + (card.tab ?? 0)})));
    for (const parameter of layout.parameters) {
      const prior = parameters.get(parameter.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(parameter)) throw new Error(`Conflicting foundation filter: ${parameter.id}.`);
      parameters.set(parameter.id, parameter);
    }
  }
  return {...combined, parameters: [...parameters.values()], tabs, cards};
}

// A question's own table and the tables it joins must be synced with the columns it reads.
function missingSource(question, tables, dataset) {
  const synced = name => tables.find(t => t.schema === dataset && t.name === name && t.active !== false);
  if (!synced(question.table)) return 'Source table is not synced in the selected dataset.';
  for (const [name, columns] of Object.entries(question.requires || {})) {
    const table = synced(name);
    if (!table) return `${name} is not synced in the selected dataset.`;
    const fields = new Set((table.fields || []).filter(f => f.active !== false).map(f => f.name));
    const absent = columns.filter(column => !fields.has(column));
    if (absent.length) return `${name} has no synced ${absent.join(', ')}.`;
  }
  return null;
}

// Definition factories use the destination's own IDs. No exported Metabase IDs.
export function definitions(catalog, tables, sql, options, {list = questions, layouts = dashboards(options), combined = combinedDashboard} = {}) {
  const nodes = [];
  const unavailable = [...catalog.unavailable];
  for (const model of catalog.models) nodes.push({key: model.key, kind: 'card', dependencies: [],
    body: () => modelCard(model, options.database, options.dataset)});
  for (const metric of catalog.metrics) {
    const model = catalog.models.find(m => m.schema === options.dataset && m.name === metric.table);
    nodes.push({key: metric.key, kind: 'card', dependencies: [model.key, ...metric.dependencies.map(n => `metric:${n}`)],
      dimensions: [metric.time, 'sm_store_id', ...(model.columns.some(c => c.name === 'sm_channel') ? ['sm_channel'] : [])],
      body: ids => metricCard(metric, model, options.database, ids.get(model.key) || 0,
        new Map(catalog.metrics.map(m => [m.name, ids.get(m.key) || 0])))});
    nodes.push({key: `snippet:${metric.name}`, kind: 'snippet', dependencies: [metric.key, ...metric.dependencies.map(n => `snippet:${n}`)], body: () => ({
      name: snippetName(metric.name, options), content: sqlExpression(metric, catalog.metrics),
      description: `Canonical metric ${metric.name}, source ${metric.table}, time ${metric.time}. Generated from the warehouse catalog; use on this source table.`})});
  }
  for (const question of list) {
    const table = tables.find(t => t.schema === options.dataset && t.name === question.table && t.active !== false);
    const missing = missingSource(question, tables, options.dataset);
    if (missing) { unavailable.push({name: question.name, reason: missing}); continue; }
    const required = [...new Set(Object.values(question.metrics || {}).flat())];
    if (!required.every(n => catalog.metrics.some(m => m.name === n && m.table === question.table))) {
      unavailable.push({name: question.name, reason: 'Required canonical metrics are unavailable or unsupported.'}); continue;
    }
    const body = ids => sharedSqlCard(question, sql[question.key], options, table, ids || new Map(), catalog.metrics);
    try { body(); } catch { unavailable.push({name: question.name, reason: 'Required filter columns or SQL outputs are unavailable.'}); continue; }
    const dependencies = required.map(n => `snippet:${n}`);
    nodes.push({key: `question:${question.key}`, kind: 'card', dependencies, body});
    for (const variant of question.variants || []) nodes.push({key: `question:${variant.key}`, kind: 'card', dependencies, body: ids => {
      const card = body(ids);
      return {...card, name: variant.name, display: variant.display, visualization_settings: {
        ...variant.settings, column_settings: card.visualization_settings.column_settings}};
    }});
  }
  const available = [];
  for (const layout of layouts) {
    if (layout.cards.some(c => !nodes.some(n => n.key === c.key))) {
      unavailable.push({name: layout.name, reason: 'One or more required questions are unavailable.'}); continue;
    }
    available.push(layout);
  }
  for (const layout of [...available, ...(available.length ? [combine(available, combined)] : [])]) {
    nodes.push({key: layout.key, kind: 'dashboard', dependencies: layout.cards.map(c => c.key), layout,
      body: ids => ({layout, cards: layout.cards.map(c => ({...c, card_id: ids.get(c.key) || 0}))})});
  }
  return {nodes, unavailable};
}

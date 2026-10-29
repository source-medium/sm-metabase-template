import {readFileSync} from 'node:fs';
import {modelCard, metricCard, sharedSqlCard, snippetName} from './content.mjs';
import {sqlExpression} from './catalog.mjs';
import {filtersIn, dashboardParameters} from './filters.mjs';
import {questions, dashboards, combinedDashboard} from '../foundation/questions.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// A line `-- @include name` stands for foundation/sql/include/name.sql, so SQL that several
// questions share (comparison periods, shipping locations) has one source.
function expand(sql, key) {
  return sql.replace(/^[ \t]*-- @include ([a-z_]+)[ \t]*$/gm, (_line, name) => {
    try { return read(`../foundation/sql/include/${name}.sql`).replace(/\n$/, ''); }
    catch { throw new Error(`${key}: missing foundation/sql/include/${name}.sql.`); }
  });
}

/** Each question's SQL, read from foundation/sql/<key>.sql with its includes expanded. */
export function foundationSql() {
  return Object.fromEntries(questions.map(question => {
    let sql;
    try { sql = read(`../foundation/sql/${question.key}.sql`); }
    catch { throw new Error(`Missing foundation/sql/${question.key}.sql.`); }
    return [question.key, expand(sql, question.key)];
  }));
}

// Clicking a column sets dashboard filters from the clicked row: on this dashboard, or on
// the dashboard a click opens. A filter the destination does not have is left out, and a
// click with nothing left to set does nothing.
function clickSettings(card, parameters, layouts, ids) {
  const column_settings = {};
  for (const click of card.clicks || []) {
    const target = click.dashboard && layouts.find(l => l.key === click.dashboard);
    if (click.dashboard && !target) continue;
    const available = (target || {parameters}).parameters;
    const parameterMapping = Object.fromEntries(Object.entries(click.set).filter(([id]) => available.some(p => p.id === id))
      .map(([id, column]) => [id, {id, source: {type: 'column', id: column, name: column}, target: {type: 'parameter', id}}]));
    if (!Object.keys(parameterMapping).length) continue;
    column_settings[JSON.stringify(['name', click.column])] = {click_behavior: target ?
      {type: 'link', linkType: 'dashboard', targetId: ids.get(click.dashboard) || 0, parameterMapping} :
      {type: 'crossfilter', parameterMapping}};
  }
  return Object.keys(column_settings).length ? {column_settings} : {};
}

// Compose only available dashboards. Questions and calculations are shared with the
// standalone dashboards, never copied; the combined dashboard shows every filter they show.
function combine(layouts, options) {
  const tabs = [];
  const cards = [];
  for (const layout of layouts) {
    const offset = tabs.length;
    tabs.push(...(layout.tabs.length ? layout.tabs : [layout.label]));
    cards.push(...layout.cards.map(card => ({...card, tab: offset + (card.tab ?? 0)})));
  }
  const ids = new Set(layouts.flatMap(layout => layout.parameters.map(p => p.id)));
  return {...combinedDashboard, parameters: dashboardParameters(ids, options), tabs, cards};
}

// A question's own table and the tables it joins must be synced with the columns it reads.
export function missingSource(question, tables, dataset) {
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
export function definitions(catalog, tables, sql, options) {
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
  const uses = new Map();
  for (const question of questions) {
    const dataset = question.metadata ? options.metadataDataset : options.dataset;
    const table = tables.find(t => t.schema === dataset && t.name === question.table && t.active !== false);
    const missing = missingSource(question, tables, dataset);
    if (missing) { unavailable.push({name: question.name, reason: missing}); continue; }
    const required = [...new Set(Object.values(question.metrics || {}).flat())];
    if (!required.every(n => catalog.metrics.some(m => m.name === n && m.table === question.table))) {
      unavailable.push({name: question.name, reason: 'Required canonical metrics are unavailable or unsupported.'}); continue;
    }
    const body = ids => sharedSqlCard(question, sql[question.key], options, table, ids || new Map(), catalog.metrics);
    try { body(); } catch { unavailable.push({name: question.name, reason: 'Required filter columns or SQL outputs are unavailable.'}); continue; }
    const dependencies = required.map(n => `snippet:${n}`);
    const filters = new Set(filtersIn(sql[question.key], options).map(f => f.id));
    nodes.push({key: `question:${question.key}`, kind: 'card', dependencies, body});
    uses.set(`question:${question.key}`, filters);
    for (const variant of question.variants || []) {
      nodes.push({key: `question:${variant.key}`, kind: 'card', dependencies, body: ids => {
        const card = body(ids);
        return {...card, name: variant.name, display: variant.display, visualization_settings: {
          ...variant.settings, column_settings: card.visualization_settings.column_settings}};
      }});
      uses.set(`question:${variant.key}`, filters);
    }
  }
  // A dashboard leaves out cards whose questions are unavailable (reported above) and tabs
  // left empty, and is skipped only when nothing is left. It shows the filters its cards consume.
  const available = [];
  for (const layout of dashboards(options)) {
    const kept = layout.cards.filter(c => uses.has(c.key));
    if (!kept.length) { unavailable.push({name: layout.name, reason: 'None of its questions are available.'}); continue; }
    const tabs = layout.tabs.filter((_, i) => kept.some(c => c.tab === i));
    const cards = kept.map(c => c.tab === null ? c : {...c, tab: tabs.indexOf(layout.tabs[c.tab])});
    available.push({...layout, tabs, cards, parameters: dashboardParameters(new Set(cards.flatMap(c => [...uses.get(c.key)])), options)});
  }
  const layouts = [...available, ...(available.length ? [combine(available, options)] : [])];
  for (const [index, layout] of layouts.entries()) {
    const targets = [...new Set(layout.cards.flatMap(c => (c.clicks || []).map(click => click.dashboard).filter(Boolean)))]
      .filter(key => layouts.some(l => l.key === key));
    // Apply follows this order, so a dashboard a click opens must already have its ID.
    if (targets.some(key => layouts.findIndex(l => l.key === key) >= index)) throw new Error(`${layout.key} links to a later dashboard.`);
    nodes.push({key: layout.key, kind: 'dashboard', dependencies: [...layout.cards.map(c => c.key), ...targets], layout,
      body: ids => ({layout, cards: layout.cards.map(({clicks, ...c}) => ({...c, card_id: ids.get(c.key) || 0,
        visualization_settings: clickSettings({clicks}, layout.parameters, layouts, ids)}))})});
  }
  return {nodes, unavailable};
}

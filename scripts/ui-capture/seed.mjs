import {randomUUID} from 'node:crypto';
import {mappings} from '../../src/snapshot.mjs';
import {questions, dashboards} from '../../foundation/questions.mjs';
import {fixtureFoundation} from '../../tests/fixtures.mjs';
import {rows, emptyTypes} from './rows.mjs';

const quote = name => '"' + name.replaceAll('"', '""') + '"';
const isoDate = /^\d{4}-\d\d-\d\d$/;
function literal(value, temporal) {
  if (value == null) return 'NULL';
  if (typeof value !== 'string') return String(value);
  return (temporal ? 'DATE ' : '') + "'" + value.replaceAll("'", "''") + "'";
}

function sampleQuery(key) {
  const records = rows[key];
  if (!records.length) {
    const columns = Object.entries(emptyTypes[key]).map(([name, type]) => 'NULL::' + type + ' AS ' + quote(name));
    return 'SELECT ' + columns.join(', ') + ' WHERE FALSE';
  }
  const columns = Object.keys(records[0]);
  const dates = new Set(columns.filter(key => records.every(row => row[key] == null || isoDate.test(row[key]))));
  const values = records.map(record => '(' + columns.map(key => literal(record[key], dates.has(key))).join(', ') + ')');
  return 'SELECT * FROM (VALUES ' + values.join(',\n') + ') AS fixture(' + columns.map(quote).join(', ') + ')';
}

export async function seed(origin, password) {
  let session;
  const api = async (method, path, body) => {
    const response = await fetch(origin + '/api/' + path, {method, headers: {'Content-Type': 'application/json',
      ...(session ? {'X-Metabase-Session': session} : {})}, body: JSON.stringify(body)});
    if (!response.ok) {
      const detail = path.endsWith('/query') ? (await response.json()).via?.[0]?.error || '' : '';
      throw new Error(method + ' ' + path + ' returned ' + response.status + ' ' + detail.slice(0, 2200));
    }
    return response.status === 204 ? null : response.json();
  };
  const token = (await api('GET', 'session/properties'))['setup-token'];
  if (!token) throw new Error('Capture requires a new Metabase application database.');
  session = (await api('POST', 'setup', {token, prefs: {site_name: 'Foundation fixture', allow_tracking: false},
    user: {first_name: 'Sample', last_name: 'Viewer', email: 'viewer@example.test', password: 'Sample-' + randomUUID()}})).id;
  const database = await api('POST', 'database', {engine: 'postgres', name: 'Visual fixture',
    details: {host: '127.0.0.1', port: 5432, dbname: 'postgres', user: 'postgres', password, ssl: false}});
  let sampleTable;
  for (let attempt = 0; attempt < 30 && !sampleTable; attempt++) {
    const {tables} = await api('GET', 'database/' + database.id + '/metadata');
    sampleTable = tables.find(t => t.name === 'filter_values' && t.fields?.length === 2);
    if (!sampleTable) await new Promise(r => setTimeout(r, 500));
  }
  if (!sampleTable) throw new Error('Metabase did not sync the fixture filter fields.');
  const {nodes} = fixtureFoundation({database: database.id, asOf: '2026-10-01'});
  const combined = nodes.find(node => node.key === 'dashboard:foundation');
  if (combined.layout.cards.length !== dashboards().flatMap(d => d.cards).length) throw new Error('Fixture catalog omitted foundation cards.');
  const ids = new Map();
  const cards = new Map();
  for (const key of new Set(combined.layout.cards.map(card => card.key))) {
    const recipe = questions.find(q => [q, ...(q.variants || [])].some(v => 'question:' + v.key === key));
    const body = nodes.find(n => n.key === key).body(ids);
    const native = body.dataset_query.native;
    const tags = Object.fromEntries(Object.entries(native['template-tags']).filter(([, tag]) => tag.type !== 'snippet'));
    // Preserve filter widgets and mappings. Their predicates accept any fixture row.
    const clauses = [];
    for (const [name, tag] of Object.entries(tags)) {
      if (tag.type === 'dimension') {
        const field = name === 'date' ? 'day' : 'label';
        tag.dimension = ['field', sampleTable.fields.find(f => f.name === field).id, null];
        clauses.push('[[AND (TRUE OR EXISTS (SELECT 1 FROM ' + quote(sampleTable.name) + ' WHERE {{' + name + '}}))]]');
      } else clauses.push('[[AND (TRUE OR CAST({{' + name + '}} AS text) IS NULL)]]');
    }
    native.query = 'SELECT * FROM (' + sampleQuery(recipe.key) + ') AS sample_rows WHERE TRUE\n' + clauses.join('\n');
    native['template-tags'] = tags;
    const card = await api('POST', 'card', body);
    if (key === 'question:readout') {
      const result = await api('POST', 'card/' + card.id + '/query', {parameters: []});
      if (result.error) throw new Error('Fixture query: ' + result.error + ' ' + String(JSON.stringify(result.via?.map(e => e.message))).slice(0,500));
    }
    ids.set(key, card.id);
    cards.set(key, body);
  }
  // Install each drill destination before the combined view that links to it.
  for (const node of nodes.filter(node => node.kind === 'dashboard')) {
    const {layout, cards: placements} = node.body(ids);
    const date = layout.parameters.find(parameter => parameter.id === 'date');
    if (date) date.default = '2026-10-01~2026-10-28';
    const dashboard = await api('POST', 'dashboard', {name: layout.name, parameters: layout.parameters});
    const tabs = layout.tabs.map((name, i) => ({id: -(i + 1), name, position: i}));
    await api('PUT', 'dashboard/' + dashboard.id, {tabs, parameters: layout.parameters,
      dashcards: placements.map((card, i) => ({id: -(i + 1), card_id: card.card_id, row: card.row, col: card.col,
        size_x: card.size_x, size_y: card.size_y, dashboard_tab_id: card.tab === null ? null : tabs[card.tab].id,
        inline_parameters: card.inline_parameters || [], visualization_settings: card.visualization_settings,
        parameter_mappings: mappings(cards.get(card.key), card.card_id, layout.parameters)}))});
    ids.set(node.key, dashboard.id);
  }
  const dashboardId = ids.get(combined.key);
  const saved = await api('GET', 'dashboard/' + dashboardId);
  if (saved.dashcards.length !== combined.layout.cards.length) throw new Error('Fixture lost dashboard cards.');
  const {uuid} = await api('POST', 'dashboard/' + dashboardId + '/public_link', {});
  return saved.tabs.map((tab, i) => ({route_id: tab.name.toLowerCase().replaceAll(' ', '-'), priority: i + 1, title: combined.layout.name,
    tab: tab.name, count: saved.dashcards.filter(card => card.dashboard_tab_id === tab.id).length,
    path: '/public/dashboard/' + uuid + '?tab=' + tab.id + '-' + encodeURIComponent(tab.name.toLowerCase().replaceAll(' ', '-'))}));
}

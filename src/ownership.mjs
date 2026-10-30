import {createHash} from 'node:crypto';

const prefix = '\nSM_METABASE_V1 ';
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, stable(value[k])]));
}
export const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export const definitionSource = (node, body) => digest(node.dimensions ? {body, dimensions: node.dimensions} : body);
export const scopeFor = options => digest({database: options.database, dataset: options.dataset,
  metadataDataset: options.metadataDataset, collection: options.collection});
export function marker(description = '') {
  if (typeof description !== 'string') return null;
  const i = description.lastIndexOf(prefix);
  if (i < 0) return null;
  try {
    const value = JSON.parse(description.slice(i + prefix.length));
    return typeof value.key === 'string' && typeof value.scope === 'string' &&
      /^[a-f0-9]{64}$/.test(value.source) && /^[a-f0-9]{64}$/.test(value.content) ? value : null;
  } catch { return null; }
}
// A hosted install's ownership map: the installation scope and the ID of each managed object
// by key, with a revision that changes whenever an ID is recorded. Absent, it starts empty.
const kinds = ['collection', 'card', 'dashboard', 'snippet'];
export function ownershipMap(map, scope) {
  if (map === null) return {format: 1, scope, revision: 0, objects: {}};
  const objects = map?.objects && typeof map.objects === 'object' && !Array.isArray(map.objects) ? Object.values(map.objects) : null;
  const ids = (objects ?? []).map(o => `${o?.kind}:${o?.id}`);
  if (map?.format !== 1 || typeof map.scope !== 'string' || !Number.isSafeInteger(map.revision) || map.revision < 0 || !objects ||
      objects.some(o => !kinds.includes(o?.kind) || !Number.isSafeInteger(o.id) || o.id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error('The ownership map is invalid. No content was changed.');
  }
  if (map.scope !== scope) throw new Error('The ownership map belongs to another database, dataset or collection. No content was changed.');
  return map;
}

// The map after an apply: each key's ID as installed. The revision changes only with an ID.
export function recordIds(map, ids, nodes) {
  const kindOf = new Map(nodes.map(n => [n.key, n.kind]));
  const objects = {...map.objects};
  for (const [key, id] of Object.entries(ids)) objects[key] = {kind: kindOf.get(key) ?? map.objects[key].kind, id};
  return digest(objects) === digest(map.objects) ? map : {...map, revision: map.revision + 1, objects};
}

export function prose(description = '') {
  if (typeof description !== 'string') return '';
  const i = description.lastIndexOf(prefix);
  return i < 0 ? description : description.slice(0, i);
}
export function stamp(description, value) { return prose(description) + prefix + JSON.stringify(value); }

// Metabase annotates field references with their types when it reads a saved
// query back (["field", 1, null] becomes ["field", 1, {"base-type": ...}]).
// Comparing a definition the adapter built with one Metabase stored must ignore
// those annotations, or an interrupted write can never be recognized.
export function withoutFieldTypes(value) {
  if (Array.isArray(value)) {
    if (value[0] === 'field' && value.length === 3 && value[2] && typeof value[2] === 'object' && !Array.isArray(value[2])) {
      const {'base-type': _base, 'effective-type': _effective, ...options} = value[2];
      return ['field', value[1], Object.keys(options).length ? withoutFieldTypes(options) : null];
    }
    return value.map(withoutFieldTypes);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutFieldTypes(item)]));
}

// Compare only writable content. IDs, timestamps, UUID annotations and result
// fingerprints are server-owned. Card GET uses Metabase's legacy-MBQL format.
export function cardContent(card) {
  const q = structuredClone(card.dataset_query);
  if (q) { delete q.parameters; delete q.middleware; delete q.constraints; }
  const result = {name: card.name, type: card.type, display: card.display, collection_id: card.collection_id ?? null,
    description: prose(card.description), dataset_query: q,
    visualization_settings: card.visualization_settings ?? {}, parameters: card.parameters ?? []};
  // settings appear only when set, so models installed before formatting keep their
  // recorded content digest and plan as updates rather than customer edits.
  if (card.type === 'model') result.result_metadata = (card.result_metadata ?? []).map(c => ({
    name: c.name, display_name: c.display_name, base_type: c.base_type,
    semantic_type: c.semantic_type ?? null, description: c.description ?? null, id: c.id,
    ...(c.settings && Object.keys(c.settings).length ? {settings: c.settings} : {}),
  }));
  return result;
}

// Metabase returns a dashboard's cards in storage order, and a Postgres application
// database reorders them whenever it rewrites the rows (saving a card that sits on the
// dashboard does). So a dashboard's content lists cards, and each card's filter mappings,
// in a fixed order: storage order is never an edit. `stored: true` keeps Metabase's order,
// which is how installs made before this recorded their content.
const byPlacement = (a, b) => a.card_id - b.card_id || (a.dashboard_tab_id ?? 0) - (b.dashboard_tab_id ?? 0) || a.row - b.row || a.col - b.col;
const byFilter = (a, b) => String(a.parameter_id).localeCompare(String(b.parameter_id));
export function dashboardContent(dashboard, {stored = false} = {}) {
  const dashcards = (dashboard.dashcards ?? []).map(c => ({card_id: c.card_id, row: c.row, col: c.col,
    size_x: c.size_x, size_y: c.size_y, dashboard_tab_id: c.dashboard_tab_id,
    parameter_mappings: stored ? c.parameter_mappings : [...(c.parameter_mappings ?? [])].sort(byFilter),
    visualization_settings: c.visualization_settings ?? {}}));
  const tabs = (dashboard.tabs ?? []).map(t => ({name: t.name, position: t.position}));
  return {name: dashboard.name, collection_id: dashboard.collection_id ?? null,
    description: prose(dashboard.description), parameters: dashboard.parameters,
    tabs: stored ? tabs : tabs.sort((a, b) => a.position - b.position),
    dashcards: stored ? dashcards : dashcards.sort(byPlacement)};
}

// The readings an install made before cards were ordered may have recorded: Metabase's
// order then, which was creation order right after a write, or storage order.
export const recordedDashboardContents = dashboard => [dashboardContent(dashboard, {stored: true}),
  dashboardContent({...dashboard, dashcards: [...(dashboard.dashcards ?? [])].sort((a, b) => a.id - b.id)}, {stored: true})];

// What a dashboard shows, independent of the IDs Metabase assigned: each card's tab by
// position. The plan compares this with what the definition would write.
export function placedContent(dashboard) {
  const position = new Map((dashboard.tabs ?? []).map(t => [t.id, t.position]));
  const {dashcards, ...content} = dashboardContent(dashboard);
  return {...content, dashcards: dashcards.map(({dashboard_tab_id: tab, parameter_mappings, ...c}) => ({...c,
    tab: tab == null ? null : position.get(tab) ?? null,
    parameter_mappings: parameter_mappings.map(m => ({parameter_id: m.parameter_id, card_id: m.card_id, target: m.target}))}))
    .sort((a, b) => a.card_id - b.card_id || (a.tab ?? -1) - (b.tab ?? -1) || a.row - b.row || a.col - b.col)};
}

// `content` reads an object's writable content; `recorded` lists other readings an older
// install may have recorded (a dashboard's cards in Metabase's order).
export function actionFor(existing, sourceHash, content, recorded = () => []) {
  if (!existing) return {action: 'create'};
  if (existing.archived) return {action: 'conflict', reason: 'Archived content is preserved; restore it before updating.'};
  const saved = marker(existing.description);
  if (!saved || ![content(existing), ...recorded(existing)].some(c => digest(c) === saved.content)) {
    return {action: 'conflict', reason: 'Customer edits or incomplete prior apply; preserved.'};
  }
  return {action: saved.source === sourceHash ? 'unchanged' : 'update'};
}

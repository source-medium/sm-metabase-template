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

export function dashboardContent(dashboard) {
  return {name: dashboard.name, collection_id: dashboard.collection_id ?? null,
    description: prose(dashboard.description), parameters: dashboard.parameters,
    tabs: (dashboard.tabs ?? []).map(t => ({name: t.name, position: t.position})),
    dashcards: (dashboard.dashcards ?? []).map(c => ({card_id: c.card_id, row: c.row, col: c.col,
      size_x: c.size_x, size_y: c.size_y, dashboard_tab_id: c.dashboard_tab_id,
      parameter_mappings: c.parameter_mappings, visualization_settings: c.visualization_settings ?? {}}))};
}

export function actionFor(existing, sourceHash, content) {
  if (!existing) return {action: 'create'};
  if (existing.archived) return {action: 'conflict', reason: 'Archived content is preserved; restore it before updating.'};
  const saved = marker(existing.description);
  if (!saved || digest(content(existing)) !== saved.content) return {action: 'conflict', reason: 'Customer edits or incomplete prior apply; preserved.'};
  return {action: saved.source === sourceHash ? 'unchanged' : 'update'};
}

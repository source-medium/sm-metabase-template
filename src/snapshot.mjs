import {digest, definitionSource, marker, prose, cardContent, dashboardContent, recordedDashboardContents, placedContent, actionFor, scopeFor, withoutFieldTypes} from './ownership.mjs';

const list = value => Array.isArray(value) ? value : value.data;
const dimensionSummary = dimensions => (dimensions ?? []).map(d => ({name: d.name, default: !!d.default}))
  .sort((a, b) => a.name.localeCompare(b.name));

export async function snapshot(api, options, definitions = []) {
  const version = await api('GET', '/api/session/properties');
  // Versions verified end to end on the demo warehouse: v0.64.1 and v0.65.0-beta
  // (install, unchanged second plan, every question and dashboard card run).
  if (!/^v[01]\.6[45]\./.test(version.version?.tag || '')) throw new Error('This installer supports Metabase 0.64 and 0.65 (or 1.64 and 1.65). No content was changed.');
  const target = await api('GET', `/api/collection/${options.collection}`);
  // The target is the parent of the managed subcollection. Passing the managed
  // collection itself would plan a second foundation nested inside the first.
  if (marker(target?.description)) {
    throw new Error('That collection is a managed SourceMedium foundation. Use its parent collection ID. No content was changed.');
  }
  const scope = scopeFor(options);
  const [collections, archivedCollections, cards, archivedCards, dashboards, archivedDashboards, snippets, archivedSnippets] = await Promise.all([
    api('GET', '/api/collection'), api('GET', '/api/collection?archived=true'),
    api('GET', '/api/card'), api('GET', '/api/card?f=archived'),
    api('GET', '/api/dashboard'), api('GET', '/api/dashboard?f=archived'),
    api('GET', '/api/native-query-snippet'), api('GET', '/api/native-query-snippet?archived=true'),
  ]);
  const owned = new Map();
  const duplicate = new Set();
  const remember = (object, kind, key) => {
    const m = marker(object.description);
    if (m?.scope !== scope && !key) return;
    key ||= m.key;
    if (owned.has(key)) duplicate.add(key);
    owned.set(key, {...object, _kind: kind});
  };
  for (const c of [...list(collections), ...list(archivedCollections)].filter(c => marker(c.description)?.scope === scope)) remember(await api('GET', `/api/collection/${c.id}`), 'collection');
  const managedCollection = owned.get('collection:foundation');
  const allCards = [...new Map([...list(cards), ...list(archivedCards)].map(c => [c.id, c])).values()];
  for (const c of allCards.filter(c => marker(c.description)?.scope === scope)) {
    const card = await api('GET', `/api/card/${c.id}?legacy-mbql=true`);
    if (card.type === 'metric') card._dimensions = (await api('GET', `/api/metric/${c.id}/dimension`)).added;
    remember(card, 'card');
  }
  const allDashboards = [...list(dashboards), ...list(archivedDashboards)];
  for (const d of allDashboards.filter(d => marker(d.description)?.scope === scope)) remember(await api('GET', `/api/dashboard/${d.id}`), 'dashboard');
  const names = new Map(definitions.filter(n => n.kind === 'snippet').map(n => [n.body(new Map()).name, n.key]));
  for (const s of [...list(snippets), ...list(archivedSnippets)]) {
    if (marker(s.description)?.scope === scope || names.has(s.name)) remember(s, 'snippet', names.get(s.name));
  }
  // Metabase assigns its own entity IDs, so the ownership line is the only
  // identity. Report its loss rather than create a second managed copy: an
  // unmarked object with a managed name inside the managed collection, or
  // managed content whose collection in the target parent lost its line.
  const unmarked = new Map();
  const unowned = object => !object.archived && marker(object.description)?.scope !== scope;
  if (managedCollection) {
    for (const node of definitions.filter(n => !owned.has(n.key) && ['card', 'dashboard'].includes(n.kind))) {
      const name = node.kind === 'card' ? node.body(new Map()).name : node.layout.name;
      const candidates = node.kind === 'card' ? allCards : allDashboards;
      if (candidates.some(o => unowned(o) && o.collection_id === managedCollection.id && o.name === name)) {
        unmarked.set(node.key, 'An unmarked object with this managed name is in the managed collection; restore its ownership line or move it out.');
      }
    }
  } else {
    const homes = new Set([...owned.values()].filter(o => o._kind !== 'snippet' && !o.archived).map(o => o.collection_id));
    for (const listed of list(collections).filter(c => homes.has(c.id) && unowned(c))) {
      const home = await api('GET', `/api/collection/${listed.id}`);
      if (home.parent_id === options.collection) {
        unmarked.set('collection:foundation', `Managed content is in collection ${home.id} (${JSON.stringify(home.name)}), which has no ownership line; restore the line before updating.`);
      }
    }
  }
  return {scope, owned, duplicate, unmarked, collectionId: managedCollection?.id};
}

export function metricContent(card) {
  return {...cardContent(card), dimensions: (card._dimensions || []).map(d => ({
    name: d.name, display_name: d.display_name, default: !!d.default}))};
}
export const contentOf = object => object._kind === 'dashboard' ? dashboardContent(object) :
  object._kind === 'snippet' ? {name: object.name, content: object.content, description: prose(object.description)} :
  object._kind === 'collection' ? {name: object.name, description: object.description?.split('\nSM_METABASE_V1 ')[0], parent_id: object.parent_id} :
  object.type === 'metric' ? metricContent(object) : cardContent(object);

// How a dashboard card maps the dashboard's filters: to each template tag the card's
// question consumes, as a field filter or a value.
export function mappings(card, id, parameters) {
  return parameters.flatMap(p => {
    const questionParameter = card.parameters?.find(q => q.id === p.id);
    const tag = card.dataset_query.native?.['template-tags']?.[p.id];
    // A multi-tab dashboard can have filters this question does not consume.
    if (!questionParameter && !tag) return [];
    const target = questionParameter?.target || [tag?.type === 'dimension' ? 'dimension' : 'variable', ['template-tag', p.id]];
    return [{parameter_id: p.id, card_id: id, target}];
  });
}

// A dashboard whose content is exactly what its definition writes holds no customer edit,
// whatever its ownership record says (a record taken from a read Metabase later reordered,
// or an apply stopped part way). Every card must already be installed for that to hold.
function matchesDefinition(existing, target, state) {
  const cards = new Map([...state.owned].filter(([, v]) => v._kind === 'card'));
  const {layout, cards: placements} = target;
  if (placements.some(c => !cards.has(c.key) || cards.get(c.key).id !== c.card_id)) return false;
  const defined = {name: layout.name, collection_id: state.collectionId ?? null, description: layout.description,
    parameters: layout.parameters, tabs: layout.tabs.map((name, position) => ({name, position})),
    dashcards: placements.map(c => ({card_id: c.card_id, row: c.row, col: c.col, size_x: c.size_x, size_y: c.size_y,
      visualization_settings: c.visualization_settings ?? {}, tab: c.tab,
      parameter_mappings: mappings(cards.get(c.key), c.card_id, layout.parameters)}))};
  return digest(withoutFieldTypes(placedContent(existing))) === digest(withoutFieldTypes(placedContent({...defined,
    tabs: defined.tabs.map(t => ({...t, id: t.position})), dashcards: defined.dashcards.map(({tab, ...c}) => ({...c, dashboard_tab_id: tab}))})));
}

export const collectionDefinition = options => ({key: 'collection:foundation', kind: 'collection', dependencies: [], body: () => ({
  name: 'SourceMedium foundation', parent_id: options.collection,
  description: 'Customer-owned SourceMedium dashboards, models and catalog-derived metrics. Refresh definitions with the SourceMedium adapter; add custom content separately.'})});

export function makePlan(definition, state, options) {
  const nodes = [collectionDefinition(options), ...definition.nodes];
  const ids = new Map([...state.owned].map(([key, value]) => [key, value.id]));
  const actions = [];
  for (const node of nodes) {
    const target = node.body(ids);
    const source = definitionSource(node, target);
    const existing = state.owned.get(node.key);
    let result = actionFor(existing, source, contentOf,
      object => object._kind === 'dashboard' ? recordedDashboardContents(object) : []);
    if (result.action === 'conflict' && node.kind === 'dashboard' && !existing.archived && marker(existing.description) &&
        !marker(existing.description).pending && matchesDefinition(existing, target, state)) {
      result = {action: 'update', reason: 'Content matches the definition; its ownership record is refreshed.'};
    }
    if (existing && !existing.archived && marker(existing.description)?.pending) {
      const current = existing._kind === 'card' ? cardContent(existing) : ['collection', 'snippet'].includes(existing._kind) ? contentOf(existing) :
        {name: existing.name, collection_id: existing.collection_id ?? null,
          description: contentOf(existing).description, parameters: existing.parameters};
      const desired = node.kind === 'card' ? cardContent({...target, collection_id: state.collectionId}) : ['collection', 'snippet'].includes(node.kind) ? target :
        {name: node.layout.name, collection_id: state.collectionId,
          description: node.layout.description, parameters: node.layout.parameters};
      result = digest(withoutFieldTypes(current)) === digest(withoutFieldTypes(desired)) ? {action: 'resume'} :
        {action: 'conflict', reason: 'Incomplete content has changed; preserved.'};
    }
    if (state.unmarked.has(node.key)) result = {action: 'conflict', reason: state.unmarked.get(node.key)};
    if (state.duplicate.has(node.key)) result = {action: 'conflict', reason: 'Duplicate managed identities; preserved.'};
    const blocked = ['collection:foundation', ...node.dependencies].some(key => key !== node.key && actions.some(a => a.key === key && ['conflict', 'blocked'].includes(a.action)));
    if (blocked) result = {action: 'blocked', reason: 'A dependency has customer edits or is unavailable.'};
    // Compared with the built definition, so a review lists only real changes.
    const previous = existing ? withoutFieldTypes(contentOf(existing)) : null;
    const proposed = node.dimensions ? {...target, dimensions: dimensionSummary(node.dimensions.map((name, i) => ({name, default: i === 0})))} : target;
    const before = node.dimensions && previous ? {...previous, dimensions: dimensionSummary(previous.dimensions)} : previous;
    const changes = (result.action === 'unchanged' ? [] : Object.keys(proposed)).filter(k => digest(proposed[k]) !== digest(before?.[k] ?? null))
      .map(field => ({field, before: before?.[field] ?? null, after: proposed[field]}));
    actions.push({key: node.key, kind: node.kind, source, id: existing?.id ?? null, changes,
      before: existing ? digest(contentOf(existing)) : null, ...result});
  }
  const retained = [...state.owned.keys()].filter(key => !nodes.some(n => n.key === key));
  const review = {format: 1, target: {url: options.url, database: options.database, dataset: options.dataset,
    metadataDataset: options.metadataDataset, collection: options.collection, store: options.store || null, asOf: options.asOf},
    actions, unsupported: [...definition.unavailable, ...(definition.unsupported ?? [])], retained,
    ...(definition.formatting ? {formatting: definition.formatting} : {})};
  return {...review, digest: digest(review)};
}

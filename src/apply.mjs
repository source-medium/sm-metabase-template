import {digest, definitionSource, stamp, cardContent} from './ownership.mjs';
import {snapshot, makePlan, contentOf, collectionDefinition} from './snapshot.mjs';

async function getCard(api, id) {
  const card = await api('GET', `/api/card/${id}?legacy-mbql=true`);
  card._kind = 'card';
  if (card.type === 'metric') card._dimensions = (await api('GET', `/api/metric/${id}/dimension`)).added;
  return card;
}

async function curate(api, id, names) {
  const path = `/api/metric/${id}/dimension`;
  let dimensions = await api('GET', path + '?with-addable=true');
  const missing = names.filter(name => !dimensions.added.some(d => d.name === name));
  if (missing.length) {
    const available = dimensions.addable.flatMap(g => g.dimensions);
    const additions = missing.map(name => available.find(d => d.name === name));
    if (additions.some(d => !d)) throw new Error('Metabase did not expose a required metric dimension. Re-plan after a schema sync.');
    await api('POST', path + '/add', {dimensions: additions.map(d => ({id: d.id, mapping_target: d.mapping_target}))});
    dimensions = await api('GET', path);
  }
  const remove = dimensions.added.filter(d => !names.includes(d.name)).map(d => d.id);
  if (remove.length) await api('POST', path + '/remove', {dimension_ids: remove});
  const time = dimensions.added.find(d => d.name === names[0]);
  await api('POST', path + '/set-default', {dimension_id: time.id});
}

function mappings(card, id, parameters) {
  return parameters.flatMap(p => {
    const questionParameter = card.parameters?.find(q => q.id === p.id);
    const tag = card.dataset_query.native?.['template-tags']?.[p.id];
    // A multi-tab dashboard can have filters this question does not consume.
    if (!questionParameter && !tag) return [];
    const target = questionParameter?.target || [tag?.type === 'dimension' ? 'dimension' : 'variable', ['template-tag', p.id]];
    return [{parameter_id: p.id, card_id: id, target}];
  });
}

async function layoutDashboard(api, existing, node, ids, cards, collectionId, description) {
  const {layout, cards: placements} = node.body(ids);
  const tabs = layout.tabs.map((name, i) => ({id: existing.tabs?.find(t => t.name === name)?.id || -(i + 1), name, position: i}));
  const dashcards = placements.map((c, i) => {
    const prior = existing.dashcards?.find(d => d.card_id === c.card_id);
    return {id: prior?.id || -(i + 1), card_id: c.card_id, row: c.row, col: c.col, size_x: c.size_x, size_y: c.size_y,
      dashboard_tab_id: c.tab === null ? null : tabs[c.tab].id, visualization_settings: c.visualization_settings,
      parameter_mappings: mappings(cards.get(c.key), c.card_id, layout.parameters)};
  });
  return api('PUT', `/api/dashboard/${existing.id}`, {name: layout.name, description, collection_id: collectionId,
    parameters: layout.parameters, tabs, dashcards});
}

export async function applyPlan(api, definition, options, reviewed, {notify = () => {}} = {}) {
  const state = await snapshot(api, options, definition.nodes);
  const fresh = makePlan(definition, state, options);
  if (fresh.digest !== reviewed.digest || digest({...reviewed, digest: undefined}) !== reviewed.digest) {
    throw new Error('The reviewed plan is stale or modified. Generate and review a new plan. No content was changed.');
  }
  const ids = new Map([...state.owned].map(([key, value]) => [key, value.id]));
  const cards = new Map([...state.owned].filter(([, v]) => v._kind === 'card'));
  for (const node of [collectionDefinition(options), ...definition.nodes]) {
    const decision = fresh.actions.find(a => a.key === node.key);
    if (['conflict', 'blocked'].includes(decision.action)) { notify(`${decision.action}: ${node.key}`); continue; }
    if (decision.action === 'unchanged') continue;
    const existing = state.owned.get(node.key);
    if (existing) {
      const live = node.kind === 'card' ? await getCard(api, existing.id) :
        {...await api('GET', `/api/${node.kind === 'snippet' ? 'native-query-snippet' : node.kind}/${existing.id}`), _kind: node.kind};
      if (live.archived || digest(contentOf(live)) !== decision.before) throw new Error(`Content changed during apply: ${node.key}. Stopped before overwriting it.`);
    }
    const body = node.body(ids);
    const source = definitionSource(node, body);
    const collectionId = ids.get('collection:foundation');
    const pending = {key: node.key, scope: state.scope, source, content: digest(body), pending: true};
    let object;
    if (node.kind === 'card') {
      const payload = {...body, collection_id: collectionId};
      pending.content = digest(cardContent(payload));
      payload.description = stamp(body.description, pending);
      object = await api(existing ? 'PUT' : 'POST', `/api/card${existing ? '/' + existing.id : ''}`, payload);
      if (node.dimensions) await curate(api, object.id, node.dimensions);
      object = await getCard(api, object.id);
      await api('PUT', `/api/card/${object.id}`, {description: stamp(body.description, {...pending, pending: false, content: digest(contentOf(object))})});
      object = await getCard(api, object.id);
      cards.set(node.key, object);
    } else if (node.kind === 'snippet') {
      object = await api(existing ? 'PUT' : 'POST', `/api/native-query-snippet${existing ? '/' + existing.id : ''}`,
        {...body, description: stamp(body.description, pending)});
      object = {...await api('GET', `/api/native-query-snippet/${object.id}`), _kind: 'snippet'};
      await api('PUT', `/api/native-query-snippet/${object.id}`, {description: stamp(body.description, {...pending, pending: false, content: digest(contentOf(object))})});
    } else if (node.kind === 'dashboard') {
      const initial = {name: node.layout.name, description: stamp(node.layout.description, pending),
        parameters: node.layout.parameters, collection_id: collectionId};
      object = existing || await api('POST', '/api/dashboard', initial);
      if (existing) await api('PUT', `/api/dashboard/${object.id}`, initial);
      await layoutDashboard(api, object, node, ids, cards, collectionId, initial.description);
      object = {...await api('GET', `/api/dashboard/${object.id}`), _kind: 'dashboard'};
      await api('PUT', `/api/dashboard/${object.id}`, {description: stamp(node.layout.description, {...pending, pending: false, content: digest(contentOf(object))})});
    } else {
      object = await api(existing ? 'PUT' : 'POST', `/api/collection${existing ? '/' + existing.id : ''}`,
        {...body, description: stamp(body.description, pending)});
      object = {...await api('GET', `/api/collection/${object.id}`), _kind: 'collection'};
      await api('PUT', `/api/collection/${object.id}`, {description: stamp(body.description, {...pending, pending: false, content: digest(contentOf(object))})});
    }
    ids.set(node.key, object.id);
    notify(`${decision.action}: ${node.key}`);
  }
  return {ids: Object.fromEntries(ids), conflicts: fresh.actions.filter(a => ['conflict', 'blocked'].includes(a.action)),
    retained: fresh.retained, omitted: definition.unavailable, unsupportedMetrics: definition.unsupported?.length || 0};
}

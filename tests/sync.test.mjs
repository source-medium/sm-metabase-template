import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCatalog} from '../src/catalog.mjs';
import {definitions, foundationSql} from '../src/foundation.mjs';
import {snapshot, makePlan} from '../src/snapshot.mjs';
import {applyPlan} from '../src/apply.mjs';
import {marker, stamp, prose, digest, dashboardContent} from '../src/ownership.mjs';
import {rows, tables, options, fakeMetabase, documented, foundationTables, paidRows} from './fixtures.mjs';
import {dashboards} from '../foundation/questions.mjs';

const sql = foundationSql();
const define = (data = rows) => ({...definitions(compileCatalog(data, tables, options.dataset, documented(tables)), tables, sql, options), unsupported: []});
async function plan(api, definition) { return makePlan(definition, await snapshot(api, options, definition.nodes), options); }
const writes = calls => calls.filter(c => c.method !== 'GET');

const full = () => definitions(compileCatalog([...rows, ...paidRows], foundationTables, options.dataset, documented(foundationTables)), foundationTables, sql, options);

test('comparison numbers use their own value for the empty state and preserve shared metrics and filters', async () => {
  const m = fakeMetabase();
  const definition = full();
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const fields = {kpis: 'net_revenue', kpi_orders: 'summary_orders', kpi_spend: 'ad_spend',
    kpi_mer: 'mer', kpi_order_value: 'net_revenue_per_summary_order', kpi_sessions: 'sessions'};
  for (const [key, column] of Object.entries(fields)) {
    const card = m.cards.get(installed.ids[`question:${key}`]);
    assert.equal(card.visualization_settings['scalar.field'], column);
    assert.ok(card.dataset_query.native.query.endsWith(`WHERE number_card.\`${column}\` IS NOT NULL\n`));
    assert.equal(card.dataset_query.native['template-tags'].store.required, true);
    assert.match(card.dataset_query.native.query, /SAFE_DIVIDE\(\{\{snippet: SM /);
    assert.match(card.dataset_query.native.query, /comparison\.net_revenue_per_summary_order AS compare_net_revenue_per_summary_order/);
    assert.equal(card.visualization_settings['scalar.comparisons'][0].column, `compare_${column}`);
  }
  const trend = m.cards.get(installed.ids['question:trend_order_value']);
  assert.ok(!trend.dataset_query.native.query.includes('number_card'), 'line charts must keep null gaps and comparison-only dates');
  const stable = await plan(m.api, definition);
  assert.ok(stable.actions.every(a => a.action === 'unchanged'));
});

test('the eleven-tab foundation reuses questions and maps only each question\'s actual filters', async () => {
  const m = fakeMetabase();
  const definition = full();
  assert.deepEqual(definition.unavailable, []);
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const dashboard = m.dashboards.get(installed.ids['dashboard:foundation']);
  assert.deepEqual(dashboard.tabs.map(t => t.name), ['Overview', 'Business review', 'Performance tables', 'All stores', 'Paid marketing',
    'Creatives', 'Products', 'Retention', 'Geography', 'Orders', 'Data']);
  const placed = dashboards().flatMap(d => d.cards).length;
  assert.equal(dashboard.dashcards.length, placed);
  assert.equal(new Set(dashboard.dashcards.map(c => c.card_id)).size, placed);
  for (const placement of dashboard.dashcards) {
    const card = m.cards.get(placement.card_id);
    const tags = card.dataset_query.native['template-tags'];
    const tagIds = Object.keys(tags).filter(id => !id.startsWith('snippet:'));
    assert.deepEqual(placement.parameter_mappings.map(p => p.parameter_id).sort(), tagIds.sort());
    for (const mapping of placement.parameter_mappings) {
      assert.equal(mapping.card_id, card.id);
      assert.deepEqual(mapping.target, [tags[mapping.parameter_id].type === 'dimension' ? 'dimension' : 'variable', ['template-tag', mapping.parameter_id]]);
    }
    assert.ok([...m.dashboards.values()].some(d => d.id !== dashboard.id && d.dashcards.some(c => c.card_id === card.id)));
  }
  const original = structuredClone(dashboard);
  const again = await plan(m.api, definition);
  assert.ok(again.actions.every(a => a.action === 'unchanged'));
  const start = m.calls.length;
  await applyPlan(m.api, definition, options, again);
  assert.equal(writes(m.calls.slice(start)).length, 0);
  assert.deepEqual(m.dashboards.get(dashboard.id), original);
});

test('clicks set filters on the same dashboard, or open another dashboard with its filters set', async () => {
  const m = fakeMetabase();
  const definition = full();
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const click = (dashboard, question, column) => m.dashboards.get(installed.ids[dashboard]).dashcards
    .find(c => c.card_id === installed.ids[`question:${question}`]).visualization_settings.column_settings[JSON.stringify(['name', column])].click_behavior;
  const set = (id, column) => ({id, source: {type: 'column', id: column, name: column}, target: {type: 'parameter', id}});
  assert.deepEqual(click('dashboard:geography', 'geography_regions', 'region'),
    {type: 'crossfilter', parameterMapping: {country: set('country', 'country'), region: set('region', 'region')}});
  assert.deepEqual(click('dashboard:orders', 'orders', 'order_name'), {type: 'crossfilter', parameterMapping: {order: set('order', 'order_key')}});
  for (const dashboard of ['dashboard:stores', 'dashboard:foundation']) {
    assert.deepEqual(click(dashboard, 'stores', 'store_name'),
      {type: 'link', linkType: 'dashboard', targetId: installed.ids['dashboard:summary'], parameterMapping: {store: set('store', 'store_id')}});
  }
  // A filter the dashboard does not have is left out of the click.
  const paid = definition.nodes.find(n => n.key === 'dashboard:paid');
  assert.ok(paid.layout.parameters.some(p => p.id === 'campaign'));
});

// Metabase on a Postgres application database returns a dashboard's cards in storage order,
// which changes when it rewrites the rows, as saving a card on the dashboard does. Seen on the
// public demo on 2026-10-25: an upgrade stopped with "Content changed during apply", or
// stamped a read that a later one reordered and planned the next refresh as a customer edit.
test('dashboard cards read back in another order are never a change or a customer edit', async () => {
  const m = fakeMetabase(); m.reorderDashcards(true);
  const initial = define();
  await applyPlan(m.api, initial, options, await plan(m.api, initial));
  assert.ok((await plan(m.api, initial)).actions.every(a => a.action === 'unchanged'));
  const expanded = full();
  const upgrade = await plan(m.api, expanded);
  assert.ok(upgrade.actions.some(a => a.key === 'dashboard:foundation' && a.action === 'update'));
  await applyPlan(m.api, expanded, options, upgrade);
  for (let i = 0; i < 2; i++) assert.ok((await plan(m.api, expanded)).actions.every(a => a.action === 'unchanged'));
});

test('an install recorded with cards in Metabase\'s order still plans unchanged', async () => {
  const m = fakeMetabase(); const definition = full();
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const dashboard = m.dashboards.get(installed.ids['dashboard:foundation']);
  const saved = marker(dashboard.description);
  // Recorded in creation order, then stored in another: the earlier release's demo install.
  const created = digest(dashboardContent(dashboard, {stored: true}));
  dashboard.dashcards.reverse();
  assert.notEqual(created, digest(dashboardContent(dashboard)), 'the fixture must differ only in order');
  for (const content of [created, digest(dashboardContent(dashboard, {stored: true}))]) {
    dashboard.description = stamp(dashboard.description, {...saved, content});
    assert.ok((await plan(m.api, definition)).actions.every(a => a.action === 'unchanged'));
  }
});

test('a stale ownership record on a dashboard that matches its definition is refreshed; an edit is preserved', async () => {
  const m = fakeMetabase(); const definition = full();
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const dashboard = m.dashboards.get(installed.ids['dashboard:foundation']);
  const stale = description => stamp(description, {...marker(description), content: '0'.repeat(64)});
  dashboard.description = stale(dashboard.description);
  const refresh = await plan(m.api, definition);
  assert.deepEqual(refresh.actions.filter(a => a.action !== 'unchanged').map(a => [a.key, a.action, a.reason]),
    [['dashboard:foundation', 'update', 'Content matches the definition; its ownership record is refreshed.']]);
  await applyPlan(m.api, definition, options, refresh);
  assert.ok((await plan(m.api, definition)).actions.every(a => a.action === 'unchanged'));
  // A customer who moves a card keeps the move, with or without a current record.
  const moved = m.dashboards.get(dashboard.id);
  moved.dashcards[0].row += 1;
  assert.equal((await plan(m.api, definition)).actions.find(a => a.key === 'dashboard:foundation').action, 'conflict');
  moved.description = stale(moved.description);
  assert.equal((await plan(m.api, definition)).actions.find(a => a.key === 'dashboard:foundation').action, 'conflict');
});

test('unavailable optional sources leave out only their cards and empty tabs', async () => {
  const m = fakeMetabase(); const definition = define();
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const dashboard = m.dashboards.get(installed.ids['dashboard:foundation']);
  assert.deepEqual(dashboard.tabs.map(t => t.name), ['Overview', 'Business review', 'Performance tables']);
  assert.ok(!dashboard.dashcards.some(c => c.card_id === installed.ids['question:store_context']));
  assert.ok(definition.unavailable.some(item => item.name === 'All stores' && /dim_stores/.test(item.reason)));
  assert.ok(definition.unavailable.some(item => item.name === 'Reporting context' && /not synced/.test(item.reason)));
  assert.ok(definition.unavailable.some(item => item.name === 'SourceMedium paid marketing'));
  const performance = m.dashboards.get(installed.ids['dashboard:performance']);
  assert.equal(performance.dashcards.length, 3, 'the platform table needs the ad report');
  const empty = definitions({models: [], metrics: [], unavailable: []}, [], sql, options);
  assert.ok(!empty.nodes.some(n => n.key === 'dashboard:foundation'));
});

test('adding optional foundation tabs preserves existing dashboard, tab and placement IDs', async () => {
  const m = fakeMetabase(); const initial = define();
  const installed = await applyPlan(m.api, initial, options, await plan(m.api, initial));
  const original = structuredClone(m.dashboards.get(installed.ids['dashboard:foundation']));
  const expanded = full();
  await applyPlan(m.api, expanded, options, await plan(m.api, expanded));
  const dashboard = m.dashboards.get(original.id);
  for (const tab of original.tabs) assert.equal(dashboard.tabs.find(t => t.name === tab.name).id, tab.id);
  for (const placement of original.dashcards) assert.equal(dashboard.dashcards.find(c => c.card_id === placement.card_id).id, placement.id);
  assert.ok((await plan(m.api, expanded)).actions.every(a => a.action === 'unchanged'));
});

test('dictionary-only models install and refresh independently of supported metrics, preserving existing IDs', async () => {
  const m = fakeMetabase();
  await applyPlan(m.api, define(), options, await plan(m.api, define()));
  const original = m.cards.get([...m.cards.values()].find(c => marker(c.description)?.key === `model:${tables[0].name}`).id);
  const extra = {id: 77, name: 'dim_customers', schema: options.dataset,
    fields: [{id: 771, name: 'customer_id', base_type: 'type/Text'}]};
  const all = [...tables, extra];
  const dictionary = documented(all);
  const expanded = () => definitions(compileCatalog(rows, all, options.dataset, dictionary), all, sql, options);
  const reviewed = await plan(m.api, expanded());
  assert.equal(reviewed.actions.find(a => a.key === 'model:dim_customers').action, 'create');
  await applyPlan(m.api, expanded(), options, reviewed);
  assert.equal(m.cards.get(original.id).id, original.id);
  const installed = [...m.cards.values()].find(c => marker(c.description)?.key === 'model:dim_customers');
  const again = await plan(m.api, expanded());
  assert.ok(again.actions.every(a => a.action === 'unchanged'));
  dictionary[1].columns[0].column_description = 'Canonical customer identity.';
  const refresh = await plan(m.api, expanded());
  assert.deepEqual(refresh.actions.filter(a => a.action !== 'unchanged').map(a => a.key), ['model:dim_customers']);
  await applyPlan(m.api, expanded(), options, refresh);
  assert.equal([...m.cards.values()].find(c => marker(c.description)?.key === 'model:dim_customers').id, installed.id);
  assert.equal(m.cards.get(installed.id).result_metadata[0].description, 'Canonical customer identity.');
});

test('first install and second apply are idempotent; customer content is untouched', async () => {
  const m = fakeMetabase(); const definition = define();
  m.cards.set(6, {id: 6, name: 'Customer question', description: null, type: 'question'});
  // Customer look-alikes carry managed names but no ownership line.
  m.cards.set(7, {id: 7, name: 'Executive summary KPIs', description: null, type: 'question', collection_id: 3});
  m.dashboards.set(8, {id: 8, name: 'SourceMedium executive summary', description: null, collection_id: 3});
  const before = structuredClone([m.cards.get(6), m.cards.get(7), m.dashboards.get(8)]);
  const reviewed = await plan(m.api, definition);
  assert.equal(writes(m.calls).length, 0);
  assert.ok(reviewed.actions.every(a => a.action === 'create'));
  await applyPlan(m.api, definition, options, reviewed);
  assert.deepEqual([m.cards.get(6), m.cards.get(7), m.dashboards.get(8)], before);
  const again = await plan(m.api, definition);
  assert.ok(again.actions.every(a => a.action === 'unchanged'));
  const start = m.calls.length;
  await applyPlan(m.api, definition, options, again);
  assert.equal(writes(m.calls.slice(start)).length, 0);
});

test('catalog changes update the existing metric, preserving its ID and its consumers', async () => {
  const m = fakeMetabase(); const definition = define();
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const id = installed.ids['metric:order_net_revenue_summary'];
  const next = define(rows.map(r => r.metric_name === 'order_net_revenue_summary' ? {...r, calculation: 'SUM(order_gross_revenue)'} : r));
  const reviewed = await plan(m.api, next);
  assert.equal(reviewed.actions.find(a => a.key === 'metric:order_net_revenue_summary').action, 'update');
  const applied = await applyPlan(m.api, next, options, reviewed);
  assert.equal(applied.ids['metric:order_net_revenue_summary'], id);
  assert.equal(applied.ids['question:kpis'], installed.ids['question:kpis']);
  assert.equal(m.cards.get(id).dataset_query.query.aggregation[0][1][1], 8);
  assert.ok(m.snippets.get(applied.ids['snippet:marketing_efficiency_ratio_summary']).content.includes('order_gross_revenue'));
});

test('metric dimension changes participate in review and refresh without replacing the metric', async () => {
  const m = fakeMetabase(); const d = define();
  const installed = await applyPlan(m.api, d, options, await plan(m.api, d));
  const key = 'metric:order_net_revenue_summary'; const id = installed.ids[key];
  const next = {...d, nodes: d.nodes.map(n => n.key === key ? {...n, dimensions: ['date', 'sm_store_id']} : n)};
  const reviewed = await plan(m.api, next);
  const action = reviewed.actions.find(a => a.key === key);
  assert.equal(action.action, 'update');
  assert.deepEqual(action.changes.map(c => c.field), ['dimensions']);
  const result = await applyPlan(m.api, next, options, reviewed);
  assert.equal(result.ids[key], id);
  assert.deepEqual(m.dimensions.get(id).map(d => d.name), ['date', 'sm_store_id']);
  assert.ok((await plan(m.api, next)).actions.every(a => a.action === 'unchanged'));
});

test('customer edits, moved cards, removed markers and archived cards are protected', async () => {
  for (const edit of [c => {c.name = 'My custom name';}, c => {c.collection_id = 99;},
    c => {c.description = 'My custom description';}, c => {c.archived = true;}, c => {c.type = 'question';}]) {
    const m = fakeMetabase(); const d = define();
    const installed = await applyPlan(m.api, d, options, await plan(m.api, d));
    const id = installed.ids['metric:order_net_revenue_summary'];edit(m.cards.get(id));
    const before = structuredClone(m.cards.get(id));
    const reviewed = await plan(m.api, d);
    assert.equal(reviewed.actions.find(a => a.key === 'metric:order_net_revenue_summary').action, 'conflict');
    assert.equal(reviewed.actions.find(a => a.key === 'question:kpis').action, 'blocked');
    await applyPlan(m.api, d, options, reviewed);
    assert.deepEqual(m.cards.get(id), before);
  }
});

test('stale or tampered reviewed plans fail before the first write', async () => {
  const m = fakeMetabase(); const d = define();
  const reviewed = await plan(m.api, d);
  const changed = structuredClone(reviewed);changed.actions[0].action = 'unchanged';
  await assert.rejects(applyPlan(m.api, d, options, changed), /stale or modified/);
  assert.equal(writes(m.calls).length, 0);
  await applyPlan(m.api, d, options, reviewed);
  const next = await plan(m.api, d);
  m.cards.values().next().value.name = 'Edited after review';
  const start = m.calls.length;
  await assert.rejects(applyPlan(m.api, d, options, next), /stale or modified/);
  assert.equal(writes(m.calls.slice(start)).length, 0);
});

test('moving a managed dashboard is preserved when its source definitions change', async () => {
  const m = fakeMetabase(); const d = define();
  const installed = await applyPlan(m.api, d, options, await plan(m.api, d));
  const id = installed.ids['dashboard:summary'];
  m.dashboards.get(id).collection_id = 99;
  const before = structuredClone(m.dashboards.get(id));
  const next = {...d, nodes: d.nodes.map(n => n.key === 'dashboard:summary' ?
    {...n, layout: {...n.layout, name: 'Updated summary'}, body: ids => ({...n.body(ids), name: 'Updated summary'})} : n)};
  const reviewed = await plan(m.api, next);
  assert.equal(reviewed.actions.find(a => a.key === 'dashboard:summary').action, 'conflict');
  await applyPlan(m.api, next, options, reviewed);
  assert.deepEqual(m.dashboards.get(id), before);
});

test('archived dashboards and collections are preserved instead of recreated', async () => {
  for (const [key, store] of [['dashboard:summary', 'dashboards'], ['collection:foundation', 'collections']]) {
    const m = fakeMetabase(); const d = define();
    const installed = await applyPlan(m.api, d, options, await plan(m.api, d));
    const id = installed.ids[key];
    m[store].get(id).archived = true;
    m[store].get(id).description = stamp(m[store].get(id).description, {...marker(m[store].get(id).description), pending: true});
    const before = structuredClone(m[store].get(id));
    const reviewed = await plan(m.api, d);
    assert.equal(reviewed.actions.find(a => a.key === key).action, 'conflict');
    const start = m.calls.length;
    await applyPlan(m.api, d, options, reviewed);
    assert.equal(writes(m.calls.slice(start)).length, 0);
    assert.deepEqual(m[store].get(id), before);
  }
});

test('an interrupted curation can resume, while changed pending definitions are protected', async () => {
  const m = fakeMetabase(); const d = define();
  let once = true;
  m.failWhen((method, path) => method === 'POST' && path.endsWith('/set-default') && once && !(once = false));
  await assert.rejects(applyPlan(m.api, d, options, await plan(m.api, d)), /transport failure/);
  const pending = [...m.cards.values()].find(c => marker(c.description)?.pending);
  assert.ok(pending);
  m.failWhen(null);
  const resume = await plan(m.api, d);
  assert.equal(resume.actions.find(a => a.id === pending.id).action, 'resume');
  await applyPlan(m.api, d, options, resume);
  assert.ok((await plan(m.api, d)).actions.every(a => a.action === 'unchanged'));
});

test('retired metrics are reported and preserved, and plan data excludes authentication', async () => {
  const m = fakeMetabase(); const d = define();
  const installed = await applyPlan(m.api, d, options, await plan(m.api, d));
  const next = define(rows.filter(r => r.metric_name !== 'new_customer_order_count_summary'));
  const reviewed = await plan(m.api, next);
  assert.ok(reviewed.retained.includes('metric:new_customer_order_count_summary'));
  assert.ok(!JSON.stringify(reviewed).includes('test-secret-not-for-plans'));
  await applyPlan(m.api, next, options, reviewed);
  assert.ok(m.cards.has(installed.ids['metric:new_customer_order_count_summary']));
});

test('an apply interrupted after creating a card resumes it once Metabase has annotated its query', async () => {
  for (const interrupted of [card => card.type === 'model', card => card.dataset_query?.type === 'native']) {
    const m = fakeMetabase(); const d = define();
    let once = true;
    m.failWhen((method, path, body) => method === 'PUT' && /^\/api\/card\/\d+$/.test(path) &&
      body?.description?.includes('"pending":false') && interrupted(m.cards.get(Number(path.split('/')[3]))) && once && !(once = false));
    await assert.rejects(applyPlan(m.api, d, options, await plan(m.api, d)), /transport failure/);
    const pending = [...m.cards.values()].find(c => marker(c.description)?.pending);
    assert.ok(pending && interrupted(pending));
    m.failWhen(null);
    const resume = await plan(m.api, d);
    assert.equal(resume.actions.find(a => a.id === pending.id).action, 'resume');
    assert.ok(!resume.actions.some(a => ['conflict', 'blocked'].includes(a.action)));
    const applied = await applyPlan(m.api, d, options, resume);
    assert.equal(applied.ids[resume.actions.find(a => a.id === pending.id).key], pending.id);
    assert.ok((await plan(m.api, d)).actions.every(a => a.action === 'unchanged'));
    const names = [...m.cards.values()].map(c => c.name);
    assert.equal(new Set(names).size, names.length);
  }
});

test('a removed ownership line is reported instead of duplicating managed content', async () => {
  for (const [key, store] of [['metric:order_net_revenue_summary', 'cards'], ['dashboard:summary', 'dashboards'], ['collection:foundation', 'collections']]) {
    const m = fakeMetabase(); const d = define();
    const installed = await applyPlan(m.api, d, options, await plan(m.api, d));
    const object = m[store].get(installed.ids[key]);
    object.description = prose(object.description) + ' Edited by the customer.';
    const sizes = [m.cards.size, m.dashboards.size, m.collections.size, m.snippets.size];
    const reviewed = await plan(m.api, d);
    assert.equal(reviewed.actions.find(a => a.key === key).action, 'conflict');
    assert.ok(!reviewed.actions.some(a => a.action === 'create'));
    await applyPlan(m.api, d, options, reviewed);
    assert.deepEqual([m.cards.size, m.dashboards.size, m.collections.size, m.snippets.size], sizes);
  }
});

test('the managed subcollection is refused as a target before any write', async () => {
  const m = fakeMetabase(); const d = define();
  const installed = await applyPlan(m.api, d, options, await plan(m.api, d));
  const start = m.calls.length;
  await assert.rejects(snapshot(m.api, {...options, collection: installed.ids['collection:foundation']}, d.nodes), /Use its parent collection ID/);
  assert.equal(writes(m.calls.slice(start)).length, 0);
});

test('a --store install requires one store in dashboards and questions while All stores stays grouped', async () => {
  assert.equal(options.store, 'store-a');
  const m = fakeMetabase();
  const definition = full();
  const installed = await applyPlan(m.api, definition, options, await plan(m.api, definition));
  const stores = m.cards.get(installed.ids['question:stores']);
  assert.deepEqual(Object.keys(stores.dataset_query.native['template-tags']).filter(id => !id.startsWith('snippet:')).sort(),
    ['channel', 'compare', 'compare2', 'date']);
  assert.ok(!m.dashboards.get(installed.ids['dashboard:stores']).parameters.some(p => p.id === 'store'));
  const foundation = m.dashboards.get(installed.ids['dashboard:foundation']);
  assert.deepEqual(foundation.parameters.find(p => p.id === 'store').default, ['store-a']);
  for (const dashboard of m.dashboards.values()) {
    const store = dashboard.parameters.find(p => p.id === 'store');
    if (!store) continue;
    assert.equal(store.required, true);
    assert.equal(store.isMultiSelect, false);
  }
  for (const card of m.cards.values()) {
    const native = card.dataset_query.native;
    const store = native?.['template-tags'].store;
    if (!store) continue;
    assert.equal(store.required, true);
    assert.equal(store.type, 'text');
    assert.equal(store.default, 'store-a');
    assert.doesNotMatch(native.query, /\[\[[^\]]*\{\{store\}\}/);
    // A scalar equality cannot turn into a multi-store IN predicate when run standalone.
    const predicates = [...native.query.matchAll(/`[^`]+`\.sm_store_id = \{\{store\}\}/g)];
    assert.equal(predicates.length, [...native.query.matchAll(/\{\{store\}\}/g)].length);
    assert.ok(predicates.length > 0);
  }
  const placement = foundation.dashcards.find(c => c.card_id === stores.id);
  assert.ok(!placement.parameter_mappings.some(p => p.parameter_id === 'store'));
  const kpis = foundation.dashcards.find(c => c.card_id === installed.ids['question:kpis']);
  assert.deepEqual(kpis.parameter_mappings.find(p => p.parameter_id === 'store').target,
    ['variable', ['template-tag', 'store']]);
});

test('a currency-checked install without --store retains optional multi-store field filters', () => {
  const unscoped = {...options, store: undefined};
  const definition = definitions(compileCatalog(rows, tables, options.dataset, documented(tables)), tables, sql, unscoped);
  const card = definition.nodes.find(n => n.key === 'question:kpis').body(new Map());
  assert.equal(card.dataset_query.native['template-tags'].store.type, 'dimension');
  assert.equal(card.dataset_query.native['template-tags'].store.required, false);
  assert.ok(card.dataset_query.native.query.includes('[[AND {{store}}]]'));
  const store = definition.nodes.find(n => n.key === 'dashboard:foundation').layout.parameters.find(p => p.id === 'store');
  assert.equal(store.required, undefined);
  assert.equal(store.default, undefined);
});

for (const [source, question, name] of [
  ['dim_data_dictionary', 'data_health', 'Source freshness'],
  ['obt_order_lines', 'product_totals', 'Product net revenue'],
]) {
  for (const state of ['missing', 'inactive']) {
    for (const scoped of [false, true]) {
      test(`${scoped ? 'scoped' : 'unscoped'} questions omit ${source} when its Store column is ${state}`, () => {
        const synced = foundationTables.map(table => table.name !== source ? table : {...table,
          fields: state === 'missing' ? table.fields.filter(field => field.name !== 'sm_store_id') :
            table.fields.map(field => field.name === 'sm_store_id' ? {...field, active: false} : field)});
        const target = {...options, store: scoped ? options.store : undefined};
        const definition = definitions(compileCatalog([...rows, ...paidRows], synced, target.dataset, documented(synced)),
          synced, sql, target);
        assert.ok(!definition.nodes.some(node => node.key === `question:${question}`));
        assert.ok(definition.unavailable.some(item => item.name === name && /filter columns/.test(item.reason)));
        assert.ok(definition.nodes.some(node => node.key === 'question:kpis'), 'unrelated sources remain available');
      });
    }
  }
}

test('a question naming an unknown filter is refused instead of running unfiltered', async () => {
  const {filtersIn} = await import('../src/filters.mjs');
  assert.throws(() => filtersIn('WHERE {{stoer}}', options), /Unknown foundation filter \{\{stoer\}\}/);
});

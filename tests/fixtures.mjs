export const options = {url: 'http://localhost:3031', database: 1, dataset: 'tenant_sm_transformed_v2',
  metadataDataset: 'tenant_sm_metadata', collection: 3, store: 'store-a', asOf: '2026-09-01'};

const column = (name, id, base_type = 'type/Decimal') => ({name, id, base_type, display_name: name, active: true});
const dims = [column('date', 1, 'type/Date'), column('sm_store_id', 2, 'type/Text'), column('sm_channel', 3, 'type/Text')];
export const documented = (tables, formats = {}) => tables.map(t => ({dataset_name: t.schema, table_name: t.name,
  table_description: t.description || '', columns: (t.fields || []).map(f => ({column_name: f.name, column_description: f.description || '',
    ...(formats[f.name] ? {value_format: formats[f.name]} : {})}))}));
// The value_format reporting_queries publishes for the fixture columns and metrics.
export const columnFormats = {order_net_revenue: 'currency', order_gross_revenue: 'currency', ad_spend: 'currency',
  order_count: 'count', website_sessions: 'count', new_customer_order_count: 'count', repeat_customer_order_count: 'count',
  ad_impressions: 'count', ad_clicks: 'count', ad_platform_reported_conversions: 'count', ad_platform_reported_revenue: 'currency'};
export const metricFormats = {order_net_revenue_summary: 'currency', order_count_summary: 'count', total_ad_spend_summary: 'currency',
  website_sessions_summary: 'count', new_customer_order_count_summary: 'count', repeat_customer_order_count_summary: 'count',
  marketing_efficiency_ratio_summary: 'ratio', total_ad_spend: 'currency', total_ad_impressions: 'count', total_ad_clicks: 'count',
  platform_reported_conversions: 'count', platform_reported_revenue: 'currency', platform_return_on_ad_spend: 'ratio',
  platform_cost_per_conversion: 'currency', click_through_rate: 'percent'};
export const withFormats = catalogRows => catalogRows.map(r => ({...r, value_format: metricFormats[r.metric_name] ?? null}));
export const tables = [{id: 10, name: 'rpt_executive_summary_daily', schema: options.dataset, active: true,
  fields: [...dims, column('order_net_revenue', 4), column('order_count', 5, 'type/Float'),
    column('ad_spend', 6), column('website_sessions', 7, 'type/Integer'), column('order_gross_revenue', 8),
    column('new_customer_order_count', 9, 'type/Float'), column('repeat_customer_order_count', 10, 'type/Float')]}];
export const simple = (name, expr, extra = {}) => ({metric_name: name, metric_label: name,
  metric_type: 'simple', calculation: expr, has_filter: false, filter_condition: null,
  underlying_model: 'rpt_executive_summary_daily', metric_time_expression: 'date',
  metric_time_grains: 'day, week, month, quarter, year',
  dependent_metrics: null, metric_description: 'Canonical definition.', is_abbreviation: false, ...extra});
export const rows = [simple('order_net_revenue_summary', 'SUM(order_net_revenue)'),
  simple('order_count_summary', 'SUM(order_count)'), simple('total_ad_spend_summary', 'SUM(ad_spend)'),
  simple('website_sessions_summary', 'SUM(website_sessions)'), simple('new_customer_order_count_summary', 'SUM(new_customer_order_count)'),
  simple('repeat_customer_order_count_summary', 'SUM(repeat_customer_order_count)'),
  simple('marketing_efficiency_ratio_summary', 'order_net_revenue_summary / total_ad_spend_summary', {
    metric_type: 'ratio', dependent_metrics: 'order_net_revenue_summary, total_ad_spend_summary'})];

export const adTable = {id: 40, name: 'rpt_ad_performance_daily', schema: options.dataset, active: true, fields: [
  column('date', 41, 'type/Date'), column('sm_store_id', 42, 'type/Text'), column('sm_channel', 43, 'type/Text'),
  column('source_system', 44, 'type/Text'), column('ad_spend', 45), column('ad_impressions', 46, 'type/Integer'),
  column('ad_clicks', 47, 'type/Integer'), column('ad_platform_reported_conversions', 48, 'type/Float'),
  column('ad_platform_reported_revenue', 49, 'type/Float'), column('ad_account_id', 50, 'type/Text'), column('ad_campaign_id', 51, 'type/Text'),
  column('ad_creative_id', 52, 'type/Text'), column('ad_creative_title', 53, 'type/Text'), column('ad_creative_thumbnail_url', 54, 'type/Text')]};
const paid = (name, expr, extra = {}) => simple(name, expr, {underlying_model: adTable.name, ...extra});
const paidRatio = (name, a, b) => paid(name, `${a} / ${b}`, {metric_type: 'ratio', dependent_metrics: `${a}, ${b}`});
export const paidRows = [paid('total_ad_spend', 'SUM(ad_spend)'), paid('total_ad_impressions', 'SUM(ad_impressions)'),
  paid('total_ad_clicks', 'SUM(ad_clicks)'), paid('platform_reported_conversions', 'SUM(ad_platform_reported_conversions)'),
  paid('platform_reported_revenue', 'SUM(ad_platform_reported_revenue)'),
  paidRatio('platform_return_on_ad_spend', 'platform_reported_revenue', 'total_ad_spend'),
  paidRatio('platform_cost_per_conversion', 'total_ad_spend', 'platform_reported_conversions'),
  paidRatio('click_through_rate', 'total_ad_clicks', 'total_ad_impressions')];

export const foundationTables = [...tables, adTable,
  {id: 60, name: 'obt_order_lines', schema: options.dataset, active: true, fields: [
    column('order_processed_at_local_datetime', 61, 'type/DateTime'), column('sm_store_id', 62, 'type/Text'), column('sm_channel', 63, 'type/Text')]},
  {id: 70, name: 'rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters', schema: options.dataset, active: true,
    fields: [column('sm_store_id', 71, 'type/Text'), column('sm_channel', 72, 'type/Text')]},
  {id: 80, name: 'dim_stores', schema: options.dataset, active: true, fields: [column('sm_store_id', 81, 'type/Text'),
    column('store_name', 82, 'type/Text'), column('store_currency_code', 83, 'type/Text')]},
  {id: 90, name: 'obt_orders', schema: options.dataset, active: true, fields: [
    column('order_processed_at_local_datetime', 91, 'type/DateTime'), column('sm_store_id', 92, 'type/Text'), column('sm_channel', 93, 'type/Text'),
    column('order_shipping_country_code', 94, 'type/Text'), column('order_shipping_state', 95, 'type/Text'),
    column('is_order_sm_valid', 96, 'type/Boolean'), column('order_name', 97, 'type/Text'), column('sm_order_type', 98, 'type/Text'),
    column('order_payment_status', 99, 'type/Text'), column('sm_utm_source_medium', 100, 'type/Text')]}];

// The executive summary catalog as reporting_queries publishes it since 2026-10-24: order
// measures count only the valid sales channels (contracts/dashboard-metrics-v1).
export const validChannelFilter = "sm_channel in ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop')";
export const filteredRows = rows.map(r => ['order_net_revenue_summary', 'order_count_summary'].includes(r.metric_name) ?
  {...r, calculation: `${r.calculation} WHERE [filter applied]`, has_filter: true, filter_condition: validChannelFilter} : r);

const fieldTypes = new Map(tables.flatMap(t => t.fields.map(f => [f.id, f.base_type])));
// Metabase v0.64.1 returns saved field references with type annotations the
// adapter never writes. The fake does the same, so comparisons see real shapes.
const annotate = value => Array.isArray(value) ?
  (value[0] === 'field' && value.length === 3 && value[2] === null ? ['field', value[1], {'base-type': fieldTypes.get(value[1]) ?? 'type/*'}] : value.map(annotate)) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, annotate(v)])) : value;

export function fakeMetabase() {
  let sequence = 30;
  const collections = new Map([[3, {id: 3, name: 'Customer content', description: null, parent_id: null}]]);
  const cards = new Map();
  const dashboards = new Map();
  const dimensions = new Map();
  const snippets = new Map();
  const calls = [];
  let fail;
  async function api(method, path, body) {
    calls.push({method, path, body: structuredClone(body)});
    if (fail?.(method, path, body)) throw new Error('Simulated transport failure.');
    const url = new URL(path, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const kind = parts[1];
    const id = Number(parts[2]);
    if (path === '/api/session/properties') return {version: {tag: 'v0.64.1'}, 'setup-token': 'test-secret-not-for-plans'};
    if (kind === 'metric') {
      const all = dimensions.get(id);
      if (method === 'GET') return {added: structuredClone(all), addable: []};
      if (parts[4] === 'remove') dimensions.set(id, all.filter(d => !body.dimension_ids.includes(d.id)));
      if (parts[4] === 'set-default') dimensions.set(id, all.map(d => ({...d, default: d.id === body.dimension_id})));
      return {added: structuredClone(dimensions.get(id))};
    }
    const store = {collection: collections, card: cards, dashboard: dashboards, 'native-query-snippet': snippets}[kind];
    if (!store) throw new Error(`Unhandled fake API: ${method} ${path}`);
    if (method === 'GET') {
      const read = o => kind === 'card' ? annotate(structuredClone(o)) : structuredClone(o);
      if (!id) return [...store.values()].filter(o => ['card', 'dashboard'].includes(kind) ? Boolean(o.archived) === (url.searchParams.get('f') === 'archived') :
        Boolean(o.archived) === (url.searchParams.get('archived') === 'true')).map(read);
      if (!store.has(id)) throw new Error('Unknown test object.');
      return read(store.get(id));
    }
    const actual = id || ++sequence;
    // Like Metabase v0.64.1, keep the server's own entity ID and ignore a client's.
    const object = {...store.get(actual), ...structuredClone(body), id: actual, entity_id: store.get(actual)?.entity_id ?? `fake-entity-${actual}`};
    if (kind === 'card') {
      object.archived ||= false;
      if (object.type === 'metric' && !dimensions.has(actual)) {
        const modelId = Number(object.dataset_query.query['source-table'].replace('card__', ''));
        dimensions.set(actual, cards.get(modelId).result_metadata.map(c => ({id: `${actual}-${c.name}`, name: c.name, display_name: c.display_name, default: false})));
      }
    }
    if (kind === 'dashboard') {
      const tabIds = new Map();
      object.tabs = (object.tabs || []).map(t => {const tabId = t.id < 0 ? ++sequence : t.id; tabIds.set(t.id, tabId); return {...t, id: tabId};});
      object.dashcards = (object.dashcards || []).map(c => ({...c, id: c.id < 0 ? ++sequence : c.id,
        dashboard_tab_id: tabIds.get(c.dashboard_tab_id) ?? c.dashboard_tab_id}));
    }
    store.set(actual, object);
    return structuredClone(object);
  }
  return {api, cards, dashboards, collections, dimensions, snippets, calls, failWhen: fn => {fail = fn;}};
}

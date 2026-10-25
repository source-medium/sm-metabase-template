// The SourceMedium foundation: every question, the dashboards that hold them, and how
// their columns display. This file and foundation/sql/ are the parts to edit when you
// change what the template installs; docs/customize.md walks through it.
//
// Keys are identities. An installed Metabase object carries its key in its ownership
// line, so renaming a key creates a new object and leaves the old one behind as
// "retained". Rename `name`, never `key`.
import {filters} from '../src/filters.mjs';

/**
 * The catalog's valid sales channels: summary order measures count only these rows
 * (`order_net_revenue_summary` and `order_count_summary` in dashboard-metrics-v1).
 * Spend, sessions and clicks count every row. tests/sql.test.mjs checks this list
 * against contracts/dashboard-metrics-v1 and every summary SQL file against it.
 */
export const VALID_SALES_CHANNELS = ['online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'];

// Summary metrics shared by the executive questions. Each alias is one output line in
// the question's SQL, which the installer swaps for the catalog's shared SQL snippet.
const summaryMetrics = {
  net_revenue: 'order_net_revenue_summary', summary_orders: 'order_count_summary',
  net_revenue_per_summary_order: ['order_net_revenue_summary', 'order_count_summary'],
  ad_spend: 'total_ad_spend_summary', mer: 'marketing_efficiency_ratio_summary',
};
const paidMetrics = {
  ad_spend: 'total_ad_spend', impressions: 'total_ad_impressions', clicks: 'total_ad_clicks',
  platform_conversions: 'platform_reported_conversions', platform_revenue: 'platform_reported_revenue',
  platform_roas: 'platform_return_on_ad_spend', cost_per_platform_conversion: 'platform_cost_per_conversion',
  click_through_rate: 'click_through_rate',
};
const pick = (metrics, ...aliases) => Object.fromEntries(aliases.map(alias => [alias, metrics[alias]]));

const SUMMARY = 'rpt_executive_summary_daily';
const ADS = 'rpt_ad_performance_daily';
const ORDERS = 'obt_orders';
const ORDER_LINES = 'obt_order_lines';
const COHORTS = 'rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters';
const PROCESSED = 'order_processed_at_local_datetime';

/**
 * One entry per saved question. The SQL is foundation/sql/<key>.sql.
 *
 * - `table` is the source; `date` is the column the Date filter maps to.
 * - `scope` picks the filters (src/filters.mjs): summary, product and orders take Date,
 *   Channel and Store; stores takes Date and Channel; paid takes Date, Ad platform and
 *   Store; cohort takes As-of month, Channel and Store.
 * - `metrics` maps an output alias to a catalog metric (or a [numerator, denominator]
 *   ratio). The installer swaps that output line for the catalog's SQL snippet, so the
 *   question follows SourceMedium's published definition.
 * - `requires` lists other tables the SQL joins, with the columns it reads; a question
 *   whose tables are not synced is reported unavailable instead of failing in Metabase.
 * - `variants` are extra cards on the same SQL with another visualization.
 */
export const questions = [
  {key: 'kpis', name: 'Executive summary KPIs', table: SUMMARY, date: 'date', scope: 'summary',
    description: 'Published summary measures; use one currency and consistent source calendars.',
    metrics: summaryMetrics},
  {key: 'comparison', name: 'Period comparison', table: SUMMARY, date: 'date', scope: 'summary',
    description: 'The selected dates against the period just before them and the same dates a year earlier. Periods run from the first to the last selected date with summary rows; the Change columns are the selected period divided by each comparison period, minus one.',
    metrics: pick(summaryMetrics, 'net_revenue', 'summary_orders', 'ad_spend', 'mer')},
  {key: 'trend', name: 'Net revenue vs ad spend', table: SUMMARY, date: 'date', scope: 'summary', display: 'line',
    settings: {'graph.dimensions': ['date'], 'graph.metrics': ['net_revenue', 'ad_spend'], 'graph.x_axis.title_text': 'Date',
      series_settings: {net_revenue: {title: 'Net revenue'}, ad_spend: {title: 'Ad spend'}}},
    description: 'Net revenue and ad spend from the same summary population.',
    metrics: pick(summaryMetrics, 'net_revenue', 'ad_spend')},
  {key: 'daily', name: 'Daily performance', table: SUMMARY, date: 'date', scope: 'summary',
    description: 'Daily summary measures; counts retain their published precision.',
    metrics: {...summaryMetrics, sessions: 'website_sessions_summary'}},
  {key: 'deductions', name: 'Revenue and deductions', table: SUMMARY, date: 'date', scope: 'summary',
    description: 'Published signs; the unreconciled difference makes remaining adjustments visible without attributing a cause.'},
  {key: 'purchase_mix', name: 'New versus repeat purchases', table: SUMMARY, date: 'date', scope: 'summary',
    description: 'Published order measures, not unique buyers. Classification coverage can prevent reconciliation to headline totals.'},
  {key: 'weekly', name: 'Weekly business review', table: SUMMARY, date: 'date', scope: 'summary',
    description: 'Monday-start weeks; selected dates only. Edge weeks can be partial.', metrics: summaryMetrics},
  {key: 'stores', name: 'All stores', table: SUMMARY, date: 'date', scope: 'stores',
    requires: {dim_stores: ['sm_store_id', 'store_name', 'store_currency_code']},
    description: 'One row per store, never a cross-store total: stores can report in different currencies. Compare stores that share a currency.',
    metrics: summaryMetrics},
  {key: 'paid_channel', name: 'Ad platform economics', table: ADS, date: 'date', scope: 'paid',
    description: 'Per advertising platform across all sales channels. Platform attribution can overlap; ROAS is not MER or incrementality. Check currency and volume.',
    metrics: paidMetrics},
  {key: 'paid_campaign', name: 'Campaign economics', table: ADS, date: 'date', scope: 'paid',
    description: 'Campaign identity includes platform, account and campaign ID. Platform-reported attribution and conversions.',
    metrics: pick(paidMetrics, 'ad_spend', 'platform_conversions', 'platform_revenue', 'platform_roas', 'cost_per_platform_conversion')},
  {key: 'creatives', name: 'Creative economics', table: ADS, date: 'date', scope: 'paid',
    requires: {[ADS]: ['ad_creative_id', 'ad_creative_title', 'ad_creative_thumbnail_url']},
    description: 'One row per creative and sales channel, by spend. Platform-reported conversions and revenue; image links can expire.',
    metrics: paidMetrics},
  {key: 'product', name: 'Product refunds and cost coverage', table: ORDER_LINES, date: PROCESSED, scope: 'product',
    description: 'Valid orders by processed date, not refund-event date. Missing costs differ from legitimate zero costs.'},
  {key: 'product_movers', name: 'Product movers', table: ORDER_LINES, date: PROCESSED, scope: 'product',
    description: 'Net revenue by product against the period just before the selection, largest changes first. Periods run from the first to the last selected order date.'},
  {key: 'geography', name: 'Sales by country', table: ORDERS, date: PROCESSED, scope: 'orders',
    requires: {[ORDERS]: ['order_shipping_country_code', 'is_order_sm_valid']},
    description: 'Valid orders by shipping country and processed date. Select one store: currencies can differ between stores.',
    variants: [{key: 'geography_map', name: 'Net revenue by country', display: 'map',
      settings: {'map.type': 'region', 'map.region': 'world_countries', 'map.dimension': 'country', 'map.metric': 'net_revenue'}}]},
  {key: 'geography_regions', name: 'Sales by region', table: ORDERS, date: PROCESSED, scope: 'orders',
    requires: {[ORDERS]: ['order_shipping_country_code', 'order_shipping_state', 'is_order_sm_valid']},
    description: 'Valid orders by shipping country and region. US states are normalized to their two-letter codes.'},
  {key: 'orders', name: 'Recent orders', table: ORDERS, date: PROCESSED, scope: 'orders',
    requires: {[ORDERS]: ['order_name', 'sm_order_type', 'order_payment_status', 'is_order_sm_valid', 'sm_utm_source_medium']},
    description: 'The 500 most recently processed orders in the selection, valid or not. Use the Valid column before counting.'},
  {key: 'retention', name: 'Second purchase and lifetime value', table: COHORTS, scope: 'cohort',
    description: 'Unsegmented no_filters / all_orders slices. Compare equal elapsed ages and retain cohort denominators.',
    variants: [{key: 'retention_curve', name: 'Second-purchase cohort curves', display: 'line',
      settings: {'graph.dimensions': ['month_age', 'cohort'], 'graph.metrics': ['second_purchase_rate'],
        'graph.x_axis.title_text': 'Months since first order', 'graph.y_axis.title_text': 'Second-purchase rate'}}]},
];

/** Column headings Metabase shows instead of the SQL alias. */
export const columnTitles = {
  date: 'Date', period: 'Period', start_date: 'From', end_date: 'To', week_start: 'Week',
  first_selected_date: 'First date', last_selected_date: 'Last date', days_with_rows: 'Days with rows',
  net_revenue: 'Net revenue', gross_revenue: 'Gross revenue', summary_orders: 'Summary orders',
  net_revenue_per_summary_order: 'Revenue / order', net_revenue_per_order: 'Revenue / order',
  ad_spend: 'Ad spend', mer: 'MER', sessions: 'Sessions', purchase_type: 'Purchase type', measure: 'Measure', amount: 'Amount',
  period_net_revenue: 'Net revenue', period_summary_orders: 'Summary orders', period_ad_spend: 'Ad spend', period_mer: 'MER',
  net_revenue_change: 'Net revenue change', summary_orders_change: 'Orders change', ad_spend_change: 'Ad spend change',
  mer_change: 'MER change', store_id: 'Store ID', store_name: 'Store', store_currency: 'Currency',
  ad_platform: 'Ad platform', ad_account_id: 'Account ID', ad_campaign_id: 'Campaign ID', campaign_name: 'Campaign',
  creative_id: 'Creative ID', creative_title: 'Creative', thumbnail_url: 'Image URL', channel: 'Channel', sub_channel: 'Sub-channel',
  impressions: 'Impressions', clicks: 'Clicks', click_through_rate: 'Click-through rate',
  platform_conversions: 'Platform conversions', platform_revenue: 'Platform revenue', platform_roas: 'Platform ROAS',
  cost_per_platform_conversion: 'Cost / conversion',
  source_system: 'Source', product_id: 'Product ID', product_title: 'Product', ordered_units: 'Units ordered',
  refunded_units: 'Units refunded', refund_amount: 'Refunds', product_gross_profit: 'Gross profit',
  missing_cost_lines: 'Lines missing cost', zero_cost_lines: 'Lines at zero cost', units: 'Net units',
  previous_units: 'Previous net units', previous_net_revenue: 'Previous net revenue',
  net_revenue_difference: 'Net revenue difference', share_of_net_revenue: 'Share of net revenue',
  country: 'Country', region: 'Region', orders: 'Orders', order_name: 'Order', processed_at: 'Processed (store time)',
  order_type: 'Order type', payment_status: 'Payment status', is_valid: 'Valid', cart_units: 'Units', source_medium: 'Source / medium',
  sm_store_id: 'Store ID', sm_channel: 'Channel', cohort_month: 'Acquisition month', cohort: 'Cohort', month_age: 'Month',
  cohort_size: 'Cohort size', second_purchase_customers: 'Second purchases', second_purchase_rate: 'Second-purchase rate',
  lifetime_revenue_per_customer: 'Lifetime revenue / customer', gross_profit_lifetime_value: 'Gross profit LTV',
};

// Display units of the SQL's own outputs. An output a question maps to a catalog metric
// takes that metric's published value_format instead; tests/formats.test.mjs requires
// every output to be one of the two or a dimension, so a new column cannot ship unformatted.
export const outputFormats = {
  gross_revenue: 'currency', net_revenue: 'currency', new_revenue: 'currency', repeat_revenue: 'currency',
  net_revenue_per_summary_order: 'currency', net_revenue_per_order: 'currency', amount: 'currency',
  gross: 'currency', net: 'currency', discounts: 'currency', refunds: 'currency', refund_amount: 'currency',
  product_gross_profit: 'currency', gross_profit_lifetime_value: 'currency', lifetime_revenue_per_customer: 'currency',
  previous_net_revenue: 'currency', net_revenue_difference: 'currency', units: 'count', previous_units: 'count',
  summary_orders: 'count', new_orders: 'count', repeat_orders: 'count', days_with_rows: 'count', orders: 'count',
  ordered_units: 'count', refunded_units: 'count', missing_cost_lines: 'count', zero_cost_lines: 'count',
  second_purchase_customers: 'count', second_purchase_rate: 'percent', month_age: 'number', position: 'identifier',
  net_revenue_change: 'percent', summary_orders_change: 'percent', ad_spend_change: 'percent', mer_change: 'percent',
  share_of_net_revenue: 'percent', cart_units: 'count', period_net_revenue: 'currency', period_summary_orders: 'count',
  period_ad_spend: 'currency', period_mer: 'ratio',
};
/** Outputs that are labels, dates or identifiers rather than measures. */
export const outputDimensions = ['date', 'week_start', 'first_selected_date', 'last_selected_date', 'item', 'measure',
  'purchase_type', 'ad_platform', 'campaign_name', 'product_title', 'cohort', 'period', 'start_date', 'end_date',
  'store_id', 'store_name', 'store_currency', 'previous_start_date', 'previous_end_date', 'creative_id', 'creative_title',
  'thumbnail_url', 'country', 'region', 'order_name', 'processed_at', 'channel', 'sub_channel', 'order_type',
  'payment_status', 'is_valid', 'source_medium', 'store_currency_code', 'stores'];

const layout = (key, row, col = 0, size_x = 24, size_y = 6, tab = null) => ({key: `question:${key}`, row, col, size_x, size_y, tab});

/**
 * The dashboards. Each is installed on its own and as tabs of the combined foundation
 * dashboard, in this order. A dashboard whose questions are unavailable is skipped
 * without hiding the others. `label` names its tab in the combined dashboard when it
 * has no tabs of its own.
 */
export function dashboards(options) {
  const summary = filters('summary', options);
  return [
    {key: 'dashboard:summary', name: 'SourceMedium executive summary', parameters: summary,
      description: 'Summary-system KPIs, Online DTC by default. Use one reporting currency and consistent calendars. Shared SQL snippets and visual-builder metrics use the same catalog definitions.',
      tabs: ['Overview', 'Business review'], cards: [layout('kpis', 0, 0, 24, 4, 0), layout('comparison', 4, 0, 24, 5, 0),
        layout('trend', 9, 0, 24, 6, 0), layout('deductions', 15, 0, 10, 7, 0), layout('purchase_mix', 15, 10, 14, 7, 0),
        layout('daily', 0, 0, 24, 8, 1), layout('weekly', 8, 0, 24, 6, 1)]},
    {key: 'dashboard:stores', label: 'All stores', name: 'SourceMedium all stores', parameters: filters('stores', options),
      description: 'Each store on its own row for the selected dates and channel. No cross-store totals: compare stores that share a currency.',
      tabs: [], cards: [layout('stores', 0, 0, 24, 8)]},
    {key: 'dashboard:paid', label: 'Paid marketing', name: 'SourceMedium paid marketing', parameters: filters('paid', options),
      description: 'Platform-attributed economics by advertising platform (source_system), across all sales channels. Ad platform starts clear.',
      tabs: [], cards: [layout('paid_channel', 0), layout('paid_campaign', 6, 0, 24, 10)]},
    {key: 'dashboard:creatives', label: 'Creatives', name: 'SourceMedium creatives', parameters: filters('paid', options),
      description: 'Creative-level spend and platform-reported results across all sales channels. Ad platform starts clear.',
      tabs: [], cards: [layout('creatives', 0, 0, 24, 12)]},
    {key: 'dashboard:product', label: 'Products', name: 'SourceMedium product quality', parameters: summary,
      description: 'Order-processed-date basis, valid orders: ranked products with signed refunds and cost coverage, and the largest movers against the previous period.',
      tabs: [], cards: [layout('product', 0, 0, 24, 12), layout('product_movers', 12, 0, 24, 10)]},
    {key: 'dashboard:retention', label: 'Retention', name: 'SourceMedium retention', parameters: filters('cohort', options),
      description: 'Second-purchase curves and denominators at an explicit completed-month cutoff. Keep store/channel/cohort identities separate.',
      tabs: [], cards: [layout('retention_curve', 0, 0, 24, 8), layout('retention', 8, 0, 24, 10)]},
    {key: 'dashboard:geography', label: 'Geography', name: 'SourceMedium geography', parameters: summary,
      description: 'Valid orders by shipping destination and processed date. Select one store before comparing money.',
      tabs: [], cards: [layout('geography_map', 0, 0, 24, 8), layout('geography', 8, 0, 12, 9), layout('geography_regions', 8, 12, 12, 9)]},
    {key: 'dashboard:orders', label: 'Orders', name: 'SourceMedium orders', parameters: summary,
      description: 'The most recently processed orders in the selection, including orders SourceMedium does not count as valid.',
      tabs: [], cards: [layout('orders', 0, 0, 24, 12)]},
  ];
}

/** The combined dashboard: every available dashboard above, one tab each. */
export const combinedDashboard = {key: 'dashboard:foundation', name: 'SourceMedium foundation dashboard',
  description: 'Revenue, stores, marketing, creatives, products, retention, geography and orders in one dashboard. Sales Channel, Ad platform and cohort As-of month apply only to their mapped tabs. Use one reporting currency and the published source calendars.'};

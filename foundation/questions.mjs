// The SourceMedium foundation: every question, the dashboards that hold them, and how
// their columns display. This file and foundation/sql/ are the parts to edit when you
// change what the template installs; docs/customize.md walks through it.
//
// Keys are identities. An installed Metabase object carries its key in its ownership
// line, so renaming a key creates a new object and leaves the old one behind as
// "retained". Rename `name`, never `key`.
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
const DICTIONARY = 'dim_data_dictionary';
const PROCESSED = 'order_processed_at_local_datetime';

// A number card with the change against Compare with and Second comparison, read from the
// question's compare_<column> and compare2_<column> outputs.
const scalar = column => ({'scalar.field': column, 'scalar.comparisons': [
  {id: 'compare', type: 'anotherColumn', column: `compare_${column}`, label: 'comparison'},
  {id: 'compare2', type: 'anotherColumn', column: `compare2_${column}`, label: 'second comparison'}]});
// A daily line with the Compare with period dashed beside it, day for day.
const trendLine = (column, title) => ({'graph.dimensions': ['date'], 'graph.metrics': [column, `compare_${column}`],
  'graph.x_axis.title_text': 'Date', 'graph.y_axis.title_text': title,
  series_settings: {[column]: {title}, [`compare_${column}`]: {title: `${title} (comparison)`, 'line.style': 'dashed'}}});
// A table showing only some of its question's columns, in SQL order.
const showing = (all, shown) => ({'table.columns': all.map(name => ({name, enabled: shown.includes(name)}))});
const BUSINESS = ['period', 'net_revenue', 'summary_orders', 'net_revenue_per_summary_order', 'ad_spend', 'mer', 'sessions',
  'gross_revenue', 'discounts', 'demand_before_returns', 'refunds', 'spend_per_order', 'spend_per_session', 'spend_share_of_revenue',
  'new_revenue', 'new_orders', 'new_revenue_per_order', 'repeat_revenue', 'repeat_orders', 'repeat_revenue_per_order',
  'repeat_share_of_revenue', 'days_with_rows'];
const MONTHS = [...Array(12).keys()];
const MATRIX = ['cohort', 'cohort_size', ...MONTHS.map(m => `rate_month_${m}`), ...MONTHS.map(m => `value_month_${m}`)];
const heat = prefix => ({'table.column_formatting': [{id: 0, columns: MONTHS.map(m => `${prefix}_month_${m}`), type: 'range',
  colors: ['#FFFFFF', '#509EE3'], min_type: null, max_type: null, operator: '=', value: '', color: '#509EE3', highlight_row: false}]});
const ORDER_COLUMNS = ['processed_at', 'order_name', 'store_id', 'channel', 'sub_channel', 'order_type', 'payment_status', 'is_valid',
  'cart_units', 'net_revenue', 'source_medium', 'country', 'region', 'order_key'];
const image = {view_as: 'image'};
const link = {view_as: 'link', link_text: 'Open'};

/**
 * One entry per saved question. The SQL is foundation/sql/<key>.sql; a line
 * `-- @include name` there stands for foundation/sql/include/<name>.sql.
 *
 * - `table` is the source; `date` is the column the Date filter maps to. `metadata`
 *   questions read the metadata dataset (written METADATA in the SQL) instead.
 * - The filters a question takes are the ones its SQL names as {{id}}, from
 *   src/filters.mjs; a dashboard shows the filters its cards take.
 * - `metrics` maps an output alias to a catalog metric (or a [numerator, denominator]
 *   ratio). The installer swaps that output line for the catalog's SQL snippet, so the
 *   question follows SourceMedium's published definition.
 * - `requires` lists other tables the SQL joins, with the columns it reads; a question
 *   whose tables are not synced is reported unavailable instead of failing in Metabase.
 * - `variants` are extra cards on the same SQL with another visualization.
 * - `columns` sets column display (an image or link) by output name.
 */
export const questions = [
  {key: 'kpis', name: 'Net revenue', table: SUMMARY, date: 'date', display: 'smartscalar', settings: scalar('net_revenue'),
    description: 'Selected dates against Compare with and Second comparison. Published summary measures; use one currency and consistent source calendars.',
    metrics: {...summaryMetrics, sessions: 'website_sessions_summary'},
    variants: [
      {key: 'kpi_orders', name: 'Summary orders', display: 'smartscalar', settings: scalar('summary_orders')},
      {key: 'kpi_spend', name: 'Ad spend', display: 'smartscalar', settings: scalar('ad_spend')},
      {key: 'kpi_mer', name: 'Marketing efficiency (MER)', display: 'smartscalar', settings: scalar('mer')},
      {key: 'kpi_order_value', name: 'Revenue per summary order', display: 'smartscalar', settings: scalar('net_revenue_per_summary_order')},
      {key: 'kpi_sessions', name: 'Website sessions', display: 'smartscalar', settings: scalar('sessions')}]},
  {key: 'comparison', name: 'Period comparison', table: SUMMARY, date: 'date',
    description: 'The selected dates against Compare with and Second comparison. Previous period follows the selection: one day compares with the same weekday a week earlier, a calendar month, quarter or year with the one before, other ranges with the days just before. Periods run from the first to the last selected date with summary rows; Change is the selected period divided by the comparison period, minus one.',
    metrics: pick(summaryMetrics, 'net_revenue', 'summary_orders', 'ad_spend', 'mer')},
  {key: 'trend', name: 'Net revenue by day', table: SUMMARY, date: 'date', display: 'line', settings: trendLine('net_revenue', 'Net revenue'),
    description: 'Daily or cumulative values (Trend values), with Compare with dashed, day for day. Cumulative values sum each day from the period start, so ratios stay ratios of sums. Missing days are gaps.',
    metrics: {...summaryMetrics, sessions: 'website_sessions_summary'},
    variants: [
      {key: 'trend_orders', name: 'Summary orders by day', display: 'line', settings: trendLine('summary_orders', 'Summary orders')},
      {key: 'trend_order_value', name: 'Revenue per summary order by day', display: 'line', settings: trendLine('net_revenue_per_summary_order', 'Revenue / order')},
      {key: 'trend_spend', name: 'Ad spend by day', display: 'line', settings: trendLine('ad_spend', 'Ad spend')},
      {key: 'trend_mer', name: 'Marketing efficiency by day', display: 'line', settings: trendLine('mer', 'MER')},
      {key: 'trend_sessions', name: 'Website sessions by day', display: 'line', settings: trendLine('sessions', 'Sessions')}]},
  {key: 'revenue_changes', name: 'Biggest changes', table: SUMMARY, date: 'date',
    description: 'The three selected dates whose net revenue moved most against the same day of Compare with.',
    metrics: pick(summaryMetrics, 'net_revenue')},
  {key: 'contributions', name: 'Sales channel and sub-channel contributions', table: SUMMARY, date: 'date',
    description: 'Net revenue by valid sales channel and sub-channel against Compare with, largest absolute change first.',
    metrics: pick(summaryMetrics, 'net_revenue')},
  {key: 'deductions', name: 'Revenue and deductions', table: SUMMARY, date: 'date',
    description: 'Published signs, against Compare with; the unreconciled difference makes remaining adjustments visible without attributing a cause.'},
  {key: 'purchase_mix', name: 'New versus repeat purchases', table: SUMMARY, date: 'date',
    description: 'Published order measures, not unique buyers, against Compare with. Classification coverage can prevent reconciliation to headline totals.'},
  {key: 'business', name: 'Business summary', table: SUMMARY, date: 'date', settings: showing(BUSINESS,
    ['period', 'net_revenue', 'summary_orders', 'net_revenue_per_summary_order', 'ad_spend', 'mer', 'sessions']),
    description: 'Summary measures by Day, Week (Monday start) or Month (Period), newest first, with the selected period total last. Edge periods the dates only partly cover are marked partial.',
    metrics: {...summaryMetrics, sessions: 'website_sessions_summary'},
    variants: [
      {key: 'business_revenue', name: 'Revenue and orders', display: 'table', settings: showing(BUSINESS, ['period', 'net_revenue',
        'summary_orders', 'net_revenue_per_summary_order', 'sessions', 'gross_revenue', 'discounts', 'demand_before_returns', 'refunds'])},
      {key: 'business_efficiency', name: 'Marketing efficiency', display: 'table', settings: showing(BUSINESS, ['period', 'net_revenue',
        'ad_spend', 'mer', 'spend_per_order', 'spend_per_session', 'spend_share_of_revenue'])},
      {key: 'business_purchases', name: 'New and repeat purchases', display: 'table', settings: showing(BUSINESS, ['period', 'new_revenue',
        'new_orders', 'new_revenue_per_order', 'repeat_revenue', 'repeat_orders', 'repeat_revenue_per_order', 'repeat_share_of_revenue'])}]},
  {key: 'store_context', name: 'Reporting context', table: 'dim_stores',
    requires: {dim_stores: ['sm_store_id', 'store_name', 'store_currency_code', 'store_timezone'], [SUMMARY]: ['sm_store_id', 'date']},
    description: 'Each store\'s reporting currency and time zone, and its latest date with summary rows. Dates are calendar dates in the store\'s time zone; the latest day may be incomplete.'},
  {key: 'stores', name: 'All stores', table: SUMMARY, date: 'date',
    requires: {dim_stores: ['sm_store_id', 'store_name', 'store_currency_code', 'brand_name', 'store_logo_url']},
    columns: {logo_url: image},
    description: 'One row per store, never a cross-store total: stores can report in different currencies. Revenue change is against Compare with. Select a store to open its executive summary.',
    metrics: summaryMetrics},
  {key: 'platform_periods', name: 'Ad platforms by period', table: ADS, date: 'date',
    description: 'Platform-reported delivery and results by Day, Week or Month, for the selected Ad platform or all of them combined. CPM is spend per thousand impressions; conversion rate is conversions per click.',
    metrics: pick(paidMetrics, 'impressions', 'clicks', 'click_through_rate', 'ad_spend', 'platform_conversions', 'platform_revenue',
      'platform_roas', 'cost_per_platform_conversion')},
  {key: 'paid_channel', name: 'Ad platform economics', table: ADS, date: 'date',
    description: 'Per advertising platform across all sales channels. Platform attribution can overlap; ROAS is not MER or incrementality. Check currency and volume.',
    metrics: paidMetrics},
  {key: 'paid_trend', name: 'Paid measure by ad platform over time', table: ADS, date: 'date', display: 'line',
    settings: {'graph.dimensions': ['period', 'ad_platform'], 'graph.metrics': ['value'], 'graph.x_axis.title_text': 'Period',
      'graph.y_axis.title_text': 'Trend measure'},
    description: 'The Trend measure by Day, Week or Month for the seven ad platforms with the most impressions, the rest as Other. Ratios are recomputed from each line\'s sums.',
    metrics: pick(paidMetrics, 'ad_spend', 'impressions', 'clicks', 'platform_conversions', 'platform_revenue')},
  {key: 'paid_breakdown', name: 'Spend breakdown', table: ADS, date: 'date',
    description: 'The ten largest by spend, broken down by ad platform, campaign, campaign type or tactic, against Compare with. Shares are of all spend in the selection.',
    metrics: pick(paidMetrics, 'ad_spend'),
    variants: [{key: 'paid_breakdown_chart', name: 'Spend by breakdown', display: 'row',
      settings: {'graph.dimensions': ['name'], 'graph.metrics': ['ad_spend'], 'graph.x_axis.title_text': 'Break down spend by',
        'graph.y_axis.title_text': 'Ad spend'}}]},
  {key: 'paid_campaign', name: 'Campaigns', table: ADS, date: 'date',
    description: 'The 200 campaigns with the most spend. Campaign identity includes platform, account and campaign ID; platform-reported attribution and conversions. Select a campaign name to filter by it.',
    metrics: {...pick(paidMetrics, 'ad_spend', 'impressions', 'clicks', 'click_through_rate', 'platform_conversions', 'platform_revenue',
      'platform_roas', 'cost_per_platform_conversion'), cost_per_click: ['total_ad_spend', 'total_ad_clicks']}},
  {key: 'creatives', name: 'Creatives', table: ADS, date: 'date',
    requires: {[ADS]: ['ad_creative_id', 'ad_creative_title', 'ad_creative_body', 'ad_creative_call_to_action_type', 'ad_creative_image_url',
      'ad_creative_thumbnail_url', 'ad_creative_facebook_url', 'ad_creative_instagram_url']},
    columns: {image_url: image, ad_url: link},
    description: 'The top 48 creatives by the chosen sort, at or above the minimum spend and conversions. Platform-reported conversions and revenue; image links can expire.',
    metrics: paidMetrics},
  {key: 'product_totals', name: 'Product net revenue', table: ORDER_LINES, date: PROCESSED, display: 'smartscalar', settings: scalar('net_revenue'),
    description: 'All products for the selection on the order-processed date, valid orders, against Compare with and Second comparison.',
    variants: [{key: 'product_units', name: 'Product net units', display: 'smartscalar', settings: scalar('units')}]},
  {key: 'product', name: 'Products ranked', table: ORDER_LINES, date: PROCESSED,
    requires: {[ORDER_LINES]: ['product_variant_id', 'product_variant_title', 'primary_product_image_url', 'order_line_product_cost']},
    columns: {image_url: image},
    description: 'The ten products or variants (Group by) with the largest Rank by value, or the biggest gainers or decliners against Compare with. Valid orders by processed date, not refund-event date; refunds are signed positive here. Missing costs differ from legitimate zero costs.'},
  {key: 'retention', name: 'Cohort curves', table: COHORTS,
    description: 'Six cohorts (Chart cohorts) through the As-of month, by age. Rate measure is monthly retention or the share who purchased a second time; Value measure is gross profit or revenue per cohort customer. Compare equal elapsed ages.',
    variants: [
      {key: 'retention_curve', name: 'Cohort rate by age', display: 'line', settings: {'graph.dimensions': ['month_age', 'cohort'],
        'graph.metrics': ['cohort_rate'], 'graph.x_axis.title_text': 'Months since first order', 'graph.y_axis.title_text': 'Rate measure'}},
      {key: 'retention_value_curve', name: 'Cohort value by age', display: 'line', settings: {'graph.dimensions': ['month_age', 'cohort'],
        'graph.metrics': ['cohort_value'], 'graph.x_axis.title_text': 'Months since first order', 'graph.y_axis.title_text': 'Value measure'}}]},
  {key: 'retention_matrix', name: 'All twelve cohorts: rate', table: COHORTS, settings: {...showing(MATRIX, MATRIX.filter(c => !c.startsWith('value_'))), ...heat('rate')},
    description: 'The Rate measure for twelve cohorts by month of age. A blank cell has not elapsed by the As-of month.',
    variants: [{key: 'retention_value_matrix', name: 'All twelve cohorts: value', display: 'table',
      settings: {...showing(MATRIX, MATRIX.filter(c => !c.startsWith('rate_'))), ...heat('value')}}]},
  {key: 'retention_segments', name: 'Acquisition segments', table: COHORTS,
    description: 'Segments of the chosen acquisition attribute in the cohort window, by first-month customers. Select one to show its cohorts.'},
  {key: 'geography_totals', name: 'Valid-order net revenue', table: ORDERS, date: PROCESSED, display: 'smartscalar', settings: scalar('net_revenue'),
    requires: {[ORDERS]: ['order_shipping_country_code', 'order_shipping_state', 'is_order_sm_valid']},
    description: 'Valid orders by processed date for the shipping scope (country and region filters), against Compare with and Second comparison.',
    variants: [
      {key: 'geography_orders_total', name: 'Valid orders', display: 'smartscalar', settings: scalar('orders')},
      {key: 'geography_coverage', name: 'Mapped-order coverage', display: 'smartscalar', settings: scalar('mapped_coverage')}]},
  {key: 'geography', name: 'Shipping countries', table: ORDERS, date: PROCESSED,
    requires: {[ORDERS]: ['order_shipping_country_code', 'order_shipping_state', 'is_order_sm_valid']},
    description: 'Valid orders by shipping country and processed date, with revenue change against Compare with. Select a country to see its regions. Select one store: currencies can differ between stores.',
    variants: [{key: 'geography_map', name: 'Valid orders by country', display: 'map',
      settings: {'map.type': 'region', 'map.region': 'world_countries', 'map.dimension': 'country', 'map.metric': 'orders'}}]},
  {key: 'geography_regions', name: 'Shipping regions', table: ORDERS, date: PROCESSED,
    requires: {[ORDERS]: ['order_shipping_country_code', 'order_shipping_state', 'is_order_sm_valid']},
    description: 'Valid orders by shipping region in the selected country (every country when none is selected). US states are normalized to their two-letter codes. Select a region to scope the totals and orders.'},
  {key: 'geography_states', name: 'Valid orders by US state', table: ORDERS, date: PROCESSED, display: 'map',
    settings: {'map.type': 'region', 'map.region': 'us_states', 'map.dimension': 'region', 'map.metric': 'orders'},
    requires: {[ORDERS]: ['order_shipping_country_code', 'order_shipping_state', 'is_order_sm_valid']},
    description: 'Valid US orders by state, shaded by orders. Other countries\' regions are in the regions table.'},
  {key: 'geography_trend', name: 'Shipping scope by day', table: ORDERS, date: PROCESSED, display: 'line',
    settings: {'graph.dimensions': ['date'], 'graph.metrics': ['net_revenue', 'orders'], 'graph.x_axis.title_text': 'Date'},
    requires: {[ORDERS]: ['order_shipping_country_code', 'order_shipping_state', 'is_order_sm_valid']},
    description: 'Valid-order net revenue and valid orders by processed date for the shipping scope.'},
  {key: 'orders', name: 'Orders, newest first', table: ORDERS, date: PROCESSED, settings: showing(ORDER_COLUMNS, ORDER_COLUMNS.slice(0, -1)),
    requires: {[ORDERS]: ['order_name', 'order_number', 'order_id', 'sm_order_type', 'order_payment_status', 'is_order_sm_valid',
      'sm_utm_source_medium', 'order_shipping_country_code', 'order_shipping_state']},
    description: 'The 500 most recently processed orders in the selection, all or only valid (Order population), in the shipping scope. Find an order by name, number or ID. Select an order name to see its details and attribution evidence.'},
  {key: 'order_detail', name: 'Order detail', table: ORDERS, date: PROCESSED, display: 'object',
    requires: {[ORDERS]: ['order_name', 'order_created_at_local_datetime', 'sm_order_sales_channel', 'order_index', 'order_refund_quantity',
      'order_product_titles_csv', 'order_net_shipping', 'order_total_taxes', 'order_total_revenue', 'order_discount_codes_csv',
      'order_shipping_country', 'order_cancelled_at_local_datetime', 'order_cancellation_reason']},
    description: 'The order selected in the orders table, within the selected dates.'},
  {key: 'order_attribution', name: 'Why attributed here?', table: 'fct_order_attribution_signals', date: PROCESSED,
    requires: {fct_order_attribution_signals: ['sm_order_key', 'evidence_source', 'evidence_type', 'sm_utm_final_source_priority',
      'sm_marketing_channel', 'sm_attribution_inference_method']},
    description: 'Published attribution evidence for the selected order: the priority-1 signal is the winner. Groups describe the evidence; they never assign or recompute credit.'},
  {key: 'data_health', name: 'Source freshness', table: DICTIONARY, metadata: true,
    description: 'The latest published data date of each source the foundation reads. Pipeline freshness, period completeness and quality checks are not published.'},
  {key: 'metric_catalog', name: 'Published metrics', table: 'dim_semantic_metric_catalog', metadata: true,
    description: 'SourceMedium\'s published metric definitions (aliases fold into their primary metric). Search by name, label or description.'},
  {key: 'field_dictionary', name: 'Field dictionary', table: DICTIONARY, metadata: true,
    description: 'Fields of the selected published source, from the data dictionary. Search by name or description.'},
];

/** Column headings Metabase shows instead of the SQL alias. */
export const columnTitles = {
  date: 'Date', period: 'Period', start_date: 'From', end_date: 'To', comparison_date: 'Comparison date',
  days_with_rows: 'Days with rows', net_revenue: 'Net revenue', gross_revenue: 'Gross revenue', summary_orders: 'Summary orders',
  net_revenue_per_summary_order: 'Revenue / order', net_revenue_per_order: 'Revenue / order',
  ad_spend: 'Ad spend', mer: 'MER', sessions: 'Sessions', purchase_type: 'Purchase type', measure: 'Measure', amount: 'Amount',
  amount_difference: 'Change', net_revenue_difference: 'Revenue change',
  period_net_revenue: 'Net revenue', period_summary_orders: 'Summary orders', period_ad_spend: 'Ad spend', period_mer: 'MER',
  net_revenue_change: 'Net revenue change', summary_orders_change: 'Orders change', ad_spend_change: 'Ad spend change',
  mer_change: 'MER change', store_id: 'Store ID', store_name: 'Store', store_currency: 'Currency', brand_name: 'Brand',
  logo_url: 'Logo', time_zone: 'Time zone', latest_date: 'Latest summary date',
  discounts: 'Discounts', demand_before_returns: 'Demand before returns', refunds: 'Refunds', spend_per_order: 'Spend / order',
  spend_per_session: 'Spend / session', spend_share_of_revenue: 'Spend / net revenue', new_revenue: 'New purchase revenue',
  new_orders: 'New purchase orders', new_revenue_per_order: 'New revenue / order', repeat_revenue: 'Repeat purchase revenue',
  repeat_orders: 'Repeat purchase orders', repeat_revenue_per_order: 'Repeat revenue / order', repeat_share_of_revenue: 'Repeat / net revenue',
  ad_platform: 'Ad platform', ad_account_id: 'Account ID', ad_campaign_id: 'Campaign ID', campaign_name: 'Campaign',
  creative_id: 'Creative ID', creative_title: 'Creative', creative_body: 'Body', call_to_action: 'Call to action', ad_url: 'Ad',
  image_url: 'Image', channel: 'Channel', sub_channel: 'Sub-channel', name: 'Name',
  impressions: 'Impressions', clicks: 'Clicks', click_through_rate: 'CTR', cost_per_click: 'CPC',
  cost_per_thousand_impressions: 'CPM', platform_conversion_rate: 'Platform CVR', platform_revenue_per_conversion: 'Platform revenue / conversion',
  platform_conversions: 'Platform conversions', platform_revenue: 'Platform revenue', platform_roas: 'Platform ROAS',
  cost_per_platform_conversion: 'Cost / conversion', share_of_spend: 'Share of spend', ad_spend_difference: 'Spend change',
  value: 'Value', product_title: 'Product', variant_title: 'Variant', share_of_total: 'Share of total', value_difference: 'Change',
  value_change: 'Change %', refund_rate: 'Refund rate', ordered_units: 'Units ordered', refunded_units: 'Units refunded',
  refund_amount: 'Refunds', product_gross_profit: 'Gross profit', missing_cost_lines: 'Lines missing cost', zero_cost_lines: 'Lines at zero cost',
  units: 'Net units', share_of_net_revenue: 'Share of net revenue', mapped_coverage: 'Mapped-order coverage',
  country: 'Country', region: 'Region', orders: 'Orders', order_name: 'Order', order_key: 'Order key', order_id: 'Order ID',
  processed_at: 'Processed (store time)', created_at: 'Created (store time)', order_type: 'Order type', payment_status: 'Payment status',
  is_valid: 'Valid', cart_units: 'Items', source_medium: 'Source / medium', sales_channel: 'Sales channel', source_system: 'Source system',
  customer_order_number: 'Customer order number', products: 'Products', shipping: 'Shipping', taxes: 'Taxes', total_revenue: 'Total revenue',
  discount_codes: 'Discount codes', ships_to: 'Ships to', utm_campaign: 'UTM campaign', cancelled_at: 'Cancelled (store time)',
  cancellation_reason: 'Cancellation reason', evidence_group: 'Evidence', evidence_source: 'Evidence source', source_priority: 'Rank',
  marketing_channel: 'Marketing channel', utm_source: 'Canonical source', utm_medium: 'Canonical medium', inference_method: 'Inference method',
  cohort: 'Cohort', month_age: 'Month', cohort_size: 'Customers', active_customers: 'Active customers',
  second_purchase_customers: 'Second purchases', retention_rate: 'Monthly retention', second_purchase_rate: 'Second-purchase rate',
  lifetime_revenue_per_customer: 'Revenue LTR', gross_profit_lifetime_value: 'Gross profit LTV', cohort_rate: 'Rate measure',
  cohort_value: 'Value measure', segment: 'Segment', customers: 'Customers',
  ...Object.fromEntries(MONTHS.flatMap(m => [[`rate_month_${m}`, `Month ${m}`], [`value_month_${m}`, `Month ${m}`]])),
  source_table: 'Source', latest_data_date: 'Latest published data date', fresh_within_14_days: 'Data in the last 14 days',
  table_description: 'Description', metric_label: 'Metric', metric_name: 'Canonical name', metric_category: 'Category',
  metric_unit: 'Unit', metric_description: 'Description', calculation: 'Calculation', source_model: 'Source', time_basis: 'Time basis',
  also_known_as: 'Also known as', column_name: 'Field', data_type: 'Type', value_format: 'Unit', column_description: 'Description',
  is_key_column: 'Key',
};

// Display units of the SQL's own outputs. An output a question maps to a catalog metric
// takes that metric's published value_format instead, and compare_<column> and
// compare2_<column> display like <column>; tests/formats.test.mjs requires every output
// to be one of these or a dimension, so a new column cannot ship unformatted.
export const outputFormats = {
  gross_revenue: 'currency', net_revenue: 'currency', new_revenue: 'currency', repeat_revenue: 'currency',
  net_revenue_per_summary_order: 'currency', net_revenue_per_order: 'currency', amount: 'currency', amount_difference: 'currency',
  gross: 'currency', net: 'currency', discounts: 'currency', refunds: 'currency', refund_amount: 'currency',
  demand_before_returns: 'currency', spend_per_order: 'currency', spend_per_session: 'currency', spend_share_of_revenue: 'percent',
  new_revenue_per_order: 'currency', repeat_revenue_per_order: 'currency', repeat_share_of_revenue: 'percent',
  product_gross_profit: 'currency', gross_profit_lifetime_value: 'currency', lifetime_revenue_per_customer: 'currency',
  net_revenue_difference: 'currency', units: 'count', summary_orders: 'count', new_orders: 'count', repeat_orders: 'count',
  days_with_rows: 'count', days: 'count', orders: 'count', ordered_units: 'count', refunded_units: 'count', missing_cost_lines: 'count',
  zero_cost_lines: 'count', second_purchase_customers: 'count', active_customers: 'count', cohort_size: 'count', customers: 'count',
  second_purchase_rate: 'percent', retention_rate: 'percent', cohort_rate: 'percent', cohort_value: 'currency',
  rate: 'percent', value: 'number', month_age: 'number', position: 'identifier', period_position: 'identifier', day_index: 'number',
  net_revenue_change: 'percent', summary_orders_change: 'percent', ad_spend_change: 'percent', mer_change: 'percent',
  share_of_net_revenue: 'percent', share_of_spend: 'percent', share_of_total: 'percent', value_difference: 'number',
  value_change: 'percent', refund_rate: 'percent', mapped_coverage: 'percent', cart_units: 'count',
  period_net_revenue: 'currency', period_summary_orders: 'count', period_ad_spend: 'currency', period_mer: 'ratio',
  ad_spend_difference: 'currency', cost_per_thousand_impressions: 'currency', platform_conversion_rate: 'percent',
  platform_revenue_per_conversion: 'currency', spend: 'currency', shown: 'count', clicked: 'count', converted: 'count', earned: 'currency',
  platform_rank: 'number', cohort_rank: 'number', cost_per_click: 'currency', customer_order_number: 'number',
  shipping: 'currency', taxes: 'currency', total_revenue: 'currency', source_priority: 'number',
  ...Object.fromEntries(MONTHS.flatMap(m => [[`rate_month_${m}`, 'percent'], [`value_month_${m}`, 'currency']])),
};
/** Outputs that are labels, dates or identifiers rather than measures. */
export const outputDimensions = ['date', 'day', 'period', 'period_start', 'first_date', 'last_date', 'item', 'measure', 'label',
  'kind', 'mode', 'purchase_type', 'ad_platform', 'line', 'campaign_name', 'product_title', 'variant_title', 'product_key', 'cohort',
  'cohort_month', 'start_date', 'end_date', 'comparison_date', 'store_id', 'store_name', 'store_currency', 'brand_name', 'logo_url',
  'time_zone', 'latest_date', 'creative_id', 'creative_title', 'creative_body', 'call_to_action', 'ad_url', 'image_url', 'name',
  'breakdown_key', 'country', 'region', 'order_name', 'order_key', 'order_id', 'processed_at', 'created_at', 'cancelled_at',
  'channel', 'sub_channel', 'sales_channel', 'source_system', 'order_type', 'payment_status', 'is_valid', 'source_medium',
  'products', 'discount_codes', 'ships_to', 'utm_campaign', 'cancellation_reason', 'evidence_group', 'evidence_source',
  'marketing_channel', 'utm_source', 'utm_medium', 'inference_method', 'segment', 'period_start', 'source_table', 'latest_data_date',
  'fresh_within_14_days', 'table_description', 'metric_label', 'metric_name', 'metric_category', 'metric_unit', 'metric_description',
  'calculation', 'source_model', 'time_basis', 'also_known_as', 'column_name', 'data_type', 'value_format', 'column_description',
  'is_key_column'];

const layout = (key, row, col = 0, size_x = 24, size_y = 6, tab = null, clicks) =>
  ({key: `question:${key}`, row, col, size_x, size_y, tab, ...(clicks ? {clicks} : {})});

/**
 * The dashboards. Each is installed on its own and as tabs of the combined foundation
 * dashboard, in this order. A dashboard whose questions are unavailable is skipped
 * without hiding the others. `label` names its tab in the combined dashboard when it
 * has no tabs of its own. A card's `clicks` make a column clickable: it sets dashboard
 * filters from the clicked row, on this dashboard or on the one `dashboard` names (which
 * must come earlier in this list).
 */
export function dashboards() {
  return [
    {key: 'dashboard:summary', name: 'SourceMedium executive summary',
      description: 'Summary-system KPIs, Online DTC by default, against Compare with and Second comparison. Use one reporting currency and consistent calendars. Shared SQL snippets and visual-builder metrics use the same catalog definitions.',
      tabs: ['Overview', 'Business review'], cards: [
        layout('kpis', 0, 0, 8, 4, 0), layout('kpi_orders', 0, 8, 8, 4, 0), layout('kpi_spend', 0, 16, 8, 4, 0),
        layout('kpi_mer', 4, 0, 8, 4, 0), layout('kpi_order_value', 4, 8, 8, 4, 0), layout('kpi_sessions', 4, 16, 8, 4, 0),
        layout('comparison', 8, 0, 24, 5, 0), layout('trend', 13, 0, 24, 7, 0),
        layout('trend_orders', 20, 0, 8, 5, 0), layout('trend_order_value', 20, 8, 8, 5, 0), layout('trend_spend', 20, 16, 8, 5, 0),
        layout('trend_mer', 25, 0, 8, 5, 0), layout('trend_sessions', 25, 8, 8, 5, 0), layout('revenue_changes', 25, 16, 8, 5, 0),
        layout('contributions', 30, 0, 24, 8, 0),
        layout('deductions', 0, 0, 10, 7, 1), layout('purchase_mix', 0, 10, 14, 7, 1), layout('business', 7, 0, 24, 9, 1),
        layout('store_context', 16, 0, 24, 4, 1)]},
    {key: 'dashboard:performance', label: 'Performance tables', name: 'SourceMedium performance tables',
      description: 'Summary and platform measures by Day, Week or Month (Period), with the selected period total last.',
      tabs: [], cards: [layout('business_revenue', 0, 0, 24, 9), layout('business_efficiency', 9, 0, 24, 9),
        layout('business_purchases', 18, 0, 24, 9), layout('platform_periods', 27, 0, 24, 9)]},
    {key: 'dashboard:stores', label: 'All stores', name: 'SourceMedium all stores',
      description: 'Each store on its own row for the selected dates and channel. No cross-store totals: compare stores that share a currency.',
      tabs: [], cards: [layout('stores', 0, 0, 24, 8, null, [{column: 'store_name', dashboard: 'dashboard:summary', set: {store: 'store_id'}}])]},
    {key: 'dashboard:paid', label: 'Paid marketing', name: 'SourceMedium paid marketing',
      description: 'Platform-attributed economics by advertising platform (source_system), across all sales channels. Ad platform starts clear.',
      tabs: [], cards: [layout('paid_channel', 0), layout('paid_trend', 6, 0, 24, 7), layout('paid_breakdown_chart', 13, 0, 12, 7),
        layout('paid_breakdown', 13, 12, 12, 7), layout('paid_campaign', 20, 0, 24, 10, null, [{column: 'campaign_name', set: {campaign: 'campaign_name'}}])]},
    {key: 'dashboard:creatives', label: 'Creatives', name: 'SourceMedium creatives',
      description: 'Creative-level spend and platform-reported results across all sales channels. Ad platform starts clear.',
      tabs: [], cards: [layout('creatives', 0, 0, 24, 12)]},
    {key: 'dashboard:product', label: 'Products', name: 'SourceMedium products',
      description: 'Order-processed-date basis, valid orders: product totals and ranked products or variants against Compare with, with refund rates and cost coverage.',
      tabs: [], cards: [layout('product_totals', 0, 0, 12, 4), layout('product_units', 0, 12, 12, 4), layout('product', 4, 0, 24, 9)]},
    {key: 'dashboard:retention', label: 'Retention', name: 'SourceMedium retention',
      description: 'Cohort curves and matrices at an explicit completed-month cutoff, optionally for one acquisition segment. Keep store/channel/cohort identities separate.',
      tabs: [], cards: [layout('retention_curve', 0, 0, 12, 7), layout('retention_value_curve', 0, 12, 12, 7),
        layout('retention_matrix', 7, 0, 24, 7), layout('retention_value_matrix', 14, 0, 24, 7),
        layout('retention_segments', 21, 0, 24, 6, null, [{column: 'segment', set: {segment: 'segment'}}])]},
    {key: 'dashboard:geography', label: 'Geography', name: 'SourceMedium geography',
      description: 'Valid orders by shipping destination and processed date. Select a country, then a region, to scope the totals, trend and orders. Select one store before comparing money.',
      tabs: [], cards: [layout('geography_totals', 0, 0, 8, 4), layout('geography_orders_total', 0, 8, 8, 4), layout('geography_coverage', 0, 16, 8, 4),
        layout('geography_map', 4, 0, 24, 8), layout('geography', 12, 0, 12, 9, null, [{column: 'country', set: {country: 'country'}}]),
        layout('geography_regions', 12, 12, 12, 9, null, [{column: 'region', set: {country: 'country', region: 'region'}}]),
        layout('geography_states', 21, 0, 12, 8), layout('geography_trend', 21, 12, 12, 8)]},
    {key: 'dashboard:orders', label: 'Orders', name: 'SourceMedium orders',
      description: 'The most recently processed orders in the selection, including orders SourceMedium does not count as valid. Select an order to see its details and attribution evidence.',
      tabs: [], cards: [layout('orders', 0, 0, 24, 12, null, [{column: 'order_name', set: {order: 'order_key'}}]),
        layout('order_detail', 12, 0, 12, 10), layout('order_attribution', 12, 12, 12, 10)]},
    {key: 'dashboard:data', label: 'Data', name: 'SourceMedium data',
      description: 'Published source freshness, metric definitions and fields. Pipeline freshness, period completeness and quality checks are not published.',
      tabs: [], cards: [layout('data_health', 0, 0, 24, 5), layout('metric_catalog', 5, 0, 24, 10), layout('field_dictionary', 15, 0, 24, 10)]},
  ];
}

/** The combined dashboard: every available dashboard above, one tab each. */
export const combinedDashboard = {key: 'dashboard:foundation', name: 'SourceMedium foundation dashboard',
  description: 'Revenue, performance tables, stores, marketing, creatives, products, retention, geography, orders and data in one dashboard. Sales Channel, Ad platform and cohort As-of month apply only to their mapped tabs. Use one reporting currency and the published source calendars.'};

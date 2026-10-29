// Every dashboard filter the foundation uses, in the order dashboards show them. A question
// consumes the filters its SQL names as {{id}}, and a dashboard shows the filters its cards
// consume, so the SQL is the one place that decides what filters what.
//
// `column` requires a synced column on the question's source table (`date` uses the
// question's own date column). `variable` makes the tag a scalar value the SQL reads;
// otherwise the column is a Metabase field filter. A Metabase filter is navigation,
// not a permission boundary.
const choice = (values, fallback) => ({type: 'string/=', sectionId: 'string', required: true, default: [fallback],
  isMultiSelect: false, values_query_type: 'list', values_source_type: 'static-list', values_source_config: {values}});
const text = {type: 'string/=', sectionId: 'string', isMultiSelect: false};
const comparisons = [['previous', 'Previous period'], ['year', 'Same period last year'], ['weekday', '52 weeks earlier'], ['off', 'Off']];

function registry({store, asOf}) {
  return [
    {id: 'date', name: 'Date', column: 'date', type: 'date/all-options', default: 'past28days', required: true},
    {id: 'as_of_month', name: 'As-of month', variable: 'date', type: 'date/single', default: asOf, required: true},
    // sm_channel is the sales channel in every report. In the ad report, source_system is
    // the advertising platform that delivered the ad.
    {id: 'channel', name: 'Channel', column: 'sm_channel', type: 'string/=', default: ['online_dtc']},
    {id: 'ad_platform', name: 'Ad platform', column: 'source_system', type: 'string/='},
    // --store permits mixed-currency warehouses, so both dashboards and standalone
    // questions must take exactly one store. A field filter can accept several values.
    {id: 'store', name: 'Store', column: 'sm_store_id', type: 'string/=',
      ...(store ? {variable: 'text', ...text, required: true, default: [store]} : {})},
    {id: 'compare', name: 'Compare with', variable: 'text', ...choice(comparisons, 'previous')},
    {id: 'compare2', name: 'Second comparison', variable: 'text', ...choice(comparisons, 'year')},
    {id: 'grain', name: 'Period', variable: 'text', ...choice([['day', 'Day'], ['week', 'Week'], ['month', 'Month']], 'day')},
    {id: 'trend_values', name: 'Trend values', variable: 'text', ...choice([['daily', 'Daily values'], ['cumulative', 'Cumulative values']], 'daily')},
    {id: 'campaign', name: 'Campaign name', column: 'ad_campaign_name', type: 'string/contains'},
    {id: 'ad_set', name: 'Ad set name', column: 'ad_group_name', type: 'string/contains'},
    {id: 'ad', name: 'Ad name', column: 'ad_name', type: 'string/contains'},
    {id: 'paid_metric', name: 'Trend measure', variable: 'text', ...choice([['spend', 'Spend'], ['impressions', 'Impressions'],
      ['clicks', 'Clicks'], ['conversions', 'Platform conversions'], ['revenue', 'Platform revenue'], ['roas', 'Platform ROAS'],
      ['cost_per_conversion', 'Cost / conversion']], 'spend')},
    {id: 'breakdown', name: 'Break down spend by', variable: 'text', ...choice([['platform', 'Ad platform'], ['campaign', 'Campaign'],
      ['campaign_type', 'Campaign type'], ['campaign_tactic', 'Campaign tactic']], 'platform')},
    {id: 'min_spend', name: 'Minimum spend', variable: 'number', type: 'number/=', sectionId: 'number', required: true, default: [0]},
    {id: 'min_conversions', name: 'Minimum conversions', variable: 'number', type: 'number/=', sectionId: 'number', required: true, default: [0]},
    {id: 'creative_sort', name: 'Sort creatives by', variable: 'text', ...choice([['spend', 'Most spend'], ['impressions', 'Most impressions'],
      ['clicks', 'Most clicks'], ['conversions', 'Most conversions'], ['ctr', 'Highest CTR'], ['revenue', 'Most platform revenue'],
      ['roas', 'Highest platform ROAS'], ['cost_per_conversion', 'Lowest cost / conversion']], 'spend')},
    {id: 'product_group', name: 'Group by', variable: 'text', ...choice([['product', 'Product'], ['variant', 'Variant']], 'product')},
    {id: 'product_rank', name: 'Rank by', variable: 'text', ...choice([['net_revenue', 'Net revenue'], ['units', 'Net units'],
      ['gross_profit', 'Product gross profit'], ['refunds', 'Refund amount'], ['refunded_units', 'Refunded units']], 'net_revenue')},
    {id: 'product_ranking', name: 'Ranking', variable: 'text', ...choice([['largest', 'Largest value'], ['gainers', 'Period gainers'],
      ['decliners', 'Period decliners']], 'largest')},
    {id: 'acquisition', name: 'Segment cohorts by', variable: 'text', ...choice([['no_filters', 'All acquisition orders'],
      ['order_type_(sub_vs._one_time)', 'First-order type'], ['discount_code', 'Discount code'], ['source/medium', 'Source / medium'],
      ['campaign', 'Campaign'], ['zero_party_attribution', 'Survey attribution'], ['sub_channel', 'Sub-channel']], 'no_filters')},
    {id: 'segment', name: 'Acquisition segment', variable: 'text', ...text},
    {id: 'cohorts', name: 'Chart cohorts', variable: 'text', ...choice([['latest', 'Latest 6'], ['earliest', 'Earliest 6']], 'latest')},
    {id: 'rate', name: 'Rate measure', variable: 'text', ...choice([['retention', 'Monthly retention'],
      ['second_purchase', 'Purchased a second time']], 'retention')},
    {id: 'value', name: 'Value measure', variable: 'text', ...choice([['ltv', 'Gross profit LTV'], ['ltr', 'Revenue LTR']], 'ltv')},
    {id: 'country', name: 'Shipping country', variable: 'text', ...text},
    {id: 'region', name: 'Shipping region', variable: 'text', ...text},
    {id: 'population', name: 'Order population', variable: 'text', ...choice([['all', 'All orders'], ['valid', 'Valid orders']], 'all')},
    {id: 'order_search', name: 'Find an order', variable: 'text', ...text},
    {id: 'order', name: 'Order', variable: 'text', ...text},
    {id: 'metric_search', name: 'Search metrics', variable: 'text', ...text},
    {id: 'source_table', name: 'Published source', variable: 'text', ...choice([['rpt_executive_summary_daily', 'Executive summary'],
      ['rpt_ad_performance_daily', 'Ad performance'], ['obt_orders', 'Orders'], ['obt_order_lines', 'Order lines'],
      ['rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters', 'Cohort LTV'], ['dim_stores', 'Stores']],
      'rpt_executive_summary_daily')},
    {id: 'field_search', name: 'Search fields', variable: 'text', ...text},
  ];
}

/** The filters a question's SQL names, as `{{id}}`, in registry order. Unknown names are refused. */
export function filtersIn(sql, options) {
  const named = new Set([...sql.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map(m => m[1]));
  const all = registry(options);
  const unknown = [...named].filter(id => !all.some(f => f.id === id));
  if (unknown.length) throw new Error(`Unknown foundation filter ${unknown.map(id => `{{${id}}}`).join(', ')}; add it to src/filters.mjs.`);
  return all.filter(f => named.has(f.id));
}

/** The Metabase dashboard parameter for a filter: its definition without the SQL binding. */
export function parameter({column: _column, variable: _variable, ...definition}) {
  return {slug: definition.id, ...definition};
}

/** The dashboard parameters for filters any of its questions consume, in registry order. */
export function dashboardParameters(ids, options) {
  return registry(options).filter(f => ids.has(f.id)).map(parameter);
}

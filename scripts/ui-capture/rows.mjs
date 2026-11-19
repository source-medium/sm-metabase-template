// Synthetic result sets for visual review. The renderer gets the installed column names,
// units and visualization settings. These rows never run the foundation's BigQuery SQL.
import published from '../../contracts/dashboard-metrics-v1/definitions.json' with {type: 'json'};
import {tables, columnFormats} from '../../tests/fixtures.mjs';

function commerce(net_revenue, summary_orders, ad_spend, sessions) {
  return {net_revenue, summary_orders, net_revenue_per_summary_order: net_revenue / summary_orders,
    ad_spend, mer: net_revenue / ad_spend, sessions};
}
const measures = commerce(62480.50, 812, 14860, 21046);
const previous = commerce(56857.26, 758, 14142.17, 19152);
const lastYear = commerce(53733.23, 720, 13547.78, 18446);
const geography = {net_revenue: 62480.50, orders: 812, mapped_coverage: 0.97};
const dates = Array.from({length: 28}, (_, i) => `2026-10-${String(1 + i).padStart(2, '0')}`);
const channels = ['Online DTC', 'Amazon', 'Retail', 'Wholesale'];
const platforms = ['Meta', 'Google', 'TikTok'];
const products = ['Cotton weekend tote', 'Canvas shoulder bag', 'Linen travel pouch', 'Wool scarf', 'Weekend duffel'];
const scaled = (obj, factor) => Object.fromEntries(Object.entries(obj).map(([key, value]) =>
  [key, Math.round(value * factor * (Number.isInteger(value) ? 1 : 100)) / (Number.isInteger(value) ? 1 : 100)]));
const prefixed = (prefix, obj) => Object.fromEntries(Object.entries(obj).map(([key, value]) => [prefix + key, value]));
const compared = obj => ({start_date: '2026-10-01', ...obj, ...prefixed('compare_', scaled(obj, .91)), ...prefixed('compare2_', scaled(obj, .86))});
const cohorts = ['May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026'];
const cohortRate = (month, index) => month === 0 ? 1 : .47 / (1 + month * .32) + index * .012;
const cohortValue = (month, index) => 28 + month * 4.5 + index * 1.8;
const matrixCohorts = [...['Nov 2025','Dec 2025','Jan 2026','Feb 2026','Mar 2026','Apr 2026'], ...cohorts];
const matrix = matrixCohorts.map((cohort, i) => {
  const row = {cohort, cohort_size: 220 + 12 * i};
  for (let m = 0; m < 12; m++) {
    row['rate_month_' + m] = m + i < matrixCohorts.length ? Math.round(row.cohort_size * cohortRate(m, i - 6)) / row.cohort_size : null;
    row['value_month_' + m] = m + i < matrixCohorts.length ? cohortValue(m, i - 6) : null;
  }
  return row;
});
const areas = ['US', 'CA', 'GB', 'AU'];
const stores = ['North shop', 'West shop'];
// Difference of rounded running totals assigns whole orders and exact cents across the period.
function daysFor(total, phase) {
  const weights = dates.map((_, i) => 1 + .2 * Math.sin(i + phase));
  const sum = weights.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  return weights.map(weight => {
    const before = cumulative / sum;
    cumulative += weight;
    const part = (value, unit) => (Math.round(value * unit * cumulative / sum) - Math.round(value * unit * before)) / unit;
    return commerce(part(total.net_revenue, 100), part(total.summary_orders, 1), part(total.ad_spend, 100), part(total.sessions, 1));
  });
}
const currentDays = daysFor(measures, 0);
const previousDays = daysFor(previous, .4);
const cents = amount => Math.round(amount * 100) / 100;
// Round cumulative shares, then take differences so that each day is a whole number
// of orders and cents and all days add to the same period allocation.
function splitAt(revenueCents, orders) {
  return {gross: Math.round(revenueCents * 1.12), discount: -Math.round(revenueCents * .08),
    newRevenue: Math.round(revenueCents * .6), newOrders: Math.round(orders * .6)};
}
function businessRow(period, row, split, days_with_rows) {
  const new_revenue = split.newRevenue / 100, new_orders = split.newOrders;
  const repeat_revenue = cents(row.net_revenue - new_revenue), repeat_orders = row.summary_orders - new_orders;
  const demand_before_returns = (split.gross + split.discount) / 100;
  return {period, ...row, gross_revenue: split.gross / 100, discounts: split.discount / 100, demand_before_returns,
    refunds: cents(row.net_revenue - demand_before_returns), spend_per_order: row.ad_spend / row.summary_orders,
    spend_per_session: row.ad_spend / row.sessions, spend_share_of_revenue: row.ad_spend / row.net_revenue,
    new_revenue, new_orders, new_revenue_per_order: new_revenue / new_orders, repeat_revenue, repeat_orders,
    repeat_revenue_per_order: repeat_revenue / repeat_orders, repeat_share_of_revenue: repeat_revenue / row.net_revenue, days_with_rows};
}
let runningCents = 0, runningOrders = 0;
const businessDays = currentDays.map((row, i) => {
  const before = splitAt(runningCents, runningOrders);
  runningCents += Math.round(row.net_revenue * 100);
  runningOrders += row.summary_orders;
  const after = splitAt(runningCents, runningOrders);
  const daily = Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
  return businessRow(dates[i], row, daily, 1);
});
const businessTotal = businessRow('Selected period total', measures, splitAt(runningCents, runningOrders), dates.length);
const business = [businessTotal, ...businessDays.toReversed()];
function allocate(amount, shares, precision = 100) {
  let allocated = 0;
  return shares.map((share, index) => {
    const part = index === shares.length - 1 ? amount - allocated : amount * share;
    const rounded = Math.round(part * precision) / precision;
    allocated += rounded;
    return rounded;
  });
}
const weights = [.54, .25, .14, .07];
const breakdown = (names, current, prior, shares = weights) => {
  const amounts = allocate(current, shares), baselines = allocate(prior, shares);
  return names.map((name, i) => ({name, value: amounts[i], compare_value: baselines[i],
    value_difference: cents(amounts[i] - baselines[i]), value_change: amounts[i] / baselines[i] - 1, share_of_total: amounts[i] / current}));
};
const rank = breakdown(products, measures.net_revenue, previous.net_revenue, [.29,.24,.20,.16,.11]);
const byChannel = breakdown(channels, measures.net_revenue, previous.net_revenue);
const platformShares = [.48,.32,.20];
const adSpend = breakdown(platforms, measures.ad_spend, previous.ad_spend, platformShares);
const platformRows = adSpend.map(({name: ad_platform, value: ad_spend}, i) => {
  const impressions = Math.round(ad_spend * (40 + i)), clicks = Math.round(impressions * (.016 + .001 * i));
  const platform_conversions = Math.round(clicks * .042), platform_revenue = cents(ad_spend * (3.6 - .2 * i));
  return {ad_platform, ad_spend, impressions, clicks, platform_conversions, platform_revenue,
    platform_roas: platform_revenue / ad_spend, cost_per_platform_conversion: ad_spend / platform_conversions, click_through_rate: clicks / impressions};
});
// Allocate paid delivery once. Every breakdown recomputes rates from these additive measures.
const delivery = ['impressions','clicks','ad_spend','platform_conversions','platform_revenue'];
function summarizeDelivery(records) {
  const totals = Object.fromEntries(delivery.map(key => [key, cents(records.reduce((sum,r) => sum + r[key], 0))]));
  return {...totals, click_through_rate: totals.clicks / totals.impressions, platform_roas: totals.platform_revenue / totals.ad_spend,
    cost_per_platform_conversion: totals.ad_spend / totals.platform_conversions};
}
function divideDelivery(source, shares) {
  const splits = Object.fromEntries(delivery.map(key => [key, allocate(source[key], shares, ['impressions','clicks','platform_conversions'].includes(key) ? 1 : 100)]));
  return shares.map((_,i) => summarizeDelivery([Object.fromEntries(delivery.map(key => [key,splits[key][i]]))]));
}
const dailyAds = divideDelivery(summarizeDelivery(platformRows), currentDays.map(day => day.ad_spend / measures.ad_spend));
// Allocate running spend to platforms, then subtract consecutive allocations. Both the
// daily total and each platform's period total keep their last cent.
let spendToDate = 0;
let priorAllocation = platforms.map(() => 0);
const paidTrend = currentDays.flatMap((day, i) => {
  spendToDate = cents(spendToDate + day.ad_spend);
  const amounts = allocate(spendToDate, platformShares);
  const records = platforms.map((ad_platform, j) => ({
    period: dates[i], ad_platform, value: cents(amounts[j] - priorAllocation[j])
  }));
  priorAllocation = amounts;
  return records;
});
const formats = ['Video','Carousel','Image'];
const creativeRows = platformRows.flatMap((platform, p) => divideDelivery(platform,[.40,.29,.21,.10]).slice(0,3).map((ad,i) => ({
  image_url: null, ad_platform: platform.ad_platform, creative_title: products[(p+i)%products.length] + ' · ' + formats[i],
  creative_format: formats[i], first_spend: ['2026-09-03','2026-10-06','2026-10-21'][(p+i)%3],
  ...ad, compare_ad_spend: cents(ad.ad_spend / 1.09), ad_spend_change: .09, compare_platform_roas: 3.25, platform_roas_change: ad.platform_roas / 3.25 - 1,
  creative_body: 'Autumn collection', call_to_action: 'Shop now', ad_url: null, creative_id: 'sample-' + p + i
}))).sort((a,b) => b.ad_spend - a.ad_spend);
const creative = summarizeDelivery(creativeRows);
function creativeGroups(groups, key, select) {
  return groups.map(label => {
    const members = creativeRows.filter(row => select(row) === label);
    const totals = summarizeDelivery(members);
    return {[key]: label, creatives: members.length, ad_spend: totals.ad_spend, share_of_spend: totals.ad_spend / creative.ad_spend,
      click_through_rate: totals.click_through_rate, platform_roas: totals.platform_roas};
  });
}
const launches = ['Running before Oct 1','Week of Oct 5','Week of Oct 19'];
const groupGeo = (labels, key, shares, orders, revenue, prior) => {
  const counts = allocate(orders, shares, 1);
  return breakdown(labels, revenue, prior, shares).map((r,i) => ({[key]: r.name, orders: counts[i], net_revenue: r.value,
    net_revenue_per_order: r.value / counts[i],
    compare_net_revenue: r.compare_value, net_revenue_change: r.value_change}));
};
const countries = groupGeo([...areas, '(unknown)'], 'country', [.6,.22,.10,.05,.03], geography.orders, geography.net_revenue, previous.net_revenue)
  .map(row => ({...row, share_of_net_revenue: row.net_revenue / geography.net_revenue}));
const states = groupGeo(['CA','NY','TX','WA'], 'region', weights, countries[0].orders, countries[0].net_revenue, countries[0].compare_net_revenue);
const locations = [...states.map(row => ({country: 'US', ...row})), ...countries.slice(1).flatMap((r,i) =>
  groupGeo([['ON','BC'],['England','Scotland'],['NSW','VIC'],['(unknown)']][i], 'region', i === 3 ? [1] : [.62,.38],
    r.orders, r.net_revenue, r.compare_net_revenue).map(region => ({country: r.country, ...region})))];
const changes = dates.map((date,i) => ({date, comparison_date: new Date(Date.parse(date) - 28*86400000).toISOString().slice(0,10),
  net_revenue: currentDays[i].net_revenue, compare_net_revenue: previousDays[i].net_revenue,
  net_revenue_difference: cents(currentDays[i].net_revenue - previousDays[i].net_revenue), net_revenue_change: currentDays[i].net_revenue / previousDays[i].net_revenue - 1}));
const purchaseTypes = breakdown(['New purchases', 'Repeat purchases'], measures.net_revenue, previous.net_revenue, [.6,.4]);
const purchaseOrders = [businessTotal.new_orders, businessTotal.repeat_orders];
const deductionLines = total => [cents(total*1.12), -cents(total*.08), cents(total - cents(total*1.12) + cents(total*.08)), total];
const deductions = deductionLines(measures.net_revenue), previousDeductions = deductionLines(previous.net_revenue);
const comparison = ['Selected period', 'Previous 28 days', 'Same period last year'].map((period, i) => ({period, start_date: ['2026-10-01','2026-09-03','2025-10-01'][i],
    end_date: ['2026-10-28','2026-09-30','2025-10-28'][i], ...Object.fromEntries(['net_revenue','summary_orders','ad_spend','mer'].flatMap(name => [
      ['period_' + name, [measures, previous, lastYear][i][name]], [name + '_change', i ? measures[name] / [measures, previous, lastYear][i][name] - 1 : null]]))}));
export const rows = {
  readout: [{readout: 'Net revenue rose to 62,480.50 against the previous period. Ad spend rose, and marketing efficiency increased to 4.20x.'}],
  kpis: [{start_date: dates[0], ...measures, ...prefixed('compare_', previous), ...prefixed('compare2_', lastYear)}], product_totals: [compared({net_revenue: 62480.50, units: 1940})],
  comparison,
  comparison_measures: Object.entries({net_revenue: 'Net revenue', summary_orders: 'Orders', ad_spend: 'Ad spend', mer: 'MER'})
    .flatMap(([key, label]) => comparison.map(row => ({measure_period: label + ' · ' + row.period, display_value: key === 'summary_orders' ? String(row.period_summary_orders) : row['period_' + key].toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
      value_change: row[key + '_change'], start_date: row.start_date, end_date: row.end_date}))),
  trend: dates.map((date, i) => ({date, ...currentDays[i], ...prefixed('compare_', previousDays[i])})),
  revenue_changes: changes.toSorted((a,b) => Math.abs(b.net_revenue_difference)-Math.abs(a.net_revenue_difference)).slice(0,3),
  contributions: byChannel.map(r => ({channel: r.name, period_net_revenue: r.value, compare_net_revenue: r.compare_value, net_revenue_difference: r.value_difference})),
  deductions: ['Gross revenue','Discounts','Refunds','Net revenue'].map((measure,i) => ({measure, amount: deductions[i],
    compare_amount: previousDeductions[i], amount_difference: cents(deductions[i]-previousDeductions[i])})),
  purchase_mix: purchaseTypes.map((r,i) => ({purchase_type: r.name, net_revenue: r.value, summary_orders: purchaseOrders[i],
    net_revenue_per_order: r.value / purchaseOrders[i], compare_net_revenue: r.compare_value, net_revenue_difference: r.value_difference})), business,
  store_context: stores.map((store_name, i) => ({store_id: 'store-' + (i + 1), store_name, store_currency: 'USD', time_zone: 'America/New_York', latest_date: dates.at(-1)})),
  stores: stores.map((store_name, i) => {
    const share = i ? .4 : .6;
    return {store_id: 'store-' + (i + 1), store_name, brand_name: 'Sample Brand', logo_url: null, store_currency: 'USD',
      net_revenue: measures.net_revenue * share, net_revenue_change: measures.net_revenue / previous.net_revenue - 1,
      summary_orders: Math.round(measures.summary_orders * share), net_revenue_per_summary_order: measures.net_revenue * share / Math.round(measures.summary_orders * share),
      ad_spend: measures.ad_spend * share, mer: measures.mer, latest_date: dates.at(-1)};
  }),
  platform_periods: ['Selected period total', ...dates.toReversed()].map((period, i) => {
    const row = i === 0 ? summarizeDelivery(platformRows) : dailyAds[dates.length-i];
    return {period, impressions: row.impressions, clicks: row.clicks, click_through_rate: row.clicks / row.impressions,
      cost_per_thousand_impressions: 1000 * row.ad_spend / row.impressions, cost_per_click: row.ad_spend / row.clicks,
      ad_spend: row.ad_spend, platform_conversion_rate: row.platform_conversions / row.clicks, platform_conversions: row.platform_conversions,
      platform_revenue: row.platform_revenue, platform_roas: row.platform_revenue / row.ad_spend,
      platform_revenue_per_conversion: row.platform_revenue / row.platform_conversions, cost_per_platform_conversion: row.ad_spend / row.platform_conversions};
  }),
  paid_channel: platformRows,
  paid_campaign: platformRows.map((row, i) => ({
    ad_platform: row.ad_platform, ad_account_id: 'account-' + i, ad_campaign_id: 'campaign-' + i,
    campaign_name: ['Autumn collection','Everyday essentials','New arrivals'][i], ad_spend: row.ad_spend,
    impressions: row.impressions, clicks: row.clicks, click_through_rate: row.click_through_rate,
    cost_per_click: row.ad_spend / row.clicks, platform_conversions: row.platform_conversions,
    platform_revenue: row.platform_revenue, platform_roas: row.platform_roas,
    cost_per_platform_conversion: row.cost_per_platform_conversion
  })),
  paid_trend: paidTrend,
  paid_breakdown: adSpend.map(r => ({name: r.name, ad_spend: r.value, share_of_spend: r.share_of_total, compare_ad_spend: r.compare_value,
    ad_spend_difference: r.value_difference, ad_spend_change: r.value_change})), creative_totals: [{start_date: dates[0], ad_spend: creative.ad_spend,
    platform_roas: creative.platform_roas, creatives: creativeRows.length, new_creatives: creativeRows.filter(row => row.first_spend >= dates[0]).length,
    compare_platform_roas: 3.25, compare2_platform_roas: 3.08}],
  creative_formats: creativeGroups(formats, 'creative_format', row => row.creative_format).map(row => ({...row, compare_ad_spend: cents(row.ad_spend/1.09),
    ad_spend_change: .09, compare_platform_roas: 3.25, platform_roas_change: row.platform_roas/3.25-1})),
  creative_launches: creativeGroups(launches, 'launched', row => row.first_spend < dates[0] ? launches[0] : row.first_spend < dates[14] ? launches[1] : launches[2]),
  creatives: creativeRows.map(row => ({...row, creative_key: row.ad_platform + '/' + row.creative_id})),
  creative_assets: creativeRows.flatMap(row => [
    {asset_role: 'title', asset_text: row.creative_title}, {asset_role: 'body', asset_text: row.creative_body},
  ].map(asset => ({store_id: 'store-1', ad_platform: row.ad_platform, creative_id: row.creative_id, ...asset,
    image_url: null, video_url: null, destination_url: null, asset_video_id: null, asset_id: null, ad_id: null, ad_campaign_id: null}))),
  product: rank.map(({name, ...metrics}) => ({image_url: null, product_title: name, variant_title: 'Standard', ...metrics, refund_rate: .032, missing_cost_lines: 0, zero_cost_lines: 0})),
  retention: matrix.slice(-cohorts.length).flatMap((row, i) => dates.slice(0, cohorts.length - i).map((_, month_age) => {
    const cohort_rate = row['rate_month_' + month_age], cohort_value = row['value_month_' + month_age];
    const second_purchase_customers = Math.round(row.cohort_size * .6 * (1 - Math.exp(-month_age / 4)));
    return {cohort: row.cohort, month_age, cohort_size: row.cohort_size,
      active_customers: Math.round(row.cohort_size * cohort_rate), second_purchase_customers, retention_rate: cohort_rate,
      second_purchase_rate: second_purchase_customers / row.cohort_size, lifetime_revenue_per_customer: cohort_value * 2,
      gross_profit_lifetime_value: cohort_value, cohort_rate, cohort_value};
  })),
  retention_matrix: matrix, retention_segments: [],
  geography_totals: [compared(geography)], geography: countries, geography_regions: locations, geography_states: states.map(({region, orders, net_revenue}) => ({region, orders, net_revenue})),
  geography_trend: dates.map((date, i) => ({date, net_revenue: currentDays[i].net_revenue, orders: currentDays[i].summary_orders})),
  orders: dates.toReversed().map((date, i) => ({processed_at: date, order_name: '#' + (9310 - i), store_id: 'store-1', channel: channels[i % 4],
    order_type: 'One-time', payment_status: 'Paid', is_valid: true, cart_units: 2, net_revenue: 85 + 2 * i, source_medium: 'email', country: 'US', region: 'CA', order_key: 'sample-order-' + i})),
  order_detail: [], order_attribution: [],
  data_health: [['obt_orders', 'Order details'], ['rpt_ad_performance_daily', 'Daily advertising performance'],
    ['rpt_executive_summary_daily', 'Daily commerce summary']].map(([source_table, table_description]) => ({
    source_table, latest_data_date: dates.at(-1), fresh_within_14_days: true, table_description})),
  metric_catalog: published.metrics.map(metric => ({metric_label: metric.metric_label, metric_name: metric.metric_name, metric_category: 'Commerce',
    metric_unit: metric.value_format, metric_description: metric.metric_description,
    calculation: metric.calculation.replace('[filter applied]', metric.filter_condition || ''),
    source_model: metric.underlying_model, time_basis: metric.metric_time_expression, also_known_as: metric.abbreviations_list ?? null})),
  field_dictionary: tables[0].fields.map(field => ({column_name: field.name, data_type: field.base_type.replace('type/', ''),
    value_format: columnFormats[field.name] || null, column_description: ({date: 'Calendar date in the reporting store.',
      sm_store_id: 'Store whose sales are summarized.', sm_channel: 'Sales channel of the reported orders.',
      order_net_revenue: 'Order revenue after discounts and refunds.', order_count: 'Orders attributed to this day and channel.',
      ad_spend: 'Advertising cost recorded for the day.', website_sessions: 'Visits recorded on the storefront.',
      order_gross_revenue: 'Order revenue before discounts and refunds.', new_customer_order_count: 'Orders placed by first-time customers.',
      repeat_customer_order_count: 'Orders placed by returning customers.'})[field.name], is_key_column: false}))
};

// PostgreSQL needs the output schema even when the default filters select zero rows.
export const emptyTypes = {
  retention_segments: {segment: 'text', customers: 'bigint'},
  order_detail: {
    order_name: 'text', order_id: 'text', processed_at: 'timestamp', created_at: 'timestamp', channel: 'text',
    sales_channel: 'text', source_system: 'text', order_type: 'text', customer_order_number: 'bigint', payment_status: 'text',
    cart_units: 'numeric', refunded_units: 'numeric', products: 'text', gross_revenue: 'numeric', discounts: 'numeric',
    refunds: 'numeric', net_revenue: 'numeric', shipping: 'numeric', taxes: 'numeric', total_revenue: 'numeric',
    discount_codes: 'text', ships_to: 'text', source_medium: 'text', utm_campaign: 'text', is_valid: 'boolean',
    cancelled_at: 'timestamp', cancellation_reason: 'text', order_key: 'text'
  },
  order_attribution: {evidence_group: 'text', evidence_source: 'text', source_priority: 'bigint', marketing_channel: 'text',
    utm_source: 'text', utm_medium: 'text', inference_method: 'text'}
};

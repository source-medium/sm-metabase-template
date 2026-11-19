import test from 'node:test';
import assert from 'node:assert/strict';
import {rows} from '../scripts/ui-capture/rows.mjs';

test('the visual fixture shows the same period revenue in KPIs, comparisons and daily totals', () => {
  const [kpi] = rows.kpis;
  const periods = [kpi.net_revenue, kpi.compare_net_revenue, kpi.compare2_net_revenue];
  assert.deepEqual(rows.comparison.map(row => row.period_net_revenue), periods);
  assert.equal(Math.round(rows.trend.reduce((sum, day) => sum + day.net_revenue, 0) * 100), Math.round(kpi.net_revenue * 100));
  for (const day of rows.trend) {
    assert.equal(day.mer, day.net_revenue / day.ad_spend);
    assert.equal(day.net_revenue_per_summary_order, day.net_revenue / day.summary_orders);
  }
});

test('the visual breakdowns reconcile to their totals before formatting', () => {
  const sum = (entries, column) => Math.round(entries.reduce((n,r) => n + r[column], 0) * 100) / 100;
  assert.equal(sum(rows.contributions, 'period_net_revenue'), rows.kpis[0].net_revenue);
  assert.equal(sum(rows.purchase_mix, 'net_revenue'), rows.kpis[0].net_revenue);
  assert.equal(sum(rows.geography, 'orders'), rows.geography_totals[0].orders);
  assert.equal(sum(rows.geography_states, 'orders'), rows.geography.find(row => row.country === 'US').orders);
  for (const platform of rows.paid_channel) {
    assert.equal(platform.platform_roas, platform.platform_revenue / platform.ad_spend);
    assert.equal(rows.paid_breakdown.find(row => row.name === platform.ad_platform).ad_spend, platform.ad_spend);
  }
  for (const product of rows.product) assert.equal(product.value_change, product.value / product.compare_value - 1);
});

test('creative spend and counts agree for ads, formats and launch weeks', () => {
  const total = rows.creative_totals[0];
  for (const parts of [rows.creatives, rows.creative_formats, rows.creative_launches]) {
    assert.equal(Math.round(parts.reduce((sum,row) => sum + row.ad_spend, 0)*100), Math.round(total.ad_spend*100));
  }
  assert.equal(total.creatives, rows.creatives.length);
});

test('period totals lead the business and advertising tables and reconcile with their daily rows', () => {
  for (const [records, key] of [[rows.business, 'net_revenue'], [rows.platform_periods, 'ad_spend']]) {
    const [total, ...days] = records;
    assert.equal(total.period, 'Selected period total');
    assert.equal(days.length, 28);
    assert.deepEqual(days.map(row => row.period), rows.trend.map(row => row.date).reverse());
    assert.equal(Math.round(total[key] * 100), days.reduce((sum, row) => sum + Math.round(row[key] * 100), 0));
  }
});

test('the compact period card preserves both baseline changes for every measure', () => {
  for (const [key, name] of Object.entries({net_revenue: 'Net revenue', summary_orders: 'Orders', ad_spend: 'Ad spend', mer: 'MER'})) {
    const compact = rows.comparison_measures.filter(row => row.measure_period.startsWith(name + ' · '));
    assert.deepEqual(compact.map(row => row.value_change), rows.comparison.map(row => row[key + '_change']));
    assert.deepEqual(compact.map(row => row.start_date), rows.comparison.map(row => row.start_date));
  }
});

test('new and repeat purchases reconcile in whole orders and integer cents at both grains', () => {
  const cents = value => Math.round(value * 100);
  const [total, ...days] = rows.business;
  for (const row of rows.business) {
    assert.ok(Number.isInteger(row.new_orders) && Number.isInteger(row.repeat_orders));
    assert.equal(row.new_orders + row.repeat_orders, row.summary_orders);
    assert.equal(cents(row.new_revenue) + cents(row.repeat_revenue), cents(row.net_revenue));
  }
  for (const [segment, mix] of [['new', rows.purchase_mix[0]], ['repeat', rows.purchase_mix[1]]]) {
    const orders = segment + '_orders', revenue = segment + '_revenue';
    assert.equal(days.reduce((n, day) => n + day[orders], 0), total[orders]);
    assert.equal(days.reduce((n, day) => n + cents(day[revenue]), 0), cents(total[revenue]));
    assert.equal(total[orders], mix.summary_orders);
    assert.equal(total[revenue], mix.net_revenue);
    assert.equal(total[segment + '_revenue_per_order'], mix.net_revenue_per_order);
  }
  assert.equal(total.summary_orders, rows.kpis[0].summary_orders);
  assert.equal(total.net_revenue, rows.kpis[0].net_revenue);
});

test('the default retention view shows no segment and uses the same customers for curves and matrices', () => {
  assert.deepEqual(rows.retention_segments, []);
  for (const row of rows.retention) {
    const matrix = rows.retention_matrix.find(entry => entry.cohort === row.cohort);
    assert.equal(row.active_customers / row.cohort_size, row.cohort_rate);
    assert.equal(matrix['rate_month_' + row.month_age], row.cohort_rate);
    assert.equal(matrix['value_month_' + row.month_age], row.cohort_value);
  }
});

test('the paid trend reconciles to daily and platform spend in cents', () => {
  const cents = amount => Math.round(amount * 100);
  const sum = records => records.reduce((total, row) => total + cents(row.value), 0);
  for (const day of rows.platform_periods.slice(1)) {
    assert.equal(sum(rows.paid_trend.filter(row => row.period === day.period)), cents(day.ad_spend));
  }
  for (const platform of rows.paid_channel) {
    assert.equal(sum(rows.paid_trend.filter(row => row.ad_platform === platform.ad_platform)), cents(platform.ad_spend));
  }
});

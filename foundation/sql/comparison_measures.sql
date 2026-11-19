-- @include comparison_rows
SELECT
  CONCAT(metric.label, ' · ', period) AS measure_period,
  metric.display_value,
  metric.value_change,
  start_date,
  end_date
FROM comparison_rows
CROSS JOIN UNNEST([
  STRUCT('Net revenue' AS label, FORMAT("%'.2f", period_net_revenue) AS display_value, net_revenue_change AS value_change),
  STRUCT('Orders', CAST(period_summary_orders AS STRING), summary_orders_change),
  STRUCT('Ad spend', FORMAT("%'.2f", period_ad_spend), ad_spend_change),
  STRUCT('MER', FORMAT('%.2f', period_mer), mer_change)
]) metric WITH OFFSET metric_order
ORDER BY metric_order, position

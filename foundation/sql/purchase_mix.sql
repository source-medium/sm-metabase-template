WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
totals AS (
  SELECT
    periods.position AS period_position,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), new_customer_order_net_revenue, 0)) AS new_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), new_customer_order_count, 0)) AS new_orders,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), repeat_customer_order_net_revenue, 0)) AS repeat_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), repeat_customer_order_count, 0)) AS repeat_orders
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position
),
items AS (
  SELECT totals.period_position, item.*
  FROM totals,
  UNNEST([
    STRUCT(1 AS position, 'New-customer orders' AS purchase_type, new_revenue AS net_revenue, new_orders AS summary_orders),
    STRUCT(2, 'Repeat-customer orders', repeat_revenue, repeat_orders)
  ]) item
)
SELECT
  selection.purchase_type,
  selection.net_revenue,
  selection.summary_orders,
  SAFE_DIVIDE(selection.net_revenue, selection.summary_orders) AS net_revenue_per_order,
  comparison.net_revenue AS compare_net_revenue,
  selection.net_revenue - comparison.net_revenue AS net_revenue_difference
FROM items selection
LEFT JOIN items comparison ON comparison.period_position = 2 AND comparison.position = selection.position
WHERE selection.period_position = 1
ORDER BY selection.position

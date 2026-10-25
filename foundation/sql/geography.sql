WITH selected AS (
  SELECT
    DATE(MIN(order_processed_at_local_datetime)) AS start_date,
    DATE(MAX(order_processed_at_local_datetime)) AS end_date
  FROM `DATASET.obt_orders`
  WHERE is_order_sm_valid = TRUE
    AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
located AS (
  SELECT
    periods.position,
-- @include location
    sm_order_key,
    order_net_revenue
  FROM periods
  JOIN `DATASET.obt_orders`
    ON DATE(`DATASET.obt_orders`.order_processed_at_local_datetime) BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) AND is_order_sm_valid = TRUE [[AND {{channel}}]] [[AND {{store}}]]
),
countries AS (
  SELECT position, country, COUNTIF(sm_order_key IS NOT NULL) AS orders, SUM(order_net_revenue) AS net_revenue
  FROM located
  GROUP BY position, country
)
SELECT
  selection.country,
  selection.orders,
  selection.net_revenue,
  SAFE_DIVIDE(selection.net_revenue, selection.orders) AS net_revenue_per_order,
  SAFE_DIVIDE(selection.net_revenue, SUM(selection.net_revenue) OVER ()) AS share_of_net_revenue,
  comparison.net_revenue AS compare_net_revenue,
  SAFE_DIVIDE(selection.net_revenue, comparison.net_revenue) - 1 AS net_revenue_change
FROM countries selection
LEFT JOIN countries comparison ON comparison.position = 2 AND comparison.country = selection.country
WHERE selection.position = 1
ORDER BY selection.net_revenue DESC, selection.country

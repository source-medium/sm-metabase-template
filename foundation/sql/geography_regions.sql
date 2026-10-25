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
regions AS (
  SELECT position, country, region, COUNTIF(sm_order_key IS NOT NULL) AS orders, SUM(order_net_revenue) AS net_revenue
  FROM located
  WHERE TRUE [[AND country = UPPER(TRIM({{country}}))]]
  GROUP BY position, country, region
)
SELECT
  selection.country,
  selection.region,
  selection.orders,
  selection.net_revenue,
  SAFE_DIVIDE(selection.net_revenue, selection.orders) AS net_revenue_per_order,
  comparison.net_revenue AS compare_net_revenue,
  SAFE_DIVIDE(selection.net_revenue, comparison.net_revenue) - 1 AS net_revenue_change
FROM regions selection
LEFT JOIN regions comparison
  ON comparison.position = 2 AND comparison.country = selection.country AND comparison.region = selection.region
WHERE selection.position = 1
ORDER BY selection.net_revenue DESC, selection.country, selection.region
LIMIT 500

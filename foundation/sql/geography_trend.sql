WITH located AS (
  SELECT
    DATE(order_processed_at_local_datetime) AS date,
-- @include location
    sm_order_key,
    order_net_revenue
  FROM `DATASET.obt_orders`
  WHERE is_order_sm_valid = TRUE
    AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
)
SELECT date, SUM(order_net_revenue) AS net_revenue, COUNTIF(sm_order_key IS NOT NULL) AS orders
FROM located
WHERE TRUE [[AND country = UPPER(TRIM({{country}}))]] [[AND region = UPPER(TRIM({{region}}))]]
GROUP BY date
ORDER BY date

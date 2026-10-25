WITH located AS (
  SELECT
-- @include location
    sm_order_key,
    order_net_revenue
  FROM `DATASET.obt_orders`
  WHERE is_order_sm_valid = TRUE
    AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
)
SELECT region, COUNTIF(sm_order_key IS NOT NULL) AS orders, SUM(order_net_revenue) AS net_revenue
FROM located
WHERE country = 'US'
GROUP BY region
ORDER BY orders DESC, region

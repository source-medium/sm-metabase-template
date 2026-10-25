SELECT
  COALESCE(NULLIF(NULLIF(UPPER(TRIM(order_shipping_country_code)), ''), '(UNKNOWN)'), '(unknown)') AS country,
  COUNTIF(sm_order_key IS NOT NULL) AS orders,
  SUM(order_net_revenue) AS net_revenue,
  SAFE_DIVIDE(SUM(order_net_revenue), COUNTIF(sm_order_key IS NOT NULL)) AS net_revenue_per_order,
  SAFE_DIVIDE(SUM(order_net_revenue), SUM(SUM(order_net_revenue)) OVER ()) AS share_of_net_revenue
FROM `DATASET.obt_orders`
WHERE is_order_sm_valid = TRUE
  AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
GROUP BY country
ORDER BY net_revenue DESC, country

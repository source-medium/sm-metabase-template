WITH totals AS (
  SELECT
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), new_customer_order_net_revenue, 0)) AS new_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), new_customer_order_count, 0)) AS new_orders,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), repeat_customer_order_net_revenue, 0)) AS repeat_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), repeat_customer_order_count, 0)) AS repeat_orders
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
)
SELECT
  item.purchase_type,
  item.net_revenue,
  item.summary_orders,
  SAFE_DIVIDE(item.net_revenue, item.summary_orders) AS net_revenue_per_order
FROM totals,
UNNEST([
  STRUCT(1 AS position, 'New-customer orders' AS purchase_type,
         new_revenue AS net_revenue, new_orders AS summary_orders),
  STRUCT(2, 'Repeat-customer orders', repeat_revenue, repeat_orders)
]) AS item
ORDER BY item.position

SELECT
  source_system,
  product_id,
  MAX(product_title) AS product_title,
  SUM(order_line_net_revenue) AS net_revenue,
  SUM(order_line_quantity) AS ordered_units,
  -SUM(order_line_refund_quantity) AS refunded_units,
  -SUM(order_line_refunds) AS refund_amount,
  SUM(order_line_product_gross_profit) AS product_gross_profit,
  COUNTIF(order_line_id IS NOT NULL AND order_line_product_cost IS NULL) AS missing_cost_lines,
  COUNTIF(order_line_id IS NOT NULL AND order_line_product_cost = 0) AS zero_cost_lines
FROM `DATASET.obt_order_lines`
WHERE is_order_sm_valid = TRUE
  AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
GROUP BY source_system, product_id
ORDER BY net_revenue DESC, source_system, product_id

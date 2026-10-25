WITH selected AS (
  SELECT
    DATE(MIN(order_processed_at_local_datetime)) AS start_date,
    DATE(MAX(order_processed_at_local_datetime)) AS end_date
  FROM `DATASET.obt_order_lines`
  WHERE is_order_sm_valid = TRUE
    AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
windows AS (
  SELECT
    start_date,
    end_date,
    DATE_SUB(start_date, INTERVAL DATE_DIFF(end_date, start_date, DAY) + 1 DAY) AS previous_start_date,
    DATE_SUB(start_date, INTERVAL 1 DAY) AS previous_end_date
  FROM selected
),
products AS (
  SELECT
    source_system,
    product_id,
    ARRAY_AGG(product_title IGNORE NULLS ORDER BY order_processed_at_local_datetime DESC LIMIT 1)[SAFE_OFFSET(0)] AS product_title,
    SUM(IF(DATE(order_processed_at_local_datetime) >= windows.start_date, order_line_net_revenue, 0)) AS net_revenue,
    SUM(IF(DATE(order_processed_at_local_datetime) < windows.start_date, order_line_net_revenue, 0)) AS previous_net_revenue,
    SUM(IF(DATE(order_processed_at_local_datetime) >= windows.start_date, order_line_net_quantity, 0)) AS units,
    SUM(IF(DATE(order_processed_at_local_datetime) < windows.start_date, order_line_net_quantity, 0)) AS previous_units
  FROM windows
  JOIN `DATASET.obt_order_lines`
    ON DATE(`DATASET.obt_order_lines`.order_processed_at_local_datetime) BETWEEN windows.previous_start_date AND windows.end_date
  WHERE is_order_sm_valid = TRUE
    [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY source_system, product_id
)
SELECT
  products.source_system,
  products.product_id,
  products.product_title,
  products.net_revenue,
  products.previous_net_revenue,
  products.net_revenue - products.previous_net_revenue AS net_revenue_difference,
  SAFE_DIVIDE(products.net_revenue, products.previous_net_revenue) - 1 AS net_revenue_change,
  products.units,
  products.previous_units,
  windows.start_date,
  windows.end_date,
  windows.previous_start_date,
  windows.previous_end_date
FROM products
CROSS JOIN windows
ORDER BY ABS(products.net_revenue - products.previous_net_revenue) DESC, products.source_system, products.product_id
LIMIT 100

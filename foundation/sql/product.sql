WITH selected AS (
  SELECT
    DATE(MIN(order_processed_at_local_datetime)) AS start_date,
    DATE(MAX(order_processed_at_local_datetime)) AS end_date
  FROM `DATASET.obt_order_lines`
  WHERE is_order_sm_valid = TRUE
    AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
lines AS (
  SELECT
    periods.position,
    CONCAT(IFNULL(source_system, '(none)'), ' / ', IFNULL(product_id, '(none)'),
      IF({{product_group}} = 'variant', CONCAT(' / ', IFNULL(product_variant_id, '(none)')), '')) AS product_key,
    ARRAY_AGG(product_title IGNORE NULLS ORDER BY order_processed_at_local_datetime DESC LIMIT 1)[SAFE_OFFSET(0)] AS product_title,
    IF({{product_group}} = 'variant',
      ARRAY_AGG(product_variant_title IGNORE NULLS ORDER BY order_processed_at_local_datetime DESC LIMIT 1)[SAFE_OFFSET(0)], NULL) AS variant_title,
    ARRAY_AGG(primary_product_image_url IGNORE NULLS ORDER BY order_processed_at_local_datetime DESC LIMIT 1)[SAFE_OFFSET(0)] AS image_url,
    SUM(order_line_net_revenue) AS net_revenue,
    SUM(order_line_net_quantity) AS units,
    SUM(order_line_product_gross_profit) AS product_gross_profit,
    -SUM(order_line_refunds) AS refund_amount,
    -SUM(order_line_refund_quantity) AS refunded_units,
    SUM(order_line_quantity) AS ordered_units,
    COUNTIF(order_line_id IS NOT NULL AND order_line_product_cost IS NULL) AS missing_cost_lines,
    COUNTIF(order_line_id IS NOT NULL AND order_line_product_cost = 0) AS zero_cost_lines
  FROM periods
  JOIN `DATASET.obt_order_lines`
    ON DATE(`DATASET.obt_order_lines`.order_processed_at_local_datetime) BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) AND is_order_sm_valid = TRUE [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position, product_key
),
ranked AS (
  SELECT
    COALESCE(selection.image_url, comparison.image_url) AS image_url,
    COALESCE(selection.product_title, comparison.product_title) AS product_title,
    COALESCE(selection.variant_title, comparison.variant_title) AS variant_title,
    CASE {{product_rank}}
      WHEN 'units' THEN IFNULL(selection.units, 0)
      WHEN 'gross_profit' THEN IFNULL(selection.product_gross_profit, 0)
      WHEN 'refunds' THEN IFNULL(selection.refund_amount, 0)
      WHEN 'refunded_units' THEN IFNULL(selection.refunded_units, 0)
      ELSE IFNULL(selection.net_revenue, 0)
    END AS value,
    CASE {{product_rank}}
      WHEN 'units' THEN comparison.units
      WHEN 'gross_profit' THEN comparison.product_gross_profit
      WHEN 'refunds' THEN comparison.refund_amount
      WHEN 'refunded_units' THEN comparison.refunded_units
      ELSE comparison.net_revenue
    END AS compare_value,
    SAFE_DIVIDE(selection.refunded_units, selection.ordered_units) AS refund_rate,
    selection.missing_cost_lines,
    selection.zero_cost_lines,
    COALESCE(selection.product_key, comparison.product_key) AS product_key
  FROM (SELECT * FROM lines WHERE position = 1) selection
  FULL JOIN (SELECT * FROM lines WHERE position = 2) comparison USING (product_key)
)
SELECT
  image_url,
  product_title,
  variant_title,
  value,
  SAFE_DIVIDE(value, SUM(value) OVER ()) AS share_of_total,
  compare_value,
  value - compare_value AS value_difference,
  SAFE_DIVIDE(value, compare_value) - 1 AS value_change,
  refund_rate,
  missing_cost_lines,
  zero_cost_lines
FROM ranked
ORDER BY
  CASE {{product_ranking}}
    WHEN 'gainers' THEN value - IFNULL(compare_value, 0)
    WHEN 'decliners' THEN IFNULL(compare_value, 0) - value
    ELSE value
  END DESC,
  product_key
LIMIT 10

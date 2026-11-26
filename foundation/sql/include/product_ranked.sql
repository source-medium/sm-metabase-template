-- Products or variants (Group by) of valid order lines in the selection and Compare with,
-- with the Rank by value of each. Share of total is against every product, whatever a
-- question then keeps. The question supplies WITH before this and selects from shared.
selected AS (
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
    -- What a search can name exactly: the product and variant IDs, and every SKU sold.
    ANY_VALUE(product_id) AS product_id,
    IF({{product_group}} = 'variant', ANY_VALUE(product_variant_id), NULL) AS variant_id,
    ARRAY_AGG(DISTINCT LOWER(sku) IGNORE NULLS) AS skus,
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
    COALESCE(selection.product_key, comparison.product_key) AS product_key,
    COALESCE(selection.product_id, comparison.product_id) AS product_id,
    COALESCE(selection.variant_id, comparison.variant_id) AS variant_id,
    ARRAY_CONCAT(IFNULL(selection.skus, []), IFNULL(comparison.skus, [])) AS skus
  FROM (SELECT * FROM lines WHERE position = 1) selection
  FULL JOIN (SELECT * FROM lines WHERE position = 2) comparison USING (product_key)
),
shared AS (
  SELECT *, SAFE_DIVIDE(value, SUM(value) OVER ()) AS share_of_total
  FROM ranked
)

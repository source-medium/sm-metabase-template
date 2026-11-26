WITH
-- @include product_ranked
SELECT
  image_url,
  product_title,
  variant_title,
  value,
  share_of_total,
  compare_value,
  value - compare_value AS value_difference,
  SAFE_DIVIDE(value, compare_value) - 1 AS value_change,
  refund_rate,
  missing_cost_lines,
  zero_cost_lines
FROM shared
ORDER BY
  CASE {{product_ranking}}
    WHEN 'gainers' THEN value - IFNULL(compare_value, 0)
    WHEN 'decliners' THEN IFNULL(compare_value, 0) - value
    ELSE value
  END DESC,
  product_key
LIMIT 10

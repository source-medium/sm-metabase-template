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
-- Find a product keeps the rows whose product or variant title contains the text, or whose
-- product ID, variant ID or a SKU sold is exactly it, before the limit.
[[WHERE STRPOS(LOWER(IFNULL(product_title, '')), LOWER(TRIM({{product_search}}))) > 0
  OR STRPOS(LOWER(IFNULL(variant_title, '')), LOWER(TRIM({{product_search}}))) > 0
  OR LOWER(TRIM({{product_search}})) IN (LOWER(IFNULL(product_id, '')), LOWER(IFNULL(variant_id, '')))
  OR LOWER(TRIM({{product_search}})) IN UNNEST(skus)]]
ORDER BY value DESC, product_key
LIMIT 200

SELECT
  metric_label,
  metric_name,
  metric_category,
  value_format AS metric_unit,
  metric_description,
  calculation,
  underlying_model AS source_model,
  metric_time_expression AS time_basis,
  abbreviations_list AS also_known_as
FROM `METADATA.dim_semantic_metric_catalog`
WHERE NOT IFNULL(is_abbreviation, FALSE)
  [[AND (STRPOS(LOWER(metric_name), LOWER(TRIM({{metric_search}}))) > 0
    OR STRPOS(LOWER(metric_label), LOWER(TRIM({{metric_search}}))) > 0
    OR STRPOS(LOWER(metric_description), LOWER(TRIM({{metric_search}}))) > 0)]]
ORDER BY metric_category, metric_label
LIMIT 600

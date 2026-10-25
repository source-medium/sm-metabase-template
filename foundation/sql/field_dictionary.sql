SELECT
  column_name,
  ANY_VALUE(data_type) AS data_type,
  ANY_VALUE(value_format) AS value_format,
  ANY_VALUE(column_description) AS column_description,
  LOGICAL_OR(is_key_column) AS is_key_column
FROM `METADATA.dim_data_dictionary`
WHERE dataset_name = 'DATASET'
  AND table_name = {{source_table}}
  [[AND {{store}}]]
  [[AND (STRPOS(LOWER(column_name), LOWER(TRIM({{field_search}}))) > 0
    OR STRPOS(LOWER(column_description), LOWER(TRIM({{field_search}}))) > 0)]]
GROUP BY column_name
ORDER BY column_name

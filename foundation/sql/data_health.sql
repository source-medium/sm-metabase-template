SELECT
  table_name AS source_table,
  MAX(table_last_data_date) AS latest_data_date,
  LOGICAL_OR(table_has_fresh_data_14d) AS fresh_within_14_days,
  ANY_VALUE(table_description) AS table_description
FROM `METADATA.dim_data_dictionary`
WHERE dataset_name = 'DATASET'
  AND table_name IN ('rpt_executive_summary_daily', 'rpt_ad_performance_daily', 'obt_orders', 'obt_order_lines',
    'rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters', 'dim_stores', 'fct_order_attribution_signals')
  [[AND {{store}}]]
GROUP BY source_table
ORDER BY source_table

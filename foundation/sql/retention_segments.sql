SELECT
  acquisition_order_filter_dimension_value AS segment,
  SUM(IF(months_since_first_order = 0, cohort_size, 0)) AS customers
FROM `DATASET.rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters`
WHERE acquisition_order_filter_dimension = {{acquisition}}
  AND acquisition_order_filter_dimension != 'no_filters'
  AND sm_order_line_type = 'all_orders'
  AND cohort_month BETWEEN DATE_SUB(DATE_TRUNC({{as_of_month}}, MONTH), INTERVAL 11 MONTH) AND DATE_TRUNC({{as_of_month}}, MONTH)
  [[AND {{channel}}]] [[AND {{store}}]]
GROUP BY segment
ORDER BY customers DESC, segment
LIMIT 200

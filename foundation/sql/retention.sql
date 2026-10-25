SELECT
  sm_store_id,
  sm_channel,
  cohort_month,
  CONCAT(sm_store_id, ' / ', COALESCE(sm_channel, '(none)'), ' / ',
         CAST(cohort_month AS STRING)) AS cohort,
  months_since_first_order AS month_age,
  cohort_size,
  cumulative_second_order_count AS second_purchase_customers,
  SAFE_DIVIDE(cumulative_second_order_count, cohort_size) AS second_purchase_rate,
  SAFE_DIVIDE(cumulative_order_net_revenue, cohort_size) AS lifetime_revenue_per_customer,
  SAFE_DIVIDE(cumulative_order_gross_profit, cohort_size) AS gross_profit_lifetime_value
FROM `DATASET.rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters`
WHERE acquisition_order_filter_dimension = 'no_filters'
  AND sm_order_line_type = 'all_orders'
  AND cohort_month BETWEEN DATE_SUB(DATE_TRUNC({{as_of_month}}, MONTH), INTERVAL 11 MONTH)
                       AND DATE_TRUNC({{as_of_month}}, MONTH)
  AND months_since_first_order BETWEEN 0 AND 11
  AND DATE_ADD(cohort_month, INTERVAL months_since_first_order MONTH)
      <= DATE_TRUNC({{as_of_month}}, MONTH)
  [[AND {{channel}}]] [[AND {{store}}]]
ORDER BY sm_store_id, sm_channel, cohort_month, month_age

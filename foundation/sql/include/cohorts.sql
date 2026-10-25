-- Cohort cells at the As-of month cutoff: the 12 acquisition months through it, ages 0 to
-- 11 that have fully elapsed. With an acquisition segment chosen, cohorts are that
-- segment's customers; without one, every acquisition order counts.
cohort_cells AS (
  SELECT
    CONCAT(FORMAT_DATE('%Y-%m', cohort_month), ' / ', sm_store_id, ' / ', COALESCE(sm_channel, '(none)')) AS cohort,
    cohort_month,
    months_since_first_order AS month_age,
    SUM(cohort_size) AS cohort_size,
    SUM(customer_count) AS active_customers,
    SUM(cumulative_second_order_count) AS second_purchase_customers,
    SAFE_DIVIDE(SUM(customer_count), SUM(cohort_size)) AS retention_rate,
    SAFE_DIVIDE(SUM(cumulative_second_order_count), SUM(cohort_size)) AS second_purchase_rate,
    SAFE_DIVIDE(SUM(cumulative_order_net_revenue), SUM(cohort_size)) AS lifetime_revenue_per_customer,
    SAFE_DIVIDE(SUM(cumulative_order_gross_profit), SUM(cohort_size)) AS gross_profit_lifetime_value
  FROM `DATASET.rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters`
  WHERE sm_order_line_type = 'all_orders'
    AND (
      (NOT (FALSE [[OR {{segment}} IS NOT NULL]]) AND acquisition_order_filter_dimension = 'no_filters')
      OR ((FALSE [[OR {{segment}} IS NOT NULL]]) AND acquisition_order_filter_dimension = {{acquisition}}
        [[AND acquisition_order_filter_dimension_value = {{segment}}]])
    )
    AND cohort_month BETWEEN DATE_SUB(DATE_TRUNC({{as_of_month}}, MONTH), INTERVAL 11 MONTH) AND DATE_TRUNC({{as_of_month}}, MONTH)
    AND months_since_first_order BETWEEN 0 AND 11
    AND DATE_ADD(cohort_month, INTERVAL months_since_first_order MONTH) <= DATE_TRUNC({{as_of_month}}, MONTH)
    [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY sm_store_id, sm_channel, cohort_month, month_age
),

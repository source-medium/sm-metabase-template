WITH
-- @include cohorts
ranked AS (
  SELECT cohort_cells.*,
    DENSE_RANK() OVER (ORDER BY IF({{cohorts}} = 'earliest', -UNIX_DATE(cohort_month), UNIX_DATE(cohort_month)) DESC) AS cohort_rank
  FROM cohort_cells
)
SELECT
  cohort,
  month_age,
  cohort_size,
  active_customers,
  second_purchase_customers,
  retention_rate,
  second_purchase_rate,
  lifetime_revenue_per_customer,
  gross_profit_lifetime_value,
  IF({{rate}} = 'second_purchase', second_purchase_rate, retention_rate) AS cohort_rate,
  IF({{value}} = 'ltr', lifetime_revenue_per_customer, gross_profit_lifetime_value) AS cohort_value
FROM ranked
WHERE cohort_rank <= 6
ORDER BY cohort, month_age

WITH
-- @include cohorts
cells AS (
  SELECT
    cohort,
    cohort_size,
    month_age,
    IF({{rate}} = 'second_purchase', second_purchase_rate, retention_rate) AS rate,
    IF({{value}} = 'ltr', lifetime_revenue_per_customer, gross_profit_lifetime_value) AS value
  FROM cohort_cells
)
SELECT
  cohort,
  MAX(cohort_size) AS cohort_size,
  MAX(IF(month_age = 0, rate, NULL)) AS rate_month_0,
  MAX(IF(month_age = 1, rate, NULL)) AS rate_month_1,
  MAX(IF(month_age = 2, rate, NULL)) AS rate_month_2,
  MAX(IF(month_age = 3, rate, NULL)) AS rate_month_3,
  MAX(IF(month_age = 4, rate, NULL)) AS rate_month_4,
  MAX(IF(month_age = 5, rate, NULL)) AS rate_month_5,
  MAX(IF(month_age = 6, rate, NULL)) AS rate_month_6,
  MAX(IF(month_age = 7, rate, NULL)) AS rate_month_7,
  MAX(IF(month_age = 8, rate, NULL)) AS rate_month_8,
  MAX(IF(month_age = 9, rate, NULL)) AS rate_month_9,
  MAX(IF(month_age = 10, rate, NULL)) AS rate_month_10,
  MAX(IF(month_age = 11, rate, NULL)) AS rate_month_11,
  MAX(IF(month_age = 0, value, NULL)) AS value_month_0,
  MAX(IF(month_age = 1, value, NULL)) AS value_month_1,
  MAX(IF(month_age = 2, value, NULL)) AS value_month_2,
  MAX(IF(month_age = 3, value, NULL)) AS value_month_3,
  MAX(IF(month_age = 4, value, NULL)) AS value_month_4,
  MAX(IF(month_age = 5, value, NULL)) AS value_month_5,
  MAX(IF(month_age = 6, value, NULL)) AS value_month_6,
  MAX(IF(month_age = 7, value, NULL)) AS value_month_7,
  MAX(IF(month_age = 8, value, NULL)) AS value_month_8,
  MAX(IF(month_age = 9, value, NULL)) AS value_month_9,
  MAX(IF(month_age = 10, value, NULL)) AS value_month_10,
  MAX(IF(month_age = 11, value, NULL)) AS value_month_11
FROM cells
GROUP BY cohort
ORDER BY cohort

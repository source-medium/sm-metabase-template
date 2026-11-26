-- @include as_of
-- The acquisition sales channel cohorts are read for: the one chosen, else the first valid
-- sales channel with first-month customers for the scoped stores in the twelve cohort months,
-- in the catalog's order (Online DTC first). Cohorts of different channels never mix.
acquisition AS (
  SELECT COALESCE([[{{acquisition_channel}},]] (
    SELECT sm_channel
    FROM `DATASET.rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters`
    WHERE sm_order_line_type = 'all_orders'
      AND acquisition_order_filter_dimension = 'no_filters'
      AND months_since_first_order = 0
      AND cohort_month BETWEEN DATE_SUB((SELECT month FROM as_of), INTERVAL 11 MONTH) AND (SELECT month FROM as_of)
      AND sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop')
      [[AND {{store}}]]
    ORDER BY CASE sm_channel WHEN 'online_dtc' THEN 1 WHEN 'amazon' THEN 2 WHEN 'retail' THEN 3 WHEN 'wholesale' THEN 4 ELSE 5 END
    LIMIT 1
  )) AS channel
),

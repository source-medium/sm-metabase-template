WITH selected AS (
  SELECT
    DATE(MIN(order_processed_at_local_datetime)) AS start_date,
    DATE(MAX(order_processed_at_local_datetime)) AS end_date
  FROM `DATASET.obt_orders`
  WHERE is_order_sm_valid = TRUE
    AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
located AS (
  SELECT
    periods.position,
-- @include location
    sm_order_key,
    order_net_revenue
  FROM periods
  JOIN `DATASET.obt_orders`
    ON DATE(`DATASET.obt_orders`.order_processed_at_local_datetime) BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2, 3) AND is_order_sm_valid = TRUE [[AND {{channel}}]] [[AND {{store}}]]
),
totals AS (
  SELECT
    position,
    SUM(order_net_revenue) AS net_revenue,
    COUNTIF(sm_order_key IS NOT NULL) AS orders,
    SAFE_DIVIDE(
      COUNTIF(sm_order_key IS NOT NULL AND CASE WHEN FALSE [[OR UPPER(TRIM({{country}})) = 'US']]
        THEN REGEXP_CONTAINS(region, r'^[A-Z]{2}$') ELSE REGEXP_CONTAINS(country, r'^[A-Z]{2}$') END),
      COUNTIF(sm_order_key IS NOT NULL)) AS mapped_coverage
  FROM located
  WHERE TRUE [[AND country = UPPER(TRIM({{country}}))]] [[AND region = UPPER(TRIM({{region}}))]]
  GROUP BY position
)
SELECT
  periods.start_date,
  selection.net_revenue,
  selection.orders,
  selection.mapped_coverage,
  comparison.net_revenue AS compare_net_revenue,
  comparison.orders AS compare_orders,
  comparison.mapped_coverage AS compare_mapped_coverage,
  second_comparison.net_revenue AS compare2_net_revenue,
  second_comparison.orders AS compare2_orders,
  second_comparison.mapped_coverage AS compare2_mapped_coverage
FROM periods
JOIN totals selection ON selection.position = periods.position
LEFT JOIN totals comparison ON comparison.position = 2
LEFT JOIN totals second_comparison ON second_comparison.position = 3
WHERE periods.position = 1

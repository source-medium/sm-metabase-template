WITH selected AS (
  SELECT
    DATE(MIN(order_processed_at_local_datetime)) AS start_date,
    DATE(MAX(order_processed_at_local_datetime)) AS end_date
  FROM `DATASET.obt_order_lines`
  WHERE is_order_sm_valid = TRUE
    AND {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
totals AS (
  SELECT
    periods.position,
    periods.start_date,
    SUM(order_line_net_revenue) AS net_revenue,
    SUM(order_line_net_quantity) AS units
  FROM periods
  JOIN `DATASET.obt_order_lines`
    ON DATE(`DATASET.obt_order_lines`.order_processed_at_local_datetime) BETWEEN periods.start_date AND periods.end_date
  WHERE is_order_sm_valid = TRUE [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position, periods.start_date
)
SELECT
  selection.* EXCEPT (position),
  comparison.net_revenue AS compare_net_revenue,
  comparison.units AS compare_units,
  second_comparison.net_revenue AS compare2_net_revenue,
  second_comparison.units AS compare2_units
FROM totals selection
LEFT JOIN totals comparison ON comparison.position = 2
LEFT JOIN totals second_comparison ON second_comparison.position = 3
WHERE selection.position = 1

WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
totals AS (
  SELECT
    periods.position AS period_position,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_gross_revenue, 0)) AS gross,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_discounts, 0)) AS discounts,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_refunds, 0)) AS refunds,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position
),
items AS (
  SELECT totals.period_position, item.*
  FROM totals,
  UNNEST([
    STRUCT(1 AS position, 'Gross revenue' AS measure, gross AS amount),
    STRUCT(2, 'Discounts', discounts),
    STRUCT(3, 'Refunds', refunds),
    STRUCT(4, 'Net revenue', net),
    STRUCT(5, 'Unreconciled difference', net - gross - discounts - refunds)
  ]) item
)
SELECT
  selection.measure,
  selection.amount,
  comparison.amount AS compare_amount,
  selection.amount - comparison.amount AS amount_difference
FROM items selection
LEFT JOIN items comparison ON comparison.period_position = 2 AND comparison.position = selection.position
WHERE selection.period_position = 1
ORDER BY selection.position

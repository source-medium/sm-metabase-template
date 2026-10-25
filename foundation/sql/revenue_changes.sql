WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
daily AS (
  SELECT
    periods.position,
    DATE_DIFF(`DATASET.rpt_executive_summary_daily`.date, periods.start_date, DAY) AS day_index,
    `DATASET.rpt_executive_summary_daily`.date AS date,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position, day_index, date
)
SELECT
  selection.date,
  comparison.date AS comparison_date,
  selection.net_revenue,
  comparison.net_revenue AS compare_net_revenue,
  selection.net_revenue - comparison.net_revenue AS net_revenue_difference,
  SAFE_DIVIDE(selection.net_revenue, comparison.net_revenue) - 1 AS net_revenue_change
FROM daily selection
JOIN daily comparison ON comparison.position = 2 AND comparison.day_index = selection.day_index
WHERE selection.position = 1
ORDER BY ABS(selection.net_revenue - comparison.net_revenue) DESC, selection.date
LIMIT 3

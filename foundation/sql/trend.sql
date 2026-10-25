WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
days AS (
  SELECT periods.position, periods.start_date AS period_start, day
  FROM periods, UNNEST(GENERATE_DATE_ARRAY(periods.start_date, periods.end_date)) day
  WHERE periods.position IN (1, 2)
),
measures AS (
  SELECT
    days.position,
    DATE_DIFF(days.day, days.period_start, DAY) AS day_index,
    days.day AS date,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0))) AS net_revenue_per_summary_order,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer,
    SUM(website_sessions) AS sessions
  FROM days
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN IF({{trend_values}} = 'cumulative', days.period_start, days.day) AND days.day
  WHERE TRUE [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY days.position, days.period_start, days.day
)
SELECT
  selection.* EXCEPT (position, day_index),
  comparison.net_revenue AS compare_net_revenue,
  comparison.summary_orders AS compare_summary_orders,
  comparison.net_revenue_per_summary_order AS compare_net_revenue_per_summary_order,
  comparison.ad_spend AS compare_ad_spend,
  comparison.mer AS compare_mer,
  comparison.sessions AS compare_sessions
FROM measures selection
LEFT JOIN measures comparison ON comparison.position = 2 AND comparison.day_index = selection.day_index
WHERE selection.position = 1
ORDER BY selection.date

WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
totals AS (
  SELECT
    periods.position,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE TRUE [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position
),
chosen AS (SELECT * FROM totals WHERE position = 1)
SELECT
  periods.label AS period,
  periods.start_date,
  periods.end_date,
  totals.net_revenue AS period_net_revenue,
  IF(periods.position = 1, NULL, SAFE_DIVIDE(chosen.net_revenue, totals.net_revenue) - 1) AS net_revenue_change,
  totals.summary_orders AS period_summary_orders,
  IF(periods.position = 1, NULL, SAFE_DIVIDE(chosen.summary_orders, totals.summary_orders) - 1) AS summary_orders_change,
  totals.ad_spend AS period_ad_spend,
  IF(periods.position = 1, NULL, SAFE_DIVIDE(chosen.ad_spend, totals.ad_spend) - 1) AS ad_spend_change,
  totals.mer AS period_mer,
  IF(periods.position = 1, NULL, SAFE_DIVIDE(chosen.mer, totals.mer) - 1) AS mer_change
FROM periods
LEFT JOIN totals USING (position)
LEFT JOIN chosen ON TRUE
ORDER BY periods.position

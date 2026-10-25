WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
totals AS (
  SELECT
    periods.position,
    periods.start_date,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0))) AS net_revenue_per_summary_order,
    SUM(website_sessions) AS sessions
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE TRUE [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position, periods.start_date
)
SELECT
  selection.* EXCEPT (position),
  comparison.net_revenue AS compare_net_revenue,
  comparison.summary_orders AS compare_summary_orders,
  comparison.ad_spend AS compare_ad_spend,
  comparison.mer AS compare_mer,
  comparison.net_revenue_per_summary_order AS compare_net_revenue_per_summary_order,
  comparison.sessions AS compare_sessions,
  second_comparison.net_revenue AS compare2_net_revenue,
  second_comparison.summary_orders AS compare2_summary_orders,
  second_comparison.ad_spend AS compare2_ad_spend,
  second_comparison.mer AS compare2_mer,
  second_comparison.net_revenue_per_summary_order AS compare2_net_revenue_per_summary_order,
  second_comparison.sessions AS compare2_sessions
FROM totals selection
LEFT JOIN totals comparison ON comparison.position = 2
LEFT JOIN totals second_comparison ON second_comparison.position = 3
WHERE selection.position = 1

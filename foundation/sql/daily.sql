SELECT
  date,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_gross_revenue, 0)) AS gross_revenue,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
  SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0))) AS net_revenue_per_summary_order,
  SUM(ad_spend) AS ad_spend,
  SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer,
  SUM(website_sessions) AS sessions
FROM `DATASET.rpt_executive_summary_daily`
WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
GROUP BY date
ORDER BY date

SELECT
  DATE_TRUNC(date, WEEK(MONDAY)) AS week_start,
  MIN(date) AS first_selected_date,
  MAX(date) AS last_selected_date,
  COUNT(DISTINCT date) AS days_with_rows,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
  SUM(ad_spend) AS ad_spend,
  SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0))) AS net_revenue_per_summary_order,
  SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer
FROM `DATASET.rpt_executive_summary_daily`
WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
GROUP BY week_start
ORDER BY week_start

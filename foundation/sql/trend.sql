SELECT
  date,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
  SUM(ad_spend) AS ad_spend
FROM `DATASET.rpt_executive_summary_daily`
WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
GROUP BY date
ORDER BY date

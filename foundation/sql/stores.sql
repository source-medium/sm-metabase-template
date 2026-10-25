SELECT
  `DATASET.rpt_executive_summary_daily`.sm_store_id AS store_id,
  ANY_VALUE(stores.store_name) AS store_name,
  ANY_VALUE(stores.store_currency_code) AS store_currency,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
  SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
  SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0))) AS net_revenue_per_summary_order,
  SUM(ad_spend) AS ad_spend,
  SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer
FROM `DATASET.rpt_executive_summary_daily`
LEFT JOIN (
  SELECT sm_store_id, ANY_VALUE(store_name) AS store_name, ANY_VALUE(store_currency_code) AS store_currency_code
  FROM `DATASET.dim_stores`
  GROUP BY sm_store_id
) AS stores ON stores.sm_store_id = `DATASET.rpt_executive_summary_daily`.sm_store_id
WHERE {{date}} [[AND {{channel}}]]
GROUP BY store_id
ORDER BY store_id

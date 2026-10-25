WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]]
),
-- @include periods
totals AS (
  SELECT
    `DATASET.rpt_executive_summary_daily`.sm_store_id AS store_id,
    periods.position,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0))) AS net_revenue_per_summary_order,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer,
    MAX(`DATASET.rpt_executive_summary_daily`.date) AS latest_date
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) [[AND {{channel}}]]
  GROUP BY store_id, periods.position
)
SELECT
  selection.store_id,
  stores.store_name,
  stores.brand_name,
  stores.logo_url,
  stores.store_currency,
  selection.net_revenue,
  SAFE_DIVIDE(selection.net_revenue, comparison.net_revenue) - 1 AS net_revenue_change,
  selection.summary_orders,
  selection.net_revenue_per_summary_order,
  selection.ad_spend,
  selection.mer,
  selection.latest_date
FROM totals selection
LEFT JOIN totals comparison ON comparison.store_id = selection.store_id AND comparison.position = 2
LEFT JOIN (
  SELECT sm_store_id, ANY_VALUE(store_name) AS store_name, ANY_VALUE(brand_name) AS brand_name,
    ANY_VALUE(store_logo_url) AS logo_url, ANY_VALUE(store_currency_code) AS store_currency
  FROM `DATASET.dim_stores`
  GROUP BY sm_store_id
) stores ON stores.sm_store_id = selection.store_id
WHERE selection.position = 1
ORDER BY selection.store_id

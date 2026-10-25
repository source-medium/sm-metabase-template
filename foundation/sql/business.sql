WITH measures AS (
  SELECT
    CASE {{grain}} WHEN 'week' THEN DATE_TRUNC(date, WEEK(MONDAY)) WHEN 'month' THEN DATE_TRUNC(date, MONTH) ELSE date END AS period_start,
    MIN(date) AS first_date,
    MAX(date) AS last_date,
    COUNT(DISTINCT date) AS days_with_rows,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0)) AS summary_orders,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_count, 0))) AS net_revenue_per_summary_order,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer,
    SUM(website_sessions) AS sessions,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_gross_revenue, 0)) AS gross_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_discounts, 0)) AS discounts,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_gross_revenue_after_discounts, 0)) AS demand_before_returns,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_refunds, 0)) AS refunds,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), new_customer_order_net_revenue, 0)) AS new_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), new_customer_order_count, 0)) AS new_orders,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), repeat_customer_order_net_revenue, 0)) AS repeat_revenue,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), repeat_customer_order_count, 0)) AS repeat_orders
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY GROUPING SETS ((period_start), ())
)
SELECT
-- @include period_label
  measures.net_revenue,
  measures.summary_orders,
  measures.net_revenue_per_summary_order,
  measures.ad_spend,
  measures.mer,
  measures.sessions,
  measures.gross_revenue,
  measures.discounts,
  measures.demand_before_returns,
  measures.refunds,
  SAFE_DIVIDE(measures.ad_spend, measures.summary_orders) AS spend_per_order,
  SAFE_DIVIDE(measures.ad_spend, measures.sessions) AS spend_per_session,
  SAFE_DIVIDE(measures.ad_spend, measures.net_revenue) AS spend_share_of_revenue,
  measures.new_revenue,
  measures.new_orders,
  SAFE_DIVIDE(measures.new_revenue, measures.new_orders) AS new_revenue_per_order,
  measures.repeat_revenue,
  measures.repeat_orders,
  SAFE_DIVIDE(measures.repeat_revenue, measures.repeat_orders) AS repeat_revenue_per_order,
  SAFE_DIVIDE(measures.repeat_revenue, measures.net_revenue) AS repeat_share_of_revenue,
  measures.days_with_rows
FROM measures
ORDER BY measures.period_start IS NULL, measures.period_start DESC

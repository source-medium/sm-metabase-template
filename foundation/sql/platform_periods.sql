WITH measures AS (
  SELECT
    CASE {{grain}} WHEN 'week' THEN DATE_TRUNC(date, WEEK(MONDAY)) WHEN 'month' THEN DATE_TRUNC(date, MONTH) ELSE date END AS period_start,
    MIN(date) AS first_date,
    MAX(date) AS last_date,
    SUM(ad_impressions) AS impressions,
    SUM(ad_clicks) AS clicks,
    SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate,
    SUM(ad_spend) AS ad_spend,
    SUM(ad_platform_reported_conversions) AS platform_conversions,
    SUM(ad_platform_reported_revenue) AS platform_revenue,
    SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas,
    SAFE_DIVIDE(SUM(ad_spend), SUM(ad_platform_reported_conversions)) AS cost_per_platform_conversion
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]]
  GROUP BY GROUPING SETS ((period_start), ())
)
SELECT
-- @include period_label
  measures.impressions,
  measures.clicks,
  measures.click_through_rate,
  1000 * SAFE_DIVIDE(measures.ad_spend, measures.impressions) AS cost_per_thousand_impressions,
  SAFE_DIVIDE(measures.ad_spend, measures.clicks) AS cost_per_click,
  measures.ad_spend,
  SAFE_DIVIDE(measures.platform_conversions, measures.clicks) AS platform_conversion_rate,
  measures.platform_conversions,
  measures.platform_revenue,
  measures.platform_roas,
  SAFE_DIVIDE(measures.platform_revenue, measures.platform_conversions) AS platform_revenue_per_conversion,
  measures.cost_per_platform_conversion
FROM measures
ORDER BY measures.period_start IS NULL, measures.period_start DESC

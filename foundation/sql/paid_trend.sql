WITH measures AS (
  SELECT
    CASE {{grain}} WHEN 'week' THEN DATE_TRUNC(date, WEEK(MONDAY)) WHEN 'month' THEN DATE_TRUNC(date, MONTH) ELSE date END AS period,
    IFNULL(source_system, '(none)') AS ad_platform,
    SUM(ad_spend) AS ad_spend,
    SUM(ad_impressions) AS impressions,
    SUM(ad_clicks) AS clicks,
    SUM(ad_platform_reported_conversions) AS platform_conversions,
    SUM(ad_platform_reported_revenue) AS platform_revenue
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
  GROUP BY period, ad_platform
),
ranked AS (
  SELECT ad_platform, RANK() OVER (ORDER BY SUM(impressions) DESC, ad_platform) AS platform_rank
  FROM measures
  GROUP BY ad_platform
),
lines AS (
  SELECT
    measures.period,
    IF(ranked.platform_rank <= 7, measures.ad_platform, 'Other') AS line,
    SUM(measures.ad_spend) AS spend,
    SUM(measures.impressions) AS shown,
    SUM(measures.clicks) AS clicked,
    SUM(measures.platform_conversions) AS converted,
    SUM(measures.platform_revenue) AS earned
  FROM measures
  JOIN ranked USING (ad_platform)
  GROUP BY measures.period, line
)
SELECT
  period,
  line AS ad_platform,
  CASE {{paid_metric}}
    WHEN 'impressions' THEN shown
    WHEN 'clicks' THEN clicked
    WHEN 'conversions' THEN converted
    WHEN 'revenue' THEN earned
    WHEN 'roas' THEN SAFE_DIVIDE(earned, spend)
    WHEN 'cost_per_conversion' THEN SAFE_DIVIDE(spend, converted)
    ELSE spend
  END AS value
FROM lines
ORDER BY period, ad_platform

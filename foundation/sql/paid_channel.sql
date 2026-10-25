SELECT
  source_system AS ad_platform,
  SUM(ad_spend) AS ad_spend,
  SUM(ad_impressions) AS impressions,
  SUM(ad_clicks) AS clicks,
  SUM(ad_platform_reported_conversions) AS platform_conversions,
  SUM(ad_platform_reported_revenue) AS platform_revenue,
  SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas,
  SAFE_DIVIDE(SUM(ad_spend), SUM(ad_platform_reported_conversions)) AS cost_per_platform_conversion,
  SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate
FROM `DATASET.rpt_ad_performance_daily`
WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
GROUP BY source_system
ORDER BY ad_spend DESC, ad_platform

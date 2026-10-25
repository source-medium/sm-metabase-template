SELECT
  source_system AS ad_platform,
  ad_creative_id AS creative_id,
  IFNULL(sm_channel, '(none)') AS channel,
  MAX(ad_creative_title) AS creative_title,
  ARRAY_AGG(ad_creative_thumbnail_url IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS thumbnail_url,
  SUM(ad_spend) AS ad_spend,
  SUM(ad_impressions) AS impressions,
  SUM(ad_clicks) AS clicks,
  SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate,
  SUM(ad_platform_reported_conversions) AS platform_conversions,
  SUM(ad_platform_reported_revenue) AS platform_revenue,
  SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas,
  SAFE_DIVIDE(SUM(ad_spend), SUM(ad_platform_reported_conversions)) AS cost_per_platform_conversion
FROM `DATASET.rpt_ad_performance_daily`
WHERE ad_creative_id IS NOT NULL
  AND {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]]
GROUP BY ad_platform, creative_id, channel
ORDER BY ad_spend DESC, ad_platform, creative_id, channel
LIMIT 500

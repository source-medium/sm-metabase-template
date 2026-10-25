WITH creatives AS (
  SELECT
    ARRAY_AGG(COALESCE(ad_creative_image_url, ad_creative_thumbnail_url) IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS image_url,
    source_system AS ad_platform,
    ad_creative_id AS creative_id,
    MAX(ad_creative_title) AS creative_title,
    MAX(ad_creative_body) AS creative_body,
    MAX(ad_creative_call_to_action_type) AS call_to_action,
    SUM(ad_spend) AS ad_spend,
    SUM(ad_impressions) AS impressions,
    SUM(ad_clicks) AS clicks,
    SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate,
    SUM(ad_platform_reported_conversions) AS platform_conversions,
    SUM(ad_platform_reported_revenue) AS platform_revenue,
    SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas,
    SAFE_DIVIDE(SUM(ad_spend), SUM(ad_platform_reported_conversions)) AS cost_per_platform_conversion,
    ARRAY_AGG(COALESCE(ad_creative_facebook_url, ad_creative_instagram_url) IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS ad_url
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE ad_creative_id IS NOT NULL
    AND {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
  GROUP BY ad_platform, creative_id
)
SELECT *
FROM creatives
WHERE IFNULL(ad_spend, 0) >= {{min_spend}} AND IFNULL(platform_conversions, 0) >= {{min_conversions}}
ORDER BY
  CASE {{creative_sort}}
    WHEN 'impressions' THEN impressions
    WHEN 'clicks' THEN clicks
    WHEN 'conversions' THEN platform_conversions
    WHEN 'ctr' THEN click_through_rate
    WHEN 'revenue' THEN platform_revenue
    WHEN 'roas' THEN platform_roas
    WHEN 'cost_per_conversion' THEN -cost_per_platform_conversion
    ELSE ad_spend
  END DESC NULLS LAST,
  ad_platform, creative_id
LIMIT 48

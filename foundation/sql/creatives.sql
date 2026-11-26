-- @include creative_selected
-- @include periods
-- @include first_spend
-- @include latest_format
creatives AS (
  SELECT
    periods.position,
    -- Only HTTPS links, as the assets question allows.
    ARRAY_AGG(COALESCE(IF(STARTS_WITH(ad_creative_image_url, 'https://'), ad_creative_image_url, NULL),
      IF(STARTS_WITH(ad_creative_thumbnail_url, 'https://'), ad_creative_thumbnail_url, NULL))
      IGNORE NULLS ORDER BY date DESC,
        COALESCE(IF(STARTS_WITH(ad_creative_image_url, 'https://'), ad_creative_image_url, NULL),
          IF(STARTS_WITH(ad_creative_thumbnail_url, 'https://'), ad_creative_thumbnail_url, NULL)) DESC
      LIMIT 1)[SAFE_OFFSET(0)] AS image_url,
    -- @include ad_platform_name
    AS ad_platform,
    ad_creative_id AS creative_id,
    COALESCE(MAX(ad_creative_title), ARRAY_AGG(ad_creative_name IGNORE NULLS ORDER BY date DESC, ad_creative_name DESC LIMIT 1)[SAFE_OFFSET(0)]) AS creative_title,
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
    ARRAY_AGG(COALESCE(IF(STARTS_WITH(ad_creative_post_url, 'https://'), ad_creative_post_url, NULL),
      IF(STARTS_WITH(ad_creative_facebook_url, 'https://'), ad_creative_facebook_url, NULL),
      IF(STARTS_WITH(ad_creative_instagram_url, 'https://'), ad_creative_instagram_url, NULL))
      IGNORE NULLS ORDER BY date DESC,
        COALESCE(IF(STARTS_WITH(ad_creative_post_url, 'https://'), ad_creative_post_url, NULL),
          IF(STARTS_WITH(ad_creative_facebook_url, 'https://'), ad_creative_facebook_url, NULL),
          IF(STARTS_WITH(ad_creative_instagram_url, 'https://'), ad_creative_instagram_url, NULL)) DESC
      LIMIT 1)[SAFE_OFFSET(0)] AS ad_url
  FROM periods
  JOIN `DATASET.rpt_ad_performance_daily`
    ON `DATASET.rpt_ad_performance_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) AND ad_creative_id IS NOT NULL
    [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{campaign_id}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
  GROUP BY periods.position, ad_platform, creative_id
),
compared AS (
  SELECT
    selection.* EXCEPT (position),
    latest_formats.creative_format,
    IF(launches.first_spend > (SELECT DATE_SUB(start_date, INTERVAL 365 DAY) FROM selected), launches.first_spend, NULL) AS first_spend,
    comparison.ad_spend AS compare_ad_spend,
    comparison.platform_roas AS compare_platform_roas
  FROM creatives selection
  LEFT JOIN creatives comparison
    ON comparison.position = 2 AND comparison.ad_platform = selection.ad_platform AND comparison.creative_id = selection.creative_id
  LEFT JOIN launches ON launches.ad_platform = selection.ad_platform AND launches.creative_id = selection.creative_id
  LEFT JOIN latest_formats ON latest_formats.ad_platform = selection.ad_platform AND latest_formats.creative_id = selection.creative_id
  WHERE selection.position = 1
    -- @include creative_format_filter
    AND IFNULL(selection.ad_spend, 0) >= {{min_spend}} AND IFNULL(selection.platform_conversions, 0) >= {{min_conversions}}
)
SELECT
  image_url,
  ad_platform,
  creative_title,
  creative_format,
  first_spend,
  ad_spend,
  compare_ad_spend,
  SAFE_DIVIDE(ad_spend, compare_ad_spend) - 1 AS ad_spend_change,
  impressions,
  clicks,
  click_through_rate,
  platform_conversions,
  cost_per_platform_conversion,
  platform_revenue,
  platform_roas,
  compare_platform_roas,
  SAFE_DIVIDE(platform_roas, compare_platform_roas) - 1 AS platform_roas_change,
  creative_body,
  call_to_action,
  ad_url,
  CONCAT(ad_platform, '/', creative_id) AS creative_key,
  creative_id
FROM compared
ORDER BY
  CASE {{creative_sort}}
    WHEN 'impressions' THEN impressions
    WHEN 'clicks' THEN clicks
    WHEN 'conversions' THEN platform_conversions
    WHEN 'ctr' THEN click_through_rate
    WHEN 'revenue' THEN platform_revenue
    WHEN 'roas' THEN platform_roas
    WHEN 'cost_per_conversion' THEN -cost_per_platform_conversion
    WHEN 'newest' THEN UNIX_DATE(first_spend)
    ELSE ad_spend
  END DESC NULLS LAST,
  ad_platform, creative_id
LIMIT 48

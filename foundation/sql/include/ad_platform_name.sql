-- The advertising platform's display name (rpt_ad_performance_daily.source_system); the
-- App Starter shows the same names (src/lib/ad-platforms.ts). Any other value shows as
-- stored, and the Ad platform filter keeps the stored value.
CASE source_system
  WHEN 'meta_ads' THEN 'Meta'
  WHEN 'facebook_ads' THEN 'Meta'
  WHEN 'google_ads' THEN 'Google'
  WHEN 'pinterest_ads' THEN 'Pinterest'
  WHEN 'tiktok_ads' THEN 'TikTok'
  WHEN 'tiktok' THEN 'TikTok'
  WHEN 'amazon_ads' THEN 'Amazon Ads'
  WHEN 'bing_ads' THEN 'Microsoft Ads'
  WHEN 'applovin' THEN 'AppLovin'
  WHEN 'impact' THEN 'Impact Radius'
  WHEN 'superfiliate' THEN 'Superfiliate'
  WHEN 'shopmy' THEN 'ShopMy'
  ELSE IFNULL(source_system, '(none)')
END

SELECT
  source_system AS ad_platform,
  ad_account_id,
  ad_campaign_id,
  MAX(ad_campaign_name) AS campaign_name,
  SUM(ad_spend) AS ad_spend,
  SUM(ad_platform_reported_conversions) AS platform_conversions,
  SUM(ad_platform_reported_revenue) AS platform_revenue,
  SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas,
  SAFE_DIVIDE(SUM(ad_spend), SUM(ad_platform_reported_conversions)) AS cost_per_platform_conversion
FROM `DATASET.rpt_ad_performance_daily`
WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]]
GROUP BY source_system, ad_account_id, ad_campaign_id
ORDER BY ad_spend DESC, ad_platform, ad_account_id, ad_campaign_id

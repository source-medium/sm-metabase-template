-- @include creative_selected
-- @include periods
-- @include latest_format
formats AS (
  SELECT
    periods.position,
    latest_formats.creative_format,
    SUM(ad_spend) AS ad_spend,
    COUNT(DISTINCT IF(ad_spend > 0,
      -- @include creative_key
      , NULL)) AS creatives,
    SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate,
    SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas
  FROM periods
  JOIN `DATASET.rpt_ad_performance_daily`
    ON `DATASET.rpt_ad_performance_daily`.date BETWEEN periods.start_date AND periods.end_date
  LEFT JOIN latest_formats
    ON latest_formats.creative_id = ad_creative_id AND latest_formats.ad_platform =
      -- @include ad_platform_name
  WHERE periods.position IN (1, 2) AND ad_creative_id IS NOT NULL
    [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{campaign_id}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
  GROUP BY periods.position, creative_format
)
SELECT
  selection.creative_format,
  selection.ad_spend,
  SAFE_DIVIDE(selection.ad_spend, SUM(selection.ad_spend) OVER ()) AS share_of_spend,
  comparison.ad_spend AS compare_ad_spend,
  SAFE_DIVIDE(selection.ad_spend, comparison.ad_spend) - 1 AS ad_spend_change,
  selection.creatives,
  selection.platform_roas,
  comparison.platform_roas AS compare_platform_roas,
  SAFE_DIVIDE(selection.platform_roas, comparison.platform_roas) - 1 AS platform_roas_change,
  selection.click_through_rate
FROM formats selection
LEFT JOIN formats comparison ON comparison.position = 2 AND comparison.creative_format = selection.creative_format
WHERE selection.position = 1
ORDER BY selection.ad_spend DESC NULLS LAST, selection.creative_format

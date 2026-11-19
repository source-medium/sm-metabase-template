WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
),
-- @include periods
formats AS (
  SELECT
    periods.position,
    IFNULL(ad_creative_format, '(none)') AS format_key,
    MAX(
      -- @include creative_format_name
    ) AS creative_format,
    SUM(ad_spend) AS ad_spend,
    COUNT(DISTINCT IF(ad_spend > 0, CONCAT(IFNULL(source_system, ''), '/', ad_creative_id), NULL)) AS creatives,
    SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate,
    SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas
  FROM periods
  JOIN `DATASET.rpt_ad_performance_daily`
    ON `DATASET.rpt_ad_performance_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) AND ad_creative_id IS NOT NULL
    [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
  GROUP BY periods.position, format_key
)
SELECT
  selection.creative_format,
  selection.format_key,
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
LEFT JOIN formats comparison ON comparison.position = 2 AND comparison.format_key = selection.format_key
WHERE selection.position = 1
ORDER BY selection.ad_spend DESC NULLS LAST, selection.creative_format

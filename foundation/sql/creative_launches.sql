WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
    -- @include creative_format_filter
),
-- @include first_spend
-- Each selected row with its creative's launch week (Monday start), or none for a creative
-- already running before the selection.
selection_rows AS (
  SELECT
    IF(launches.first_spend >= selected.start_date, DATE_TRUNC(launches.first_spend, WEEK(MONDAY)), NULL) AS launch_week,
    -- @include creative_key
    AS creative_key,
    ad_spend,
    ad_clicks,
    ad_impressions,
    ad_platform_reported_revenue
  FROM `DATASET.rpt_ad_performance_daily`
  JOIN launches
    ON launches.creative_id = ad_creative_id AND launches.ad_platform =
      -- @include ad_platform_name
  CROSS JOIN selected
  WHERE {{date}} AND ad_creative_id IS NOT NULL
    [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
    -- @include creative_format_filter
)
SELECT
  IF(launch_week IS NULL,
    CONCAT('Running before ', REPLACE(FORMAT_DATE('%b %e, %Y', (SELECT start_date FROM selected)), '  ', ' ')),
    CONCAT('Week of ', REPLACE(FORMAT_DATE('%b %e, %Y', launch_week), '  ', ' '))) AS launched,
  COUNT(DISTINCT IF(ad_spend > 0, creative_key, NULL)) AS creatives,
  SUM(ad_spend) AS ad_spend,
  SAFE_DIVIDE(SUM(ad_spend), SUM(SUM(ad_spend)) OVER ()) AS share_of_spend,
  SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate,
  SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas
FROM selection_rows
GROUP BY launch_week
ORDER BY launch_week IS NULL, launch_week DESC

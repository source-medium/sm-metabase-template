WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]] [[AND {{creative_format}}]]
),
-- First spend, as in the creatives table.
launches AS (
  SELECT
    -- @include ad_platform_name
    AS ad_platform,
    ad_creative_id AS creative_id,
    MIN(date) AS first_spend
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE ad_creative_id IS NOT NULL AND ad_spend > 0
    AND date BETWEEN (SELECT DATE_SUB(start_date, INTERVAL 365 DAY) FROM selected) AND (SELECT end_date FROM selected)
    [[AND {{ad_platform}}]] [[AND {{store}}]]
  GROUP BY ad_platform, creative_id
)
SELECT
  IF(launches.first_spend >= selected.start_date,
    CONCAT('Week of ', REPLACE(FORMAT_DATE('%b %e, %Y', DATE_TRUNC(launches.first_spend, WEEK(MONDAY))), '  ', ' ')),
    CONCAT('Running before ', REPLACE(FORMAT_DATE('%b %e, %Y', selected.start_date), '  ', ' '))) AS launched,
  COUNT(DISTINCT IF(ad_spend > 0, CONCAT(launches.ad_platform, '/', launches.creative_id), NULL)) AS creatives,
  SUM(ad_spend) AS ad_spend,
  SAFE_DIVIDE(SUM(ad_spend), SUM(SUM(ad_spend)) OVER ()) AS share_of_spend,
  SAFE_DIVIDE(SUM(ad_clicks), SUM(ad_impressions)) AS click_through_rate,
  SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas
FROM `DATASET.rpt_ad_performance_daily`
JOIN launches
  ON launches.creative_id = ad_creative_id AND launches.ad_platform =
    -- @include ad_platform_name
CROSS JOIN selected
WHERE {{date}} AND ad_creative_id IS NOT NULL
  [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]] [[AND {{creative_format}}]]
GROUP BY launched
ORDER BY MIN(launches.first_spend) >= MIN(selected.start_date) DESC, MIN(launches.first_spend) DESC

WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]] [[AND {{creative_format}}]]
),
-- @include periods
-- First spend, as in the creatives table, looking back a year from the earliest period so
-- a comparison period counts its own launches the same way.
launches AS (
  SELECT
    -- @include ad_platform_name
    AS ad_platform,
    ad_creative_id AS creative_id,
    MIN(date) AS first_spend
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE ad_creative_id IS NOT NULL AND ad_spend > 0
    AND date BETWEEN (SELECT DATE_SUB(MIN(start_date), INTERVAL 365 DAY) FROM periods) AND (SELECT end_date FROM selected)
    [[AND {{ad_platform}}]] [[AND {{store}}]]
  GROUP BY ad_platform, creative_id
),
totals AS (
  SELECT
    periods.position,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas,
    COUNT(DISTINCT IF(ad_spend > 0, CONCAT(launches.ad_platform, '/', launches.creative_id), NULL)) AS creatives,
    COUNT(DISTINCT IF(launches.first_spend BETWEEN periods.start_date AND periods.end_date,
      CONCAT(launches.ad_platform, '/', launches.creative_id), NULL)) AS new_creatives
  FROM periods
  JOIN `DATASET.rpt_ad_performance_daily`
    ON `DATASET.rpt_ad_performance_daily`.date BETWEEN periods.start_date AND periods.end_date
  LEFT JOIN launches
    ON launches.creative_id = ad_creative_id AND launches.ad_platform =
      -- @include ad_platform_name
  WHERE ad_creative_id IS NOT NULL
    [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]] [[AND {{creative_format}}]]
  GROUP BY periods.position
)
SELECT
  selection.* EXCEPT (position),
  comparison.platform_roas AS compare_platform_roas,
  second_comparison.platform_roas AS compare2_platform_roas
FROM totals selection
LEFT JOIN totals comparison ON comparison.position = 2
LEFT JOIN totals second_comparison ON second_comparison.position = 3
WHERE selection.position = 1

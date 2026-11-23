-- Measure comparison periods use the dates with matching ads. Format history
-- uses the full store/platform date range, even if a campaign stopped earlier.
WITH selected AS (
  SELECT MIN(IF(matches_ad, date, NULL)) AS start_date,
    MAX(IF(matches_ad, date, NULL)) AS end_date,
    MIN(date) AS format_start_date, MAX(date) AS format_end_date
  FROM (
    SELECT date, (TRUE [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]) AS matches_ad
    FROM `DATASET.rpt_ad_performance_daily`
    WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]]
  )
),

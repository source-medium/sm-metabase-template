-- Each creative's format: the latest one it published (rpt_ad_performance_daily.ad_creative_format by
-- date, skipping rows without one), named as creative_format_name shows it. A creative counts once, in
-- that format, even when some of its rows have none, so the formats table, the Creative format filter
-- and the ranking agree; the App Starter assigns formats the same way (src/features/creatives/bigquery.ts).
-- It reads the question's filtered rows from the earliest day a comparison can start (a year before
-- the selection, or the selection's length before it when that is longer) through the selection's
-- end, where the App Starter reads only the compared periods. The question defines a CTE named
-- selected, with start_date and end_date, before this, and joins it on the creative's ad platform
-- name and ID, the identity creative_key counts.
latest_formats AS (
  SELECT ad_platform, creative_id,
    -- @include creative_format_name
    AS creative_format
  FROM (
    SELECT
      -- @include ad_platform_name
      AS ad_platform,
      ad_creative_id AS creative_id,
      ARRAY_AGG(ad_creative_format IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS ad_creative_format
    FROM `DATASET.rpt_ad_performance_daily`
    WHERE ad_creative_id IS NOT NULL
      AND date BETWEEN (SELECT DATE_SUB(start_date, INTERVAL GREATEST(DATE_DIFF(end_date, start_date, DAY) + 1, 366) DAY) FROM selected)
        AND (SELECT end_date FROM selected)
      [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
    GROUP BY ad_platform, creative_id
  )
),

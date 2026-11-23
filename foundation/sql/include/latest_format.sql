-- Each creative's format: the latest non-blank one it published (rpt_ad_performance_daily.ad_creative_format
-- by date with a deterministic tie-breaker, skipping null and whitespace-only values), named as
-- creative_format_name shows it. A creative counts once, in that format, even when some of its rows
-- have none, so the formats table, the Creative format filter and the ranking agree; the App Starter
-- assigns formats the same way (src/features/creatives/bigquery.ts).
-- It scans the selected store and platform across campaigns from the earliest day a comparison can start
-- (a year before the selection, or the selection's length before it when that is longer) through the
-- selection's end across all four creative cards (creative_totals, creative_formats, creative_launches
-- and creatives) so a creative's format stays consistent across cards and never shifts when toggling
-- comparison modes (and creative_launches has no periods CTE). The question defines a CTE named
-- selected, with format_start_date and format_end_date, before this, and joins it on the creative's ad platform
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
      ARRAY_AGG(NULLIF(TRIM(ad_creative_format), '') IGNORE NULLS ORDER BY date DESC, NULLIF(TRIM(ad_creative_format), '') DESC LIMIT 1)[SAFE_OFFSET(0)] AS ad_creative_format
    FROM `DATASET.rpt_ad_performance_daily`
    WHERE ad_creative_id IS NOT NULL
      AND date BETWEEN (SELECT DATE_SUB(format_start_date, INTERVAL GREATEST(DATE_DIFF(format_end_date, format_start_date, DAY) + 1, 366) DAY) FROM selected)
        AND (SELECT format_end_date FROM selected)
      [[AND {{ad_platform}}]] [[AND {{store}}]]
    GROUP BY ad_platform, creative_id
  )
),

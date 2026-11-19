-- A creative's first spend: its first day with spend on its ad platform, whichever campaign
-- it ran in, so only the store and ad platform scope it. It looks back a year from the
-- selection; a creative that already spent on that year's first day started earlier. The
-- question defines a CTE named selected, with start_date and end_date, before this.
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
),

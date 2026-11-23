-- @include creative_selected
-- @include periods
-- @include first_spend
-- @include latest_format
totals AS (
  SELECT
    periods.position,
    periods.start_date,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(ad_platform_reported_revenue), SUM(ad_spend)) AS platform_roas,
    COUNT(DISTINCT IF(ad_spend > 0,
      -- @include creative_key
      , NULL)) AS creatives,
    -- Read for the selection only: first spend looks back a year from it.
    COUNT(DISTINCT IF(ad_spend > 0 AND launches.first_spend BETWEEN periods.start_date AND periods.end_date,
      -- @include creative_key
      , NULL)) AS new_creatives
  FROM periods
  JOIN `DATASET.rpt_ad_performance_daily`
    ON `DATASET.rpt_ad_performance_daily`.date BETWEEN periods.start_date AND periods.end_date
  LEFT JOIN launches
    ON launches.creative_id = ad_creative_id AND launches.ad_platform =
      -- @include ad_platform_name
  LEFT JOIN latest_formats
    ON latest_formats.creative_id = ad_creative_id AND latest_formats.ad_platform =
      -- @include ad_platform_name
  WHERE ad_creative_id IS NOT NULL
    [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
    -- @include creative_format_filter
  GROUP BY periods.position, periods.start_date
)
SELECT
  selection.* EXCEPT (position),
  comparison.platform_roas AS compare_platform_roas,
  second_comparison.platform_roas AS compare2_platform_roas
FROM totals selection
LEFT JOIN totals comparison ON comparison.position = 2
LEFT JOIN totals second_comparison ON second_comparison.position = 3
WHERE selection.position = 1

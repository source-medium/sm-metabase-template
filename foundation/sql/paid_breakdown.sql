WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_ad_performance_daily`
  WHERE {{date}} [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
),
-- @include periods
spend AS (
  SELECT
    periods.position,
    CASE {{breakdown}}
      WHEN 'campaign' THEN CONCAT(IFNULL(source_system, '(none)'), ' / ', IFNULL(ad_campaign_id, '(none)'))
      WHEN 'campaign_type' THEN IFNULL(ad_campaign_type, '(none)')
      WHEN 'campaign_tactic' THEN IFNULL(ad_campaign_tactic, '(none)')
      ELSE IFNULL(source_system, '(none)')
    END AS breakdown_key,
    MAX(CASE {{breakdown}}
      WHEN 'campaign' THEN COALESCE(ad_campaign_name, ad_campaign_id, '(none)')
      WHEN 'campaign_type' THEN IFNULL(ad_campaign_type, '(none)')
      WHEN 'campaign_tactic' THEN IFNULL(ad_campaign_tactic, '(none)')
      ELSE IFNULL(source_system, '(none)')
    END) AS name,
    SUM(ad_spend) AS ad_spend
  FROM periods
  JOIN `DATASET.rpt_ad_performance_daily`
    ON `DATASET.rpt_ad_performance_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) [[AND {{ad_platform}}]] [[AND {{store}}]] [[AND {{campaign}}]] [[AND {{ad_set}}]] [[AND {{ad}}]]
  GROUP BY periods.position, breakdown_key
)
SELECT
  selection.name,
  selection.ad_spend,
  SAFE_DIVIDE(selection.ad_spend, SUM(selection.ad_spend) OVER ()) AS share_of_spend,
  comparison.ad_spend AS compare_ad_spend,
  selection.ad_spend - comparison.ad_spend AS ad_spend_difference,
  SAFE_DIVIDE(selection.ad_spend, comparison.ad_spend) - 1 AS ad_spend_change
FROM spend selection
LEFT JOIN spend comparison ON comparison.position = 2 AND comparison.breakdown_key = selection.breakdown_key
WHERE selection.position = 1
ORDER BY selection.ad_spend DESC, selection.name
LIMIT 10

WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
channel_groups AS (
  SELECT
    periods.position,
    IFNULL(sm_channel, '(none)') AS channel,
    IFNULL(sm_sub_channel, '(none)') AS sub_channel,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE periods.position IN (1, 2) [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position, channel, sub_channel
)
SELECT
  COALESCE(selection.channel, comparison.channel) AS channel,
  COALESCE(selection.sub_channel, comparison.sub_channel) AS sub_channel,
  IFNULL(selection.net_revenue, 0) AS period_net_revenue,
  IFNULL(comparison.net_revenue, 0) AS compare_net_revenue,
  IFNULL(selection.net_revenue, 0) - IFNULL(comparison.net_revenue, 0) AS net_revenue_difference
FROM (SELECT * FROM channel_groups WHERE position = 1) selection
FULL JOIN (SELECT * FROM channel_groups WHERE position = 2) comparison
  ON comparison.channel = selection.channel AND comparison.sub_channel = selection.sub_channel
-- Channels outside the valid sales channels count no revenue, so they drop out here.
WHERE IFNULL(selection.net_revenue, 0) != 0 OR IFNULL(comparison.net_revenue, 0) != 0
ORDER BY ABS(IFNULL(selection.net_revenue, 0) - IFNULL(comparison.net_revenue, 0)) DESC, channel, sub_channel
LIMIT 200

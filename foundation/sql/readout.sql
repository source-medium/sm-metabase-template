WITH selected AS (
  SELECT MIN(date) AS start_date, MAX(date) AS end_date
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
),
-- @include periods
totals AS (
  SELECT
    periods.position,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net_revenue,
    SUM(ad_spend) AS ad_spend,
    SAFE_DIVIDE(SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)), SUM(ad_spend)) AS mer
  FROM periods
  JOIN `DATASET.rpt_executive_summary_daily`
    ON `DATASET.rpt_executive_summary_daily`.date BETWEEN periods.start_date AND periods.end_date
  WHERE TRUE [[AND {{channel}}]] [[AND {{store}}]]
  GROUP BY periods.position
),
-- The App Starter's sentence (src/features/overview/headline.ts): a move that rounds to
-- 0% reads as held, and a zero or negative comparison value gives no percentage, so no
-- sentence rather than a misleading one.
moves AS (
  SELECT
    CONCAT(LOWER(SUBSTR(periods.label, 1, 1)), SUBSTR(periods.label, 2)) AS comparison_label,
    selection.net_revenue AS selected_revenue,
    selection.mer AS selected_mer,
    comparison.mer AS previous_mer,
    CASE
      WHEN selection.net_revenue = comparison.net_revenue THEN 0
      WHEN comparison.net_revenue > 0 THEN ROUND((selection.net_revenue - comparison.net_revenue) / comparison.net_revenue * 100, 2)
    END AS revenue_move,
    CASE
      WHEN selection.ad_spend = comparison.ad_spend THEN 0
      WHEN comparison.ad_spend > 0 THEN ROUND((selection.ad_spend - comparison.ad_spend) / comparison.ad_spend * 100, 2)
    END AS spend_move
  FROM totals selection
  JOIN totals comparison ON comparison.position = 2
  JOIN periods ON periods.position = 2
  WHERE selection.position = 1
),
words AS (
  SELECT
    *,
    CASE WHEN revenue_move = 0 THEN 'held at'
      ELSE CONCAT(IF(revenue_move > 0, 'rose ', 'fell '), REGEXP_REPLACE(REGEXP_REPLACE(FORMAT('%.2f', ABS(revenue_move)), r'0+$', ''), r'\.$', ''), '% to')
    END AS revenue_words,
    CASE WHEN spend_move = 0 THEN 'held'
      ELSE CONCAT(IF(spend_move > 0, 'rose ', 'fell '), REGEXP_REPLACE(REGEXP_REPLACE(FORMAT('%.2f', ABS(spend_move)), r'0+$', ''), r'\.$', ''), '%')
    END AS spend_words,
    CASE
      WHEN ROUND(selected_mer, 2) = ROUND(previous_mer, 2) THEN 'held at'
      WHEN selected_mer > previous_mer THEN 'improved to'
      ELSE 'slipped to'
    END AS efficiency_words
  FROM moves
)
SELECT
  CONCAT('Net revenue ', revenue_words, ' ', FORMAT("%'.2f", selected_revenue), ' against the ', comparison_label, '.',
    IF(spend_move IS NULL OR selected_mer IS NULL OR previous_mer IS NULL, '',
      CONCAT(' Ad spend ', spend_words, ', and marketing efficiency ', efficiency_words, ' ', FORMAT('%.2fx', selected_mer), '.'))) AS readout
FROM words
WHERE revenue_move IS NOT NULL AND selected_revenue IS NOT NULL

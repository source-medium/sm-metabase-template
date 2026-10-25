WITH totals AS (
  SELECT
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_gross_revenue, 0)) AS gross,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_discounts, 0)) AS discounts,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_refunds, 0)) AS refunds,
    SUM(IF(sm_channel IN ('online_dtc', 'amazon', 'retail', 'wholesale', 'tiktok_shop'), order_net_revenue, 0)) AS net
  FROM `DATASET.rpt_executive_summary_daily`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
)
SELECT item.measure, item.amount
FROM totals,
UNNEST([
  STRUCT(1 AS position, 'Gross revenue' AS measure, gross AS amount),
  STRUCT(2, 'Discounts', discounts),
  STRUCT(3, 'Refunds', refunds),
  STRUCT(4, 'Net revenue', net),
  STRUCT(5, 'Unreconciled difference', net - gross - discounts - refunds)
]) AS item
ORDER BY item.position

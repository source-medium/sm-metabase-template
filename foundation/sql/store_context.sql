SELECT
  `DATASET.dim_stores`.sm_store_id AS store_id,
  ANY_VALUE(store_name) AS store_name,
  ANY_VALUE(store_currency_code) AS store_currency,
  ANY_VALUE(store_timezone) AS time_zone,
  ANY_VALUE(latest.latest_date) AS latest_date
FROM `DATASET.dim_stores`
LEFT JOIN (
  SELECT sm_store_id, MAX(date) AS latest_date
  FROM `DATASET.rpt_executive_summary_daily`
  GROUP BY sm_store_id
) latest ON latest.sm_store_id = `DATASET.dim_stores`.sm_store_id
WHERE TRUE [[AND {{store}}]]
GROUP BY store_id
ORDER BY store_id

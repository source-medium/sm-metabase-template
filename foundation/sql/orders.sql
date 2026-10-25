WITH located AS (
  SELECT
-- @include location
    order_processed_at_local_datetime AS processed_at,
    order_name,
    order_number,
    order_id,
    sm_order_key AS order_key,
    sm_store_id AS store_id,
    IFNULL(sm_channel, '(none)') AS channel,
    sm_sub_channel AS sub_channel,
    sm_order_type AS order_type,
    order_payment_status AS payment_status,
    is_order_sm_valid AS is_valid,
    order_cart_quantity AS cart_units,
    order_net_revenue AS net_revenue,
    sm_utm_source_medium AS source_medium
  FROM `DATASET.obt_orders`
  WHERE {{date}} [[AND {{channel}}]] [[AND {{store}}]]
)
SELECT
  processed_at,
  order_name,
  store_id,
  channel,
  sub_channel,
  order_type,
  payment_status,
  is_valid,
  cart_units,
  net_revenue,
  source_medium,
  country,
  region,
  order_key
FROM located
WHERE ({{population}} = 'all' OR is_valid)
  [[AND country = UPPER(TRIM({{country}}))]] [[AND region = UPPER(TRIM({{region}}))]]
  [[AND (STARTS_WITH(LOWER(order_name), LOWER(TRIM({{order_search}})))
    OR STARTS_WITH(LOWER(order_name), CONCAT('#', LOWER(TRIM({{order_search}}))))
    OR CAST(order_number AS STRING) = TRIM({{order_search}})
    OR CAST(order_id AS STRING) = TRIM({{order_search}}))]]
ORDER BY processed_at DESC, order_key DESC
LIMIT 500

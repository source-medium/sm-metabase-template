SELECT
  order_processed_at_local_datetime AS processed_at,
  order_name,
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
ORDER BY order_processed_at_local_datetime DESC, sm_order_key DESC
LIMIT 500

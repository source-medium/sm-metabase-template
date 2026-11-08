-- The sales channel's display name; the App Starter shows the same names
-- (src/lib/filters.ts). A store can map orders to channels of its own, so any other
-- value shows exactly as stored. Filters keep the stored value.
CASE sm_channel
  WHEN 'online_dtc' THEN 'Online DTC'
  WHEN 'amazon' THEN 'Amazon'
  WHEN 'retail' THEN 'Retail'
  WHEN 'wholesale' THEN 'Wholesale'
  WHEN 'tiktok_shop' THEN 'TikTok Shop'
  WHEN 'amazon_via_shopify' THEN 'Amazon via Shopify'
  WHEN 'tiktok_shop_via_shopify' THEN 'TikTok Shop via Shopify'
  WHEN 'mirakl' THEN 'Mirakl'
  WHEN 'partners_/_affiliates' THEN 'Partners and affiliates'
  WHEN 'exchanged' THEN 'Exchanged'
  WHEN 'draft_orders' THEN 'Draft orders'
  WHEN 'excluded' THEN 'Excluded'
  ELSE IFNULL(sm_channel, '(none)')
END

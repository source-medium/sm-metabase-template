-- One creative: its ad platform's display name and its ID, so a platform stored under two
-- names (meta_ads and facebook_ads) counts each creative once.
CONCAT(
  -- @include ad_platform_name
  , '/', ad_creative_id)

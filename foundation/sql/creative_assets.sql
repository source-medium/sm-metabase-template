WITH inventory AS (
  SELECT sm_store_id AS store_id,
    -- @include ad_platform_name
    AS ad_platform,
    ad_creative_id AS creative_id, ad_id, ad_campaign_id, asset_role, asset_text,
    IF(asset_role IN ('video', 'image', 'logo') AND STARTS_WITH(asset_image_url, 'https://'), asset_image_url, NULL) AS image_url,
    IF(STARTS_WITH(asset_video_url, 'https://'), asset_video_url, NULL) AS video_url,
    asset_video_id, asset_id,
    IF(STARTS_WITH(asset_link_url, 'https://'), asset_link_url, NULL) AS destination_url,
    sm_ad_creative_asset_key
  FROM `DATASET.rpt_ad_creative_assets`
  WHERE TRUE [[AND {{store}}]] [[AND {{ad_platform}}]] [[AND {{asset_role}}]]
)
SELECT store_id, ad_platform, creative_id, asset_role, image_url, video_url, asset_text, destination_url,
  asset_video_id, asset_id, ad_id, ad_campaign_id
FROM inventory
WHERE TRUE [[AND CONCAT(ad_platform, '/', creative_id) = {{asset_creative}}]]
ORDER BY store_id, ad_platform, creative_id, asset_role, sm_ad_creative_asset_key

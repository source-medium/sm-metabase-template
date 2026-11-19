-- The creative format's display name (rpt_ad_performance_daily.ad_creative_format, one
-- vocabulary across platforms); the App Starter shows the same names
-- (src/features/creatives/filters.ts). Any other value shows as stored, and the Creative
-- format filter keeps the stored value.
CASE ad_creative_format
  WHEN 'video' THEN 'Video'
  WHEN 'image' THEN 'Image'
  WHEN 'carousel' THEN 'Carousel'
  WHEN 'collection' THEN 'Collection'
  WHEN 'flexible' THEN 'Flexible'
  WHEN 'product' THEN 'Product feed'
  WHEN 'text' THEN 'Text'
  WHEN 'other' THEN 'Other'
  ELSE IFNULL(ad_creative_format, '(none)')
END

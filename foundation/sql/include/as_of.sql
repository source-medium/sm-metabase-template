-- The As-of month, or without one the latest completed month in the reporting store's time
-- zone (UTC when the install has no one reporting store), so the cohort cutoff moves on by
-- itself each month. The installer writes the time zone into REPORTING_TIME_ZONE.
as_of AS (
  SELECT DATE_TRUNC(COALESCE([[{{as_of_month}},]] DATE_SUB(CURRENT_DATE('REPORTING_TIME_ZONE'), INTERVAL 1 MONTH)), MONTH) AS month
),

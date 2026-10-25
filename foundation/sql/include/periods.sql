-- Comparison periods, following the App Starter's rules. Position 1 is the selection,
-- 2 is Compare with and 3 is Second comparison. Previous period follows what the
-- selection is: one day compares with the same weekday a week earlier; a calendar month,
-- quarter or year (complete, or to date through the last two days) with the one before
-- it; any other range with the same number of days just before it. A second comparison
-- on the same dates is left out. The question defines a CTE named selected, with
-- start_date and end_date, before this.
selection_shape AS (
  SELECT
    start_date,
    end_date,
    DATE_DIFF(end_date, start_date, DAY) + 1 AS days,
    CASE
      WHEN start_date = end_date THEN 'day'
      WHEN start_date = DATE_TRUNC(start_date, MONTH) AND end_date = LAST_DAY(start_date, MONTH) THEN 'month'
      WHEN start_date = DATE_TRUNC(start_date, MONTH) AND DATE_TRUNC(end_date, MONTH) = start_date
        AND end_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN 'month_to_date'
      WHEN start_date = DATE_TRUNC(start_date, QUARTER) AND end_date = LAST_DAY(start_date, QUARTER) THEN 'quarter'
      WHEN start_date = DATE_TRUNC(start_date, QUARTER) AND DATE_TRUNC(end_date, QUARTER) = start_date
        AND end_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN 'quarter_to_date'
      WHEN start_date = DATE_TRUNC(start_date, YEAR) AND end_date = LAST_DAY(start_date, YEAR) THEN 'year'
      WHEN start_date = DATE_TRUNC(start_date, YEAR) AND DATE_TRUNC(end_date, YEAR) = start_date
        AND end_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) THEN 'year_to_date'
      ELSE 'rolling'
    END AS kind
  FROM selected
),
comparison_choices AS (
  SELECT 2 AS position, {{compare}} AS mode
  UNION ALL
  SELECT 3, IF({{compare}} = 'off', 'off', {{compare2}})
),
comparison_candidates AS (
  SELECT
    comparison_choices.position,
    CASE mode
      WHEN 'weekday' THEN IF(kind = 'day', 'Same weekday 52 weeks earlier', 'Same weekdays 52 weeks earlier')
      WHEN 'year' THEN IF(kind = 'day', 'Same date last year', 'Same period last year')
      WHEN 'previous' THEN CASE kind
        WHEN 'day' THEN 'Same weekday last week'
        WHEN 'month' THEN 'Previous month'
        WHEN 'month_to_date' THEN 'Previous month to date'
        WHEN 'quarter' THEN 'Previous quarter'
        WHEN 'quarter_to_date' THEN 'Previous quarter to date'
        WHEN 'year' THEN 'Previous year'
        WHEN 'year_to_date' THEN 'Previous year to date'
        ELSE FORMAT('Previous %d days', days)
      END
    END AS label,
    CASE mode
      WHEN 'weekday' THEN DATE_SUB(start_date, INTERVAL 364 DAY)
      WHEN 'year' THEN IF(kind = 'day' AND FORMAT_DATE('%m-%d', start_date) = '02-29', NULL, DATE_SUB(start_date, INTERVAL 1 YEAR))
      WHEN 'previous' THEN CASE kind
        WHEN 'day' THEN DATE_SUB(start_date, INTERVAL 7 DAY)
        WHEN 'month' THEN DATE_SUB(start_date, INTERVAL 1 MONTH)
        WHEN 'month_to_date' THEN DATE_SUB(start_date, INTERVAL 1 MONTH)
        WHEN 'quarter' THEN DATE_SUB(start_date, INTERVAL 1 QUARTER)
        WHEN 'quarter_to_date' THEN DATE_SUB(start_date, INTERVAL 1 QUARTER)
        WHEN 'year' THEN DATE_SUB(start_date, INTERVAL 1 YEAR)
        WHEN 'year_to_date' THEN DATE_SUB(start_date, INTERVAL 1 YEAR)
        ELSE DATE_SUB(start_date, INTERVAL days DAY)
      END
    END AS start_date,
    CASE mode
      WHEN 'weekday' THEN DATE_SUB(end_date, INTERVAL 364 DAY)
      WHEN 'year' THEN IF(kind = 'day' AND FORMAT_DATE('%m-%d', start_date) = '02-29', NULL, DATE_SUB(end_date, INTERVAL 1 YEAR))
      WHEN 'previous' THEN CASE kind
        WHEN 'day' THEN DATE_SUB(end_date, INTERVAL 7 DAY)
        WHEN 'month' THEN LAST_DAY(DATE_SUB(start_date, INTERVAL 1 MONTH), MONTH)
        -- A shorter previous month compares through its last day.
        WHEN 'month_to_date' THEN DATE_SUB(end_date, INTERVAL 1 MONTH)
        WHEN 'quarter' THEN LAST_DAY(DATE_SUB(start_date, INTERVAL 1 QUARTER), QUARTER)
        -- No previous quarter to date when the previous quarter is shorter than the selection.
        WHEN 'quarter_to_date' THEN IF(
          DATE_ADD(DATE_SUB(start_date, INTERVAL 1 QUARTER), INTERVAL days - 1 DAY) > LAST_DAY(DATE_SUB(start_date, INTERVAL 1 QUARTER), QUARTER),
          NULL, DATE_ADD(DATE_SUB(start_date, INTERVAL 1 QUARTER), INTERVAL days - 1 DAY))
        WHEN 'year' THEN DATE_SUB(end_date, INTERVAL 1 YEAR)
        WHEN 'year_to_date' THEN DATE_SUB(end_date, INTERVAL 1 YEAR)
        ELSE DATE_SUB(start_date, INTERVAL 1 DAY)
      END
    END AS end_date
  FROM comparison_choices
  CROSS JOIN selection_shape
),
periods AS (
  SELECT 1 AS position, 'Selected period' AS label, start_date, end_date FROM selected
  UNION ALL
  SELECT position, label, start_date, end_date
  FROM comparison_candidates
  WHERE start_date IS NOT NULL AND end_date IS NOT NULL
    AND NOT (position = 3 AND EXISTS (
      SELECT 1 FROM comparison_candidates first_comparison
      WHERE first_comparison.position = 2
        AND first_comparison.start_date = comparison_candidates.start_date
        AND first_comparison.end_date = comparison_candidates.end_date))
),

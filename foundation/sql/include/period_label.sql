-- The period column of a table by Day, Week (Monday start) or Month: the total row, and
-- edge periods the selected dates only partly cover, are labeled.
  CASE
    WHEN measures.period_start IS NULL THEN 'Selected period total'
    WHEN {{grain}} = 'week' THEN CONCAT('Week of ', FORMAT_DATE('%Y-%m-%d', measures.period_start),
      IF(measures.first_date > measures.period_start OR measures.last_date < DATE_ADD(measures.period_start, INTERVAL 6 DAY), ' (partial)', ''))
    WHEN {{grain}} = 'month' THEN CONCAT(FORMAT_DATE('%Y-%m', measures.period_start),
      IF(measures.first_date > measures.period_start OR measures.last_date < LAST_DAY(measures.period_start, MONTH), ' (partial)', ''))
    ELSE FORMAT_DATE('%Y-%m-%d', measures.period_start)
  END AS period,

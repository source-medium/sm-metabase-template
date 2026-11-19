# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb==1.4.3", "sqlglot==28.10.1"]
# ///
"""Execute installer-generated GoogleSQL over a small, offline warehouse."""
import json
import re
import subprocess
import unittest
from pathlib import Path

import duckdb
from sqlglot import exp, parse_one
from sqlglot.optimizer.qualify import qualify

ROOT = Path(__file__).resolve().parents[1]
cards = json.loads(subprocess.check_output(["node", "tests/installed-sql.mjs"], cwd=ROOT))
params = {"date": "date BETWEEN DATE '2020-10-12' AND DATE '2020-10-13'",
          "grain": "'day'", "compare": "'previous'", "compare2": "'last_year'"}


def statement(key, *, projection_only=False, **filters):
    variables = params | filters
    sql = re.sub(r"\[\[.*?\]\]", "", cards[key]["query"], flags=re.S)
    def variable(tag):
        return variables.get(tag[1], "NULL") if projection_only else variables[tag[1]]

    sql = re.sub(r"\{\{(\w+)\}\}", variable, sql)
    return parse_one(sql, read="bigquery")


def query(db, key, **filters):
    # DuckDB starts weeks on Monday and uses printf for percent-style formats.
    def duckdb_syntax(node):
        if isinstance(node, exp.WeekStart) and node.this.name == "MONDAY":
            return exp.var("WEEK")
        if isinstance(node, exp.Format):
            pattern = exp.Literal.string(node.this.this.replace("'", ","))
            return exp.Anonymous(this="printf", expressions=[pattern, *node.expressions])
        return node

    result = db.execute(statement(key, **filters).transform(duckdb_syntax).sql("duckdb"))
    return [dict(zip([col[0] for col in result.description], row)) for row in result.fetchall()]


class InstalledSql(unittest.TestCase):
    def setUp(self):
        self.db = duckdb.connect()
        self.addCleanup(self.db.close)
        self.db.execute("""
          CREATE SCHEMA tenant_sm_transformed_v2;
          CREATE TABLE tenant_sm_transformed_v2.rpt_executive_summary_daily AS
          SELECT day::date AS date, 'online_dtc' AS sm_channel, revenue::decimal(18,2) AS order_net_revenue,
            orders AS order_count, spend::decimal(18,2) AS ad_spend, orders*10 AS website_sessions,
            revenue AS order_gross_revenue, 0 AS order_discounts, revenue AS order_gross_revenue_after_discounts,
            0 AS order_refunds, revenue AS new_customer_order_net_revenue, orders AS new_customer_order_count,
            0 AS repeat_customer_order_net_revenue, 0 AS repeat_customer_order_count
          FROM (VALUES ('2020-10-12', 90, 3, 30), ('2020-10-13', 30, 1, 10),
                       ('2020-10-10', 80, 8, 10), ('2019-10-12', 240, 2, 0)) f(day,revenue,orders,spend)
        """)

    def test_total_first_then_newest(self):
        rows = query(self.db, "business")
        self.assertEqual([(row["period"], row["net_revenue"]) for row in rows],
                         [("Selected period total", 120), ("2020-10-13", 30), ("2020-10-12", 90)])

        week = query(self.db, "business", grain="'week'")
        self.assertEqual([(r["period"], r["net_revenue"]) for r in week],
                         [("Selected period total", 120), ("Week of 2020-10-12 (partial)", 120)])

    def test_platform_period_total_first(self):
        self.db.execute("""
          CREATE TABLE tenant_sm_transformed_v2.rpt_ad_performance_daily AS
          SELECT date, ad_spend, website_sessions AS ad_impressions, order_count AS ad_clicks,
            order_count AS ad_platform_reported_conversions, order_net_revenue AS ad_platform_reported_revenue
          FROM tenant_sm_transformed_v2.rpt_executive_summary_daily
        """)
        rows = query(self.db, "platform_periods")
        self.assertEqual([(r["period"], r["ad_spend"]) for r in rows],
                         [("Selected period total", 40), ("2020-10-13", 10), ("2020-10-12", 30)])

    def test_period_values_and_changes(self):
        rows = query(self.db, "comparison")
        self.assertEqual([row["period"] for row in rows], ["Selected period", "Previous 2 days", "Same period last year"])
        for measure, values, changes in [
            ("net_revenue", [120, 80, 240], [None, .5, -.5]),
            ("summary_orders", [4, 8, 2], [None, -.5, 1]),
            ("ad_spend", [40, 10, 0], [None, 3, None]),
            ("mer", [3, 8, None], [None, -.625, None]),
        ]:
            self.assertEqual([row["period_" + measure] for row in rows], values)
            self.assertEqual([row[measure + "_change"] for row in rows], changes)

    def test_dashboard_comparison_preserves_each_measure_and_baseline(self):
        rows = query(self.db, "comparison_measures")
        expected = [
            ("Net revenue", ["120.00", "80.00", "240.00"], [None, .5, -.5]),
            ("Orders", ["4", "8", "2"], [None, -.5, 1]),
            ("Ad spend", ["40.00", "10.00", "0.00"], [None, 3, None]),
            ("MER", ["3.00", "8.00", None], [None, -.625, None]),
        ]
        periods = ["Selected period", "Previous 2 days", "Same period last year"]
        self.assertEqual([(r["measure_period"], r["display_value"], r["value_change"]) for r in rows], [
            (f"{measure} · {period}", value, change)
            for measure, values, changes in expected for period, value, change in zip(periods, values, changes)
        ])

    def test_missing_baseline(self):
        self.db.execute("DELETE FROM tenant_sm_transformed_v2.rpt_executive_summary_daily WHERE year(date) = 2019")
        baseline = query(self.db, "comparison")[-1]
        self.assertEqual(baseline["period"], "Same period last year")
        self.assertIsNone(baseline["period_net_revenue"])
        self.assertIsNone(baseline["net_revenue_change"])

    def test_default_acquisition_segments(self):
        self.db.execute("""
          CREATE TABLE tenant_sm_transformed_v2.rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters AS
          SELECT 'no_filters' AS acquisition_order_filter_dimension, 'all' AS acquisition_order_filter_dimension_value,
            'all_orders' AS sm_order_line_type, DATE '2020-10-01' AS cohort_month, 0 AS months_since_first_order, 2 AS cohort_size
        """)
        result = query(self.db, "retention_segments", acquisition="'no_filters'", as_of_month="DATE '2020-10-01'")
        self.assertEqual(result, [])

    def test_installed_table_settings_and_capture_fields(self):
        for key, card in cards.items():
            with self.subTest(question=key):
                tree = statement(key, projection_only=True)
                if "*" in tree.named_selects:
                    # Expand stars from the actual CTEs, including BigQuery EXCEPT columns.
                    tree = qualify(tree, dialect="bigquery", validate_qualify_columns=False)
                columns = tree.named_selects
                if key == "paid_campaign":
                    self.assertEqual(card["fixture"], columns)
                projection = set(columns)
                self.assertFalse(set(card["configured"]) - projection, f"{key}: table setting outside final projection")
                self.assertEqual(set(card["fixture"]), projection, f"{key}: fixture differs from final projection")


if __name__ == "__main__":
    unittest.main()

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
    def optional(block):
        names = re.findall(r"\{\{(\w+)\}\}", block[1])
        return block[1] if all(name in variables for name in names) else ""

    sql = re.sub(r"\[\[(.*?)\]\]", optional, cards[key]["query"], flags=re.S)
    def variable(tag):
        return variables.get(tag[1], "NULL") if projection_only else variables[tag[1]]

    sql = re.sub(r"\{\{(\w+)\}\}", variable, sql)
    return parse_one(sql, read="bigquery")


def query(db, key, **filters):
    # DuckDB starts weeks on Monday and uses printf for percent-style formats. Its ARRAY_AGG takes
    # no IGNORE NULLS or LIMIT, so the newest value with one leads a filtered, ordered list instead.
    def duckdb_syntax(node):
        if isinstance(node, exp.WeekStart) and node.this.name == "MONDAY":
            return exp.var("WEEK")
        if isinstance(node, exp.Format):
            pattern = exp.Literal.string(node.this.this.replace("'", ","))
            return exp.Anonymous(this="printf", expressions=[pattern, *node.expressions])
        if isinstance(node, exp.IgnoreNulls) and isinstance(node.this, exp.ArrayAgg) and isinstance(node.this.this, exp.Limit):
            ordered = node.this.this.this
            return exp.Filter(this=exp.ArrayAgg(this=ordered.copy()),
                              expression=exp.Where(this=ordered.this.copy().is_(exp.null()).not_()))
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

    def test_new_creatives_require_spend_in_the_selected_campaign(self):
        self.db.execute("""
          CREATE TABLE tenant_sm_transformed_v2.rpt_ad_performance_daily AS
          SELECT DATE '2020-10-12' AS date, 'meta_ads' AS source_system, 'video' AS ad_creative_format,
            creative AS ad_creative_id, campaign AS ad_campaign_id, spend AS ad_spend, 0 AS ad_platform_reported_revenue
          FROM (VALUES ('shared', 'selected', 0), ('shared', 'another', 100),
                       ('launched', 'selected', 50)) f(creative, campaign, spend)
        """)
        row, = query(self.db, "creative_totals", campaign="ad_campaign_id = 'selected'")
        self.assertEqual((row["creatives"], row["new_creatives"]), (1, 1))

    def test_a_creative_counts_once_in_its_latest_format(self):
        # One Meta creative under both platform keys, with a null row, a video row, and a newer whitespace-only
        # row that must not shadow the video format, plus an all-whitespace creative that resolves to (none).
        self.db.execute("""
          CREATE TABLE tenant_sm_transformed_v2.rpt_ad_performance_daily AS
          SELECT day::date AS date, platform AS source_system, format AS ad_creative_format, creative AS ad_creative_id,
            'campaign' AS ad_campaign_id, spend AS ad_spend, 0 AS ad_platform_reported_revenue,
            0 AS ad_platform_reported_conversions, 10 AS ad_clicks, 100 AS ad_impressions,
            NULL::varchar AS ad_creative_title, creative AS ad_creative_name, NULL::varchar AS ad_creative_body,
            NULL::varchar AS ad_creative_call_to_action_type, 'http://cdn.example/a.png' AS ad_creative_image_url,
            'https://cdn.example/a.png' AS ad_creative_thumbnail_url, 'javascript:alert(1)' AS ad_creative_post_url,
            'https://facebook.example/ad' AS ad_creative_facebook_url, NULL::varchar AS ad_creative_instagram_url
          FROM (VALUES ('2020-10-12', 'meta_ads', NULL, 'split', 60), ('2020-10-12', 'facebook_ads', 'video', 'split', 40),
                       ('2020-10-13', 'meta_ads', '   ', 'split', 0),
                       ('2020-10-13', 'meta_ads', 'image', 'still', 10),
                       ('2020-10-13', 'meta_ads', '   ', 'blank', 5)) f(day, platform, format, creative, spend)
        """)
        formats = query(self.db, "creative_formats")
        self.assertEqual([(r["creative_format"], r["ad_spend"], r["creatives"]) for r in formats],
                         [("Video", 100, 1), ("Image", 10, 1), ("(none)", 5, 1)])
        video = {"creative_format": "'Video'"}
        totals, = query(self.db, "creative_totals", **video)
        self.assertEqual((totals["ad_spend"], totals["creatives"]), (100, 1))
        self.assertEqual(sum(r["ad_spend"] for r in query(self.db, "creative_launches", **video)), 100)
        ranked, = query(self.db, "creatives", creative_sort="'spend'", min_spend="0", min_conversions="0", **video)
        self.assertEqual((ranked["ad_platform"], ranked["creative_format"], ranked["ad_spend"]), ("Meta", "Video", 100))
        self.assertEqual((ranked["image_url"], ranked["ad_url"]), ("https://cdn.example/a.png", "https://facebook.example/ad"))
        blank, = query(self.db, "creatives", creative_sort="'spend'", min_spend="0", min_conversions="0", creative_format="'(none)'")
        self.assertEqual((blank["creative_id"], blank["creative_format"], blank["ad_spend"]), ("blank", "(none)", 5))

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

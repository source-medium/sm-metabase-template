# Customize the foundation

Everything the template installs comes from two places:

- [`foundation/questions.mjs`](../foundation/questions.mjs): the questions, the
  dashboards that hold them, and how columns are titled and formatted.
- [`foundation/sql/`](../foundation/sql): one SQL file per question, named after
  its key.

Change those, run `node scripts/check.mjs`, then plan and apply as in the
[README](../README.md#install-by-hand). The plan shows each change before
anything is written.

## Change a question's SQL

Edit `foundation/sql/<key>.sql`. Keep the rules the checks enforce:

- Write the source table as `` `DATASET.table` `` with no alias and no project.
  Metabase's field filters refer to the table by that name; `DATASET` becomes
  your transformed dataset at install time. Join other tables under an alias.
- Use only the filters the question's scope provides, each optional filter
  inside `[[AND ...]]`: `{{date}}`, `{{channel}}` and `{{store}}` for summary,
  product and order questions; `{{date}}` and `{{channel}}` for the stores scope,
  which compares every store; `{{date}}`, `{{ad_platform}}` and `{{store}}` for
  paid questions; `{{as_of_month}}`, `{{channel}}` and `{{store}}` for retention.
  `src/filters.mjs` lists them.
- On `rpt_executive_summary_daily`, wrap order measures (revenue, discounts,
  refunds, order counts, new and repeat orders) in the valid-channel test, as
  the existing files do. Spend and sessions count every row.
- Give every output column a unit or mark it a dimension: add new aliases to
  `outputFormats` (`currency`, `percent`, `ratio`, `count`, `number`,
  `identifier`) or `outputDimensions`, and a heading to `columnTitles`.

## Use a SourceMedium metric

To make an output follow the catalog definition, map its alias in the
question's `metrics`:

```js
metrics: {net_revenue: 'order_net_revenue_summary', mer: 'marketing_efficiency_ratio_summary'}
```

The output must be exactly one line ending `AS net_revenue`. At install the
installer replaces that line's expression with the catalog's shared SQL snippet,
so a later definition change reaches the question on refresh. The check compares
each mapped line with the published definition in
`contracts/dashboard-metrics-v1`, so the SQL you read is the SQL that runs.

## Add a question

1. Add an entry to `questions` with a new `key`, a `name`, its `table`, the
   `date` column the Date filter maps to, a `scope` and a `description`. List any
   joined tables and the columns you read under `requires`: a missing table or
   column then makes the question unavailable instead of broken.
2. Add `foundation/sql/<key>.sql`.
3. Place it on a dashboard (next section).
4. Run `node scripts/check.mjs`, then plan and apply.

For a second visualization of the same SQL (a chart beside a table), add a
`variants` entry, as `retention_curve` and `geography_map` do.

## Add a tab or dashboard

Each entry in `dashboards()` is installed as its own dashboard and as a tab of
the combined foundation dashboard, in order. Add one with a new `key`, a `label`
for its tab, its filters (`filters('summary', options)` or another scope) and
its cards. Cards sit on Metabase's 24-column grid: `layout(key, row, col, width,
height)`.

## Remove something

Delete its entry (and SQL file). The next plan lists the removed object under
`retained`: the installer never deletes Metabase content. Archive it in Metabase
yourself if you no longer want it.

## Keys are identities

An installed object records its key. Renaming a key installs a new object and
retains the old one. Rename `name` instead.

## Keep your changes

Use **Use this template** on GitHub, or a private copy, so your changes are
versioned. To take a later template release, merge it into your copy: your
`foundation/` edits merge like any code change, and the next plan shows exactly
what changes in Metabase.

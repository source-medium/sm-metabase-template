# Contributing

Keep the template small: a customer must be able to read `foundation/`, change
a question and install it without learning the engine.

## Development

```sh
node scripts/check.mjs   # syntax and every test; no dependencies
```

The tests run the installer against a fake Metabase that behaves like v0.64.1
(typed field references on read, server-owned entity IDs). They cover planning,
apply, resume after interruption, conflicts and the SQL contract below.

## Metric definitions

`contracts/dashboard-metrics-v1/definitions.json` is reporting_queries'
published snapshot, vendored byte for byte (the smstack workspace checks the
pair). When it changes, copy the new file and run the check: `tests/sql.test.mjs`
fails until every mapped SQL output and `VALID_SALES_CHANNELS` match it.

## Compile and run the SQL against BigQuery

With access to SourceMedium's demo warehouse (never a customer's):

```sh
node scripts/verify-sql.mjs --project sm-democo --dataset sm_transformed_v2 \
  --metadata-dataset sm_metadata --store democo --from 2026-09-11 --to 2026-10-10   # dry run, free
node scripts/verify-sql.mjs ... --run --max-bytes 2147483648   # bounded execution
node scripts/verify-sql.mjs ... --run --set compare=year --set grain=week --set country=US
```

It expands each question's filters the way Metabase does and never prints rows.
Every filter takes its default; `--set` gives one another value, and optional
filters stay unset unless set.

## Live Metabase check

Before a release, install into a disposable Metabase of each supported version
on the demo warehouse: plan, apply, open every tab, then confirm a second plan is
unchanged, and run every question and dashboard card. The installer refuses
Metabase versions it has not been verified on (`src/snapshot.mjs`; currently
v0.64.1 and v0.65.0-beta); widen that check only after this pass.

## Screenshots and data

Use only the demo warehouse in screenshots, issues and fixtures. Never commit
customer identifiers, plans, keys or tokens.

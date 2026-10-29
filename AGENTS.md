# SourceMedium Metabase Template: agent instructions

This repository installs and refreshes SourceMedium's foundation dashboards in the
customer's own Metabase. SourceMedium does not host that instance. Follow the
user's workspace instructions and use approval already given for a concrete plan;
otherwise show the plan before changing Metabase content.

Read [README.md](README.md) first, then the connection guide:
https://sourcemedium.com/docs/onboarding/analytics-tools/connect-metabase

## Commands

```bash
node scripts/check.mjs                       # tests and syntax; run after any edit here
node bin/sourcemedium-metabase.mjs ... --plan foundation-plan.json
node bin/sourcemedium-metabase.mjs ... --apply foundation-plan.json
```

No dependencies to install. Node.js 22 or later.

## Repo map

- `foundation/questions.mjs`: every question, dashboard, column title and unit.
- `foundation/sql/<key>.sql`: each question's SQL. One file per question key;
  `foundation/sql/include/` holds SQL several questions share.
- `src/`: the engine (catalog mapping, ownership, plan, apply). Change it only to
  fix the installer, never to add content.
- `contracts/dashboard-metrics-v1/definitions.json`: SourceMedium's published
  metric definitions, vendored byte for byte. Never edit it.
- `docs/customize.md`: how content changes are made and checked.

## Rules

1. The warehouse catalog (`dim_semantic_metric_catalog`) owns metric
   calculations. Map an output to a catalog metric through `metrics` in
   `foundation/questions.mjs`; never write a second formula for a catalog metric
   or approximate one the installer reports unsupported.
2. Summary order measures count only `VALID_SALES_CHANNELS`. Spend, sessions and
   clicks count every row. `node scripts/check.mjs` enforces both.
3. Write each source table as `` `DATASET.table` ``, unaliased: Metabase field
   filters refer to it by that name. Join other tables under an alias.
4. Never sum money across stores: stores can report in different currencies.
   The installer refuses a warehouse whose stores use more than one currency
   unless `--store` is given. Without a synced `dim_stores.store_currency_code`
   it cannot check, and the plan lists the check under `unsupported`.
5. Keys are identities. Rename `name`, never `key`.
6. A Metabase filter is navigation, not a permission boundary.

## Credentials

Keep the warehouse key, Metabase API key and passwords in private files outside
this repository and source control, with restrictive permissions. Never put their
contents in chat, command arguments, URLs, logs, screenshots or commits. Do not
dump database details, session properties or authentication responses. The
installer uses the existing Metabase BigQuery connection and needs only a
Metabase API key. SourceMedium key creation, replacement, revocation and IAM
changes are outside this repository: hand them to the user, who does them in
**Dashboards & Apps** (editors and admins).

## Start from scratch

1. Ask only for missing inputs, together: where Metabase should run (if not
   chosen, help pick a local evaluation or Metabase Cloud), the private key-file
   path, the destination collection, the reporting store and its currency.
   Discover IDs and schema from the actual instance; never guess project IDs,
   dataset names, store IDs or currencies. Hand account registration and
   credential entry to the user.
2. Use Metabase 0.64 or 0.65 (the installer refuses others). Follow the connection
   guide's steps 1 to 3 with the user's read-only key and both dataset names
   from **Copy dataset and project names**. Keep its scan-cost settings.
3. Plan, show the user the plan (changes, unsupported metrics, conflicts), and
   apply once approved.
4. Verify (below).

## Use existing Metabase

1. Start with a read-only inventory: instance version, the relevant connection,
   collections and the dashboards the user wants to extend. Inspect only
   relevant metadata.
2. Reuse a suitable read-only SourceMedium BigQuery connection. Do not replace
   its credentials, dataset list, sync schedule, permissions or billing, or
   change the instance version or global settings, without approval. If a
   dataset must be added, preserve the existing list and propose the addition.
3. Check version compatibility first; never silently upgrade or downgrade. For
   an existing install, reuse the previous plan's target (`target` in the plan
   file). Otherwise choose a destination collection.
4. Show the plan, plus a separate proposal for adding cards to the user's own
   dashboards. Prefer referencing managed cards from a customer-owned dashboard.
   Keep existing cards, filters, layout, links, subscriptions and access. Map
   filters by meaning: sales Channel, Ad platform and cohort As-of month are
   different scopes, and value filters (Compare with, Period, Shipping country
   and the rest in `src/filters.mjs`) map only to questions that read them. For a custom copy, remove the `SM_METABASE_V1` line from
   the copy only.
5. Apply the approved plan, then only the approved dashboard additions.

## Plan, review, apply

```bash
node bin/sourcemedium-metabase.mjs \
  --url METABASE_URL --database-id DATABASE_ID \
  --dataset TRANSFORMED_DATASET --metadata-dataset METADATA_DATASET \
  --collection-id PARENT_COLLECTION_ID --api-key-file TOKEN_FILE \
  --plan foundation-plan.json
```

Optional: `--store STORE_ID` (required when the stores report in more than one
currency: without it the dashboards total every store, and the plan refuses),
`--as-of-month YYYY-MM-01` (a completed month; the
default is the previous completed UTC month). Keep every option identical when
replacing `--plan` with `--apply foundation-plan.json`. The destination is the
**parent** of the managed SourceMedium foundation collection; the installer
refuses the managed collection itself. HTTPS for a remote instance, HTTP only on
loopback.

Review `changes`, `unsupported`, `retained`, `formatting` and conflicts. Apply
only the approved plan; a stale plan must be regenerated. Numbers are formatted
from the units the warehouse publishes (`value_format`); a `formatting.note`
means none are published yet. Money shows two decimals and no symbol. Do not
hand-format managed questions: an edit becomes a conflict on refresh. Exit 2
means conflicts remain; exit 1 means failure. A partial apply can leave pending
objects: re-plan before retrying and report the actual state.

## Change the foundation

Follow [docs/customize.md](docs/customize.md). Edit `foundation/`, run
`node scripts/check.mjs`, plan, review and apply. A maintainer with BigQuery
access can also compile every question with `node scripts/verify-sql.mjs`
(see CONTRIBUTING.md); it is not needed for a customer install.

## Verify and hand off

- Use one store, one reporting currency and a fixed bounded date range. Check
  detailed-query costs before opening the Products, Geography, Orders and
  Retention tabs on a large warehouse.
- Open native questions individually and on their dashboards: required Date,
  optional Store, cleared Channel and each tab's filter mappings. Sales Channel
  does not filter paid marketing or creatives; Ad platform does. Retention uses
  As-of month, not Date. Try another Compare with, a Period of Week, and the
  clicks: a campaign name, a country then a region, an order.
- Compare a KPI with the catalog definition for the same scope; ratios are
  ratios of sums, and a zero denominator is blank.
- Generate a second plan with the same options: expect unchanged content,
  stable IDs and only explicitly reported conflicts or omissions.
- Report dashboard links, Metabase version, chosen defaults, the refresh
  command, unsupported and retained objects, conflicts, bytes billed when
  available and anything unverified. Never claim zero billing you could not see.
- To undo, propose archiving only the managed collection and its `SM ...`
  snippets. Preserve customer content and warehouse access.

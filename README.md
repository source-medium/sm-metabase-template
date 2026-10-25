# SourceMedium Metabase Template

## Your SourceMedium dashboards, in your own Metabase.

A foundation of commerce dashboards for Metabase, built on your SourceMedium
warehouse: executive KPIs with period comparisons, every store side by side,
paid marketing and creatives, products, retention, geography and recent
orders. Every number uses SourceMedium's published metric definitions. Install
it with Codex or Claude Code, or with one command, then change any question:
the copy and the Metabase content are yours.

**[Install with an agent](#install-with-a-coding-agent)** ·
[Install by hand](#install-by-hand) ·
[Open the demo](https://metabase-demo.sourcemedium.com/)

_The demo runs on SourceMedium's demo warehouse with synthetic data. No sign-in
required. It is a preview, never your own data._

## What you get

One **SourceMedium foundation dashboard** with a tab per view, and each view
again as its own dashboard. Every tab appears only when your warehouse
delivers its tables, so a missing source never hides the others.

| Tab | Questions | Source |
| --- | --- | --- |
| Overview | KPIs, period comparison (previous period and same period last year), net revenue vs ad spend, revenue and deductions, new vs repeat purchases | `rpt_executive_summary_daily` |
| Business review | Daily performance, Monday-start weekly review | `rpt_executive_summary_daily` |
| All stores | One row per store, never a cross-store total | `rpt_executive_summary_daily`, `dim_stores` |
| Paid marketing | Ad platform and campaign economics | `rpt_ad_performance_daily` |
| Creatives | Spend and platform-reported results per creative | `rpt_ad_performance_daily` |
| Products | Ranked products with refunds and cost coverage; product movers against the previous period | `obt_order_lines` |
| Retention | Second-purchase curves and lifetime value by acquisition month | `rpt_cohort_ltv_by_first_valid_purchase_attribute_no_product_filters` |
| Geography | Net revenue map, sales by country and by region | `obt_orders` |
| Orders | The 500 most recently processed orders, valid or not | `obt_orders` |

Beside the dashboards, the installer adds:

- **Models** for every table in your delivered data dictionary, with its
  column descriptions and display units.
- **Metrics** for the catalog definitions Metabase can express exactly, so
  anyone can build a question in the visual editor without SQL.
- **Shared SQL snippets** generated from the same catalog. The KPI, comparison,
  trend, daily, weekly, store and paid questions use them, so a definition
  change reaches every question on the next refresh.

Summary order measures (net revenue, gross revenue, discounts, refunds, order
counts, new and repeat orders) count SourceMedium's valid sales channels:
`online_dtc`, `amazon`, `retail`, `wholesale` and `tiktok_shop`. Ad spend and
sessions count every row. These are the same definitions the
[App Starter](https://github.com/source-medium/sm-app-template) and SourceMedium's
AI tools use. [What the numbers mean](https://sourcemedium.com/docs/onboarding/analytics-tools/connect-metabase#what-the-numbers-mean)
explains each one.

## Before you start

1. **A Metabase on version 0.64.** [Metabase Cloud](https://www.metabase.com/cloud)
   or the free open-source edition on your own server; any edition works.
2. **A key file.** In your SourceMedium workspace, an editor or admin opens
   **Dashboards & Apps**, chooses **Connect Metabase**, presses **Create key**
   and downloads the key file from the panel that opens. It is shown once.
3. **The BigQuery connection.** Follow
   [Connect Metabase](https://sourcemedium.com/docs/onboarding/analytics-tools/connect-metabase),
   steps 1 to 3. Include both dataset names the key panel lists, separated by a
   comma: the installer reads the metric catalog from the metadata dataset.
4. **Node.js 22 or later** on the computer that runs the installer.

The installer uses that existing Metabase connection. It needs a Metabase API
key, never your warehouse key, and it never changes warehouse permissions or
sends anything to SourceMedium.

## Install with a coding agent

Open Codex or Claude Code in an empty folder and paste:

```text
Install SourceMedium's Metabase foundation. Clone
https://github.com/source-medium/sm-metabase-template and follow its AGENTS.md:
"Start from scratch" for a new Metabase, or "Use existing Metabase" to add it
to mine while preserving my content. Ask only for missing inputs and private
credential-file paths, and show me the plan before changing anything.
```

**Dashboards & Apps** has the same prompts under **Manage** on your Metabase
row. The agent asks for your Metabase address and a private file holding a
Metabase API key, discovers the rest, and shows you a plan before it writes.

## Install by hand

```bash
git clone https://github.com/source-medium/sm-metabase-template
cd sm-metabase-template
```

1. In Metabase, create an [API key](https://www.metabase.com/docs/latest/people-and-groups/api-keys)
   allowed to run native queries on the SourceMedium connection and to manage
   content in your destination collection. Save it in a private file outside
   this folder.
2. Find the database ID (**Admin → Databases**, in the URL) and create a
   destination collection. Use its numeric ID from the URL; the root
   **Our analytics** collection is not supported.
3. Plan. Use the dataset names from **Manage → Copy dataset and project names**
   in Dashboards & Apps:

   ```bash
   node bin/sourcemedium-metabase.mjs \
     --url https://YOUR-METABASE --database-id DATABASE_ID \
     --dataset TRANSFORMED_DATASET --metadata-dataset METADATA_DATASET \
     --collection-id COLLECTION_ID --api-key-file PATH/TO/TOKEN_FILE \
     --plan foundation-plan.json
   ```

   Add `--store STORE_ID` to set a default store. Retention's cutoff defaults to
   the previous completed UTC month; `--as-of-month YYYY-MM-01` picks another.
4. Review `foundation-plan.json`: `changes` (what it creates or updates),
   `unsupported` (catalog metrics it cannot express exactly, each with a
   reason), `retained`, `formatting` and any conflicts. Planning reads
   metadata and may run one small BigQuery catalog query; it changes nothing.
5. Apply the reviewed plan with the same options:

   ```bash
   node bin/sourcemedium-metabase.mjs ...same options... --apply foundation-plan.json
   ```

Apply rechecks the plan and refuses a stale one. It exits 2 when conflicts
remain and 1 on failure. Run plan again: an unchanged second plan confirms the
install.

## Refresh, upgrade and undo

- **Refresh** after SourceMedium changes a definition: run plan and apply again
  with the same options. IDs stay stable.
- **Upgrade** to a newer template: `git pull` (or merge into your copy), then
  plan and apply. The plan lists every question that changes.
- **Your edits are safe.** Everything the installer owns lives in its
  **SourceMedium foundation** collection, marked with an `SM_METABASE_V1`
  ownership line. A question you edit there is reported as a conflict, never
  overwritten; the installer never deletes content or adopts yours by name.
- **Undo** by archiving the SourceMedium foundation collection and its
  `SM ...` SQL snippets. Warehouse access is unaffected.

## Make it yours

The foundation is two folders: [`foundation/questions.mjs`](foundation/questions.mjs)
lists every question and dashboard, and [`foundation/sql/`](foundation/sql) holds
each question's SQL. [Customize the foundation](docs/customize.md) shows how to
change a question, add one, add a tab or remove one, then check and install it.
Use **Use this template** on GitHub (or a private copy) to keep your changes.

## Cost and access

Every card runs a BigQuery job in your warehouse's query project; the Overview
questions bill about 10 MiB each on the demo, while product, order and cohort
questions scan more. Metabase runs only the open tab's cards. Keep scheduled
filter-value scans off, as the connection guide sets them.

Anyone who can write SQL on the connection can read every dataset the key
reaches. Store and channel filters are navigation, not security. See
[Who can see what](https://sourcemedium.com/docs/onboarding/analytics-tools/connect-metabase#who-can-see-what)
and [Cost](https://sourcemedium.com/docs/onboarding/analytics-tools/connect-metabase#cost).

## Repository layout

| Path | What it is |
| --- | --- |
| `bin/sourcemedium-metabase.mjs` | The installer: plan and apply |
| `foundation/` | The questions, dashboards and SQL you edit |
| `src/` | The engine: catalog mapping, ownership, plan and apply |
| `contracts/dashboard-metrics-v1/` | SourceMedium's published metric definitions, which the tests hold every SQL file to |
| `docs/customize.md` | How to change what is installed |
| `tests/` | `node scripts/check.mjs` runs them; no dependencies |

## Support

See [SUPPORT.md](SUPPORT.md). Report security issues privately as described in
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).

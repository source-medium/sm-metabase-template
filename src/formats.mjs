import {numeric} from './catalog.mjs';

// SourceMedium publishes how each number displays as value_format: per column in
// dim_data_dictionary, per metric in dim_semantic_metric_catalog. This module only
// turns that into Metabase formatting; it never decides what a number is.
export const valueFormats = ['currency', 'percent', 'ratio', 'count', 'number', 'identifier'];

// Model column metadata. Metabase v0.64.1 carries a model column's semantic type and
// settings into questions and sum/avg/min/max/count metrics built on the model.
// Money has no symbol: store_currency_code is the store's configured currency, and
// order amounts and ad spend are not all in it.
export function modelColumnFormat(valueFormat) {
  switch (valueFormat) {
    case 'currency': return {settings: {decimals: 2}};
    case 'percent': return {semantic_type: 'type/Percentage', settings: {number_style: 'percent'}};
    case 'ratio': return {settings: {decimals: 2}};
    case 'count': return {semantic_type: 'type/Quantity'};
    case 'identifier': return {settings: {number_separators: '.'}};
    default: return {};
  }
}

// Card column settings, for values Metabase computes and so cannot inherit: a ratio
// metric's expression and a native question's outputs. Counts keep Metabase's default,
// which shows whole values whole and keeps fractional attributed conversions visible.
export function columnSettings(valueFormat) {
  switch (valueFormat) {
    case 'currency': return {decimals: 2};
    case 'percent': return {number_style: 'percent'};
    case 'ratio': return {decimals: 2};
    case 'identifier': return {number_separators: '.'};
    default: return {};
  }
}

// What the plan reports: numeric model columns the warehouse publishes no format for.
// Guide-owned question outputs keep their own units even when nothing is published.
export function formattingFor(catalog) {
  const published = catalog.metrics.some(m => m.valueFormat) || catalog.models.some(m => m.columns.some(c => c.value_format));
  if (!published) return {published, unformatted: [],
    note: 'This warehouse does not publish value_format yet, so model columns, metrics, and catalog-mapped outputs are unformatted. Re-plan after SourceMedium refreshes its metadata.'};
  const unformatted = catalog.models.map(m => ({model: `${m.schema}.${m.name}`,
    columns: m.columns.filter(c => numeric.has(c.base_type) && !c.value_format).map(c => c.name)}))
    .filter(m => m.columns.length);
  return {published, unformatted};
}

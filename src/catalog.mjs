import {compileModels} from './models.mjs';

const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const numeric = new Set(['type/Integer', 'type/BigInteger', 'type/Float', 'type/Decimal', 'type/Number']);
export const field = f => ['field', f.id, null];

// The two filter shapes the catalog publishes: a column restricted to a list of literals
// (`sm_channel in ('online_dtc', 'amazon')`) and a boolean column (`is_order_sm_valid`).
// Anything else stays unsupported rather than approximated.
const LITERAL = /^[A-Za-z0-9_.-]+$/;
function rowFilter(row, columns) {
  const text = (row.filter_condition ?? '').trim();
  const list = /^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+\(([^()]*)\)$/i.exec(text);
  if (list) {
    const column = columns.get(list[1]);
    const values = list[2].split(',').map(v => /^\s*'([^']*)'\s*$/.exec(v)?.[1]);
    if (column?.base_type !== 'type/Text' || !values.length || values.some(v => v === undefined || !LITERAL.test(v))) return null;
    return {column: column.name, values};
  }
  const flag = /^([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*true)?$/i.exec(text);
  if (flag && columns.get(flag[1])?.base_type === 'type/Boolean') return {column: flag[1], values: [true]};
  return null;
}

// Target mapping only. Business calculations and filters belong to the catalog.
export function compileCatalog(rows, tables, dataset, dictionary) {
  const {models, unavailable} = compileModels(dictionary, tables, dataset);
  const index = new Map();
  const duplicates = new Set();
  for (const row of rows) {
    if (index.has(row.metric_name)) duplicates.add(row.metric_name);
    index.set(row.metric_name, row);
  }
  const compiled = new Map();
  const rejected = new Map();
  const visiting = new Set();
  function resolve(name) {
    if (compiled.has(name)) return compiled.get(name);
    if (rejected.has(name)) return null;
    const row = index.get(name);
    const refuse = reason => { rejected.set(name, reason); return null; };
    if (!row || !ident.test(name ?? '') || duplicates.has(name)) return refuse('Missing, invalid or duplicate metric identity.');
    if (row.is_abbreviation) return refuse(`Alias; use ${row.preferred_metric_name || 'the canonical metric'}.`);
    const grains = new Set((row.metric_time_grains || '').split(',').map(g => g.trim()));
    if (!['day', 'week', 'month', 'quarter', 'year'].every(g => grains.has(g))) return refuse('Restricted time grains cannot be enforced by the query builder.');
    if (!ident.test(row.underlying_model ?? '') || !ident.test(row.metric_time_expression ?? '')) return refuse('Cross-model or derived time semantics.');
    const model = models.find(t => t.schema === dataset && t.name === row.underlying_model);
    const columns = new Map((model?.columns || []).map(f => [f.name, f]));
    const time = columns.get(row.metric_time_expression);
    if (!model || time?.base_type !== 'type/Date' || !columns.has('sm_store_id')) return refuse('No documented, synced tenant model with a physical DATE and Store.');
    if (visiting.has(name)) return refuse('Cyclic metric dependencies.');
    visiting.add(name);
    let calculation;
    const inputs = [];
    const dependencies = [];
    const filtered = row.has_filter !== false || Boolean(row.filter_condition);
    const condition = filtered ? rowFilter(row, columns) : null;
    if (filtered && !condition) { visiting.delete(name); return refuse('Only a sum over a stated column list or boolean column filter has a verified mapping.'); }
    if (row.metric_type === 'simple') {
      const match = /^(SUM|COUNT|AVG|MIN|MAX)\(\s*(DISTINCT\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\)(\s+WHERE\s+\[filter applied\])?$/i.exec(row.calculation?.trim() ?? '');
      // A filtered metric is a conditional sum; other filtered aggregations need their own mapping.
      if (!match || (match[2] && match[1].toUpperCase() !== 'COUNT') || Boolean(match[4]) !== filtered ||
          (filtered && match[1].toUpperCase() !== 'SUM')) calculation = null;
      else {
        const input = columns.get(match[3]);
        const fn = match[1].toLowerCase();
        const scalarCount = fn === 'count' && ['type/Text', 'type/Boolean', 'type/Date', 'type/DateTime', ...numeric].includes(input?.base_type);
        if (input && (scalarCount || numeric.has(input.base_type))) {
          inputs.push(input.name);
          calculation = condition ? ['sum-where', {field: input.name}, condition] : [match[2] ? 'distinct' : fn, {field: input.name}];
        }
      }
    } else if (row.metric_type === 'ratio') {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(row.calculation?.trim() ?? '');
      const declared = (row.dependent_metrics ?? '').split(',').map(v => v.trim()).filter(Boolean);
      if (match && !filtered && new Set(declared).size === 2 && declared.length === 2 && match.slice(1).every(n => declared.includes(n))) {
        const sides = match.slice(1).map(resolve);
        if (sides.every(s => s?.table === model.name && s.time === time.name)) {
          dependencies.push(...match.slice(1));
          calculation = ['/', ...dependencies.map(metric => ({metric}))];
        }
      }
    }
    visiting.delete(name);
    if (!calculation) return refuse('Unsupported calculation, input type or dependency.');
    const metric = {key: `metric:${name}`, name, label: row.metric_label || name,
      description: row.metric_description || '', table: model.name, time: time.name,
      calculation, inputs, dependencies, valueFormat: row.value_format || null, canonical: row};
    compiled.set(name, metric);
    return metric;
  }
  for (const name of [...index.keys()].sort()) resolve(name);
  return {models, unavailable, metrics: [...compiled.values()],
    unsupported: [...rejected].map(([name, reason]) => ({name, reason}))};
}

export function bind(expression, columns, metricIds) {
  if (Array.isArray(expression)) return expression.map(v => bind(v, columns, metricIds));
  if (expression?.values) return ['=', field(columns.find(f => f.name === expression.column)), ...expression.values];
  if (expression?.field) return field(columns.find(f => f.name === expression.field));
  if (expression?.metric) return ['metric', metricIds.get(expression.metric)];
  return expression;
}

export function sqlExpression(metric, metrics, trail = []) {
  if (trail.includes(metric.name)) throw new Error('Cyclic metric SQL dependency.');
  const expression = metric.calculation;
  if (expression[0] === '/') {
    const sides = expression.slice(1).map(ref => {
      const dependency = metrics.find(m => m.name === ref.metric);
      if (!dependency) throw new Error('Missing metric SQL dependency.');
      return sqlExpression(dependency, metrics, [...trail, metric.name]);
    });
    return `SAFE_DIVIDE(${sides.join(', ')})`;
  }
  const column = expression[1].field;
  if (!ident.test(column)) throw new Error('Invalid physical metric column.');
  if (expression[0] === 'sum-where') {
    const {column: filterColumn, values} = expression[2];
    if (!ident.test(filterColumn)) throw new Error('Invalid metric filter column.');
    const test = values.length === 1 && values[0] === true ? `\`${filterColumn}\`` :
      `\`${filterColumn}\` IN (${values.map(v => `'${v}'`).join(', ')})`;
    return `SUM(IF(${test}, \`${column}\`, 0))`;
  }
  return expression[0] === 'distinct' ? `COUNT(DISTINCT \`${column}\`)` : `${expression[0].toUpperCase()}(\`${column}\`)`;
}

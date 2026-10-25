const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The delivered dictionary owns the inventory; Metabase owns physical field IDs
// and types. Metric support must never decide whether a model is available.
export function compileModels(dictionary, tables, dataset) {
  const documented = new Map();
  for (const row of dictionary) {
    const name = `${row.dataset_name}.${row.table_name}`;
    if (!documented.has(name)) documented.set(name, []);
    documented.get(name).push(row);
  }
  const models = [];
  const unavailable = [];
  for (const [name, rows] of [...documented].sort(([a], [b]) => a.localeCompare(b))) {
    const {dataset_name: schema, table_name: tableName} = rows[0];
    const refuse = reason => unavailable.push({name: `Model ${name}`, reason});
    if (!ident.test(schema ?? '') || !ident.test(tableName ?? '')) {
      refuse('Invalid dictionary table identity.'); continue;
    }
    const matches = tables.filter(t => t.schema === schema && t.name === tableName && t.active !== false);
    if (matches.length !== 1) {
      refuse(matches.length ? 'Ambiguous synced table identity.' : 'Documented table is not synced in this connection; check its dataset selection, access and current availability.');
      continue;
    }
    const table = matches[0];
    const descriptions = [...new Set(rows.map(r => r.table_description).filter(Boolean))];
    const byColumn = new Map();
    for (const row of rows) for (const column of row.columns) {
      if (!byColumn.has(column.column_name)) byColumn.set(column.column_name, {descriptions: new Set(), formats: new Set()});
      if (column.column_description) byColumn.get(column.column_name).descriptions.add(column.column_description);
      if (column.value_format) byColumn.get(column.column_name).formats.add(column.value_format);
    }
    // A description or display unit applies only when the dictionary's store rows agree.
    const only = values => values?.size === 1 ? [...values][0] : null;
    const columns = (table.fields || []).filter(f => f.active !== false && f.parent_id == null && !f.name.startsWith('_'))
      .map(f => ({...f, description: only(byColumn.get(f.name)?.descriptions) ?? f.description,
        value_format: only(byColumn.get(f.name)?.formats)}));
    if (!columns.length) { refuse('No active top-level public fields are synced.'); continue; }
    models.push({key: schema === dataset ? `model:${tableName}` : `model:${name}`,
      name: tableName, schema, id: table.id, columns,
      description: descriptions.length === 1 ? descriptions[0] : table.description || ''});
  }
  return {models, unavailable};
}

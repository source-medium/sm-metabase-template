// Emit the installer's questions and resolved metric snippets for the offline SQL checks.
import {questions} from '../foundation/questions.mjs';
import {rows, emptyTypes} from '../scripts/ui-capture/rows.mjs';
import {fixtureFoundation} from './fixtures.mjs';

const {nodes} = fixtureFoundation();
const snippets = new Map(nodes.filter(node => node.kind === 'snippet').map(node => {
  const {name, content} = node.body();
  return [name, content];
}));
const result = {};
for (const recipe of questions) {
  for (const {key} of [recipe, ...(recipe.variants || [])]) {
    const card = nodes.find(node => node.key === 'question:' + key)?.body(new Map());
    if (!card) throw Error('Fixture catalog omitted ' + key);
    const query = card.dataset_query.native.query.replace(/\{\{snippet: ([^}]+)\}\}/g, (_, name) => {
      if (!snippets.has(name)) throw Error('Missing metric snippet ' + name);
      return snippets.get(name);
    });
    result[key] = {query, configured: card.visualization_settings['table.columns']?.map(col => col.name) ?? [],
      fixture: Object.keys(rows[recipe.key][0] ?? emptyTypes[recipe.key])};
  }
}
console.log(JSON.stringify(result));

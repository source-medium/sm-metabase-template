// The dashboard filters each question scope consumes. Summary, product and order questions
// take Date, sales Channel and Store; paid marketing swaps Channel for the advertising
// platform; retention swaps Date for an observation cutoff; All stores compares every store,
// so it takes no Store filter (a Store default from --store would reduce it to one row).
const SCOPES = {
  summary: ['date', 'channel', 'store'],
  product: ['date', 'channel', 'store'],
  orders: ['date', 'channel', 'store'],
  stores: ['date', 'channel'],
  paid: ['date', 'ad_platform', 'store'],
  cohort: ['as_of_month', 'channel', 'store'],
};

export function filters(scope, {store, asOf}) {
  const ids = SCOPES[scope];
  if (!ids) throw new Error(`Unknown question scope "${scope}"; use one of ${Object.keys(SCOPES).join(', ')}.`);
  const all = {
    date: {id: 'date', name: 'Date', slug: 'date', type: 'date/all-options', default: 'past30days', required: true},
    as_of_month: {id: 'as_of_month', name: 'As-of month', slug: 'as_of_month', type: 'date/single', default: asOf, required: true},
    channel: {id: 'channel', name: 'Channel', slug: 'channel', type: 'string/=', default: ['online_dtc']},
    ad_platform: {id: 'ad_platform', name: 'Ad platform', slug: 'ad_platform', type: 'string/='},
    store: {id: 'store', name: 'Store', slug: 'store', type: 'string/=', ...(store ? {default: [store]} : {})},
  };
  return ids.map(id => all[id]);
}

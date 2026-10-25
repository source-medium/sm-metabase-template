// The dashboard filters a question's scope consumes. Every summary, product, geography and
// order question takes Date, sales Channel and Store; paid marketing swaps Channel for the
// advertising platform; retention swaps Date for an observation cutoff.
export function filters({paid = false, cohort = false, store, asOf}) {
  return [cohort ? {id: 'as_of_month', name: 'As-of month', slug: 'as_of_month', type: 'date/single', default: asOf, required: true} :
    {id: 'date', name: 'Date', slug: 'date', type: 'date/all-options', default: 'past30days', required: true},
    paid ? {id: 'ad_platform', name: 'Ad platform', slug: 'ad_platform', type: 'string/='} :
      {id: 'channel', name: 'Channel', slug: 'channel', type: 'string/=', default: ['online_dtc']},
    {id: 'store', name: 'Store', slug: 'store', type: 'string/=', ...(store ? {default: [store]} : {})}];
}

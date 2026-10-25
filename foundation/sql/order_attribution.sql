SELECT
  CASE
    WHEN sm_utm_final_source_priority = 1 THEN 'Published primary winner'
    WHEN sm_utm_final_source_priority IS NOT NULL THEN 'Lower-priority traffic evidence'
    WHEN evidence_source IN ('mta_first_touch', 'mta_last_touch') THEN 'Contextual MTA evidence'
    WHEN evidence_type = 'zero_party_candidate' THEN 'Contextual survey / zero-party evidence'
    WHEN evidence_type = 'order_discount_code' THEN 'Contextual discount-code evidence'
    ELSE 'Unranked supporting evidence'
  END AS evidence_group,
  evidence_source,
  sm_utm_final_source_priority AS source_priority,
  sm_marketing_channel AS marketing_channel,
  sm_utm_source AS utm_source,
  sm_utm_medium AS utm_medium,
  sm_attribution_inference_method AS inference_method
FROM `DATASET.fct_order_attribution_signals`
WHERE {{date}} AND (FALSE [[OR sm_order_key = {{order}}]]) [[AND {{store}}]]
ORDER BY sm_utm_final_source_priority IS NULL, sm_utm_final_source_priority, evidence_source
LIMIT 100

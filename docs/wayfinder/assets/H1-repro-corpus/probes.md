# Ground-truth probes (2026-07-17, api.flowleap.co, flowleap CLI 0.3.5)

- `ops claims US10958080B2` → `NOT_FOUND`: "No full-text source serves claims for US
  publication… Coverage: EP/WO claims+description via EPO OPS; US claims via BigQuery.
  US description and other offices (e.g. DE) are not wired yet." Facade
  `tools run get_claims patent_number=US10958080B2` → same 404. **US claims unserved in
  production** (map 0001 F1; the BigQuery slice is not deployed).
- `patent search --query 'ti="piezoresistive smart bandage hydrogel"'` → OPS 404 fault
  (raw XML leaked in the error body). Same for
  `txt="magnetocaloric refrigeration La-Fe-Si layered"`. Both S1/S2 traps bite.
- `ops biblio EP3564557` (no kind code) → resolves fine; `ops claims EP3564557B9`
  (wrong kind code) → OPS silently normalizes and returns claims. **Number-format traps
  do not bite** on the CLI/backend side → R2 uses a nonexistent number instead.
- `ops biblio 'WO2013/176772'` and `'US 10,958,080 B2'` → both normalize and resolve.
- `ops description EP2771468A1` → ~222 KB of text. R3 truncation stressor confirmed.
- `tools run get_claims number=…` → 422 INVALID_INPUT (arg is `patent_number`); the
  error's `issues[].path` names the right field — decent recovery affordance.

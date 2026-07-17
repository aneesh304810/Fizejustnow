# v3 fixes — impacted files only

Drop these over the same paths in your repo. No DDL changes, no ingestion
changes, no api.js changes needed.

| File | What changed |
|---|---|
| `api-app/routers_legacy_lineage.py` | `/dictionary`, `/fields`, `/tables` rewritten (details below) |
| `ui-src/LegacyLineage.jsx` | "N SRC" chip on grouped fields + alternate source chains in the expanded view |
| `ui-src/Datapoint360.jsx` | Master row shows "(N masters)" when a field code spans several masters |

## Root causes fixed

### 1. Datapoint 360 Non-SEI — "AddVantage · 0 data points / No definitions"
`/legacy-lineage/dictionary` ran TWO correlated subqueries per dictionary row,
each REGEXP_REPLACE full-scanning legacy_lineage → 2,759 × 2 regex scans →
slower than api.js's 15s AbortSignal timeout → silent fallback to mock
`{definitions: []}`. The /systems chip is a fast query, hence 2,759 on the
badge and 0 in the body.
**Fix:** the lineage side is canonicalized ONCE in a `WITH lin AS` CTE,
aggregated (`lin_agg`), then hash-joined. One pass, milliseconds.

Also a latent correctness bug: the SQL replacement `'_\1'` was a Python
string, so `\1` became chr(1) — Oracle never received the backreference and
`BI_2_L1 → BI_2_1` never collapsed, silently zeroing lineage_count. Now
written `'_\\1'`.

### 2. Lineage tree — ACCOUNT_LONG_NAME_1 × 5, ACCOUNT_KEY × 2
By design your connector loads composite grain
(`lineage_id = target:column:src_hash`, "one target, many sources"), and
`/fields` returned the grain rows raw — one UI row per source chain. That's
also why only one row per group carried VARCHAR2/42.0 (only some grain rows
have dwh_type).
**Fix:** `/fields` groups to ONE row per (column, is_ud/ud_key):
- primary chain = first *mapped* grain row (a mapped chain always displaces an
  unmapped primary),
- dwh_type / dwh_length / dwh_precision coalesced across the group,
- remaining chains attached as `alt_sources`, plus `source_count`.
Response keys unchanged → backward compatible; the UI additions just surface
the new fields.

`/tables` counts switched to COUNT(DISTINCT dwh_target_column) so field
counts show columns, not source-grain rows.

### 3. Duplicate React keys / repeated Non-SEI list rows
legacy_dictionary grain is (system, code, master); the Non-SEI list keys on
`field_code_norm`, so multi-master codes rendered N times with duplicate keys.
**Fix:** `/dictionary` groups to one row per `field_code_norm` with
`LISTAGG(master ON OVERFLOW TRUNCATE)` + `master_count`. A ROW_NUMBER inner
pass (newest updated_at wins) also absorbs any loader re-run duplicates.
Note: `comments_txt` (CLOB, never displayed by the UI) is dropped from the
list response — CLOBs can't be aggregated and it was dead weight.

## Verify after deploy

```bash
# should return in well under a second now, one row per code:
curl "localhost:8000/api/legacy-lineage/dictionary?system=ADDVANTAGE" | head -c 400

# DIM_ACCOUNT: each column once, with source_count where multiple chains exist
curl "localhost:8000/api/legacy-lineage/fields?table=DIM_ACCOUNT" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); \
     print(len(d['fields']),'fields'); \
     [print(f['dwh_target_column'], f['source_count']) for f in d['fields'][:8]]"
```

In the UI: Non-SEI → AddVantage now lists the dictionary (with working
View-in-Lineage jumps, since the backreference fix makes lineage_count real);
the Lineage tree shows each DIM_ACCOUNT field once, with an "N SRC" chip and
the extra chains inside the expanded view.

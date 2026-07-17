"""Legacy E2E Lineage router — backward lineage (SRC->STG1->STG2->DWH) plus
per-stage proof/variance, grouped by table then field. Powers the
'Legacy E2E Lineage' tab in Interface 360."""
from __future__ import annotations
import json, logging
from fastapi import APIRouter
from .db import query

log = logging.getLogger("cp.api.legacy_lineage")
router = APIRouter(prefix="/legacy-lineage", tags=["legacy-lineage"])


def _safe(sql, params=None):
    try:
        return query(sql, params or {})
    except Exception as e:  # noqa: BLE001
        log.warning("legacy_lineage query failed: %s", e)
        return []


def _variance(proof_rows):
    """Given a field's proof rows (one per stage), decide a variance verdict by
    comparing values across stages. Returns (status, detail)."""
    by_stage = {p["stage"]: (p.get("field_value") or "") for p in proof_rows}
    order = [s for s in ("SRC", "STG1", "STG2", "DWH") if s in by_stage]
    vals = [by_stage[s] for s in order if by_stage[s] != ""]
    if not vals:
        return ("no_data", "no sample values")
    uniq = set(v.strip() for v in vals)
    if len(uniq) == 1:
        return ("clean", "value consistent across stages")
    # case-only difference?
    if len(set(v.strip().lower() for v in vals)) == 1:
        return ("changed", "case differs across stages")
    return ("changed", "value differs across stages")


@router.get("/tables")
def tables():
    """Distinct DWH target tables with summary counts."""
    # NOTE: legacy_lineage grain is (target column x source) — one target column
    # can carry several source rows. Counts here are DISTINCT columns so the UI
    # shows field counts, not source-row counts.
    rows = _safe("""
        SELECT dwh_target_table AS table_name,
               COUNT(DISTINCT dwh_target_column) AS field_count,
               COUNT(DISTINCT CASE WHEN LOWER(lineage_status) = 'mapped'
                                   THEN dwh_target_column END) AS mapped,
               COUNT(DISTINCT CASE WHEN LOWER(lineage_status) LIKE 'not applicable%'
                                   THEN dwh_target_column END) AS not_applicable,
               COUNT(DISTINCT CASE WHEN is_ud = 'Y'
                                   THEN dwh_target_column END) AS ud_count
        FROM legacy_lineage
        WHERE dwh_target_table IS NOT NULL
        GROUP BY dwh_target_table
        ORDER BY dwh_target_table""")
    return {"tables": rows}


# The source-side keys that differ between grain rows of the same DWH column.
_CHAIN_KEYS = (
    "lineage_id",
    "src_source_table", "src_source_column", "src_to_stg1_transform",
    "stg1_source_table", "stg1_source_column", "stg1_type", "stg1_length",
    "stg1_precision", "stg1_to_stg2_transform",
    "stg2_source_table", "stg2_source_column", "stg2_type", "stg2_length",
    "stg2_precision", "stg2_to_dwh_transform",
    "lineage_status", "lineage_status_detail",
)


@router.get("/fields")
def fields(table: str):
    """All fields for a table, each with its lineage chain + a variance verdict.

    legacy_lineage grain is (target column x source): one DWH column can source
    from several files, so the raw rows repeat the column (this is why the tree
    used to show ACCOUNT_LONG_NAME_1 five times). Here the grain rows are
    GROUPED into ONE field row per (dwh_target_column, is_ud/ud_key):
      - the primary chain = the first *mapped* grain row (else the first row),
      - dwh_type/length/precision are coalesced across the group (only some
        grain rows carry them),
      - the remaining chains are attached as `alt_sources`,
      - `source_count` = number of distinct source chains.
    Response stays backward compatible — same keys as before, plus the two new
    ones. UD attributes remain separate rows (is_ud='Y')."""
    lin = _safe("""
        SELECT lineage_id, dwh_target_table, dwh_target_column, dwh_type, dwh_length, dwh_precision,
               stg2_source_table, stg2_source_column, stg2_to_dwh_transform, stg2_type, stg2_length, stg2_precision,
               stg1_source_table, stg1_source_column, stg1_type, stg1_length, stg1_precision,
               src_source_table, src_source_column, src_to_stg1_transform, stg1_to_stg2_transform,
               lineage_status, lineage_status_detail, is_ud, ud_key
        FROM legacy_lineage
        WHERE dwh_target_table = :t
        ORDER BY is_ud, dwh_target_column,
                 CASE WHEN LOWER(lineage_status) = 'mapped' THEN 0 ELSE 1 END,
                 src_source_table NULLS LAST, src_source_column NULLS LAST""",
        {"t": table})

    # pull all proof rows for this table once, group by field
    proof = _safe("""
        SELECT field_name, stage, field_value, is_ud, ud_key
        FROM legacy_proof
        WHERE proof_table = :t
        ORDER BY field_name, stage""", {"t": table})
    by_field = {}
    for p in proof:
        by_field.setdefault(p["field_name"], []).append(p)

    # ---- group grain rows -> one field row per column ----
    grouped: dict[tuple, dict] = {}
    order: list[tuple] = []
    for f in lin:
        key = (f.get("is_ud") or "N", f.get("ud_key") or "", f["dwh_target_column"])
        g = grouped.get(key)
        if g is None:
            g = dict(f)                      # first (best-ranked) row = primary chain
            g["alt_sources"] = []
            grouped[key] = g
            order.append(key)
        else:
            # coalesce DWH metadata: only some grain rows carry type/len/precision
            for meta in ("dwh_type", "dwh_length", "dwh_precision"):
                if not g.get(meta) and f.get(meta):
                    g[meta] = f[meta]
            # a mapped chain always beats an unmapped primary
            if (str(g.get("lineage_status") or "").lower() != "mapped"
                    and str(f.get("lineage_status") or "").lower() == "mapped"):
                g["alt_sources"].append({k: g.get(k) for k in _CHAIN_KEYS})
                for k in _CHAIN_KEYS:
                    g[k] = f.get(k)
            else:
                g["alt_sources"].append({k: f.get(k) for k in _CHAIN_KEYS})

    out = []
    for key in order:
        g = grouped[key]
        col = g["dwh_target_column"]
        pr = by_field.get(col, [])
        status, detail = _variance(pr)
        g["variance_status"] = status
        g["variance_detail"] = detail
        g["proof"] = pr
        g["source_count"] = 1 + len(g["alt_sources"])
        out.append(g)
    return {"table": table, "fields": out}


@router.get("/proof")
def proof(table: str, field: str):
    """Per-stage proof/variance for one field (used when a field is expanded)."""
    rows = _safe("""
        SELECT stage, field_value, is_ud, ud_key
        FROM legacy_proof
        WHERE proof_table = :t AND field_name = :f
        ORDER BY CASE stage WHEN 'SRC' THEN 0 WHEN 'STG1' THEN 1
                            WHEN 'STG2' THEN 2 WHEN 'DWH' THEN 3 ELSE 4 END""",
        {"t": table, "f": field})
    status, detail = _variance(rows)
    return {"table": table, "field": field, "stages": rows,
            "variance_status": status, "variance_detail": detail}


@router.get("/groups")
def groups():
    """Functional groups across the DWH lineage — drives the group lanes and
    the Lineage-by-Functional-Group view."""
    return {"groups": _safe("""
        SELECT NVL(functional_group, 'Unassigned') AS functional_group,
               COUNT(DISTINCT dwh_target_table) AS table_count,
               COUNT(*) AS field_count
        FROM legacy_lineage
        GROUP BY NVL(functional_group, 'Unassigned')
        ORDER BY COUNT(DISTINCT dwh_target_table) DESC""")}


@router.get("/dependency-network")
def dependency_network(include_excluded: bool = False):
    """Table dependency network derived from legacy_lineage:
    one edge per (src_source_table -> dwh_target_table) with the list of
    contributing source columns. Rows whose transform is 'Not Applicable'
    (or that have no source) mark the edge excluded; pass
    include_excluded=true to receive them (the UI hides them by default)."""
    raw = _safe("""
        SELECT src_source_table, dwh_target_table,
               NVL(functional_group, 'Unassigned') AS tgt_group,
               NVL(table_type, 'TABLE') AS tgt_type,
               src_source_column, src_to_stg1_transform, lineage_status
        FROM legacy_lineage
        WHERE src_source_table IS NOT NULL""")
    edges = {}
    for r in raw:
        key = (r["src_source_table"], r["dwh_target_table"])
        e = edges.setdefault(key, {
            "src": r["src_source_table"], "tgt": r["dwh_target_table"],
            "tgt_group": r["tgt_group"], "tgt_type": r["tgt_type"],
            "columns": [], "excluded": True})
        col = r["src_source_column"] or "N/A"
        if col not in e["columns"]:
            e["columns"].append(col)
        na = ("not applicable" in str(r["src_to_stg1_transform"] or "").lower()
              or (r["lineage_status"] or "") == "unmapped")
        if not na and col != "N/A":
            e["excluded"] = False           # any real mapping un-excludes the edge
    out = [e for e in edges.values() if include_excluded or not e["excluded"]]

    nodes = _safe("""
        SELECT dwh_target_table AS name, 'tgt' AS kind,
               NVL(functional_group, 'Unassigned') AS functional_group,
               NVL(table_type, 'TABLE') AS table_type,
               COUNT(*) AS field_count
        FROM legacy_lineage
        GROUP BY dwh_target_table, NVL(functional_group, 'Unassigned'),
                 NVL(table_type, 'TABLE')""")
    src_nodes = [{"name": s2, "kind": "src", "functional_group": None,
                  "table_type": "SOURCE", "field_count": None}
                 for s2 in sorted({e["src"] for e in out})]
    return {"edges": out, "nodes": nodes + src_nodes}


# ---------------------------------------------------------------------------
# Business definitions (legacy_dictionary) — resolved by normalized field code.
# The SRC column in the lineage (e.g. BI_2_L1) is normalized the same way the
# dictionary stores its code, so the two meet. Added for the standalone Lineage
# page's field-click popup and Datapoint 360 (Non-SEI).
# ---------------------------------------------------------------------------
import re as _re


def _norm_code(code: str) -> str:
    """Canonical join key (mirror of the connector's canonical_code):
    BI/2-1 -> BI_2_1 ; ST.SEC.01 -> ST_SEC_01 ; and the DWH line convention
    BI_2_L1 -> BI_2_1, so both sides of the dictionary join meet."""
    if not code:
        return ""
    c = _re.sub(r"[\s/.\-]+", "_", str(code).strip())
    c = _re.sub(r"_{2,}", "_", c).strip("_").upper()
    return _re.sub(r"_L(\d+)", r"_\1", c)


@router.get("/business-def")
def business_def(code: str, system: str | None = None):
    """Business definition for a (normalized) field code, optionally scoped to a
    source system (ADDVANTAGE / CRD / STAR). `code` may be passed in either the
    authored form (BI/54) or the normalized form (BI_54)."""
    norm = _norm_code(code)
    params = {"c": norm}
    sql = """
        SELECT source_system, field_code, field_code_norm, asset_name, business_term,
               master_name, business_function, data_type, max_length, num_precision,
               date_format, is_required, is_unique, short_desc, long_desc,
               pb_field_mapping, comments_txt, privacy_class, regulatory_class,
               operational_class, status, is_pii
        FROM legacy_dictionary
        WHERE field_code_norm = :c"""
    if system:
        sql += " AND source_system = :s"
        params["s"] = system.upper()
    rows = _safe(sql + " ORDER BY source_system", params)
    return {"code": code, "code_norm": norm, "system": system,
            "definition": rows[0] if rows else None,
            "others": rows[1:] if len(rows) > 1 else []}


@router.get("/systems")
def systems():
    """Legacy source systems present in the dictionary, with counts — drives the
    AddVantage / CRD / STAR badge row on the Lineage page."""
    return {"systems": _safe("""
        SELECT source_system,
               COUNT(*) AS asset_count,
               COUNT(DISTINCT master_name) AS master_count,
               SUM(CASE WHEN is_required = 'Y' THEN 1 ELSE 0 END) AS required_count,
               SUM(CASE WHEN is_pii = 'Y' THEN 1 ELSE 0 END) AS pii_count,
               SUM(CASE WHEN LOWER(status) = 'deprecated' THEN 1 ELSE 0 END) AS deprecated_count
        FROM legacy_dictionary
        GROUP BY source_system ORDER BY source_system""")}


@router.get("/masters")
def masters(system: str):
    """Masters within a system (Account Master, Security Master, ...) with
    field counts — drives grouped browsing of the dictionary."""
    return {"system": system, "masters": _safe("""
        SELECT master_name, COUNT(*) AS field_count,
               SUM(CASE WHEN is_required = 'Y' THEN 1 ELSE 0 END) AS required_count
        FROM legacy_dictionary
        WHERE source_system = :s AND master_name IS NOT NULL
        GROUP BY master_name ORDER BY COUNT(*) DESC""", {"s": system.upper()})}


@router.get("/dictionary-tree")
def dictionary_tree(system: str, q: str | None = None):
    """Masters -> Groups (business_function) -> fields, for the Non-SEI
    'Browse by Master & Group' view in Datapoint 360.

    Grain here is the dictionary's native (code, master) — a field that lives
    in several masters appears under EACH master, which is exactly what a
    master-oriented browse should show. Each field row carries the same
    attributes as the flat /dictionary list so the UI can reuse the same
    definition card. lineage_count comes from the same one-pass canonicalized
    CTE as /dictionary (no correlated subqueries)."""
    params = {"s": system.upper()}
    where = "d.source_system = :s"
    if q:
        where += (" AND (UPPER(d.business_term) LIKE :q OR UPPER(d.field_code) LIKE :q"
                  " OR UPPER(d.field_code_norm) LIKE :q OR UPPER(d.business_function) LIKE :q"
                  " OR UPPER(d.master_name) LIKE :q)")
        params["q"] = f"%{q.upper()}%"
    rows = _safe(f"""
        WITH lin AS (
            SELECT REGEXP_REPLACE(
                       UPPER(TRIM('_' FROM REGEXP_REPLACE(src_source_column,
                             '[[:space:]/.-]+', '_'))),
                       '_L([0-9]+)', '_\\1') AS code_norm,
                   dwh_target_table, dwh_target_column
            FROM legacy_lineage
            WHERE src_source_column IS NOT NULL
        ),
        lin_agg AS (
            SELECT code_norm,
                   COUNT(*) AS lineage_count,
                   MIN(dwh_target_table || '.' || dwh_target_column) AS lineage_target
            FROM lin
            GROUP BY code_norm
        ),
        d1 AS (
            SELECT d.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY d.field_code_norm, NVL(d.master_name, '~')
                       ORDER BY d.updated_at DESC NULLS LAST) rn
            FROM legacy_dictionary d
            WHERE {where}
        )
        SELECT NVL(d.master_name, 'Unassigned')        AS master_name,
               NVL(d.business_function, 'Ungrouped')   AS business_function,
               d.field_code, d.field_code_norm, d.business_term,
               d.data_type, d.max_length, d.num_precision, d.date_format,
               d.is_required, d.is_unique, d.short_desc, d.pb_field_mapping,
               d.privacy_class, d.regulatory_class, d.operational_class,
               d.status, d.is_pii,
               NVL(la.lineage_count, 0) AS lineage_count,
               la.lineage_target
        FROM d1 d
        LEFT JOIN lin_agg la ON la.code_norm = d.field_code_norm
        WHERE d.rn = 1
        ORDER BY NVL(d.master_name, 'Unassigned'),
                 NVL(d.business_function, 'Ungrouped'), d.field_code""", params)

    # ---- rows -> masters[] { groups[] { fields[] } } ----
    masters: dict[str, dict] = {}
    for r in rows:
        m = masters.setdefault(r["master_name"], {
            "master_name": r["master_name"], "field_count": 0,
            "pii_count": 0, "required_count": 0, "_groups": {}})
        g = m["_groups"].setdefault(r["business_function"], {
            "business_function": r["business_function"], "fields": []})
        g["fields"].append(r)
        m["field_count"] += 1
        if r.get("is_pii") == "Y":
            m["pii_count"] += 1
        if r.get("is_required") == "Y":
            m["required_count"] += 1
    out = []
    for m in masters.values():
        m["groups"] = [{"business_function": k,
                        "field_count": len(v["fields"]),
                        "fields": v["fields"]}
                       for k, v in m.pop("_groups").items()]
        out.append(m)
    return {"system": system, "masters": out}


@router.get("/dictionary")
def dictionary(system: str, q: str | None = None, master: str | None = None):
    """Browse/search one system's definitions (Datapoint 360 Non-SEI list).
    Each row carries lineage_count / lineage_target so the UI can offer a
    'View in Lineage' jump only for fields that map into legacy_lineage.

    v3 rewrite — two bugs fixed:
      1. TIMEOUT: v2 ran TWO correlated subqueries per dictionary row, each
         REGEXP_REPLACE-scanning all of legacy_lineage (2,759 rows x 2 full
         scans). The UI's 15s fetch timeout fired and api.js silently fell
         back to mock {definitions: []} -> the tab showed "No definitions"
         while the (fast) /systems chip showed 2,759. Now the lineage side is
         canonicalized ONCE in a CTE and aggregated, then hash-joined.
      2. BACKREFERENCE: the replacement '_\\1' was written '_\1' in the Python
         source — Python parses \1 as chr(1), so Oracle never received the
         backreference and BI_2_L1 never collapsed to BI_2_1 (lineage_count
         was silently wrong even when the query completed).

    Grain: legacy_dictionary is one row per (system, code, master). The list
    is grouped to ONE row per field_code_norm (the UI keys on it) with the
    masters aggregated into master_name + master_count."""
    params = {"s": system.upper()}
    where = "d.source_system = :s"
    if q:
        where += (" AND (UPPER(d.business_term) LIKE :q OR UPPER(d.field_code) LIKE :q"
                  " OR UPPER(d.field_code_norm) LIKE :q OR UPPER(d.business_function) LIKE :q"
                  " OR UPPER(d.master_name) LIKE :q)")
        params["q"] = f"%{q.upper()}%"
    if master:
        where += " AND d.master_name = :m"
        params["m"] = master
    return {"system": system, "definitions": _safe(f"""
        WITH lin AS (
            SELECT REGEXP_REPLACE(
                       UPPER(TRIM('_' FROM REGEXP_REPLACE(src_source_column,
                             '[[:space:]/.-]+', '_'))),
                       '_L([0-9]+)', '_\\1') AS code_norm,
                   dwh_target_table, dwh_target_column
            FROM legacy_lineage
            WHERE src_source_column IS NOT NULL
        ),
        lin_agg AS (
            SELECT code_norm,
                   COUNT(*) AS lineage_count,
                   MIN(dwh_target_table || '.' || dwh_target_column) AS lineage_target
            FROM lin
            GROUP BY code_norm
        ),
        d1 AS (   -- one row per (code, master): newest wins if the loader
                  -- ever wrote the same key twice
            SELECT d.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY d.field_code_norm, NVL(d.master_name, '~')
                       ORDER BY d.updated_at DESC NULLS LAST) rn
            FROM legacy_dictionary d
            WHERE {where}
        )
        SELECT d.field_code_norm,
               MIN(d.field_code)          AS field_code,
               MAX(d.business_term)       AS business_term,
               LISTAGG(d.master_name, ' · ' ON OVERFLOW TRUNCATE '…')
                   WITHIN GROUP (ORDER BY d.master_name) AS master_name,
               COUNT(d.master_name)       AS master_count,
               MAX(d.business_function)   AS business_function,
               MAX(d.data_type)           AS data_type,
               MAX(d.max_length)          AS max_length,
               MAX(d.num_precision)       AS num_precision,
               MAX(d.date_format)         AS date_format,
               MAX(d.is_required)         AS is_required,
               MAX(d.is_unique)           AS is_unique,
               MAX(d.short_desc)          AS short_desc,
               MAX(d.pb_field_mapping)    AS pb_field_mapping,
               MAX(d.privacy_class)       AS privacy_class,
               MAX(d.regulatory_class)    AS regulatory_class,
               MAX(d.operational_class)   AS operational_class,
               MAX(d.status)              AS status,
               MAX(d.is_pii)              AS is_pii,
               NVL(MAX(la.lineage_count), 0) AS lineage_count,
               MAX(la.lineage_target)     AS lineage_target
        FROM d1 d
        LEFT JOIN lin_agg la ON la.code_norm = d.field_code_norm
        WHERE d.rn = 1
        GROUP BY d.field_code_norm
        ORDER BY MIN(d.master_name) NULLS LAST, d.field_code_norm""", params)}

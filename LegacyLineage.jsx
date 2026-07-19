import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { api } from "./api.js";

// =====================================================================
// LegacyLineage v5 — the Non-SEI lineage engine.
//
// Subview 1 · Lineage by Functional Group — three view modes over the SAME
//   functional-group sections (the grouping is the constant, the mode is
//   the lens):
//     table — the developer drill: tables -> column grid -> expandable
//             chain + alt source chains + proof. Clicking a field name
//             opens the full inline definition panel (dictionary + full
//             lineage journey + proof + where-used).
//     map   — the linkage map: per group, three wired columns
//             (DWH columns -> lineage rows -> dictionary cards) with
//             hover path-highlighting. Click any card -> inline panel.
//     biz   — business passports: plain-language rows per group; expand
//             -> passport (journey with PHYSICALIZED / RENAMED boundary
//             flags, derived origin, cross-master and cross-warehouse
//             jumps).
//
// Subview 2 · Dependency View — swimlanes (SVG wires, hover-dim, pin,
//   metadata rail with column chips -> inline def in the rail) and the
//   Table Explorer (breadcrumbs, upstream/downstream re-centering).
//
// The business-definition POPUP is retired: every definition renders
// inline, in context. Master resolution stays context-aware: clicks pass
// the source file / staging table so /business-def resolves the right
// master's definition ((master + code) identity).
//
// Props:
//   t              bbhTheme
//   system         legacy system (default ADDVANTAGE)
//   dataSource     target warehouse (PBDW / IMDS) — scopes every fetch
//   onDataSource   (ds, loc?) => void — cross-warehouse jumps ask the
//                  wrapper to switch the chip (loc = deep-link target)
//   focus          { table, column } deep-link (search / Datapoint 360)
// =====================================================================

const canon = (c) =>
  c ? String(c).trim().replace(/[\s/.\-]+/g, "_").replace(/_{2,}/g, "_")
        .replace(/^_|_$/g, "").toUpperCase().replace(/_L(\d+)/g, "_$1") : "";

const STAGE_C = { SRC: "#7c3aed", STG1: "#00a3a3", STG2: "#0091bf", DWH: "#0f4775" };
const MASTER_C = {
  "Account Master": "#0f4775", "Master Account Master": "#b5651d",
  "Interested Party Master": "#0b7d7d", "Security Issue Master": "#6d3ac0",
  "Beneficiary Submaster": "#4a7c2f", "Co-fiduciary Submaster": "#8a6d1a",
};
const DS_C = { PBDW: "#0f4775", IMDS: "#0b7d9e" };
const masterColor = (m) => MASTER_C[m] || "#6d3ac0";
const dsColor = (d) => DS_C[(d || "PBDW").toUpperCase()] || "#0f4775";
const isNA = (v) => /not applicable|^n\/a$/i.test(String(v || "").trim());
const isDerived = (def) =>
  /supplied by (the )?system/i.test(String((def && (def.long_desc || def.short_desc)) || ""));

// find the extract-file token so the map view can color by master: MSTR-ACC etc.
const fileToken = (src) => {
  const m = /MSTR[-_]([A-Z]{2,4})/i.exec(String(src || ""));
  return m ? m[1].toUpperCase() : null;
};
const guessMaster = (r) => {
  const tok = fileToken(r.src_source_table) || fileToken(r.stg1_source_table);
  const stg1 = String(r.stg1_source_table || "");
  if (tok === "MAC" || /MASTER_ACCOUNT/i.test(stg1)) return "Master Account Master";
  if (tok === "IPN" || /INTERESTED/i.test(stg1)) return "Interested Party Master";
  if (tok === "SEC" || /SECURITY/i.test(stg1)) return "Security Issue Master";
  if (tok === "BEN") return "Beneficiary Submaster";
  if (tok === "COF") return "Co-fiduciary Submaster";
  return "Account Master";
};

/* ------------------------------------------------------------------ */
/* small shared pieces                                                 */
/* ------------------------------------------------------------------ */

const pillStyle = (bg, fg, extra) => ({
  fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
  background: bg, color: fg, whiteSpace: "nowrap", ...extra });

function VarPill({ t, f }) {
  const v = (f.variance_status || f.variance || "no_data").toLowerCase();
  const m = {
    clean: [t.successBg || "#d0ebd9", t.success || "#159943", "CLEAN"],
    changed: [t.warningBg || "#fae5d3", "#a8560f", "CHANGED"],
    no_data: ["#f0f0f2", "#888", "NO DATA"],
  }[v] || ["#f0f0f2", "#888", (f.variance || "—").toUpperCase()];
  return <span title={f.variance_detail || ""} style={pillStyle(m[0], m[1])}>{m[2]}</span>;
}

// a lineage grain row -> journey stages with boundary flags
function buildStages(row, derived) {
  const st = [];
  if (derived)
    st.push({ stage: "ORIGIN", c: STAGE_C.SRC, col: "derived", tbl: "inside AddVantage",
              derived: true });
  st.push({ stage: "SRC", c: STAGE_C.SRC, col: row.src_source_column || "N/A",
            tbl: row.src_source_table || "—", xfNext: row.src_to_stg1_transform });
  st.push({ stage: "STG1", c: STAGE_C.STG1, col: row.stg1_source_column || "N/A",
            tbl: row.stg1_source_table || "—",
            ty: row.stg1_type ? `${row.stg1_type}${row.stg1_length ? "(" + row.stg1_length + ")" : ""}` : null,
            boundary: row.src_source_column && row.stg1_source_column &&
              row.src_source_column !== row.stg1_source_column &&
              canon(row.src_source_column) === canon(row.stg1_source_column)
              ? ["#efe6fb", "#6d3ac0", "PHYSICALIZED"] : null,
            xfNext: row.stg1_to_stg2_transform });
  st.push({ stage: "STG2", c: STAGE_C.STG2, col: row.stg2_source_column || "N/A",
            tbl: row.stg2_source_table || "—",
            ty: row.stg2_type ? `${row.stg2_type}${row.stg2_length ? "(" + row.stg2_length + ")" : ""}` : null,
            boundary: row.stg1_source_column && row.stg2_source_column &&
              canon(row.stg1_source_column) !== canon(row.stg2_source_column)
              ? ["#fae5d3", "#a8560f", "RENAMED"] : null,
            xfNext: row.stg2_to_dwh_transform });
  st.push({ stage: "DWH", c: STAGE_C.DWH, col: row.dwh_target_column, tbl: row.dwh_target_table,
            ty: row.dwh_type ? `${row.dwh_type}${row.dwh_length ? "(" + row.dwh_length + ")" : ""}` : null });
  return st;
}

function Journey({ t, row, derived, dataSource }) {
  const stages = buildStages(row, derived);
  return (
    <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap", rowGap: 26,
                  padding: "18px 2px 2px" }}>
      {stages.map((s, i) => (
        <React.Fragment key={s.stage + i}>
          {i > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                          justifyContent: "center", minWidth: 30, color: t.muted || "#999",
                          fontSize: 13, flex: "none" }}>
              →
              {stages[i - 1].xfNext && !isNA(stages[i - 1].xfNext) && (
                <span title={stages[i - 1].xfNext}
                  style={{ fontSize: 8.5, color: t.warning || "#e67e22",
                           fontFamily: "Roboto Mono, monospace", maxWidth: 92, textAlign: "center",
                           overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {String(stages[i - 1].xfNext).split("(")[0]}
                </span>)}
            </div>)}
          <div style={{ flex: "1 1 118px", minWidth: 108, maxWidth: 220, position: "relative",
                        padding: "0 5px" }}>
            {s.boundary && (
              <span style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
                             whiteSpace: "nowrap", fontSize: 7.5, fontWeight: 800, padding: "2px 8px",
                             borderRadius: 999, background: s.boundary[0], color: s.boundary[1],
                             zIndex: 1 }}>
                {s.boundary[2]} ▾
              </span>)}
            <div style={{ border: `1.5px solid ${t.panel2 || "#dfe6e9"}`,
                          borderStyle: s.derived ? "dashed" : "solid",
                          borderRadius: 9, background: s.derived ? "#fbf9ff" : "#fff",
                          padding: "8px 11px", height: "100%" }}>
              <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", color: "#fff",
                             padding: "2px 7px", borderRadius: 3, display: "inline-block",
                             background: s.stage === "DWH" ? dsColor(dataSource) : s.c }}>
                {s.stage === "DWH" ? `DWH · ${(dataSource || "PBDW").toUpperCase()}` : s.stage}
              </span>
              <div style={{ fontFamily: "Roboto Mono, monospace", fontSize: 11, fontWeight: 700,
                            color: t.navy || "#10193b", marginTop: 5, wordBreak: "break-all" }}>{s.col}</div>
              <div style={{ fontSize: 8.5, color: t.sub || "#666", marginTop: 2, wordBreak: "break-all" }}>
                {s.tbl}{s.ty ? ` · ${s.ty}` : ""}</div>
              {s.derived && (
                <div style={{ fontSize: 8.5, color: "#7c3aed", marginTop: 4, lineHeight: 1.4 }}>
                  the sheet records transport from SRC onward — this derivation lives only in the
                  dictionary text</div>)}
            </div>
          </div>
        </React.Fragment>))}
    </div>);
}

/* ------------------------------------------------------------------ */
/* InlineDef — the full dictionary + lineage panel (popup retired,     */
/* reborn inline). Used by every field click in every mode + the rail. */
/* ------------------------------------------------------------------ */

function InlineDef({ t, system, dataSource, code, ctx, row, tableName, onDataSource,
                     onJump, compact = false }) {
  const [def, setDef] = useState(null);
  const [others, setOthers] = useState([]);
  const [resolved, setResolved] = useState(null);
  const [used, setUsed] = useState([]);
  const [proof, setProof] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    Promise.all([
      api.legacyBusinessDef(code, system, ctx),
      api.legacyWhereUsed(code),
      row && tableName && row.dwh_target_column
        ? api.legacyLineageProof(tableName, row.dwh_target_column)
        : Promise.resolve({ stages: [] }),
    ]).then(([d, w, p]) => {
      if (dead) return;
      setDef(d.definition); setOthers(d.others || []); setResolved(d.resolved_master);
      setUsed((w && w.locations) || []);
      setProof((p && p.stages) || []);
      setLoading(false);
    }).catch(() => !dead && setLoading(false));
    return () => { dead = true; };
  }, [code, system, dataSource, ctx && ctx.srcTable, tableName, row && row.lineage_id]);

  const mc = def ? masterColor(def.master_name) : (t.accent || "#0f4775");
  const derived = isDerived(def);
  const curDs = (dataSource || "PBDW").toUpperCase();
  const otherWh = used.filter((u) => (u.data_source || "PBDW").toUpperCase() !== curDs);
  const fanOut = used.filter((u) => (u.data_source || "PBDW").toUpperCase() === curDs);
  const kv = { display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, padding: "6px 14px",
               fontSize: 11, borderTop: "1px solid #f0f3f6" };
  const kk = { fontSize: 8.5, fontWeight: 700, textTransform: "uppercase",
               color: t.muted || "#999", paddingTop: 2 };

  if (loading)
    return <div style={{ padding: "14px 16px", fontSize: 11, color: t.muted || "#999" }}>
      Loading definition…</div>;

  return (
    <div style={{ border: `1.5px solid ${t.panel2 || "#dfe6e9"}`, borderLeft: `5px solid ${mc}`,
                  borderRadius: 9, background: "#fbfcfe", margin: "4px 0 12px", overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1.25fr" }}>
        {/* ------- dictionary half ------- */}
        <div style={{ borderRight: compact ? "none" : `1px solid ${t.panel2 || "#dfe6e9"}` }}>
          {!def ? (
            <div style={{ padding: "12px 14px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: t.navy || "#10193b" }}>
                No dictionary entry for{" "}
                <span style={{ fontFamily: "Roboto Mono, monospace" }}>{code}</span></div>
              <div style={{ fontSize: 10.5, color: t.sub || "#666", marginTop: 6, lineHeight: 1.65 }}>
                The lineage row exists, but this source column is not an AddVantage field code —
                the dictionary covers the AddVantage master workbook only. Non-AddVantage sources
                (e.g. CRM / config feeds) get definitions once their own dictionary sheet is
                loaded as an additional system workbook.</div>
            </div>
          ) : (<>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#fff", padding: "7px 14px",
                        background: mc }}>
            {def.master_name || "—"} · {def.field_code}
            <span style={{ float: "right", fontWeight: 400, opacity: 0.85 }}>{system} dictionary</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.navy || "#10193b",
                        padding: "10px 14px 4px" }}>
            {def.business_term || def.asset_name}</div>
          <div style={kv}><span style={kk}>DB field code</span>
            <b style={{ fontFamily: "Roboto Mono, monospace" }}>{def.field_code_norm}
              <i style={{ color: t.muted || "#999" }}> (from {def.field_code})</i></b></div>
          <div style={kv}><span style={kk}>Group</span>
            <b style={{ fontWeight: 400 }}>{def.business_function || "—"}</b></div>
          <div style={kv}><span style={kk}>Data type</span>
            <b style={{ fontFamily: "Roboto Mono, monospace" }}>
              {[def.data_type, def.max_length, def.num_precision, def.date_format]
                .filter(Boolean).join(" · ") || "—"}
              {def.is_required === "Y" ? " · Required" : ""}{def.is_unique === "Y" ? " · Unique" : ""}</b></div>
          <div style={kv}><span style={kk}>Description</span>
            <b style={{ fontWeight: 400, whiteSpace: "pre-line", lineHeight: 1.55 }}>
              {def.long_desc || def.short_desc || "—"}</b></div>
          {derived && (
            <div style={kv}><span style={kk}>Derivation</span>
              <b style={{ fontWeight: 400, color: "#7c3aed" }}>
                ⚡ Derived inside AddVantage (see description) — SEI must reproduce the
                derivation, not just the transport.</b></div>)}
          {def.pb_field_mapping && (
            <div style={kv}><span style={kk}>PB mapping</span>
              <b style={{ fontFamily: "Roboto Mono, monospace" }}>{def.pb_field_mapping}</b></div>)}
          {others.length > 0 && (
            <div style={kv}><span style={kk}>Same code, other masters</span>
              <b style={{ fontWeight: 400 }}>
                {others.map((o) => `${o.master_name || o.source_system}${o.business_term ? " — " + o.business_term : ""}`).join("  ·  ")}
                <i style={{ display: "block", fontSize: 9, color: t.muted || "#999", marginTop: 2 }}>
                  {resolved
                    ? `Shown: ${resolved} — resolved from the source file / staging table (field identity is master + code).`
                    : "No source context — showing the first master."}</i></b></div>)}
        </>)}
        </div>
        {/* ------- lineage half ------- */}
        <div style={{ padding: "10px 14px" }}>
          {row ? (
            <>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                            letterSpacing: 0.4, color: t.sub || "#666" }}>
                Lineage — full chain · {curDs}</div>
              <Journey t={t} row={row} derived={derived} dataSource={curDs} />
              {proof.length > 0 && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                                letterSpacing: 0.4, color: t.sub || "#666", margin: "10px 0 4px" }}>
                    Stage-by-stage proof (sample)</div>
                  <table style={{ borderCollapse: "collapse", fontSize: 11 }}><tbody>
                    <tr>{proof.map((p) => (
                      <th key={p.stage} style={{ textAlign: "left", padding: "2px 16px 2px 0",
                          fontSize: 8, textTransform: "uppercase",
                          color: STAGE_C[p.stage] || (t.muted || "#999") }}>{p.stage}</th>))}</tr>
                    <tr>{proof.map((p) => (
                      <td key={p.stage} style={{ padding: "2px 16px 2px 0",
                          fontFamily: "Roboto Mono, monospace", color: t.navy || "#10193b" }}>
                        {p.field_value == null ? "∅" : String(p.field_value)}</td>))}</tr>
                  </tbody></table>
                </>)}
            </>
          ) : (
            <div style={{ fontSize: 10.5, color: t.muted || "#999", lineHeight: 1.6 }}>
              Definition only — open this field inside a table for its full chain and proof.</div>
          )}
          {fanOut.length > 1 && (
            <div style={{ marginTop: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                             color: t.muted || "#999" }}>Also lands in ({curDs}): </span>
              {fanOut.filter((u) => !row || u.dwh_target_column !== row.dwh_target_column
                                        || u.dwh_target_table !== row.dwh_target_table)
                .slice(0, 6).map((u) => (
                <span key={u.dwh_target_table + u.dwh_target_column}
                  onClick={onJump ? () => onJump(u) : undefined}
                  style={{ fontFamily: "Roboto Mono, monospace", fontSize: 9.5, margin: "2px 4px 0 0",
                           display: "inline-block", padding: "2px 8px", borderRadius: 3,
                           background: "#eef6fb", color: "#0b5e83", border: "1px solid #cfe6f2",
                           cursor: onJump ? "pointer" : "default" }}>
                  {u.dwh_target_table}.{u.dwh_target_column}</span>))}
            </div>)}
          {otherWh.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap",
                          alignItems: "center" }}>
              <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                             color: t.muted || "#999" }}>Same field, other warehouse:</span>
              {otherWh.slice(0, 4).map((u) => (
                <span key={u.data_source + u.dwh_target_table + u.dwh_target_column}
                  onClick={onDataSource
                    ? () => onDataSource(u.data_source,
                        { table: u.dwh_target_table, column: u.dwh_target_column })
                    : undefined}
                  style={{ fontSize: 10, fontWeight: 700, padding: "3px 11px", borderRadius: 12,
                           border: `1.5px solid ${dsColor(u.data_source)}`,
                           color: dsColor(u.data_source),
                           background: "#fff", cursor: onDataSource ? "pointer" : "default" }}>
                  {u.data_source} — {u.dwh_target_table}.{u.dwh_target_column} ↗</span>))}
            </div>)}
        </div>
      </div>
    </div>);
}

/* ------------------------------------------------------------------ */
/* map mode — one wired board per functional group                     */
/* ------------------------------------------------------------------ */

function MapGroup({ t, g, tbs, fieldsBy, ds, system, openDef, onOpenDef, onDataSource }) {
  const boardRef = useRef(null);
  const svgRef = useRef(null);
  const [hot, setHot] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const MORDER = ["Account Master", "Master Account Master", "Interested Party Master",
    "Security Issue Master", "Beneficiary Submaster", "Co-fiduciary Submaster"];
  const rows = tbs.flatMap((tb) => (fieldsBy[tb.table_name] || [])
    .filter((f) => f.src_source_column)
    .map((f) => ({ ...f, _tbl: tb.table_name, _master: guessMaster(f) }))
    .sort((x, y) => (MORDER.indexOf(x._master) - MORDER.indexOf(y._master))
      || String(x.dwh_target_column).localeCompare(String(y.dwh_target_column))));
  const loading = tbs.some((tb) => fieldsBy[tb.table_name] == null);

  const draw = useCallback((hotIdx) => {
    const board = boardRef.current, svg = svgRef.current;
    if (!board || !svg) return;
    const b = board.getBoundingClientRect();
    let out = "";
    rows.forEach((r, k) => {
      if (!showAll && k >= 60) return;
      const d = board.querySelector(`[data-cell="d-${k}"]`);
      const l = board.querySelector(`[data-cell="l-${k}"]`);
      const c = board.querySelector(`[data-cell="c-${k}"]`);
      if (!d || !l || !c) return;
      const color = masterColor(r._master);
      [[d, l], [l, c]].forEach(([a, z]) => {
        const ra = a.getBoundingClientRect(), rz = z.getBoundingClientRect();
        const x1 = ra.right - b.left, y1 = ra.top + ra.height / 2 - b.top;
        const x2 = rz.left - b.left, y2 = rz.top + rz.height / 2 - b.top;
        out += `<path d="M ${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}"
          fill="none" stroke="${color}" stroke-width="${hotIdx === k ? 2.8 : 1.5}"
          opacity="${hotIdx == null ? 0.5 : hotIdx === k ? 0.95 : 0.08}"/>`;
      });
    });
    svg.innerHTML = out;
  }, [rows, showAll, openDef]);

  useLayoutEffect(() => { draw(hot); });
  useEffect(() => {
    const onR = () => draw(hot);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, [draw, hot]);

  if (loading)
    return <div style={{ fontSize: 11, color: t.muted || "#999", padding: 6 }}>Loading group fields…</div>;
  if (!rows.length)
    return <div style={{ fontSize: 11, color: t.muted || "#999", padding: 6 }}>
      No mapped fields in this group for {ds}.</div>;

  const CAP = 60;
  const shown = showAll ? rows : rows.slice(0, CAP);

  const cell = (k, extra) => ({
    background: "#fff", border: `1.5px solid ${t.panel2 || "#dfe6e9"}`, borderRadius: 9,
    padding: "9px 12px", position: "relative", cursor: "pointer", height: "100%",
    transition: "box-shadow .12s, opacity .12s",
    opacity: hot != null && hot !== k ? 0.2 : 1,
    boxShadow: hot === k ? `0 0 0 2.5px ${masterColor(rows[k]._master)}` : "none",
    ...extra });
  const colT = { fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6,
                 color: t.muted || "#999" };
  const defKey = (k) => `${g}:map:${k}`;
  const click = (r, k) => onOpenDef(r, r._tbl, defKey(k));
  const rowGrid = { display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr", gap: 56 };

  return (
    <>
      <div ref={boardRef} style={{ position: "relative" }}>
        <svg ref={svgRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                                   pointerEvents: "none", zIndex: 1 }} />
        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ ...rowGrid, marginBottom: 9 }}>
            <div style={colT}>DWH columns · {ds}</div>
            <div style={colT}>Lineage rows · the master is encoded, not named</div>
            <div style={colT}>Dictionary · key = (Master + Code)</div>
          </div>
          {shown.map((r, k) => {
            const newTbl = k === 0 || shown[k - 1]._tbl !== r._tbl;
            const tok = fileToken(r.src_source_table);
            const file = String(r.src_source_table || "");
            const parts = tok ? file.split(new RegExp(`(MSTR[-_]${tok})`, "i")) : [file];
            const dOpen = openDef && openDef.key === defKey(k);
            return (
              <React.Fragment key={r.lineage_id || k}>
                {newTbl && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9,
                                margin: `${k ? 16 : 0}px 0 9px`, padding: "6px 12px",
                                background: "#f2f6f9", borderRadius: 6,
                                borderLeft: `4px solid ${dsColor(ds)}` }}>
                    <span style={{ fontFamily: "Roboto Mono, monospace", fontSize: 11.5,
                                   fontWeight: 700, color: t.navy || "#10193b" }}>{r._tbl}</span>
                    <span style={{ fontSize: 9.5, color: t.muted || "#999" }}>
                      {rows.filter((x) => x._tbl === r._tbl).length} mapped fields · sorted by master</span>
                  </div>)}
                <div style={{ ...rowGrid, marginBottom: dOpen ? 4 : 11 }}>
                  {/* --- DWH column card --- */}
                  <div data-cell={`d-${k}`} style={cell(k)}
                    onMouseEnter={() => setHot(k)} onMouseLeave={() => setHot(null)}
                    onClick={() => click(r, k)}>
                    <div style={{ fontSize: 9.5, color: t.muted || "#999" }}>
                      {r._tbl} · <b style={{ color: dsColor(ds) }}>{ds}</b></div>
                    <div style={{ fontFamily: "Roboto Mono, monospace", fontSize: 12, fontWeight: 700,
                                  color: t.navy || "#10193b" }}>{r.dwh_target_column}</div>
                    <div style={{ fontSize: 9, color: t.sub || "#666", marginTop: 2 }}>
                      {r.dwh_type || ""}{r.dwh_length ? `(${r.dwh_length})` : ""}
                      {(r.source_count || 1) > 1 ? ` · ${r.source_count} SRC` : ""}</div>
                  </div>
                  {/* --- lineage row card --- */}
                  <div data-cell={`l-${k}`} style={cell(k)}
                    onMouseEnter={() => setHot(k)} onMouseLeave={() => setHot(null)}
                    onClick={() => click(r, k)}>
                    <div style={{ fontFamily: "Roboto Mono, monospace", fontSize: 9.5,
                                  color: t.sub || "#666", wordBreak: "break-all" }}>
                      {parts.map((p, i) =>
                        /MSTR[-_]/i.test(p)
                          ? <b key={i} style={{ padding: "1px 5px", borderRadius: 4, color: "#fff",
                              background: masterColor(r._master) }}>{p}</b>
                          : <span key={i}>{p}</span>)}
                    </div>
                    <div style={{ fontFamily: "Roboto Mono, monospace", fontSize: 9.5,
                                  color: t.sub || "#666", marginTop: 3 }}>
                      {r.stg1_source_table || "—"} · <b style={{ color: masterColor(r._master) }}>
                        {r.stg1_source_column || canon(r.src_source_column)}</b></div>
                    <div style={{ fontSize: 9, marginTop: 5, padding: "4px 8px", borderRadius: 5,
                                  background: "#f2f7fa", color: t.sub || "#666", lineHeight: 1.5 }}>
                      {tok ? <>token <b style={{ fontFamily: "Roboto Mono, monospace" }}>{tok}</b>
                        {" ⇒ "}{r._master} · </> : null}
                      canon(<b style={{ fontFamily: "Roboto Mono, monospace" }}>{r.src_source_column}</b>)
                      {" = "}<b style={{ fontFamily: "Roboto Mono, monospace" }}>
                        {canon(r.src_source_column)}</b>
                      {(r.source_count || 1) > 1
                        ? ` · +${r.source_count - 1} more source file${r.source_count > 2 ? "s" : ""}` : ""}
                    </div>
                    {r.stg1_to_stg2_transform && !isNA(r.stg1_to_stg2_transform) && (
                      <div style={{ fontSize: 8.5, color: t.warning || "#e67e22", marginTop: 3,
                                    fontFamily: "Roboto Mono, monospace" }}>
                        {String(r.stg1_to_stg2_transform).split("(")[0]} at STG1→STG2</div>)}
                  </div>
                  {/* --- dictionary card --- */}
                  <div data-cell={`c-${k}`}
                    style={cell(k, { borderColor: masterColor(r._master), borderWidth: 2, paddingTop: 0 })}
                    onMouseEnter={() => setHot(k)} onMouseLeave={() => setHot(null)}
                    onClick={() => click(r, k)}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", padding: "4px 10px",
                                  borderRadius: "6px 6px 0 0", margin: "0 -12px 7px",
                                  background: masterColor(r._master) }}>
                      {r._master} · {r.src_source_column}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: t.navy || "#10193b" }}>
                      {r.dwh_target_column}</div>
                    <div style={{ fontSize: 9.5, color: t.sub || "#666", marginTop: 2 }}>
                      {dOpen ? "▾ definition open below" : "click for the master-resolved definition"}</div>
                  </div>
                </div>
                {/* --- inline panel, directly under the clicked row --- */}
                {dOpen && (
                  <div style={{ margin: "8px 0 14px" }}>
                    <InlineDef t={t} system={system} dataSource={ds} code={openDef.code}
                      ctx={openDef.ctx} row={openDef.row} tableName={openDef.table}
                      onDataSource={onDataSource} />
                  </div>)}
              </React.Fragment>);
          })}
          {rows.length > CAP && (
            <div onClick={() => setShowAll(!showAll)}
              style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: t.accent || "#0f4775",
                       cursor: "pointer", padding: "8px 0 2px" }}>
              {showAll ? `Show first ${CAP} only` : `Show all ${rows.length} fields ▾`}
            </div>)}
        </div>
      </div>
    </>);
}

/* ------------------------------------------------------------------ */
/* the engine                                                          */
/* ------------------------------------------------------------------ */

export default function LegacyLineage({ t, system = "ADDVANTAGE", dataSource = "PBDW",
                                        onDataSource, focus }) {
  const [tab, setTab] = useState("fg");                 // fg | net
  const [viewMode, setViewMode] = useState("table");    // table | map | biz
  const [tables, setTables] = useState([]);
  const [fieldsBy, setFieldsBy] = useState({});         // table -> field rows | null(loading)
  const [openG, setOpenG] = useState({});
  const [openT, setOpenT] = useState({});
  const [openChain, setOpenChain] = useState(null);     // "TBL:COL" caret expand
  const [openDef, setOpenDef] = useState(null);         // {key, code, ctx, row, table}
  const [q, setQ] = useState("");
  const ds = (dataSource || "PBDW").toUpperCase();

  // ---- load tables whenever the warehouse changes ----
  useEffect(() => {
    let dead = false;
    setTables([]); setFieldsBy({}); setOpenDef(null); setOpenChain(null);
    api.legacyLineageTables(ds).then((d) => !dead && setTables(d.tables || []));
    return () => { dead = true; };
  }, [ds]);

  const ensureFields = useCallback((tbl) => {
    setFieldsBy((m) => {
      if (m[tbl] !== undefined) return m;
      api.legacyLineageFields(tbl, ds).then((d) =>
        setFieldsBy((m2) => ({ ...m2, [tbl]: d.fields || [] })));
      return { ...m, [tbl]: null };
    });
  }, [ds]);

  // ---- group tables by functional_group ----
  const groups = {};
  tables
    .filter((tb) => !q || (tb.table_name || "").toLowerCase().includes(q.toLowerCase()))
    .forEach((tb) => {
      const g = tb.functional_group || "Unassigned";
      (groups[g] = groups[g] || []).push(tb);
    });
  const groupNames = Object.keys(groups);

  // ---- deep-link: focus {table, column} -> table mode, expanded ----
  useEffect(() => {
    if (!focus || !focus.table || !tables.length) return;
    const tb = tables.find((x) => x.table_name === focus.table);
    if (!tb) return;
    setTab("fg"); setViewMode("table");
    setOpenG((m) => ({ ...m, [tb.functional_group || "Unassigned"]: true }));
    setOpenT((m) => ({ ...m, [focus.table]: true }));
    ensureFields(focus.table);
  }, [focus, tables]);

  useEffect(() => {
    if (!focus || !focus.column) return;
    const rows = fieldsBy[focus.table];
    if (!rows) return;
    const f = rows.find((x) => x.dwh_target_column === focus.column);
    if (f && f.src_source_column)
      setOpenDef({ key: `${focus.table}:${focus.column}`, code: f.src_source_column,
                   ctx: { srcTable: f.src_source_table || f.stg1_source_table,
                          dwhTable: focus.table },
                   row: f, table: focus.table });
  }, [focus, fieldsBy]);

  const jumpWarehouse = (targetDs, loc) => { if (onDataSource) onDataSource(targetDs, loc); };

  const openDefFor = (f, tbl, key) =>
    setOpenDef((cur) => cur && cur.key === key ? null
      : { key, code: f.src_source_column,
          ctx: { srcTable: f.src_source_table || f.stg1_source_table, dwhTable: tbl },
          row: f, table: tbl });

  /* ================= FG shell — constant across modes ================= */
  const fgShell = (g, inner) => {
    const tbs = groups[g];
    const open = !!openG[g] || !!q;
    const fieldSum = tbs.reduce((n, tb) => n + (tb.field_count || 0), 0);
    const mappedSum = tbs.reduce((n, tb) => n + (tb.mapped || 0), 0);
    const pct = fieldSum ? Math.round((mappedSum / fieldSum) * 100) : 0;
    return (
      <div key={g} style={{ background: t.panel || "#fff",
                            border: `1px solid ${t.panel2 || "#dfe6e9"}`,
                            borderRadius: 8, marginBottom: 12, overflow: "hidden" }}>
        <div onClick={() => {
              const willOpen = !openG[g];
              setOpenG((m) => ({ ...m, [g]: willOpen }));
              if (willOpen && viewMode !== "table")
                tbs.forEach((tb) => ensureFields(tb.table_name));
            }}
          style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 17px",
                   cursor: "pointer", background: "linear-gradient(to right,#eef3f8,#f7fafc)" }}>
          <span style={{ fontSize: 10, color: t.muted || "#999" }}>{open ? "▾" : "▶"}</span>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: t.navy || "#10193b" }}>{g}</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: t.muted || "#999" }}>
            {tbs.length} table{tbs.length !== 1 ? "s" : ""} · {fieldSum} fields · {pct}% mapped · {ds}</span>
          <span style={{ height: 5, width: 100, background: "#e8edf2", borderRadius: 3,
                         overflow: "hidden" }}>
            <i style={{ display: "block", height: "100%", width: `${pct}%`,
                        background: t.success || "#159943" }} /></span>
        </div>
        {open && <div style={{ padding: "14px 17px" }}>{inner(tbs, g)}</div>}
      </div>);
  };

  /* ================= MODE · table ================= */
  const chainNode = (stage, col, tbl, ty, clickable, onClick) => (
    <div key={stage + (col || "")} onClick={clickable ? onClick : undefined}
      style={{ border: `1.5px solid ${clickable ? "#6d3ac0" : (t.panel2 || "#dfe6e9")}`,
               borderRadius: 8, padding: "7px 10px", minWidth: 140, background: "#fff",
               cursor: clickable ? "pointer" : "default", position: "relative" }}>
      <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", padding: "2px 6px",
                     borderRadius: 3, color: "#fff", background: STAGE_C[stage] || "#888" }}>{stage}</span>
      {clickable && <span style={{ position: "absolute", top: 5, right: 7, fontSize: 7.5,
                     fontWeight: 800, color: "#6d3ac0", background: "#efe6fb", borderRadius: 999,
                     padding: "1px 5px" }}>ⓘ def</span>}
      <div style={{ fontFamily: "Roboto Mono, monospace", fontSize: 11.5, color: t.navy || "#10193b",
                    fontWeight: 600, marginTop: 3 }}>{col || "N/A"}</div>
      <div title={tbl} style={{ fontSize: 9, color: t.sub || "#666", maxWidth: 210,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tbl || "—"}{ty ? ` · ${ty}` : ""}</div>
    </div>);

  const xfArrow = (xf) => (
    <span style={{ fontSize: 9, color: t.warning || "#e67e22",
                   fontFamily: "Roboto Mono, monospace",
                   textAlign: "center", maxWidth: 84, alignSelf: "center" }}>
      →<br />{xf && !isNA(xf) ? String(xf).split("(")[0] : "N/A"}</span>);

  const renderTableMode = (tbs) => tbs.map((tb) => {
    const tbl = tb.table_name;
    const tOpen = !!openT[tbl];
    const rows = fieldsBy[tbl];
    return (
      <div key={tbl} style={{ marginBottom: 8 }}>
        <div onClick={() => { setOpenT((m) => ({ ...m, [tbl]: !tOpen })); if (!tOpen) ensureFields(tbl); }}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
                   cursor: "pointer", background: "#fbfcfe",
                   border: `1px solid ${t.panel2 || "#dfe6e9"}`, borderRadius: 6 }}>
          <span style={{ fontSize: 10, color: t.muted || "#999" }}>{tOpen ? "▾" : "▶"}</span>
          <span style={{ fontFamily: "Roboto Mono, monospace", fontSize: 13, fontWeight: 700,
                         color: t.navy || "#10193b" }}>{tbl}</span>
          <span style={pillStyle(t.infoBg || "#e0f5fd", t.info || "#0091bf")}>
            {(tb.table_type || "TABLE").toUpperCase()}</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: t.muted || "#999" }}>
            {tb.field_count} fields · {tb.mapped} mapped · {tb.ud_count || 0} UD</span>
        </div>
        {tOpen && rows == null && (
          <div style={{ padding: "10px 14px", fontSize: 11, color: t.muted || "#999" }}>
            Loading fields…</div>)}
        {tOpen && Array.isArray(rows) && (
          <div style={{ border: `1px solid ${t.panel2 || "#dfe6e9"}`, borderTop: 0,
                        borderRadius: "0 0 6px 6px", overflow: "hidden" }}>
            <div style={{ display: "grid",
                          gridTemplateColumns: "16px minmax(240px,1fr) 100px 56px 56px 46px 108px",
                          maxWidth: 1150,
                          gap: 10, padding: "6px 14px", background: "#f7f9fa", fontSize: 8.5,
                          fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                          color: t.muted || "#999" }}>
              <span /><span>Field (click for definition + lineage)</span><span>Type</span>
              <span>Len</span><span>Prec</span><span>UD</span><span>Variance</span></div>
            {rows.map((f) => {
              const key = `${tbl}:${f.dwh_target_column}${f.is_ud === "Y" ? ":" + (f.ud_key || "UD") : ""}`;
              const cOpen = openChain === key;
              const dOpen = openDef && openDef.key === key;
              const na = !f.src_source_column && isNA(f.src_to_stg1_transform || f.lineage_status_detail);
              const hasDef = !!f.src_source_column;
              const srcN = f.source_count || 1;
              return (
                <div key={key}>
                  <div style={{ display: "grid",
                                gridTemplateColumns: "16px minmax(240px,1fr) 100px 56px 56px 46px 108px",
                                maxWidth: 1150, gap: 10,
                                alignItems: "center", padding: "8px 14px", fontSize: 12,
                                borderTop: "1px solid #eef1f4",
                                background: dOpen ? "#f6fafc" : undefined }}>
                    <span onClick={() => setOpenChain(cOpen ? null : key)}
                      style={{ cursor: "pointer", color: t.muted || "#999", fontSize: 10 }}>
                      {cOpen ? "▾" : "▶"}</span>
                    <span>
                      <span onClick={hasDef ? () => openDefFor(f, tbl, key) : undefined}
                        title={hasDef ? "Business definition + full lineage (inline)"
                                      : (na ? "No legacy source" : "No source column")}
                        style={{ fontFamily: "Roboto Mono, monospace", fontWeight: 600,
                                 color: hasDef ? (t.accent || "#0f4775") : (t.muted || "#999"),
                                 cursor: hasDef ? "pointer" : "default",
                                 textDecoration: hasDef ? "underline dotted" : "none",
                                 textUnderlineOffset: 3 }}>
                        {f.is_ud === "Y" ? "↳ " : ""}{dOpen ? "▾ " : ""}{f.dwh_target_column}
                      </span>
                      {srcN > 1 && (
                        <span title={`${srcN} source chains feed this column`}
                          style={pillStyle("#eef6fb", "#0b5e83",
                            { marginLeft: 6, border: "1px solid #cfe6f2" })}>{srcN} SRC</span>)}
                    </span>
                    <span style={{ fontFamily: "Roboto Mono, monospace", color: t.sub || "#666",
                                   fontSize: 11 }}>{f.dwh_type || "—"}</span>
                    <span style={{ fontFamily: "Roboto Mono, monospace", color: t.sub || "#666",
                                   fontSize: 11 }}>{f.dwh_length || "—"}</span>
                    <span style={{ fontFamily: "Roboto Mono, monospace", color: t.sub || "#666",
                                   fontSize: 11 }}>{f.dwh_precision || "—"}</span>
                    <span>{f.is_ud === "Y" &&
                      <span style={pillStyle("#efe6fb", "#7c3aed")}>UD</span>}</span>
                    <span>{na ? <span style={pillStyle("#f0f0f2", "#888")}>N/A</span>
                              : <VarPill t={t} f={f} />}</span>
                  </div>
                  {cOpen && (
                    <div style={{ padding: "8px 14px 14px 40px", background: "#fbfdfe",
                                  borderTop: `1px dashed ${t.panel2 || "#dfe6e9"}` }}>
                      {na ? (
                        <div style={{ fontSize: 11.5, color: t.muted || "#999" }}>
                          Not applicable — generated / surrogate column, no legacy source.</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                                        color: t.sub || "#666", margin: "6px 0" }}>
                            Backward lineage — primary chain</div>
                          <div style={{ display: "flex", alignItems: "stretch", gap: 6,
                                        flexWrap: "wrap" }}>
                            {chainNode("SRC", f.src_source_column, f.src_source_table, null,
                              hasDef, () => openDefFor(f, tbl, key))}
                            {xfArrow(f.src_to_stg1_transform)}
                            {chainNode("STG1", f.stg1_source_column, f.stg1_source_table,
                              f.stg1_type && `${f.stg1_type}${f.stg1_length ? "/" + f.stg1_length : ""}`)}
                            {xfArrow(f.stg1_to_stg2_transform)}
                            {chainNode("STG2", f.stg2_source_column, f.stg2_source_table,
                              f.stg2_type && `${f.stg2_type}${f.stg2_length ? "/" + f.stg2_length : ""}`)}
                            {xfArrow(f.stg2_to_dwh_transform)}
                            {chainNode("DWH", f.dwh_target_column, tbl,
                              f.dwh_type && `${f.dwh_type}${f.dwh_length ? "/" + f.dwh_length : ""}`)}
                          </div>
                          {(f.alt_sources || []).length > 0 && (
                            <div style={{ border: `1px dashed ${t.panel2 || "#dfe6e9"}`,
                                          borderRadius: 6, padding: "8px 12px", marginTop: 8,
                                          background: "#fff" }}>
                              <div style={{ fontSize: 9, fontWeight: 700,
                                            textTransform: "uppercase", color: t.sub || "#666",
                                            marginBottom: 4 }}>
                                Additional source chains ({f.alt_sources.length}) — same DWH column,
                                other feed files</div>
                              {f.alt_sources.map((a, i) => (
                                <div key={a.lineage_id || i}
                                  style={{ fontSize: 10.5, fontFamily: "Roboto Mono, monospace",
                                           padding: "2px 0" }}>
                                  · {a.src_source_table || "—"} ·{" "}
                                  <span onClick={a.src_source_column
                                      ? () => setOpenDef({ key, code: a.src_source_column,
                                          ctx: { srcTable: a.src_source_table || a.stg1_source_table,
                                                 dwhTable: tbl },
                                          row: { ...f, ...a }, table: tbl })
                                      : undefined}
                                    style={{ color: "#6d3ac0", cursor: "pointer",
                                             textDecoration: "underline dotted" }}>
                                    {a.src_source_column || "N/A"}</span>
                                  <span style={{ color: t.muted || "#999" }}>
                                    {" "}→ canon {canon(a.src_source_column)}</span>
                                </div>))}
                            </div>)}
                          {(f.proof || []).length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 9, fontWeight: 700,
                                            textTransform: "uppercase", color: t.sub || "#666",
                                            marginBottom: 4 }}>
                                Stage-by-stage proof (sample)</div>
                              <table style={{ borderCollapse: "collapse", fontSize: 11 }}><tbody>
                                <tr>{f.proof.map((p) => (
                                  <th key={p.stage} style={{ textAlign: "left",
                                      padding: "2px 16px 2px 0", fontSize: 8,
                                      textTransform: "uppercase",
                                      color: STAGE_C[p.stage] || (t.muted || "#999") }}>
                                    {p.stage}</th>))}</tr>
                                <tr>{f.proof.map((p) => (
                                  <td key={p.stage} style={{ padding: "2px 16px 2px 0",
                                      fontFamily: "Roboto Mono, monospace",
                                      color: t.navy || "#10193b" }}>
                                    {p.field_value == null ? "∅" : String(p.field_value)}</td>))}</tr>
                              </tbody></table>
                            </div>)}
                        </>)}
                    </div>)}
                  {dOpen && (
                    <div style={{ padding: "0 14px" }}>
                      <InlineDef t={t} system={system} dataSource={ds} code={openDef.code}
                        ctx={openDef.ctx} row={openDef.row} tableName={tbl}
                        onDataSource={jumpWarehouse}
                        onJump={(u) => {
                          setOpenT((m) => ({ ...m, [u.dwh_target_table]: true }));
                          ensureFields(u.dwh_target_table); }} />
                    </div>)}
                </div>);
            })}
          </div>)}
      </div>);
  });

  /* ================= MODE · biz (passports per group) ================= */
  const renderBizMode = (tbs, g) => {
    const rows = tbs.flatMap((tb) => (fieldsBy[tb.table_name] || [])
      .filter((f) => f.src_source_column)
      .map((f) => ({ ...f, _tbl: tb.table_name, _master: guessMaster(f) })));
    const loading = tbs.some((tb) => fieldsBy[tb.table_name] == null);
    if (loading)
      return <div style={{ fontSize: 11, color: t.muted || "#999", padding: 6 }}>
        Loading group fields…</div>;
    if (!rows.length)
      return <div style={{ fontSize: 11, color: t.muted || "#999", padding: 6 }}>
        No mapped fields in this group for {ds}.</div>;
    return rows.map((f, k) => {
      const key = `${g}:biz:${k}`;
      const open = openDef && openDef.key === key;
      const review = String(f.variance_status || f.variance || "").toLowerCase() === "changed";
      return (
        <div key={key}>
          <div onClick={() => openDefFor(f, f._tbl, key)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px",
                     borderTop: k ? "1px solid #eef1f4" : "none", cursor: "pointer",
                     fontSize: 12.5 }}>
            <span style={{ fontFamily: "Roboto Mono, monospace", fontSize: 10.5, fontWeight: 700,
                           color: "#fff", padding: "2px 9px", borderRadius: 4, flex: "none",
                           background: masterColor(f._master) }}>{f.src_source_column}</span>
            <span style={{ fontWeight: 600, color: t.navy || "#10193b" }}>{f.dwh_target_column}</span>
            {review
              ? <span style={pillStyle(t.warningBg || "#fae5d3", "#a8560f",
                  { fontSize: 9.5 })}>⚠ UNDER REVIEW</span>
              : <span style={pillStyle(t.successBg || "#d0ebd9", t.success || "#159943",
                  { fontSize: 9.5 })}>● VERIFIED</span>}
            <span style={{ fontSize: 10, color: t.muted || "#999", marginLeft: "auto" }}>
              {f._master} → {ds} · {f._tbl}.{f.dwh_target_column}</span>
          </div>
          {open && (
            <InlineDef t={t} system={system} dataSource={ds} code={openDef.code} ctx={openDef.ctx}
              row={openDef.row} tableName={openDef.table} onDataSource={jumpWarehouse} />)}
        </div>);
    });
  };

  /* ================= Dependency View ================= */
  const [net, setNet] = useState({ edges: [], nodes: [] });
  const [netMode, setNetModeS] = useState("lanes");
  const [netQ, setNetQ] = useState("");
  const [hop1, setHop1] = useState(true);
  const [showExcl, setShowExcl] = useState(false);
  const [pinned, setPinned] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [xFocus, setXFocus] = useState(null);
  const [xTrail, setXTrail] = useState([]);
  const [railDef, setRailDef] = useState(null);
  const laneBoardRef = useRef(null);
  const laneSvgRef = useRef(null);

  useEffect(() => {
    if (tab !== "net") return;
    api.legacyDependencyNetwork({ include_excluded: showExcl, data_source: ds })
      .then((d) => setNet({ edges: d.edges || [], nodes: d.nodes || [] }));
  }, [tab, showExcl, ds]);

  const visEdges = net.edges.filter((e) => {
    if (!showExcl && e.excluded) return false;
    if (netQ) {
      const hit = (x) => String(x).toLowerCase().includes(netQ.toLowerCase());
      if (hit(e.src) || hit(e.tgt)) return true;
      if (!hop1) return false;
      return net.edges.some((h) => (hit(h.src) || hit(h.tgt)) &&
        [h.src, h.tgt].some((n) => n === e.src || n === e.tgt));
    }
    return true;
  });
  const focusN = pinned || hovered;
  const connectedN = (kind, name) => {
    if (!focusN) return true;
    if (focusN.kind === kind && focusN.name === name) return true;
    return visEdges.some((e) => focusN.kind === "src"
      ? e.src === focusN.name && kind === "tgt" && e.tgt === name
      : e.tgt === focusN.name && kind === "src" && e.src === name);
  };

  const drawLanes = useCallback(() => {
    const board = laneBoardRef.current, svg = laneSvgRef.current;
    if (!board || !svg) return;
    const b = board.getBoundingClientRect();
    let out = "";
    visEdges.forEach((e) => {
      const a = board.querySelector(`[data-node="src:${CSS.escape(e.src)}"]`);
      const c = board.querySelector(`[data-node="tgt:${CSS.escape(e.tgt)}"]`);
      if (!a || !c) return;
      const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect();
      const hot = focusN && ((focusN.kind === "src" && e.src === focusN.name) ||
                             (focusN.kind === "tgt" && e.tgt === focusN.name));
      const dim = focusN && !hot;
      const x1 = ra.right - b.left, y1 = ra.top + ra.height / 2 - b.top;
      const x2 = rc.left - b.left, y2 = rc.top + rc.height / 2 - b.top;
      out += `<path d="M ${x1} ${y1} C ${x1 + 55} ${y1}, ${x2 - 55} ${y2}, ${x2} ${y2}" fill="none"
        stroke="${e.excluded ? "#c9ced6" : hot ? "#0091bf" : "#b9cddd"}"
        stroke-width="${hot ? 2.2 : 1.3}" ${e.excluded ? 'stroke-dasharray="4 4"' : ""}
        opacity="${dim ? 0.12 : hot ? 0.95 : 0.55}"/>`;
      const n = (e.columns || []).filter((x) => x !== "N/A").length;
      if (n && !dim)
        out += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}" font-size="9" font-weight="700"
          text-anchor="middle" fill="${hot ? "#0091bf" : "#7d97ab"}"
          font-family="Consolas,monospace">${n}</text>`;
    });
    svg.innerHTML = out;
  }, [visEdges, focusN]);

  useLayoutEffect(() => { if (tab === "net" && netMode === "lanes") drawLanes(); });
  useEffect(() => {
    const onR = () => drawLanes();
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, [drawLanes]);

  const lanes = {};
  visEdges.forEach((e) => {
    const g = e.tgt_group || "Unassigned";
    const l = (lanes[g] = lanes[g] || { srcs: new Set(), tgts: new Set() });
    l.srcs.add(e.src); l.tgts.add(e.tgt);
  });

  const nrow = (kind, name, extra, handlers) => (
    <div key={kind + name} data-node={`${kind}:${name}`} {...handlers}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 9px", marginBottom: 3,
               borderRadius: 4, cursor: "pointer", fontSize: 10.5, background: "#f8fafb",
               border: `1px solid ${pinned && pinned.kind === kind && pinned.name === name
                 ? (t.hover || "#0091bf") : "transparent"}`,
               opacity: connectedN(kind, name) ? 1 : 0.22, transition: "opacity .15s" }}>
      <span title={name} style={{ fontFamily: "Roboto Mono, monospace", fontWeight: 600,
             color: t.navy || "#10193b", overflow: "hidden", textOverflow: "ellipsis",
             whiteSpace: "nowrap", flex: 1 }}>{name}</span>
      {extra}
    </div>);

  const renderLanes = () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14,
                  alignItems: "start" }}>
      <div ref={laneBoardRef} style={{ position: "relative" }}>
        <svg ref={laneSvgRef} style={{ position: "absolute", inset: 0, width: "100%",
                                       height: "100%", pointerEvents: "none", zIndex: 1 }} />
        <div style={{ position: "relative", zIndex: 2 }}>
          {Object.entries(lanes).map(([g, v]) => (
            <div key={g} style={{ background: "#fff", border: `1px solid ${t.panel2 || "#dfe6e9"}`,
                                  borderRadius: 6, marginBottom: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                            background: "linear-gradient(to right,#eef3f8,#f7fafc)",
                            fontSize: 12.5, fontWeight: 700, color: t.navy || "#10193b" }}>
                {g}
                <span style={{ fontSize: 10, color: t.muted || "#999", fontWeight: 400 }}>
                  {v.srcs.size} sources → {v.tgts.size} targets</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 44,
                            padding: "12px 14px" }}>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase",
                                color: t.muted || "#999", marginBottom: 7 }}>Sources</div>
                  {[...v.srcs].map((s2) => nrow("src", s2, null, {
                    onMouseEnter: () => setHovered({ kind: "src", name: s2 }),
                    onMouseLeave: () => setHovered(null),
                    onClick: () => { setRailDef(null);
                      setPinned(pinned && pinned.name === s2 ? null : { kind: "src", name: s2 }); },
                  }))}
                </div>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase",
                                color: t.muted || "#999", marginBottom: 7 }}>Targets</div>
                  {[...v.tgts].map((s2) => nrow("tgt", s2,
                    <span style={{ fontSize: 9, color: t.accent || "#0f4775",
                                   fontWeight: 700 }}>lineage →</span>, {
                    onMouseEnter: () => setHovered({ kind: "tgt", name: s2 }),
                    onMouseLeave: () => setHovered(null),
                    onClick: () => { setRailDef(null);
                      setPinned(pinned && pinned.name === s2 ? null : { kind: "tgt", name: s2 }); },
                    onDoubleClick: () => { setXFocus(s2); setXTrail([s2]); setNetModeS("explore"); },
                  }))}
                </div>
              </div>
            </div>))}
        </div>
      </div>
      {/* metadata rail */}
      <div style={{ background: "#fff", border: `1px solid ${t.panel2 || "#dfe6e9"}`,
                    borderRadius: 6, overflow: "hidden", position: "sticky", top: 70 }}>
        <div style={{ padding: "10px 14px", background: "#f2f5f7",
                      borderBottom: `1px solid ${t.panel2 || "#dfe6e9"}`, fontSize: 12,
                      fontWeight: 700, color: t.navy || "#10193b", display: "flex", gap: 8 }}>
          {pinned ? <>📌 <span style={{ fontFamily: "Roboto Mono, monospace" }}>{pinned.name}</span>
              <span onClick={() => { setPinned(null); setRailDef(null); }}
                style={{ marginLeft: "auto", cursor: "pointer", color: t.muted || "#999" }}>✕</span></>
            : "Metadata"}
        </div>
        <div style={{ padding: "10px 14px", fontSize: 11, color: t.sub || "#666" }}>
          {!pinned ? (
            <span style={{ lineHeight: 1.7, color: t.muted || "#999" }}>
              Hover a table to trace its connections; click to pin it here for metadata + column
              mappings (click a column chip for its definition, inline). Double-click a target to
              open the Explorer. Numbers on wires = column links.</span>
          ) : (() => {
              const mine = visEdges.filter((e) =>
                pinned.kind === "src" ? e.src === pinned.name : e.tgt === pinned.name);
              const nCols = mine.reduce((n, e) =>
                n + (e.columns || []).filter((c) => c !== "N/A").length, 0);
              return (
                <>
                  <div style={{ lineHeight: 1.8, marginBottom: 8 }}>
                    <b style={{ color: t.navy || "#10193b" }}>Kind:</b>{" "}
                    {pinned.kind === "src" ? "Source" : `Target (${ds})`} ·{" "}
                    <b style={{ color: t.navy || "#10193b" }}>Links:</b> {nCols} columns
                  </div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase",
                                color: t.muted || "#999", marginBottom: 6 }}>Column mappings</div>
                  {mine.map((e) => (
                    <div key={e.src + e.tgt} style={{ marginBottom: 7 }}>
                      <div style={{ fontFamily: "Roboto Mono, monospace", fontSize: 9.5,
                                    color: t.muted || "#999" }}>
                        {pinned.kind === "src" ? `→ ${e.tgt}` : `← ${e.src}`}
                        {e.excluded && <span style={pillStyle("#f0f0f2", "#888",
                          { marginLeft: 5 })}>EXCLUDED</span>}
                      </div>
                      {(e.columns || []).filter((c) => c !== "N/A").map((c) => (
                        <span key={c}
                          onClick={() => setRailDef({ code: c,
                            ctx: { srcTable: e.src, dwhTable: e.tgt } })}
                          style={{ fontFamily: "Roboto Mono, monospace", fontSize: 9.5,
                                   background: "#efe6fb", color: "#6d3ac0",
                                   border: "1px solid #ddc9f5", padding: "2px 7px",
                                   borderRadius: 3, cursor: "pointer", display: "inline-block",
                                   margin: "2px 3px 0 0" }}>{c}</span>))}
                      {!(e.columns || []).filter((c) => c !== "N/A").length && (
                        <span style={{ fontSize: 9.5, color: t.muted || "#999" }}>(N/A)</span>)}
                    </div>))}
                  {pinned.kind === "tgt" && (
                    <span onClick={() => { setXFocus(pinned.name); setXTrail([pinned.name]);
                                           setNetModeS("explore"); }}
                      style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700,
                               padding: "6px 12px", borderRadius: 3, marginTop: 6,
                               background: t.accent || "#0f4775", color: "#fff",
                               cursor: "pointer" }}>Explore from here ⇢</span>)}
                  {railDef && (
                    <div style={{ margin: "10px -8px 0" }}>
                      <InlineDef t={t} system={system} dataSource={ds} code={railDef.code}
                        ctx={railDef.ctx} row={null} tableName={null}
                        onDataSource={jumpWarehouse} compact />
                    </div>)}
                </>);
            })()}
        </div>
      </div>
    </div>);

  const renderExplorer = () => {
    const ups = visEdges.filter((e) => e.tgt === xFocus);
    const downs = visEdges.filter((e) => e.src === xFocus);
    const xrow = (n, e) => (
      <div key={n} onClick={() => { setXFocus(n); setXTrail([...xTrail, n]); }}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 9px",
                 marginBottom: 3, borderRadius: 4, cursor: "pointer", fontSize: 10.5,
                 background: "#f8fafb" }}>
        <span style={{ fontFamily: "Roboto Mono, monospace", fontWeight: 600,
                       color: t.navy || "#10193b", flex: 1, overflow: "hidden",
                       textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n}>{n}</span>
        <span style={{ fontSize: 9, color: t.muted || "#999" }}>
          {(e.columns || []).filter((c) => c !== "N/A").length || "N/A"} cols</span>
      </div>);
    return (
      <div>
        <div style={{ fontSize: 11, fontFamily: "Roboto Mono, monospace",
                      color: t.muted || "#999", marginBottom: 10 }}>
          Path: {xTrail.map((x, i) =>
            i === xTrail.length - 1
              ? <b key={i} style={{ color: t.navy || "#10193b" }}>{x}</b>
              : <span key={i}>
                  <a onClick={() => { setXTrail(xTrail.slice(0, i + 1)); setXFocus(x); }}
                     style={{ color: t.accent || "#0f4775", cursor: "pointer" }}>{x}</a>
                  {" → "}</span>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px 1fr", gap: 14,
                      alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase",
                          color: t.muted || "#999", marginBottom: 7, textAlign: "center" }}>
              Sources feeding {xFocus} ({ups.length})</div>
            {ups.length ? ups.map((e) => xrow(e.src, e))
              : <div style={{ fontSize: 10.5, color: t.muted || "#999", textAlign: "center",
                              border: `1px dashed ${t.panel2 || "#dfe6e9"}`, borderRadius: 8,
                              padding: 14 }}>No upstream in the network</div>}
          </div>
          <div style={{ background: "#fff", border: `2px solid ${t.accent || "#0f4775"}`,
                        borderRadius: 8, padding: 14, textAlign: "center" }}>
            <div style={{ fontFamily: "Roboto Mono, monospace", fontSize: 14, fontWeight: 700,
                          color: t.navy || "#10193b" }}>{xFocus}</div>
            <div style={{ fontSize: 10.5, color: t.sub || "#666", marginTop: 4 }}>
              {ups.length} upstream · {downs.length} downstream · {ds}</div>
            <span onClick={() => {
                setTab("fg"); setViewMode("table");
                const tb = tables.find((x) => x.table_name === xFocus);
                if (tb) {
                  setOpenG((m) => ({ ...m, [tb.functional_group || "Unassigned"]: true }));
                  setOpenT((m) => ({ ...m, [xFocus]: true }));
                  ensureFields(xFocus);
                }
              }}
              style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700,
                       padding: "6px 12px", borderRadius: 3, marginTop: 10,
                       background: t.accent || "#0f4775", color: "#fff",
                       cursor: "pointer" }}>Open in lineage</span>
          </div>
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase",
                          color: t.muted || "#999", marginBottom: 7, textAlign: "center" }}>
              {xFocus} feeds ({downs.length})</div>
            {downs.length ? downs.map((e) => xrow(e.tgt, e))
              : <div style={{ fontSize: 10.5, color: t.muted || "#999", textAlign: "center",
                              border: `1px dashed ${t.panel2 || "#dfe6e9"}`, borderRadius: 8,
                              padding: 14 }}>No downstream in the network</div>}
          </div>
        </div>
      </div>);
  };

  /* ================= render ================= */
  const modeBtn = (k, label, sub) => (
    <button key={k} onClick={() => { setViewMode(k); setOpenDef(null);
        if (k !== "table")
          groupNames.filter((g) => openG[g]).forEach((g) =>
            groups[g].forEach((tb) => ensureFields(tb.table_name))); }}
      style={{ fontSize: 11.5, fontWeight: 700, padding: "7px 16px", cursor: "pointer",
               fontFamily: "inherit",
               borderStyle: "solid",
               borderColor: viewMode === k ? (t.accent || "#0f4775") : (t.panel2 || "#dfe6e9"),
               borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
               borderLeftWidth: k === "table" ? 1 : 0,
               borderRadius: k === "table" ? "3px 0 0 3px" : k === "biz" ? "0 3px 3px 0" : 0,
               background: viewMode === k ? (t.accent || "#0f4775") : "#fff",
               color: viewMode === k ? "#fff" : (t.sub || "#666") }}>
      {label}
      <small style={{ display: "block", fontSize: 8, fontWeight: 400, opacity: 0.75 }}>{sub}</small>
    </button>);

  return (
    <div>
      {/* subview tabs */}
      <div style={{ display: "flex", gap: 8, margin: "0 0 12px",
                    borderBottom: `1px solid ${t.panel2 || "#dfe6e9"}` }}>
        {[["fg", "Lineage by Functional Group"], ["net", "Dependency View"]].map(([k, label]) => (
          <div key={k} onClick={() => setTab(k)}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "9px 16px", cursor: "pointer",
                     color: tab === k ? (t.accent || "#0f4775") : (t.sub || "#666"),
                     marginBottom: -1,
                     borderBottom: `2px solid ${tab === k ? (t.accent || "#0f4775") : "transparent"}` }}>
            {label}</div>))}
      </div>

      {tab === "fg" && (
        <>
          <div style={{ display: "flex", alignItems: "center", margin: "2px 0 14px" }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase",
                           letterSpacing: 0.5, color: t.muted || "#999", marginRight: 10 }}>View</span>
            {modeBtn("table", "Table", "drill · developer")}
            {modeBtn("map", "Linkage Map", "DWH → source → definition")}
            {modeBtn("biz", "Business", "field passports")}
            <input placeholder="Search table…" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ marginLeft: "auto", height: 30,
                       border: `1px solid ${t.panel2 || "#dfe6e9"}`, borderRadius: 3,
                       padding: "0 10px", fontSize: 12, width: 220 }} />
          </div>
          {!tables.length && (
            <div style={{ fontSize: 12, color: t.muted || "#999", padding: 20,
                          textAlign: "center" }}>
              No lineage tables for {ds} — check ingestion for this data source.</div>)}
          {groupNames.map((g) =>
            fgShell(g, (tbs) =>
              viewMode === "table" ? renderTableMode(tbs)
              : viewMode === "map"
                ? <MapGroup t={t} g={g} tbs={tbs} fieldsBy={fieldsBy} ds={ds} system={system}
                    openDef={openDef} onOpenDef={openDefFor} onDataSource={jumpWarehouse} />
              : renderBizMode(tbs, g)))}
        </>)}

      {tab === "net" && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12,
                        flexWrap: "wrap", fontSize: 11, color: t.sub || "#666" }}>
            <span>
              {[["lanes", "Swimlanes"], ["explore", "Table Explorer"]].map(([k, label], i) => (
                <button key={k} onClick={() => setNetModeS(k)}
                  style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 14px",
                           cursor: "pointer", fontFamily: "inherit",
                           borderStyle: "solid",
                           borderColor: netMode === k ? (t.accent || "#0f4775") : (t.panel2 || "#dfe6e9"),
                           borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
                           borderLeftWidth: i ? 0 : 1,
                           borderRadius: i ? "0 3px 3px 0" : "3px 0 0 3px",
                           background: netMode === k ? (t.accent || "#0f4775") : "#fff",
                           color: netMode === k ? "#fff" : (t.sub || "#666") }}>{label}</button>))}
            </span>
            <input placeholder="Filter tables…" value={netQ}
              onChange={(e) => setNetQ(e.target.value)}
              style={{ height: 30, border: `1px solid ${t.panel2 || "#dfe6e9"}`, borderRadius: 3,
                       padding: "0 10px", fontSize: 12, width: 220 }} />
            <label style={{ display: "flex", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={hop1} onChange={(e) => setHop1(e.target.checked)} />
              1-hop neighbors</label>
            <label style={{ display: "flex", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={showExcl}
                onChange={(e) => setShowExcl(e.target.checked)} />
              show excluded</label>
            <span style={{ marginLeft: "auto" }}>{visEdges.length} dependencies · {ds}</span>
          </div>
          {netMode === "lanes" ? renderLanes()
            : xFocus ? renderExplorer()
            : <div style={{ fontSize: 12, color: t.muted || "#999", padding: 20,
                            textAlign: "center" }}>
                Double-click a target in Swimlanes (or pin one and "Explore from here") to start.
              </div>}
        </>)}
    </div>);
}

import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from "react";
import { api } from "./api.js";

// Legacy E2E Lineage — the ENGINE (full-featured, from the original component).
// Two views:
//   1) Lineage by Functional Group: group -> table -> column drill-down with the
//      SRC <- STG1 <- STG2 <- DWH backward trace and per-stage proof.
//   2) Dependency view with TWO modes:
//        Swimlanes — one lane per functional group, compact source/target rows,
//                    hover-highlight (dim the rest), click to pin, collapsible
//                    lanes, cross-lane jump chips, and a right rail with
//                    metadata + column mappings.
//        Table Explorer — focus-navigator: pick a table, sources on the left,
//                    consumers on the right, click a neighbor to re-center,
//                    breadcrumb trail to walk back.
//
// Merge-additive props (everything else untouched):
//   onDef(code)  — optional; when present, field names / SRC nodes / rail
//                  column chips become business-definition click targets.
//   focus        — optional {table, column}; drives openLineageAt externally
//                  (search deep-links from the Lineage wrapper).

const STAGE_COLOR = { SRC: "#7c3aed", STG1: "#00a3a3", STG2: "#0091bf", DWH: "#0f4775" };
const isNa = (s) => /not applicable/i.test(s || "");
const realCols = (e) => (e.columns || []).filter((c) => c !== "N/A" && !isNa(c));

export default function LegacyLineage({ t, onDef, focus }) {
  const [subview, setSubview] = useState("lineage");   // 'lineage' | 'network'

  // ---- view 1 state ----
  const [tables, setTables] = useState([]);
  const [groups, setGroups] = useState([]);
  const [openGroup, setOpenGroup] = useState({});
  const [open, setOpen] = useState({});
  const [fieldsByTable, setFieldsByTable] = useState({});
  const [openField, setOpenField] = useState({});
  const [q, setQ] = useState("");
  const [pendingFocus, setPendingFocus] = useState(null);

  // ---- view 2 state ----
  const [net, setNet] = useState({ edges: [], nodes: [] });
  const [netMode, setNetMode] = useState("lanes");     // 'lanes' | 'explore'
  const [showExcl, setShowExcl] = useState(false);
  const [hop1, setHop1] = useState(true);
  const [netFilterInput, setNetFilterInput] = useState("");
  const [pinned, setPinned] = useState(null);          // {kind:'src'|'tgt', name}
  const [hovered, setHovered] = useState(null);
  const [laneCollapsed, setLaneCollapsed] = useState({});
  const [xFocus, setXFocus] = useState(null);
  const [xTrail, setXTrail] = useState([]);

  useEffect(() => {
    api.legacyLineageTables().then((r) => setTables(r.tables || []));
    api.legacyLineageGroups().then((r) => setGroups(r.groups || []));
    api.legacyDependencyNetwork({ include_excluded: true }).then((d) =>
      setNet({ edges: d.edges || [], nodes: d.nodes || [] }));
  }, []);

  /* ======================= shared: deep link into view 1 ======================= */
  const toggleTable = useCallback((name) => {
    setOpen((o) => {
      const willOpen = !o[name];
      if (willOpen && !fieldsByTable[name]) {
        api.legacyLineageFields(name).then((r) =>
          setFieldsByTable((m) => ({ ...m, [name]: r.fields || [] })));
      }
      return { ...o, [name]: willOpen };
    });
  }, [fieldsByTable]);
  const toggleField = (id) => setOpenField((o) => ({ ...o, [id]: !o[id] }));

  const openLineageAt = useCallback((table, column) => {
    const tb = tables.find((x) => x.table_name === table);
    if (tb) setOpenGroup((g) => ({ ...g, [tb.functional_group || "Unassigned"]: true }));
    if (!open[table]) toggleTable(table);
    setPendingFocus({ table, column });
    setSubview("lineage");
  }, [tables, open, toggleTable]);
  useEffect(() => {
    if (!pendingFocus) return;
    const fl = fieldsByTable[pendingFocus.table];
    if (!fl) return;
    const f = fl.find((x) => (x.dwh_target_column || "").toUpperCase() === pendingFocus.column.toUpperCase());
    if (f) setOpenField((o) => ({ ...o, [f.lineage_id]: true }));
    setPendingFocus(null);
  }, [fieldsByTable, pendingFocus]);

  // merge-additive: external deep-link (search / Datapoint 360 jump)
  useEffect(() => {
    if (focus && focus.table && focus.column && tables.length) {
      openLineageAt(focus.table, focus.column);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, tables.length]);

  /* ======================= view 1: lineage by functional group ======================= */
  const varChip = (status, detail) => {
    const map = {
      clean: { bg: "#d0ebd9", c: "#159943", label: "CLEAN" },
      changed: { bg: "#fae5d3", c: "#a8560f", label: "CHANGED" },
      no_data: { bg: "#f0f0f2", c: "#888", label: "NO DATA" },
    };
    const s = map[status] || map.no_data;
    return <span title={detail || ""} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px",
      borderRadius: 999, background: s.bg, color: s.c, whiteSpace: "nowrap" }}>{s.label}</span>;
  };
  const typePill = (ty) => {
    const map = { DIMENSION: ["#e0f5fd", "#0091bf"], FACT: ["#efe6fb", "#7c3aed"],
      REFERENCE: ["#d0ebd9", "#159943"], BRIDGE: ["#fae5d3", "#a8560f"] };
    const [bg, c] = map[(ty || "").toUpperCase()] || ["#f0f0f2", "#777"];
    return <span style={{ fontSize: 8.5, fontWeight: 800, background: bg, color: c,
      padding: "2px 8px", borderRadius: 999 }}>{ty || "TABLE"}</span>;
  };
  const stageNode = (stage, col, tbl, type, clickable) => (
    <div key={stage + col} onClick={clickable && onDef && col && col !== "N/A" ? () => onDef(col) : undefined}
      style={{ border: `1.5px solid ${clickable && onDef ? STAGE_COLOR[stage] : (t.border || "#dfe6e9")}`,
        borderRadius: 8, padding: "8px 11px", minWidth: 150, background: t.panel || "#fff",
        cursor: clickable && onDef && col && col !== "N/A" ? "pointer" : "default", position: "relative" }}>
      <span style={{ fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", padding: "2px 6px",
        borderRadius: 3, color: "#fff", background: STAGE_COLOR[stage] }}>{stage}</span>
      {clickable && onDef && col && col !== "N/A" &&
        <span style={{ position: "absolute", top: 6, right: 8, fontSize: 8, fontWeight: 800,
          color: STAGE_COLOR.SRC }}>ⓘ biz def</span>}
      <div style={{ fontFamily: "monospace", fontSize: 12, color: t.navy, fontWeight: 600, marginTop: 4 }}>
        {col || "—"}</div>
      <div style={{ fontSize: 10, color: t.sub || t.textMuted, maxWidth: 220, overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tbl || ""}>{tbl || ""}</div>
      {type && <div style={{ fontSize: 9, color: t.muted || t.textMuted, fontFamily: "monospace",
        marginTop: 2 }}>{type}</div>}
    </div>
  );
  const arrow = (label) => (
    <span key={"a" + label + Math.random()} style={{ fontSize: 9.5, color: "#e67e22",
      fontFamily: "monospace", textAlign: "center", maxWidth: 96, whiteSpace: "normal" }}>
      →<br />{label && !isNa(label) ? String(label).slice(0, 24) : "N/A"}</span>
  );
  const tp = (f, stage) => {
    const p = (f.proof || []).find((x) => x.stage === stage);
    return p ? (p.sample_value ?? "—") : "—";
  };

  const renderField = (f, tbl) => {
    const openc = !!openField[f.lineage_id];
    const na = isNa(f.src_source_column) || (!f.src_source_column && isNa(f.src_to_stg1_transform));
    return (
      <div key={f.lineage_id} style={{ borderTop: `1px solid ${t.bg || "#eef1f4"}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "16px 1fr 110px 70px 60px 60px 92px",
          gap: 10, alignItems: "center", padding: "9px 15px", fontSize: 12 }}>
          <span onClick={() => toggleField(f.lineage_id)}
            style={{ cursor: "pointer", color: t.muted || t.textMuted, fontSize: 10 }}>
            {openc ? "▾" : "▶"}</span>
          <span onClick={onDef && f.src_source_column && !na ? () => onDef(f.src_source_column) : undefined}
            title={onDef && !na ? "Show business definition" : (na ? "Not applicable — no legacy source" : "")}
            style={{ fontFamily: "monospace", fontWeight: 600,
              color: na ? (t.muted || "#999") : t.accent,
              cursor: onDef && f.src_source_column && !na ? "pointer" : "default",
              textDecoration: onDef && f.src_source_column && !na ? "underline dotted" : "none",
              textUnderlineOffset: 3 }}>
            {f.dwh_target_column}
            {(f.source_count || 1) > 1 && <span title={`${f.source_count} source chains feed this column`}
              style={{ fontSize: 8.5, fontWeight: 800, marginLeft: 7, padding: "1px 7px",
                borderRadius: 999, background: "#e0f5fd", color: "#0091bf",
                verticalAlign: "middle" }}>{f.source_count} SRC</span>}</span>
          <span style={{ fontFamily: "monospace", color: t.sub || t.textMuted }}>{f.dwh_type || "—"}</span>
          <span style={{ fontFamily: "monospace", color: t.sub || t.textMuted }}>{f.dwh_length || "—"}</span>
          <span style={{ fontFamily: "monospace", color: t.sub || t.textMuted }}>{f.dwh_precision || "—"}</span>
          <span>{f.is_ud === "Y" && <span style={{ fontSize: 8, fontWeight: 800, background: "#efe6fb",
            color: "#7c3aed", padding: "1px 6px", borderRadius: 3 }}>UD</span>}</span>
          <span>{na
            ? <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                background: "#f0f0f2", color: "#888" }}>N/A</span>
            : varChip(f.variance_status, f.variance_detail)}</span>
        </div>
        {openc && (
          <div style={{ padding: "8px 15px 16px 40px", background: "#fbfdfe",
            borderTop: `1px dashed ${t.border || "#dfe6e9"}` }}>
            {na ? (
              <div style={{ fontSize: 11.5, color: t.muted || t.textMuted, padding: "8px 0" }}>
                Not applicable — this DWH column has no legacy source
                (generated / surrogate / defaulted at load).</div>
            ) : (
              <>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                  color: t.sub || t.textMuted, letterSpacing: ".4px", margin: "6px 0 8px" }}>
                  Backward lineage{onDef ? " — click the field name or SRC node for the business definition" : ""}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {stageNode("SRC", f.src_source_column, f.src_source_table, null, true)}
                  {arrow(f.src_to_stg1_transform)}
                  {stageNode("STG1", f.stg1_source_column, f.stg1_source_table, f.stg1_type)}
                  {arrow(f.stg1_to_stg2_transform)}
                  {stageNode("STG2", f.stg2_source_column, f.stg2_source_table, f.stg2_type)}
                  {arrow(f.stg2_to_dwh_transform)}
                  {stageNode("DWH", f.dwh_target_column, tbl, f.dwh_type)}
                </div>
                {(f.alt_sources || []).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                      color: t.sub || t.textMuted, letterSpacing: ".4px", marginBottom: 6 }}>
                      Additional source chains ({f.alt_sources.length}) — the same DWH column
                      is fed from more than one file</div>
                    {f.alt_sources.map((a) => (
                      <div key={a.lineage_id} style={{ display: "flex", alignItems: "center",
                        gap: 6, flexWrap: "wrap", marginBottom: 8, opacity: .85 }}>
                        {stageNode("SRC", a.src_source_column, a.src_source_table, null, true)}
                        {arrow(a.src_to_stg1_transform)}
                        {stageNode("STG1", a.stg1_source_column, a.stg1_source_table, a.stg1_type)}
                        {arrow(a.stg1_to_stg2_transform)}
                        {stageNode("STG2", a.stg2_source_column, a.stg2_source_table, a.stg2_type)}
                        {arrow(a.stg2_to_dwh_transform)}
                      </div>))}
                  </div>
                )}
                {(f.proof || []).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                      color: t.sub || t.textMuted, letterSpacing: ".4px", marginBottom: 6 }}>
                      Stage-by-stage proof (sample values)</div>
                    <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
                      <thead><tr>
                        {["SRC", "STG1", "STG2", "DWH"].map((s) => (
                          <th key={s} style={{ textAlign: "left", padding: "4px 14px 4px 0",
                            fontSize: 8.5, color: STAGE_COLOR[s], textTransform: "uppercase" }}>{s}</th>))}
                      </tr></thead>
                      <tbody><tr>
                        {["SRC", "STG1", "STG2", "DWH"].map((s) => (
                          <td key={s} style={{ padding: "4px 14px 4px 0", fontFamily: "monospace",
                            color: t.navy }}>{tp(f, s)}</td>))}
                      </tr></tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const groupedTables = useMemo(() => {
    const g = {};
    tables
      .filter((tb) => !q.trim() || tb.table_name.toLowerCase().includes(q.toLowerCase()))
      .forEach((tb) => {
        const key = tb.functional_group || "Unassigned";
        (g[key] = g[key] || []).push(tb);
      });
    return g;
  }, [tables, q]);

  const renderLineageView = () => (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search table…"
          style={inputStyle(t)} />
      </div>
      {Object.entries(groupedTables).map(([grp, tbs]) => {
        const gOpen = openGroup[grp] !== false && (openGroup[grp] || Object.keys(groupedTables)[0] === grp);
        return (
          <div key={grp} style={{ background: t.panel, border: `1px solid ${t.border || "#dfe6e9"}`,
            borderRadius: 6, marginBottom: 10, overflow: "hidden" }}>
            <div onClick={() => setOpenGroup((g) => ({ ...g, [grp]: !gOpen }))}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
                cursor: "pointer", background: "linear-gradient(to right,#eef3f8,#f7fafc)" }}>
              <span style={{ color: t.muted || t.textMuted, fontSize: 10 }}>{gOpen ? "▾" : "▶"}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: t.navy }}>{grp}</span>
              <span style={{ fontSize: 10.5, color: t.muted || t.textMuted }}>
                · {tbs.length} table{tbs.length > 1 ? "s" : ""}</span>
            </div>
            {gOpen && tbs.map((tb) => (
              <div key={tb.table_name} style={{ borderTop: `1px solid ${t.bg || "#eef1f4"}` }}>
                <div onClick={() => toggleTable(tb.table_name)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px 9px 30px",
                    cursor: "pointer", background: "#fbfcfe" }}>
                  <span style={{ color: t.muted || t.textMuted, fontSize: 10 }}>
                    {open[tb.table_name] ? "▾" : "▶"}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700,
                    color: t.navy }}>{tb.table_name}</span>
                  {typePill(tb.table_type)}
                  <span style={{ marginLeft: "auto", fontSize: 10.5, color: t.muted || t.textMuted }}>
                    {tb.field_count} fields · {tb.mapped} mapped</span>
                </div>
                {open[tb.table_name] && (
                  <div>
                    <div style={{ display: "grid",
                      gridTemplateColumns: "16px 1fr 110px 70px 60px 60px 92px", gap: 10,
                      padding: "6px 15px", background: "#f7f9fa", fontSize: 8.5, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: ".4px",
                      color: t.muted || t.textMuted }}>
                      <span></span><span>Field{onDef ? " (click for business def)" : ""}</span>
                      <span>DWH Type</span><span>Length</span><span>Precision</span>
                      <span>UD</span><span>Variance</span>
                    </div>
                    {(fieldsByTable[tb.table_name] || []).map((f) => renderField(f, tb.table_name))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );

  /* ======================= view 2: shared network model ======================= */
  const allNetTables = useMemo(() => {
    const s = new Set();
    net.edges.forEach((e) => { s.add(e.src); s.add(e.tgt); });
    return [...s].sort();
  }, [net.edges]);

  const netFilter = netFilterInput.trim().toLowerCase();
  const visEdges = useMemo(() => net.edges.filter((e) => {
    if (!showExcl && e.excluded) return false;
    if (netFilter && !(e.src.toLowerCase().includes(netFilter) ||
      e.tgt.toLowerCase().includes(netFilter))) {
      if (!hop1) return false;
      // 1-hop: keep edges touching any table that itself matches
      const touches = net.edges.some((x) =>
        (x.src.toLowerCase().includes(netFilter) || x.tgt.toLowerCase().includes(netFilter)) &&
        (x.src === e.src || x.src === e.tgt || x.tgt === e.src || x.tgt === e.tgt));
      if (!touches) return false;
    }
    return true;
  }), [net.edges, showExcl, netFilter, hop1]);

  const focusNode = pinned || hovered;
  const connSet = useMemo(() => {
    if (!focusNode) return null;
    const s = new Set([focusNode.kind + ":" + focusNode.name]);
    visEdges.forEach((e) => {
      if (focusNode.kind === "src" && e.src === focusNode.name) s.add("tgt:" + e.tgt);
      if (focusNode.kind === "tgt" && e.tgt === focusNode.name) s.add("src:" + e.src);
    });
    return s;
  }, [focusNode, visEdges]);
  const edgeHot = (e) => !focusNode ||
    (focusNode.kind === "src" ? e.src === focusNode.name : e.tgt === focusNode.name);
  const pinNode = (kind, name) =>
    setPinned((p) => (p && p.kind === kind && p.name === name ? null : { kind, name }));

  const exploreFrom = (name) => { setXFocus(name); setXTrail([name]); setNetMode("explore"); setSubview("network"); };
  const xGo = (name) => { setXFocus(name); setXTrail((tr) => [...tr, name]); };
  const xCrumb = (i) => { setXTrail((tr) => tr.slice(0, i + 1)); setXFocus(xTrail[i]); };
  const jumpLane = (grp) => {
    setLaneCollapsed((c) => ({ ...c, [grp]: false }));
    const el = document.getElementById("lane-" + grp.replace(/\W+/g, "_"));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ======================= view 2: wires ======================= */
  const boardRef = useRef(null);
  const [wires, setWires] = useState([]);
  const measureWires = useCallback(() => {
    const board = boardRef.current;
    if (!board || netMode !== "lanes") { setWires([]); return; }
    const brect = board.getBoundingClientRect();
    const ws = [];
    visEdges.forEach((e, i) => {
      if (!edgeHot(e)) return;
      const a = document.getElementById("nsrc-" + e.src.replace(/\W+/g, "_"));
      const b = document.getElementById("ntgt-" + e.tgt.replace(/\W+/g, "_"));
      if (!a || !b) return;
      const ar = a.getBoundingClientRect(), br2 = b.getBoundingClientRect();
      ws.push({ i, x1: ar.right - brect.left, y1: ar.top + ar.height / 2 - brect.top,
        x2: br2.left - brect.left, y2: br2.top + br2.height / 2 - brect.top,
        excluded: !!e.excluded, hot: !!focusNode });
    });
    setWires(ws);
  }, [visEdges, netMode, focusNode]);   // eslint-disable-line
  useLayoutEffect(() => { measureWires(); }, [measureWires, laneCollapsed, netFilterInput, showExcl]);
  useEffect(() => {
    window.addEventListener("resize", measureWires);
    return () => window.removeEventListener("resize", measureWires);
  }, [measureWires]);

  const wireSvg = (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
      pointerEvents: "none", zIndex: 1 }}>
      {wires.map((w) => (
        <path key={w.i}
          d={`M ${w.x1} ${w.y1} C ${w.x1 + 60} ${w.y1}, ${w.x2 - 60} ${w.y2}, ${w.x2} ${w.y2}`}
          fill="none"
          stroke={w.excluded ? "#c9ced6" : (w.hot ? "#0091bf" : "#b9cddd")}
          strokeWidth={w.hot ? 2 : 1.2}
          strokeDasharray={w.excluded ? "4 4" : "none"}
          opacity={w.hot ? 0.95 : 0.55} />
      ))}
    </svg>
  );

  /* ======================= view 2a: swimlanes ======================= */
  const lanes = useMemo(() => {
    const m = {};
    (groups.length ? groups.map((g) => g.functional_group || g) : ["Unassigned"]).forEach((g) => { m[g] = { srcs: new Set(), tgts: new Set() }; });
    visEdges.forEach((e) => {
      const g = e.tgt_group || "Unassigned";
      if (!m[g]) m[g] = { srcs: new Set(), tgts: new Set() };
      m[g].srcs.add(e.src); m[g].tgts.add(e.tgt);
    });
    return Object.entries(m).filter(([, v]) => v.srcs.size || v.tgts.size);
  }, [groups, visEdges]);

  const dimmed = (kind, name) => connSet && !connSet.has(kind + ":" + name);

  const renderLanes = () => (
    <div ref={boardRef} style={{ position: "relative" }}>
      {wireSvg}
      {lanes.map(([grp, v]) => {
        const collapsed = !!laneCollapsed[grp];
        return (
          <div key={grp} id={"lane-" + grp.replace(/\W+/g, "_")}
            style={{ background: t.panel, border: `1px solid ${t.border || "#dfe6e9"}`,
              borderRadius: 6, marginBottom: 10, overflow: "hidden", position: "relative", zIndex: 2 }}>
            <div onClick={() => setLaneCollapsed((c) => ({ ...c, [grp]: !collapsed }))}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                cursor: "pointer", background: "linear-gradient(to right,#eef3f8,#f7fafc)" }}>
              <span style={{ fontSize: 10, color: t.muted || t.textMuted }}>{collapsed ? "▶" : "▾"}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.navy }}>{grp}</span>
              <span style={{ fontSize: 10, color: t.muted || t.textMuted }}>
                {v.srcs.size} sources → {v.tgts.size} targets</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                {lanes.filter(([g2]) => g2 !== grp).slice(0, 4).map(([g2]) => (
                  <span key={g2} onClick={(ev) => { ev.stopPropagation(); jumpLane(g2); }}
                    style={xchipStyle(t)}>{g2.length > 14 ? g2.slice(0, 13) + "…" : g2} ↗</span>))}
              </span>
            </div>
            {!collapsed && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, padding: 14 }}>
                <div>
                  <div style={zoneTitle(t)}>Sources</div>
                  {[...v.srcs].sort().map((s) => (
                    <div key={s} id={"nsrc-" + s.replace(/\W+/g, "_")}
                      onMouseEnter={() => setHovered({ kind: "src", name: s })}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => pinNode("src", s)}
                      style={nodeRowStyle(t, { dim: dimmed("src", s),
                        pin: pinned && pinned.kind === "src" && pinned.name === s })}>
                      <span style={nodeNameStyle(t)} title={s}>{s}</span>
                      {pinned && pinned.kind === "src" && pinned.name === s &&
                        <span style={{ fontSize: 8, color: "#0091bf", fontWeight: 800 }}>📌</span>}
                    </div>))}
                  {!v.srcs.size && <div style={emptySideStyle(t)}>no sources</div>}
                </div>
                <div>
                  <div style={zoneTitle(t)}>Targets</div>
                  {[...v.tgts].sort().map((s) => (
                    <div key={s} id={"ntgt-" + s.replace(/\W+/g, "_")}
                      onMouseEnter={() => setHovered({ kind: "tgt", name: s })}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => pinNode("tgt", s)}
                      onDoubleClick={() => exploreFrom(s)}
                      style={nodeRowStyle(t, { dim: dimmed("tgt", s),
                        pin: pinned && pinned.kind === "tgt" && pinned.name === s })}>
                      <span style={nodeNameStyle(t)} title={s}>{s}</span>
                      <span onClick={(ev) => { ev.stopPropagation(); openLineageAt(s, ""); }}
                        title="Open in lineage" style={{ fontSize: 9, color: t.accent,
                          cursor: "pointer", fontWeight: 700 }}>lineage →</span>
                    </div>))}
                  {!v.tgts.size && <div style={emptySideStyle(t)}>no targets</div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /* ======================= view 2b: table explorer ======================= */
  const upstream = useMemo(() => !xFocus ? [] :
    [...new Set(visEdges.filter((e) => e.tgt === xFocus).map((e) => e.src))].sort(), [visEdges, xFocus]);
  const downstream = useMemo(() => !xFocus ? [] :
    [...new Set(visEdges.filter((e) => e.src === xFocus).map((e) => e.tgt))].sort(), [visEdges, xFocus]);
  const impact = useMemo(() => {
    if (!xFocus) return { up: 0, down: 0 };
    // transitive closure over the visible edge set
    const walk = (start, dir) => {
      const seen = new Set(); const stack = [start];
      while (stack.length) {
        const n = stack.pop();
        visEdges.forEach((e) => {
          const nb = dir === "up" ? (e.tgt === n ? e.src : null) : (e.src === n ? e.tgt : null);
          if (nb && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
        });
      }
      return seen.size;
    };
    return { up: walk(xFocus, "up"), down: walk(xFocus, "down") };
  }, [visEdges, xFocus]);

  const renderExplorer = () => (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        {xTrail.map((n, i) => (
          <span key={n + i}>
            <span onClick={() => xCrumb(i)} style={{ fontSize: 11, fontWeight: 700, cursor: "pointer",
              color: i === xTrail.length - 1 ? t.navy : t.accent,
              textDecoration: i === xTrail.length - 1 ? "none" : "underline" }}>{n}</span>
            {i < xTrail.length - 1 && <span style={{ color: t.muted || "#999", margin: "0 4px" }}>›</span>}
          </span>))}
        {!xTrail.length && <span style={{ fontSize: 11.5, color: t.muted || "#999" }}>
          Pick a table below (or double-click a target in Swimlanes) to explore.</span>}
      </div>
      {!xFocus && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {allNetTables.filter((n) => !netFilter || n.toLowerCase().includes(netFilter))
            .slice(0, 60).map((n) => (
            <span key={n} onClick={() => exploreFrom(n)} style={xchipStyle(t)}>{n}</span>))}
        </div>
      )}
      {xFocus && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px 1fr", gap: 14, alignItems: "start" }}>
          <div style={zoneStyle(t)}>
            <div style={zoneTitle(t)}>Upstream · sources ({upstream.length}) · impact {impact.up}</div>
            {upstream.map((n) => (
              <div key={n} onClick={() => xGo(n)} style={nodeRowStyle(t, {})}>
                <span style={nodeNameStyle(t)} title={n}>{n}</span>
                <span style={{ fontSize: 10, color: t.muted || "#999" }}>→</span></div>))}
            {!upstream.length && <div style={emptySideStyle(t)}>no upstream</div>}
          </div>
          <div style={{ background: t.panel, border: `2px solid ${t.accent}`, borderRadius: 8,
            padding: 16, textAlign: "center" }}>
            <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: t.navy }}>{xFocus}</div>
            <div style={{ fontSize: 10.5, color: t.sub || "#666", marginTop: 4 }}>
              {upstream.length} direct sources · {downstream.length} direct consumers</div>
            <div style={{ fontSize: 10.5, color: t.sub || "#666", marginTop: 2 }}>
              transitive impact: {impact.up} upstream · {impact.down} downstream</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
              <span onClick={() => openLineageAt(xFocus, "")} style={btn(t)}>Open in lineage</span>
              <span onClick={() => { setPinned({ kind: "tgt", name: xFocus }); setNetMode("lanes"); }}
                style={btn(t, true)}>Pin in swimlanes</span>
            </div>
          </div>
          <div style={zoneStyle(t)}>
            <div style={zoneTitle(t)}>Downstream · consumers ({downstream.length}) · impact {impact.down}</div>
            {downstream.map((n) => (
              <div key={n} onClick={() => xGo(n)} style={nodeRowStyle(t, {})}>
                <span style={nodeNameStyle(t)} title={n}>{n}</span>
                <span style={{ fontSize: 10, color: t.muted || "#999" }}>→</span></div>))}
            {!downstream.length && <div style={emptySideStyle(t)}>no downstream</div>}
          </div>
        </div>
      )}
    </div>
  );

  /* ======================= view 2: right metadata rail ======================= */
  const railEdges = useMemo(() => {
    if (!pinned) return [];
    return visEdges.filter((e) => pinned.kind === "src" ? e.src === pinned.name : e.tgt === pinned.name);
  }, [pinned, visEdges]);
  const railNode = useMemo(() =>
    pinned ? (net.nodes || []).find((n) => n.name === pinned.name) : null, [pinned, net.nodes]);

  const renderRail = () => (
    <div style={{ background: t.panel, border: `1px solid ${t.border || "#dfe6e9"}`,
      borderRadius: 6, overflow: "hidden", position: "sticky", top: 10 }}>
      <div style={{ padding: "10px 14px", background: "#f2f5f7",
        borderBottom: `1px solid ${t.border || "#dfe6e9"}`, fontSize: 12, fontWeight: 700,
        color: t.navy, display: "flex", alignItems: "center", gap: 8 }}>
        {pinned ? <>📌 <span style={{ fontFamily: "monospace" }}>{pinned.name}</span></> : "Metadata"}
        {pinned && <span onClick={() => setPinned(null)} style={{ marginLeft: "auto",
          cursor: "pointer", color: t.muted || "#999" }}>✕</span>}
      </div>
      {!pinned && <div style={{ padding: 16, fontSize: 11.5, color: t.muted || "#999", lineHeight: 1.6 }}>
        Hover a table to highlight its connections; click to pin it here and see its
        metadata and column mappings. Double-click a target to open it in the Explorer.</div>}
      {pinned && (
        <div style={{ padding: "10px 14px" }}>
          {railNode && (
            <div style={{ fontSize: 11, color: t.sub || "#666", lineHeight: 1.7, marginBottom: 10 }}>
              <div><b style={{ color: t.navy }}>Kind:</b> {pinned.kind === "src" ? "Source" : "Target"}</div>
              {railNode.functional_group && <div><b style={{ color: t.navy }}>Group:</b> {railNode.functional_group}</div>}
              {railNode.table_type && <div><b style={{ color: t.navy }}>Type:</b> {railNode.table_type}</div>}
              {railNode.field_count != null && <div><b style={{ color: t.navy }}>Fields:</b> {railNode.field_count}</div>}
            </div>
          )}
          <div style={zoneTitle(t)}>Column mappings ({railEdges.reduce((n, e) => n + realCols(e).length, 0)})</div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {railEdges.map((e, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: t.muted || "#999", fontFamily: "monospace",
                  marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={pinned.kind === "src" ? e.tgt : e.src}>
                  {pinned.kind === "src" ? "→ " + e.tgt : "← " + e.src}
                  {e.excluded && <span style={{ marginLeft: 6, fontSize: 8, color: "#888",
                    background: "#f0f0f2", padding: "1px 5px", borderRadius: 3 }}>EXCLUDED</span>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {realCols(e).map((c) => (
                    <span key={c} onClick={onDef ? () => onDef(c) : undefined}
                      title={onDef ? "Show business definition" : ""}
                      style={colBadgeStyle(t, !!onDef)}>{c}</span>))}
                  {!realCols(e).length && <span style={{ fontSize: 9.5, color: t.muted || "#999" }}>
                    (no column detail — N/A)</span>}
                </div>
              </div>))}
            {!railEdges.length && <div style={emptySideStyle(t)}>no visible connections</div>}
          </div>
          {pinned.kind === "tgt" && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <span onClick={() => openLineageAt(pinned.name, "")} style={btn(t)}>Open in lineage</span>
              <span onClick={() => exploreFrom(pinned.name)} style={btn(t, true)}>Explore</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ======================= main ======================= */
  return (
    <div>
      <div style={{ display: "flex", gap: 8, margin: "0 0 14px", borderBottom: `1px solid ${t.border || "#dfe6e9"}` }}>
        {[["lineage", "Lineage by Functional Group"], ["network", "Dependency View"]].map(([k, label]) => (
          <div key={k} onClick={() => setSubview(k)}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "9px 16px", cursor: "pointer",
              color: subview === k ? t.accent : (t.sub || "#666"), marginBottom: -1,
              borderBottom: `2px solid ${subview === k ? t.accent : "transparent"}` }}>{label}</div>))}
      </div>

      {subview === "lineage" && renderLineageView()}

      {subview === "network" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex" }}>
              {[["lanes", "Swimlanes"], ["explore", "Table Explorer"]].map(([k, label], i) => (
                <button key={k} onClick={() => setNetMode(k)}
                  style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 14px", cursor: "pointer",
                    fontFamily: t.font, border: `1px solid ${netMode === k ? t.accent : (t.border || "#dfe6e9")}`,
                    borderLeft: i === 0 ? undefined : 0,
                    borderRadius: i === 0 ? "3px 0 0 3px" : "0 3px 3px 0",
                    background: netMode === k ? t.accent : t.panel,
                    color: netMode === k ? "#fff" : (t.sub || "#666") }}>{label}</button>))}
            </div>
            <input value={netFilterInput} onChange={(e) => setNetFilterInput(e.target.value)}
              placeholder="Filter tables…" list="net-tables" style={inputStyle(t)} />
            <datalist id="net-tables">
              {allNetTables.slice(0, 200).map((n) => <option key={n} value={n} />)}
            </datalist>
            <label style={{ fontSize: 11, color: t.sub || "#666", display: "flex", gap: 5,
              alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={hop1} onChange={(e) => setHop1(e.target.checked)} />
              1-hop neighbors</label>
            <label style={{ fontSize: 11, color: t.sub || "#666", display: "flex", gap: 5,
              alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={showExcl} onChange={(e) => setShowExcl(e.target.checked)} />
              show excluded</label>
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: t.muted || "#999" }}>
              {visEdges.length} dependencies shown</span>
          </div>
          {netMode === "lanes"
            ? <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, alignItems: "start" }}>
                {renderLanes()}{renderRail()}
              </div>
            : renderExplorer()}
        </div>
      )}
    </div>
  );
}

/* ======================= style helpers ======================= */
const inputStyle = (t) => ({ flex: "0 1 300px", height: 32, border: `1px solid ${t.border || "#dfe6e9"}`,
  borderRadius: 3, padding: "0 10px", fontSize: 12, fontFamily: t.font });
const btn = (t, secondary) => ({ display: "inline-block", fontSize: 10, fontWeight: 700,
  padding: "5px 11px", borderRadius: 3, cursor: "pointer",
  border: `1px solid ${secondary ? (t.border || "#dfe6e9") : t.accent}`,
  background: secondary ? (t.panel || "#fff") : t.accent,
  color: secondary ? t.navy : "#fff" });
const zoneStyle = (t) => ({ background: t.panel, border: `1px solid ${t.border || "#dfe6e9"}`,
  borderRadius: 6, padding: "10px 12px", maxHeight: 480, overflowY: "auto" });
const zoneTitle = (t) => ({ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: ".4px", color: t.sub || "#666", marginBottom: 8 });
const nodeRowStyle = (t, { dim, pin }) => ({ display: "flex", alignItems: "center", gap: 6,
  padding: "5px 9px", marginBottom: 3, borderRadius: 4, cursor: "pointer", fontSize: 11,
  border: `1px solid ${pin ? "#0091bf" : "transparent"}`,
  background: pin ? "#e0f5fd" : "#f8fafb", opacity: dim ? 0.25 : 1,
  transition: "opacity .15s" });
const nodeNameStyle = (t) => ({ fontFamily: "monospace", fontSize: 10.5, color: t.navy,
  fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 });
const xchipStyle = (t) => ({ display: "inline-block", fontSize: 9.5, fontWeight: 700,
  padding: "3px 9px", borderRadius: 10, border: `1px solid ${t.border || "#dfe6e9"}`,
  background: "#fff", color: t.sub || "#666", cursor: "pointer" });
const colBadgeStyle = (t, clickable) => ({ fontFamily: "monospace", fontSize: 9.5,
  background: clickable ? "#efe6fb" : "#f2f5f7", color: clickable ? "#6d3ac0" : (t.sub || "#666"),
  border: "1px solid " + (clickable ? "#ddc9f5" : "#e4eaee"), padding: "2px 7px", borderRadius: 3,
  cursor: clickable ? "pointer" : "default" });
const emptySideStyle = (t) => ({ fontSize: 10.5, color: t.muted || "#999", padding: "6px 2px" });

import React, { useState, useEffect } from "react";
import { SectionHeader } from "./AppShell.jsx";
import { api } from "./api.js";

// =====================================================================
// Datapoint 360 — browse by Inbound / Outbound (parent groups, SEI),
// then drill into data points and see occurrences split by direction.
// Inbound = SWP EOD feeds; Outbound = loaders.
// =====================================================================
export default function Datapoint360({ t, selection, onOpen }) {
  const [groups, setGroups] = useState(null);
  const [direction, setDirection] = useState(null);   // null = all, 'inbound', 'outbound', 'both'
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [piiOnly, setPiiOnly] = useState(false);
  const [sel, setSel] = useState(null);
  const [dpTab, setDpTab] = useState("points");
  const [scope, setScope] = useState("sei");   // sei | nonsei — Non-SEI browses the legacy dictionaries

  useEffect(() => { api.datapointGroups().then(setGroups); }, []);
  useEffect(() => {
    if (selection?.id) api.datapointDetail(selection.id).then((d) => { if (d && d.dp_name_normalized) setSel(d); });
  }, [selection]);
  useEffect(() => {
    api.datapoints({ direction, q, pii_only: piiOnly || undefined }).then((r) => {
      setList(r.datapoints || []);
      if ((r.datapoints || []).length) api.datapointDetail(r.datapoints[0].dp_name_normalized).then(setSel);
      else setSel(null);
    });
  }, [direction, q, piiOnly]);

  const DIR = { inbound: "#0091bf", outbound: "#7c3aed", both: "#159943" };

  return (
    <div>
      <SectionHeader t={t}>Datapoint 360</SectionHeader>
      <p style={{ fontSize: 13, color: t.sub || t.textMuted, margin: "0 0 14px", lineHeight: 1.6, maxWidth: 800 }}>
        <b>Anchored to the SEI feed/loader inventory.</b> The identity and metadata of each data point come from the
        SEI feeds and loaders; reference descriptions (by category) and flows are layered on top.
        Browse by direction — <b>Inbound</b> (SWP EOD feeds) or <b>Outbound</b> (loaders).</p>

      {/* scope: SEI | Non-SEI (legacy AddVantage/CRD/STAR) */}
      <div style={{ display: "flex", margin: "0 0 16px" }}>
        {[["sei", "SEI"], ["nonsei", "Non-SEI"]].map(([k, label]) => (
          <button key={k} onClick={() => setScope(k)} style={{ fontSize: 12, fontWeight: 700,
            padding: "7px 20px", cursor: "pointer", fontFamily: t.font,
            border: `1px solid ${scope === k ? t.accent : t.border}`,
            borderLeft: k === "sei" ? undefined : 0,
            borderRadius: k === "sei" ? "3px 0 0 3px" : "0 3px 3px 0",
            background: scope === k ? t.accent : t.panel,
            color: scope === k ? "#fff" : (t.sub || t.textMuted) }}>{label}</button>))}
      </div>

      {scope === "nonsei" && <LegacyDatapoints t={t} onOpen={onOpen} />}

      {scope === "sei" && <div>
      {/* tabs: Data Points / Browse by Category */}
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${t.border}`, margin: "0 0 18px" }}>
        {[["points", "Data Points"], ["category", "Browse by Category"]].map(([k, label]) => (
          <button key={k} onClick={() => setDpTab(k)} style={{
            background: "none", border: "none", fontSize: 13, fontWeight: 500,
            padding: "10px 18px", cursor: "pointer", fontFamily: t.font,
            color: dpTab === k ? t.accent : (t.sub || t.textMuted),
            borderBottom: `2px solid ${dpTab === k ? t.accent : "transparent"}`,
            marginBottom: -1 }}>{label}</button>))}
      </div>

      {dpTab === "category" && <CategoryBrowser t={t} />}

      {dpTab === "points" && <div>

      {/* parent group cards */}
      <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
        {(groups?.groups || []).map((g) => (
          <button key={g.key} onClick={() => setDirection(direction === g.key ? null : g.key)}
            style={{ flex: "1 1 240px", textAlign: "left", cursor: "pointer", fontFamily: t.font,
              background: direction === g.key ? (t.infoBg || "#e0f5fd") : t.panel,
              border: `1px solid ${direction === g.key ? (DIR[g.key]) : t.border}`,
              borderTop: `4px solid ${DIR[g.key]}`, borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: t.navy }}>{g.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 700, color: DIR[g.key] }}>{g.count}</span>
            </div>
            <div style={{ fontSize: 12, color: t.sub || t.textMuted, marginTop: 4 }}>
              {g.project} project · source: {g.source}</div>
            <div style={{ fontSize: 11, color: t.muted || t.textMuted, marginTop: 6 }}>
              {direction === g.key ? "✓ filtering by this group — click to clear" : "click to browse data points"}</div>
          </button>))}
        {/* shared / both card */}
        {groups && (
          <button onClick={() => setDirection(direction === "both" ? null : "both")}
            style={{ flex: "0 1 180px", textAlign: "left", cursor: "pointer", fontFamily: t.font,
              background: direction === "both" ? (t.infoBg || "#e0f5fd") : t.panel,
              border: `1px solid ${direction === "both" ? DIR.both : t.border}`,
              borderTop: `4px solid ${DIR.both}`, borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.navy }}>Both</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: DIR.both }}>{groups.shared}</div>
            <div style={{ fontSize: 11, color: t.muted || t.textMuted, marginTop: 6 }}>round-tripped fields</div>
          </button>)}
      </div>

      {/* search + filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search attribute / data point…"
          style={{ flex: "0 1 300px", padding: "8px 12px", fontSize: 13, fontFamily: t.font,
            border: `1px solid ${t.border}`, borderRadius: 6 }} />
        <select value={direction || ""} onChange={(e) => setDirection(e.target.value || null)}
          style={{ padding: "8px 12px", fontSize: 13, fontFamily: t.font,
            border: `1px solid ${t.border}`, borderRadius: 6, background: t.panel, color: t.navy }}>
          <option value="">All sources</option>
          <option value="inbound">Inbound feeds only</option>
          <option value="outbound">Outbound (loaders) only</option>
          <option value="both">Round-tripped (both)</option>
        </select>
        <label style={{ fontSize: 12, color: t.sub || t.textMuted, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={piiOnly} onChange={(e) => setPiiOnly(e.target.checked)} /> PII only</label>
        <span style={{ fontSize: 12, color: t.muted || t.textMuted, marginLeft: "auto" }}>
          {direction ? `${direction} · ` : ""}{list.length} data points</span>
      </div>

      {/* list + detail */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 18 }}>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden", maxHeight: 520, overflowY: "auto" }}>
          {list.map((d) => (
            <div key={d.dp_name_normalized}
              onClick={() => api.datapointDetail(d.dp_name_normalized).then(setSel)}
              style={{ padding: "10px 14px", borderBottom: `1px solid ${t.bg}`, cursor: "pointer",
                background: sel?.dp_name_normalized === d.dp_name_normalized ? (t.infoBg || "#e0f5fd") : t.panel,
                borderLeft: sel?.dp_name_normalized === d.dp_name_normalized ? `3px solid ${t.accent}` : "3px solid transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <b style={{ fontSize: 13, color: t.navy }}>{d.dp_display_name || d.dp_name_normalized}</b>
                {d.is_pii === "Y" && <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: "#c1113a", padding: "1px 5px", borderRadius: 3 }}>PII</span>}
                {d.is_key === "Y" && <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: "#5a6472", padding: "1px 5px", borderRadius: 3 }}>KEY</span>}
                <span style={{ marginLeft: "auto", fontSize: 11, color: t.muted || t.textMuted }}>{d.occurrence_count}×</span>
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
                {d.in_inbound === "Y" && <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: DIR.inbound, padding: "1px 5px", borderRadius: 3 }}>IN</span>}
                {d.in_outbound === "Y" && <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: DIR.outbound, padding: "1px 5px", borderRadius: 3 }}>OUT</span>}
                <span style={{ fontSize: 10, color: t.muted || t.textMuted }}>{d.module_count} modules</span>
              </div>
            </div>))}
          {list.length === 0 && <div style={{ padding: 16, color: t.muted || t.textMuted, fontSize: 12 }}>No data points.</div>}
        </div>

        <div>{sel && <DatapointDetail t={t} d={sel} DIR={DIR} />}</div>
      </div>
      </div>}
      </div>}
    </div>
  );
}

function DatapointDetail({ t, d, DIR }) {
  const [refs, setRefs] = useState([]);
  useEffect(() => {
    setRefs([]);
    if (d?.dp_name_normalized)
      api.referenceForDatapoint(d.dp_name_normalized).then((r) => setRefs(r.references || []));
  }, [d?.dp_name_normalized]);
  const bd = d.by_direction || { inbound: [], outbound: [], other: [] };
  const section = (label, color, rows) => rows.length > 0 && (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color }}>{label}</span>
        <span style={{ fontSize: 11, color: t.muted || t.textMuted }}>{rows.length} occurrence{rows.length > 1 ? "s" : ""}</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 6, overflow: "hidden" }}>
        <tbody>{rows.map((o, i) => (
          <tr key={i}>
            <td style={{ padding: "8px 10px", fontSize: 12, borderBottom: `1px solid ${t.bg}` }}>{o.ref_label || o.ref_key}</td>
            <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 11, color: t.muted || t.textMuted, borderBottom: `1px solid ${t.bg}` }}>{o.ref_key}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 8, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: t.navy }}>{d.dp_display_name || d.dp_name_normalized}</div>
        {d.is_pii === "Y" && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#c1113a", padding: "2px 7px", borderRadius: 3 }}>PII</span>}
        {d.is_key === "Y" && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#5a6472", padding: "2px 7px", borderRadius: 3 }}>KEY</span>}
      </div>
      <div style={{ fontSize: 12, color: t.sub || t.textMuted, marginBottom: 4 }}>
        normalized: <code>{d.dp_name_normalized}</code> · {d.occurrence_count} occurrences across {d.module_count} modules</div>
      {d.is_pii === "Y" && d.pii_attribute && (
        <div style={{ fontSize: 12, color: "#c1113a", marginBottom: 14 }}>
          PII: {d.pii_attribute}{d.pii_category ? ` · ${d.pii_category}` : ""}</div>)}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {d.in_inbound === "Y" && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: DIR.inbound, padding: "3px 9px", borderRadius: 4 }}>INBOUND · SWP feeds</span>}
        {d.in_outbound === "Y" && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: DIR.outbound, padding: "3px 9px", borderRadius: 4 }}>OUTBOUND · loaders</span>}
      </div>

      {refs.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px",
            color: t.accent, marginBottom: 8 }}>Reference descriptions (by category)</div>
          <table style={{ width: "100%", borderCollapse: "collapse", background: t.panel,
            border: `1px solid ${t.border}`, borderRadius: 6, overflow: "hidden" }}>
            <tbody>{refs.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                  color: "#fff", borderBottom: `1px solid ${t.bg}` }}>
                  <span style={{ background: "#0091bf", padding: "2px 8px", borderRadius: 10 }}>{r.category || "Uncategorized"}</span></td>
                <td style={{ padding: "8px 10px", fontSize: 12.5, fontWeight: 600, borderBottom: `1px solid ${t.bg}` }}>{r.field_description || r.field_name}</td>
                <td style={{ padding: "8px 10px", fontSize: 11.5, color: t.sub || t.textMuted, borderBottom: `1px solid ${t.bg}` }}>{(r.detail_description || "").slice(0, 220)}</td>
              </tr>))}</tbody>
          </table>
          <div style={{ fontSize: 10.5, color: t.muted || t.textMuted, marginTop: 5 }}>
            The same field can carry a different authoritative description per category — matched on category + field name.</div>
        </div>)}

      {section("Inbound — SWP EOD feeds", DIR.inbound, bd.inbound)}
      {section("Outbound — loaders", DIR.outbound, bd.outbound)}
      {section("Other modules", t.muted || "#9aa3b0", bd.other)}

      {/* Interdependence — co-occurrence (data points sharing a feed/artifact) */}
      {(d.cooccurrence || []).length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: t.datapoint || "#0f4775" }}>
              Interdependence — co-occurrence</span>
            <span style={{ fontSize: 11, color: t.muted || t.textMuted }}>data points that share a feed with this one</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(d.cooccurrence || []).map((c, i) => (
              <div key={i} style={{ background: t.panel2 || "#eef4f7", border: `1px solid ${t.border}`,
                borderRadius: 16, padding: "5px 12px", fontSize: 12, display: "flex", gap: 7, alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", color: t.navy, fontWeight: 600 }}>{c.datapoint}</span>
                <span style={{ fontSize: 10, color: "#fff", background: t.datapoint || "#0f4775",
                  borderRadius: 9, padding: "1px 7px" }}>{c.shared_count} shared</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interdependence — impact (what depends on this data point) */}
      {(d.impact || []).length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#c1113a" }}>
              Interdependence — impact</span>
            <span style={{ fontSize: 11, color: t.muted || t.textMuted }}>artifacts that depend on this data point — change it and these are affected</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 6, overflow: "hidden" }}>
            <tbody>{(d.impact || []).map((im, i) => (
              <tr key={i}>
                <td style={{ padding: "7px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", borderBottom: `1px solid ${t.bg}` }}>
                  <span style={{ color: "#fff", background: MOD_COLOR[im.module] || "#5a6472", padding: "2px 8px", borderRadius: 10 }}>{im.module || "\u2014"}</span></td>
                <td style={{ padding: "7px 10px", fontSize: 12, borderBottom: `1px solid ${t.bg}` }}>{im.artifact}</td>
                <td style={{ padding: "7px 10px", fontSize: 11, color: t.muted || t.textMuted, borderBottom: `1px solid ${t.bg}` }}>{im.direction || ""}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MOD_COLOR = { Inbound: "#0091bf", Outbound: "#7c3aed", API360: "#159943",
  Data360: "#0091bf", Interface: "#b8528a", pii: "#c1113a" };

// ===================================================================
// Browse by Category — reference data grouped by category (SWP EOD
// Reference List). Click a field to jump to its data point.
// ===================================================================
function CategoryBrowser({ t }) {
  const [cats, setCats] = useState([]);
  const [active, setActive] = useState(null);
  const [fields, setFields] = useState([]);

  useEffect(() => {
    api.referenceCategories().then((r) => {
      const list = r.categories || [];
      setCats(list);
      if (list[0]) { setActive(list[0].category); }
    });
  }, []);
  useEffect(() => {
    if (active) api.referenceCategory(active).then((r) => setFields(r.fields || []));
  }, [active]);

  const gaps = fields.filter((f) => f.resolved === "N");

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ width: 280, flexShrink: 0, maxHeight: 560, overflowY: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase",
          color: t.muted || t.textMuted, marginBottom: 8 }}>Categories ({cats.length})</div>
        {cats.map((c) => (
          <button key={c.category || "(none)"} onClick={() => setActive(c.category)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
              marginBottom: 5, cursor: "pointer", fontFamily: t.font,
              border: `1px solid ${active === c.category ? t.accent : t.border}`,
              borderRadius: 6, background: active === c.category ? (t.infoBg || "#e0f5fd") : t.panel }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.navy }}>{c.category || "Uncategorized"}</div>
            <div style={{ fontSize: 11, color: t.sub || t.textMuted, marginTop: 2 }}>
              {c.field_count} fields · {c.resolved_count} resolved</div>
          </button>))}
        {cats.length === 0 && <div style={{ fontSize: 12, color: t.muted || t.textMuted }}>
          No reference categories loaded. Run the reference_data ingestion step.</div>}
      </div>

      <div style={{ flex: 1 }}>
        {active != null && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: t.navy, marginBottom: 2 }}>{active || "Uncategorized"}</div>
            <div style={{ fontSize: 12, color: t.sub || t.textMuted, marginBottom: 12 }}>{fields.length} fields · ordered by position</div>
            <table style={{ width: "100%", borderCollapse: "collapse", background: t.panel,
              border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden" }}>
              <thead><tr>{["Pos", "Field", "Description", "Detail", "Datapoint"].map((h) => (
                <th key={h} style={{ background: t.bgsoft || "#eef3f3", textAlign: "left", padding: "8px 10px",
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: t.accent }}>{h}</th>))}</tr></thead>
              <tbody>{fields.map((f, i) => (
                <tr key={i}>
                  <td style={{ padding: "7px 10px", fontSize: 12 }}>{f.position_order ?? ""}</td>
                  <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>{f.field_name}</td>
                  <td style={{ padding: "7px 10px", fontSize: 12 }}>{f.field_description}</td>
                  <td style={{ padding: "7px 10px", fontSize: 11, color: t.sub || t.textMuted }}>{(f.detail_description || "").slice(0, 140)}</td>
                  <td style={{ padding: "7px 10px" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", padding: "2px 7px", borderRadius: 3,
                      background: f.resolved === "Y" ? "#159943" : "#c1113a" }}>
                      {f.resolved === "Y" ? "resolved" : "unresolved"}</span></td>
                </tr>))}</tbody>
            </table>
            {gaps.length > 0 && (
              <div style={{ marginTop: 14, background: "#fdf3f5", border: "1px solid #f2c3cf",
                borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#c1113a", marginBottom: 4 }}>Reference gaps ({gaps.length})</div>
                <div style={{ fontSize: 12, color: t.sub || "#5a6472", lineHeight: 1.5 }}>
                  These fields are described in the reference list but have no matching data point in the
                  feed/loader inventory — typically lookup enums (valid-value domains) rather than physical fields.</div>
              </div>)}
          </div>)}
      </div>
    </div>
  );
}

// =====================================================================
// Non-SEI data points — the legacy column inventory (AddVantage / CRD /
// STAR business dictionaries). Each data point carries its business
// definition inline; fields that map into legacy_lineage offer a
// "View in Lineage →" jump (onOpen -> {module:'lineage', tab, id}).
// =====================================================================
const LEGACY_SYS = {
  ADDVANTAGE: { c: "#6d3ac0", bg: "#efe6fb", label: "AddVantage" },
  CRD: { c: "#0b7d7d", bg: "#e6f6f6", label: "CRD" },
  STAR: { c: "#b5651d", bg: "#f6ecdf", label: "STAR" },
};
const legacyLabel = (s) => (LEGACY_SYS[s] && LEGACY_SYS[s].label) || s;

const clsPill = (v) => {
  const map = {
    Public: ["#e6f6f6", "#0b7d7d"], Internal: ["#e0f5fd", "#0091bf"],
    Confidential: ["#fae5d3", "#e67e22"], PII: ["#f3d2d7", "#c1113a"],
    Low: ["#e0f5fd", "#0091bf"], Medium: ["#fae5d3", "#e67e22"], High: ["#f3d2d7", "#c1113a"],
    Active: ["#d0ebd9", "#159943"], Deprecated: ["#eee", "#888"],
    Required: ["#fae5d3", "#e67e22"], Unique: ["#e0f5fd", "#0091bf"],
  };
  const [bg, c] = map[v] || ["#f0f0f2", "#777"];
  return v ? <span key={v} style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px",
    borderRadius: 999, background: bg, color: c, marginRight: 5 }}>{v}</span> : null;
};

function LegacyDatapoints({ t, onOpen }) {
  const [systems, setSystems] = useState([]);
  const [curSys, setCurSys] = useState(null);
  const [defs, setDefs] = useState([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);

  useEffect(() => {
    api.legacySystems().then((r) => {
      const sys = r.systems || [];
      setSystems(sys);
      if (sys.length) setCurSys((c) => c || sys[0].source_system);
    });
  }, []);

  useEffect(() => {
    if (!curSys) return;
    api.legacyDictionary(curSys, q || undefined).then((r) => {
      const d = r.definitions || [];
      setDefs(d);
      setSel((prev) => (prev && d.find((x) => x.field_code_norm === prev.field_code_norm)) || d[0] || null);
    });
  }, [curSys, q]);

  const col = LEGACY_SYS[curSys] || { c: t.accent, bg: t.infoBg, label: curSys };
  const [view, setView] = useState("points");   // points | tree (Master & Group browse)

  return (
    <div>
      {/* legacy-system badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 14px",
        background: "#fbfcfe", border: `1px solid ${t.border}`, borderRadius: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px",
          color: t.muted || t.textMuted, marginRight: 4 }}>Legacy system</span>
        {systems.map((s) => {
          const sc = LEGACY_SYS[s.source_system] || { c: t.accent };
          const on = curSys === s.source_system;
          return (
            <span key={s.source_system} onClick={() => setCurSys(s.source_system)}
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700,
                padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                border: `1.5px solid ${on ? sc.c : t.border}`,
                background: on ? sc.c : t.panel, color: on ? "#fff" : (t.sub || t.textMuted) }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: on ? "#fff" : sc.c }} />
              {legacyLabel(s.source_system)}
              <span style={{ fontSize: 9, opacity: .8 }}>{s.asset_count}</span>
            </span>
          );
        })}
        {systems.length === 0 && <span style={{ fontSize: 11, color: t.muted || t.textMuted }}>
          No legacy dictionary loaded — run the <code>legacy_dictionary</code> ingest step.</span>}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: t.muted || t.textMuted }}>
          legacy column inventory · business definitions inline</span>
      </div>

      {/* view tabs: flat data points | grouped by Master & Group */}
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${t.border}`, margin: "0 0 16px" }}>
        {[["points", "Data Points"], ["tree", "Browse by Master & Group"]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} style={{
            background: "none", border: "none", fontSize: 13, fontWeight: 500,
            padding: "10px 18px", cursor: "pointer", fontFamily: t.font,
            color: view === k ? col.c : (t.sub || t.textMuted),
            borderBottom: `2px solid ${view === k ? col.c : "transparent"}`,
            marginBottom: -1 }}>{label}</button>))}
      </div>

      {/* search (shared by both views) */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search attribute / field code…"
          style={{ flex: "0 1 300px", padding: "8px 12px", fontSize: 13, fontFamily: t.font,
            border: `1px solid ${t.border}`, borderRadius: 6 }} />
        {view === "points" && <span style={{ fontSize: 12, color: t.muted || t.textMuted, marginLeft: "auto" }}>
          {legacyLabel(curSys)} · {defs.length} data points</span>}
      </div>

      {view === "tree" && <LegacyMasterTree t={t} curSys={curSys} q={q} col={col} onOpen={onOpen} />}

      {view === "points" && (
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18 }}>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 8,
          overflow: "hidden", maxHeight: 520, overflowY: "auto" }}>
          {defs.map((d) => (
            <div key={d.field_code_norm} onClick={() => setSel(d)}
              style={{ padding: "10px 14px", borderBottom: `1px solid ${t.bg}`, cursor: "pointer",
                background: sel?.field_code_norm === d.field_code_norm ? (t.infoBg || "#e0f5fd") : t.panel,
                borderLeft: sel?.field_code_norm === d.field_code_norm
                  ? `3px solid ${col.c}` : "3px solid transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, padding: "1px 7px",
                  borderRadius: 3, color: col.c, background: col.bg }}>{d.field_code}</span>
                <b style={{ fontSize: 12.5, color: t.navy, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap" }}>{d.business_term}</b>
                {d.is_pii === "Y" && <span style={{ fontSize: 8, fontWeight: 700, color: "#fff",
                  background: "#c1113a", padding: "1px 5px", borderRadius: 3 }}>PII</span>}
                {(d.status || "").toLowerCase() === "deprecated" && <span style={{ fontSize: 8,
                  fontWeight: 700, color: "#888", background: "#eee", padding: "1px 5px",
                  borderRadius: 3 }}>DEPR</span>}
              </div>
            </div>))}
          {defs.length === 0 && <div style={{ padding: 16, color: t.muted || t.textMuted,
            fontSize: 12 }}>No definitions.</div>}
        </div>

        <div>
          {sel && <LegacyDefCard t={t} sel={sel} curSys={curSys} col={col} onOpen={onOpen} />}
        </div>
      </div>
      )}
    </div>
  );
}

/* ============== shared definition card (flat list + master/group tree) ============== */
function LegacyDefCard({ t, sel, curSys, col, onOpen }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 8,
      overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${t.border}` }}>
        <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, padding: "2px 9px",
          borderRadius: 3, color: col.c, background: col.bg }}>{sel.field_code}</span>
        <h2 style={{ fontSize: 18, color: t.navy, margin: "8px 0 3px" }}>{sel.business_term}</h2>
        <div style={{ fontSize: 12, color: t.sub || t.textMuted }}>
          {sel.business_function || ""} · {legacyLabel(curSys)}</div>
      </div>
      {[
        ["DB field code", <span key="c" style={{ fontFamily: "monospace" }}>{sel.field_code_norm}{" "}
          <span style={{ color: t.muted || t.textMuted }}>(from {sel.field_code})</span></span>],
        ["Master", sel.master_name && <span key="ma">{sel.master_name}
          {Number(sel.master_count) > 1 && <span style={{ fontSize: 9, fontWeight: 700,
            color: t.muted || t.textMuted, marginLeft: 6 }}>
            ({sel.master_count} masters)</span>}</span>],
        ["Group", sel.business_function],
        ["Data type", sel.data_type && <span key="dt" style={{ fontFamily: "monospace" }}>
          {sel.data_type}{sel.max_length ? ` · len ${sel.max_length}` : ""}
          {sel.num_precision ? ` · precision ${sel.num_precision}` : ""}
          {sel.date_format ? ` · ${sel.date_format}` : ""}</span>],
        ["Constraints", (sel.is_required === "Y" || sel.is_unique === "Y") && <span key="rq">
          {sel.is_required === "Y" && clsPill("Required")}
          {sel.is_unique === "Y" && clsPill("Unique")}</span>],
        ["Description", sel.short_desc],
        ["PB field mapping", sel.pb_field_mapping && <span key="pb"
          style={{ fontFamily: "monospace" }}>{sel.pb_field_mapping}</span>],
        ["Classifications", (sel.privacy_class || sel.regulatory_class || sel.operational_class)
          && <span key="p">{clsPill(sel.privacy_class)}{clsPill(sel.regulatory_class)}
          {clsPill(sel.operational_class)}</span>],
        ["Status", sel.status && clsPill(sel.status)],
      ].filter(([, v]) => v).map(([k, v]) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10,
          padding: "9px 20px", borderTop: "1px solid #f0f3f6", fontSize: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: ".4px", color: t.muted || t.textMuted, paddingTop: 2 }}>{k}</div>
          <div style={{ lineHeight: 1.5, color: t.text || "#333" }}>{v}</div>
        </div>))}
      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10,
        padding: "9px 20px", borderTop: "1px solid #f0f3f6", fontSize: 12 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: ".4px", color: t.muted || t.textMuted, paddingTop: 2 }}>Linked in lineage</div>
        <div>
          {Number(sel.lineage_count) > 0 ? (
            <>
              <span style={{ fontFamily: "monospace", color: t.accent }}>{sel.lineage_target}</span>
              <div style={{ marginTop: 9 }}>
                <span onClick={() => onOpen && onOpen({ module: "lineage",
                    tab: curSys, id: sel.field_code_norm })}
                  style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700,
                    padding: "6px 12px", borderRadius: 3, cursor: "pointer",
                    border: `1px solid ${t.accent}`, background: t.accent, color: "#fff" }}>
                  View in Lineage →</span>
              </div>
            </>
          ) : (
            <>
              <span style={{ color: t.muted || t.textMuted }}>— not mapped to a DWH column —</span>
              <div style={{ marginTop: 9 }}>
                <span title="This data point has no DWH lineage target"
                  style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700,
                    padding: "6px 12px", borderRadius: 3, cursor: "not-allowed",
                    border: `1px solid ${t.border}`, background: "#f2f5f7",
                    color: t.muted || t.textMuted }}>Not in DWH lineage</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============== Browse by Master & Group — dictionary-tree view ============== */
function LegacyMasterTree({ t, curSys, q, col, onOpen }) {
  const [masters, setMasters] = useState([]);
  const [curMaster, setCurMaster] = useState(null);
  const [openGroup, setOpenGroup] = useState({});
  const [sel, setSel] = useState(null);

  useEffect(() => {
    if (!curSys) return;
    api.legacyDictionaryTree(curSys, q || undefined).then((r) => {
      const ms = r.masters || [];
      setMasters(ms);
      setCurMaster((c) => (c && ms.find((m) => m.master_name === c)) ? c
        : (ms[0] ? ms[0].master_name : null));
      setSel(null);
      // searching: auto-open every group so hits are visible
      if (q) {
        const og = {};
        ms.forEach((m) => m.groups.forEach((g) => { og[m.master_name + "|" + g.business_function] = true; }));
        setOpenGroup(og);
      }
    });
  }, [curSys, q]);

  const m = masters.find((x) => x.master_name === curMaster);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18, alignItems: "start" }}>
      {/* masters rail */}
      <div style={{ maxHeight: 560, overflowY: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase",
          color: t.muted || t.textMuted, marginBottom: 8 }}>Masters ({masters.length})</div>
        {masters.map((ms) => (
          <button key={ms.master_name} onClick={() => { setCurMaster(ms.master_name); setSel(null); }}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
              marginBottom: 5, cursor: "pointer", fontFamily: t.font,
              border: `1px solid ${curMaster === ms.master_name ? col.c : t.border}`,
              borderRadius: 6,
              background: curMaster === ms.master_name ? col.bg : t.panel }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.navy }}>{ms.master_name}</div>
            <div style={{ fontSize: 11, color: t.sub || t.textMuted, marginTop: 2 }}>
              {ms.field_count} fields · {ms.groups.length} groups
              {ms.pii_count > 0 ? ` · ${ms.pii_count} PII` : ""}</div>
          </button>))}
        {masters.length === 0 && <div style={{ fontSize: 12, color: t.muted || t.textMuted }}>
          {q ? "No fields match the search." : "No masters in the dictionary for this system."}</div>}
      </div>

      {/* groups + fields */}
      <div>
        {m && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: t.navy, marginBottom: 2 }}>{m.master_name}</div>
            <div style={{ fontSize: 12, color: t.sub || t.textMuted, marginBottom: 12 }}>
              {m.field_count} fields across {m.groups.length} groups · {legacyLabel(curSys)}</div>

            {m.groups.map((g) => {
              const gk = m.master_name + "|" + g.business_function;
              const openg = !!openGroup[gk];
              return (
                <div key={gk} style={{ background: t.panel, border: `1px solid ${t.border}`,
                  borderRadius: 8, marginBottom: 10, overflow: "hidden" }}>
                  <div onClick={() => setOpenGroup((o) => ({ ...o, [gk]: !o[gk] }))}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
                      cursor: "pointer", background: openg ? (t.bgsoft || "#f6f9fb") : t.panel }}>
                    <span style={{ fontSize: 10, color: t.muted || t.textMuted }}>{openg ? "▾" : "▶"}</span>
                    <b style={{ fontSize: 13, color: t.navy }}>{g.business_function}</b>
                    <span style={{ fontSize: 10, fontWeight: 700, color: col.c, background: col.bg,
                      padding: "1px 8px", borderRadius: 999 }}>{g.field_count}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: t.muted || t.textMuted }}>
                      {g.fields.filter((f) => f.is_pii === "Y").length > 0
                        ? `${g.fields.filter((f) => f.is_pii === "Y").length} PII` : ""}</span>
                  </div>
                  {openg && g.fields.map((d) => (
                    <div key={d.field_code_norm}>
                      <div onClick={() => setSel(sel === d ? null : d)}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px 8px 34px",
                          borderTop: `1px solid ${t.bg}`, cursor: "pointer",
                          background: sel === d ? (t.infoBg || "#e0f5fd") : t.panel }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700,
                          padding: "1px 7px", borderRadius: 3, color: col.c, background: col.bg }}>{d.field_code}</span>
                        <b style={{ fontSize: 12.5, color: t.navy, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.business_term}</b>
                        {d.is_pii === "Y" && <span style={{ fontSize: 8, fontWeight: 700, color: "#fff",
                          background: "#c1113a", padding: "1px 5px", borderRadius: 3 }}>PII</span>}
                        {d.is_required === "Y" && <span style={{ fontSize: 8, fontWeight: 700,
                          color: "#a8560f", background: "#fae5d3", padding: "1px 5px",
                          borderRadius: 3 }}>REQ</span>}
                        {Number(d.lineage_count) > 0 && <span style={{ fontSize: 8, fontWeight: 700,
                          color: "#159943", background: "#d0ebd9", padding: "1px 5px",
                          borderRadius: 3 }}>DWH</span>}
                        <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10,
                          color: t.muted || t.textMuted }}>{d.data_type || ""}</span>
                      </div>
                      {sel === d && (
                        <div style={{ padding: "10px 16px 14px 34px", borderTop: `1px dashed ${t.border}`,
                          background: "#fbfdfe" }}>
                          <LegacyDefCard t={t} sel={sel} curSys={curSys} col={col} onOpen={onOpen} />
                        </div>)}
                    </div>))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

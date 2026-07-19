import React, { useState, useEffect, useRef } from "react";
import { api } from "./api.js";

// =====================================================================
// GlobalSearch v2 — header search, redesigned per the approved mockup:
//   - centered pill, 440px at rest -> 640px on focus (animated)
//   - gradient shimmer focus ring + glow, Ctrl/Cmd+K to focus
//   - navy dropdown header echoing the parsed query
//   - section markers with color dots, master pills on definitions,
//     purple-tinted code-detection row
// Logic unchanged from v1: debounced /search?limit=8, recents
// (localStorage), field-code detection, ↑↓/↵/esc, deep-links via nav.
// Props: { t, onSubmit(q), onOpen(nav) }
// =====================================================================

const CODE_RX = /^[A-Za-z]{1,3}[/._-]\d+([/._-][Ll]?\d+)?$/;
const KINDS = {
  legacy_def: { label: "definition", bg: "#efe6fb", fg: "#6d3ac0", dot: "#6d3ac0",
                group: "Business definitions" },
  datapoint: { label: "datapoint", bg: "#e0f5fd", fg: "#0091bf", dot: "#0091bf",
               group: "Datapoints" },
  field: { label: "field", bg: "#e0f5fd", fg: "#0b5e83", dot: "#0b5e83", group: "Fields" },
  canonical: { label: "canonical", bg: "#e0f5fd", fg: "#0b5e83", dot: "#0b5e83",
               group: "Canonical fields" },
  feed: { label: "feed", bg: "#fae5d3", fg: "#a8560f", dot: "#a8560f", group: "Feeds" },
  loader: { label: "loader", bg: "#efe6fb", fg: "#7c3aed", dot: "#7c3aed", group: "Loaders" },
  loader_attr: { label: "loader attr", bg: "#efe6fb", fg: "#7c3aed", dot: "#7c3aed",
                 group: "Loader attributes" },
  api: { label: "api", bg: "#e8eaf6", fg: "#3f51b5", dot: "#3f51b5", group: "APIs" },
  api_field: { label: "api field", bg: "#e8eaf6", fg: "#3f51b5", dot: "#3f51b5",
               group: "API fields" },
  flow: { label: "flow", bg: "#e8eaf6", fg: "#3f51b5", dot: "#3f51b5", group: "Business flows" },
  pipeline: { label: "pipeline", bg: "#d0ebd9", fg: "#159943", dot: "#159943", group: "Pipelines" },
  dataset: { label: "dataset", bg: "#d0ebd9", fg: "#159943", dot: "#159943", group: "Datasets" },
  pii: { label: "pii", bg: "#f3d2d7", fg: "#c1113a", dot: "#c1113a", group: "PII" },
};
const GROUP_ORDER = ["legacy_def", "datapoint", "field", "canonical", "feed", "loader",
  "api", "flow", "pipeline", "dataset", "pii"];
const MASTER_C = {
  "Account Master": "#0f4775", "Master Account Master": "#b5651d",
  "Interested Party Master": "#0b7d7d", "Security Issue Master": "#6d3ac0",
  "Beneficiary Submaster": "#4a7c2f", "Co-fiduciary Submaster": "#8a6d1a",
};
const RECENT_KEY = "cp360RecentSearches";
const loadRecents = () => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch (e) { return []; }
};
const saveRecent = (q) => {
  try {
    const r = [q, ...loadRecents().filter((x) => x !== q)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch (e) { /* optional */ }
};

// keyframes injected once (CSS-in-JS can't express @keyframes inline)
const CSS_ID = "cp360-gs-css";
const CSS = `
@keyframes cp360gsShimmer { to { background-position: 220% 0; } }
@keyframes cp360gsDrop { from { opacity: 0; transform: translateY(-6px); }
                         to { opacity: 1; transform: none; } }`;

function Hl({ text, q }) {
  const t = String(text || ""), i = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{t}</>;
  return <>{t.slice(0, i)}<mark style={{ background: "#fff3bf", padding: 0 }}>
    {t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}</>;
}

export default function GlobalSearch({ t, onSubmit, onOpen }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState([]);
  const [sel, setSel] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {              // one-time keyframes
    if (!document.getElementById(CSS_ID)) {
      const el = document.createElement("style");
      el.id = CSS_ID; el.textContent = CSS;
      document.head.appendChild(el);
    }
  }, []);

  useEffect(() => {              // Ctrl/Cmd+K focuses the bar
    const onK = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (inputRef.current) inputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onK);
    return () => window.removeEventListener("keydown", onK);
  }, []);

  useEffect(() => {              // debounced fetch
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setHits([]); return; }
    timer.current = setTimeout(() => {
      api.search(q, undefined, 8).then((d) => setHits((d && d.results) || []));
    }, 160);
    return () => timer.current && clearTimeout(timer.current);
  }, [q, open]);

  useEffect(() => {              // click-away
    const off = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const firstTerm = q.trim().split(/\s+/)[0] || "";
  const isCode = CODE_RX.test(firstTerm);
  const items = [];
  if (!q.trim()) loadRecents().forEach((r) => items.push({ type: "recent", q: r }));
  else {
    if (isCode) items.push({ type: "code", q: q.trim() });
    hits.forEach((h) => items.push({ type: "hit", hit: h }));
    items.push({ type: "all", q: q.trim() });
  }

  const submit = (val) => { saveRecent(val); setOpen(false); onSubmit(val); };
  const choose = (it) => {
    if (!it) return submit(q);
    if (it.type === "hit") { saveRecent(q.trim()); setOpen(false); if (onOpen) onOpen(it.hit.nav || it.hit); }
    else submit(it.q);
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { setSel((s) => Math.min(s + 1, items.length - 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setSel((s) => Math.max(s - 1, 0)); e.preventDefault(); }
    else if (e.key === "Enter") { items.length ? choose(items[Math.min(sel, items.length - 1)]) : submit(q); }
    else if (e.key === "Escape") { setOpen(false); if (inputRef.current) inputRef.current.blur(); }
  };

  /* ---------- dropdown rows ---------- */
  let idx = -1;
  const row = (content, i, onClick, extraStyle) => (
    <div key={"r" + i} onMouseEnter={() => setSel(i)} onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 16px",
               cursor: "pointer",
               borderLeft: `3px solid ${sel === i ? "#31bced" : "transparent"}`,
               background: sel === i ? "#f0f8fc" : "#fff", ...extraStyle }}>{content}</div>);
  const kindPill = (k, extra) => {
    const m = KINDS[k] || { label: k, bg: "#eef1f4", fg: "#556" };
    return <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 4, background: m.bg, color: m.fg,
      flex: "none", ...extra }}>{m.label}</span>;
  };
  const secHdr = (label, dot, key) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 7,
                            padding: "9px 16px 4px", fontSize: 8.5, fontWeight: 800,
                            textTransform: "uppercase", letterSpacing: 0.7, color: "#999" }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: dot, flex: "none" }} />
      {label}</div>);

  const grouped = [];
  if (open) {
    if (!q.trim() && items.length) {
      grouped.push(secHdr("Recent", "#b9c4d0", "sh-rec"));
      items.forEach((it) => { idx++;
        const i = idx;
        grouped.push(row(<>
          <span style={{ color: "#999", fontSize: 12 }}>🕘</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#10193b" }}>{it.q}</span>
        </>, i, () => choose(items[i])));
      });
    } else if (q.trim()) {
      if (isCode) { idx++;
        const i = idx;
        grouped.push(row(<>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#6d3ac0" }}>#</span>
          {kindPill("legacy_def")}
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: "Roboto Mono, monospace", fontSize: 12.5,
                           fontWeight: 700, color: "#10193b" }}>{firstTerm.toUpperCase()}</span>
            <span style={{ display: "block", fontSize: 10, color: "#999" }}>
              field code — instant answer across all masters &amp; warehouses</span>
          </span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: "#999", flex: "none" }}>↵</span>
        </>, i, () => choose(items[i]),
        { background: sel === i ? "#f0f8fc" : "linear-gradient(90deg,#faf7ff,#fff)",
          borderTop: "1px solid #f0eafb", borderBottom: "1px solid #f0eafb" }));
      }
      GROUP_ORDER.concat(Object.keys(
        hits.reduce((m, h) => (GROUP_ORDER.includes(h.kind) ? m : (m[h.kind] = 1, m)), {})))
        .forEach((k) => {
          const g = hits.filter((h) => h.kind === k);
          if (!g.length) return;
          const meta = KINDS[k] || { group: k, dot: "#889" };
          grouped.push(secHdr(meta.group, meta.dot, "sh" + k));
          g.forEach((h) => { idx++;
            const i = idx;
            const master = k === "legacy_def"
              ? String(h.subtitle || "").split("·")[0].trim() : null;
            const mc = master && MASTER_C[master];
            grouped.push(row(<>
              {kindPill(h.kind)}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600,
                               color: "#10193b", overflow: "hidden", textOverflow: "ellipsis",
                               whiteSpace: "nowrap" }}><Hl text={h.name} q={q} /></span>
                <span style={{ display: "block", fontSize: 10, color: "#999",
                               overflow: "hidden", textOverflow: "ellipsis",
                               whiteSpace: "nowrap" }}><Hl text={h.subtitle} q={q} /></span>
              </span>
              {h.is_pii === "Y" && <span style={{ fontSize: 8, fontWeight: 800, color: "#c1113a",
                background: "#f3d2d7", borderRadius: 4, padding: "2px 6px",
                flex: "none" }}>PII</span>}
              {mc && <span style={{ fontSize: 8.5, fontWeight: 800, color: "#fff",
                background: mc, borderRadius: 999, padding: "2px 8px", flex: "none",
                whiteSpace: "nowrap" }}>{master.replace(" Master", "")}</span>}
            </>, i, () => choose(items[i])));
          });
        });
      idx++;
      const allI = idx;
      grouped.push(row(<span style={{ fontSize: 11, fontWeight: 700, color: "#0f4775",
        margin: "0 auto" }}>See all results for “{q.trim()}” ↵</span>,
        allI, () => choose(items[allI])));
    }
  }

  const showDd = open && grouped.length > 0;

  return (
    <div ref={boxRef}
      style={{ position: "relative", flex: "none",
               width: open ? 640 : 440, maxWidth: "46vw",
               margin: "0 auto",
               transition: "width .22s cubic-bezier(.4,0,.2,1)" }}>
      {/* gradient shimmer ring (focus only) */}
      <span style={{ position: "absolute", inset: -2, borderRadius: 999, padding: 2,
                     background: "linear-gradient(100deg,#31bced,#7dd8f5 35%,#4a90c9 70%,#31bced)",
                     backgroundSize: "220% 100%",
                     opacity: open ? 1 : 0, transition: "opacity .22s",
                     animation: open ? "cp360gsShimmer 2.6s linear infinite" : "none",
                     pointerEvents: "none" }}>
        <span style={{ display: "block", height: "100%", borderRadius: 999,
                       background: "#10193b" }} />
      </span>
      <input ref={inputRef} value={q} placeholder="CP 360 Search"
        onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }}
        onFocus={() => setOpen(true)} onKeyDown={onKey}
        style={{ position: "relative", width: "100%", height: 34, borderRadius: 999,
                 border: "none", outline: "none", padding: "0 78px 0 38px", fontSize: 13,
                 fontFamily: t.font, background: "rgba(255,255,255,0.96)", color: "#10193b",
                 boxShadow: open ? "0 6px 26px rgba(49,188,237,.35)"
                                 : "0 2px 10px rgba(0,0,0,.35)",
                 transition: "box-shadow .22s" }} />
      <span style={{ position: "absolute", left: 14, top: 8, fontSize: 13, opacity: 0.55,
                     zIndex: 2, pointerEvents: "none" }}>🔍</span>
      <span style={{ position: "absolute", right: 12, top: 8, zIndex: 2, display: "flex",
                     gap: 4, pointerEvents: "none" }}>
        {["Ctrl", "K"].map((k) => (
          <b key={k} style={{ fontFamily: "Roboto Mono, monospace", fontSize: 9,
             fontWeight: 700, color: "#667", background: "#eef1f4",
             border: "1px solid #d5dce2", borderBottomWidth: 2, borderRadius: 5,
             padding: "1px 6px" }}>{k}</b>))}
      </span>
      {showDd && (
        <div style={{ position: "absolute", top: 42, left: 0, right: 0, background: "#fff",
                      borderRadius: 14, overflow: "hidden", zIndex: 60,
                      boxShadow: "0 24px 60px rgba(16,25,59,.30), 0 0 0 1px #e6ebef",
                      animation: "cp360gsDrop .16s ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px",
                        background: "linear-gradient(100deg,#10193b,#0f4775)", color: "#fff",
                        fontSize: 10.5, fontWeight: 800 }}>
            CP 360 SEARCH{q.trim() ? <>&nbsp;·&nbsp;
              <span style={{ fontFamily: "Roboto Mono, monospace", color: "#31bced",
                             fontWeight: 700 }}>{q.trim()}</span></> : null}
            <span style={{ marginLeft: "auto", fontWeight: 400, opacity: 0.8 }}>↵ full results</span>
          </div>
          {grouped}
          <div style={{ display: "flex", gap: 14, padding: "7px 16px", fontSize: 9,
                        color: "#999", background: "#fafbfc", borderTop: "1px solid #eef1f4" }}>
            <span>↑↓ navigate · ↵ open · esc close</span>
            <span style={{ marginLeft: "auto" }}>filters:&nbsp;
              <b style={{ fontFamily: "Roboto Mono, monospace", color: "#778" }}>is:pii</b> ·&nbsp;
              <b style={{ fontFamily: "Roboto Mono, monospace", color: "#778" }}>master:ip</b> ·&nbsp;
              <b style={{ fontFamily: "Roboto Mono, monospace", color: "#778" }}>ds:imds</b></span>
          </div>
        </div>)}
    </div>);
}

/* Arb-dashboard. Leest JSON van de bot: lokaal (data/) of van de GitHub data-branch. */
(() => {
  "use strict";
  const C = Object.assign({ mode: "local", repo: "", branch: "data", title: "JohnsArbBets", tagline: "", telegram: "", refresh_s: 60 },
    window.ARB_CONFIG || {});
  const TZ = "Europe/Amsterdam";
  const LEAGUES = { NED: "Eredivisie", ENG: "Premier League", ESP: "LaLiga", ITA: "Serie A", GER: "Bundesliga", FRA: "Ligue 1", POR: "Primeira Liga" };
  const S = { status: null, arbs: null, cycles: null, log: null, odds: null, oddsAt: 0, tab: "home" };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x, d = 2) => (x == null || isNaN(x)) ? "–" : Number(x).toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
  const eur = (x) => "€" + num(x, 2);
  const dt = (iso, opt) => iso ? new Date(iso).toLocaleString("nl-NL", Object.assign({ timeZone: TZ }, opt)) : "–";
  const hm = (iso) => dt(iso, { hour: "2-digit", minute: "2-digit" });
  const dayhm = (iso) => dt(iso, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const ago = (iso) => {
    if (!iso) return "–";
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "zojuist";
    if (s < 3600) return Math.round(s / 60) + " min geleden";
    if (s < 86400) return Math.round(s / 3600) + " uur geleden";
    return Math.round(s / 86400) + " dagen geleden";
  };
  const durTxt = (min) => min == null ? "–" : min < 1 ? "<1 min" : min < 90 ? Math.round(min) + " min" : (min / 60).toFixed(1) + " u";

  // ---------------------------------------------------------------- data laden
  let baseCache = { url: null, at: 0 };
  async function base() {
    if (C.mode === "local") return "data/";
    if (baseCache.url && Date.now() - baseCache.at < 90_000) return baseCache.url;
    try {
      const r = await fetch(`https://api.github.com/repos/${C.repo}/git/ref/heads/${C.branch}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        baseCache = { url: `https://raw.githubusercontent.com/${C.repo}/${j.object.sha}/`, at: Date.now() };
        return baseCache.url;
      }
    } catch (e) { /* val terug op branchnaam */ }
    return `https://raw.githubusercontent.com/${C.repo}/${C.branch}/`;
  }
  async function getJSON(name) {
    const b = await base();
    const url = b + name + (b.includes("/" + C.branch + "/") || C.mode === "local" ? "?t=" + Date.now() : "");
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(name + " " + r.status);
    return r.json();
  }
  async function loadAll() {
    const [st, ar, cy, lg] = await Promise.allSettled([getJSON("status.json"), getJSON("arbs.json"), getJSON("cycles.json"), getJSON("log.json")]);
    if (st.status === "fulfilled") S.status = st.value;
    if (ar.status === "fulfilled") S.arbs = ar.value;
    if (cy.status === "fulfilled") S.cycles = cy.value;
    if (lg.status === "fulfilled") S.log = lg.value;
    if (S.tab === "odds") await loadOdds();
    renderAll();
  }
  async function loadOdds(force) {
    if (!force && S.odds && Date.now() - S.oddsAt < 60_000) return;
    try { S.odds = await getJSON("odds.json"); S.oddsAt = Date.now(); } catch (e) { S.odds = { error: true, events: [] }; }
  }

  // ---------------------------------------------------------------- helpers
  function sectionHead(title, link) {
    return `<div class="section-head"><h3>${esc(title)}</h3><div class="rule"></div>${link || ""}</div>`;
  }
  function botState() {
    const st = S.status;
    if (!st) return { cls: "off", label: "geen data", text: "Nog geen gegevens van de bot ontvangen." };
    const age = (Date.now() - new Date(st.generated_at)) / 1000;
    const limit = (st.export_interval_s || 300) * 2 + 180;
    if (age > limit) return { cls: "off", label: "offline", text: `Laatste update ${ago(st.generated_at)} — de bot of de server staat mogelijk uit.` };
    if (st.paused) return { cls: "paused", label: "gepauzeerd", text: "Scant wel, maar stuurt geen Telegram-meldingen (⏸ Pauze)." };
    return { cls: "on", label: "online", text: "" };
  }
  const tip = $("tip");
  function bindTips(root) {
    root.querySelectorAll("[data-tip]").forEach((el) => {
      el.addEventListener("mouseenter", () => { tip.innerHTML = el.getAttribute("data-tip"); tip.hidden = false; });
      el.addEventListener("mousemove", (e) => {
        const w = tip.offsetWidth, x = Math.min(e.clientX + 14, window.innerWidth - w - 8);
        tip.style.left = x + "px"; tip.style.top = (e.clientY + 14) + "px";
      });
      el.addEventListener("mouseleave", () => { tip.hidden = true; });
    });
  }

  function arbCard(a) {
    const warn = a.profit_pct >= 8;
    const legs = a.legs.map((l) => `
      <div class="leg">
        <div class="bk">${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.book)} ↗</a>` : esc(l.book)}</div>
        <div class="sel" title="${esc(l.market)} → ${esc(l.outcome)}">${esc(l.sel)} <span class="muted">· ${esc(l.market)}</span></div>
        <div class="od">@ ${num(l.odds)}</div>
        <div class="st">${eur(l.stake)}</div>
      </div>`).join("");
    return `<div class="arb ${warn ? "warn" : ""}">
      <div class="top"><div><div class="match">${esc(a.home)} – ${esc(a.away)}</div>
        <div class="info">${esc(LEAGUES[a.league] || a.league)} · aftrap ${dayhm(a.kickoff)} · sinds ${hm(a.first_seen)}${a.peak_pct > a.profit_pct + 0.01 ? ` · piek +${num(a.peak_pct)}%` : ""}</div></div>
        <div class="pct">+${num(a.profit_pct)}%${warn ? " ⚠️" : ""}</div></div>
      <div class="legs">${legs}</div>
      <div class="foot"><span>inzet ${eur(a.total_stake)}</span><span>winst min. <b>${eur(a.worst)}</b>${a.best - a.worst > 0.05 ? ` (max ${eur(a.best)})` : ""}</span>
        ${a.push_note ? `<span>ℹ️ bij ${esc(a.push_note)}: inzet terug</span>` : ""}</div>
    </div>`;
  }
  function bookClass(b) { return b.ok ? (b.fails ? "warn" : "") : (b.fails >= 3 || b.error ? "off" : "warn"); }

  // ---------------------------------------------------------------- grafieken (SVG, zonder libraries)
  function barChart(data, opt) {
    // data: [{x, y, tip}] verticale staven, één reeks
    const W = 640, H = 180, L = 30, B = 22, T = 8, R = 6;
    const max = Math.max(1, ...data.map((d) => d.y));
    const step = Math.max(1, Math.ceil(max / 4));
    const top = step * Math.ceil(max / step);
    const bw = (W - L - R) / data.length, gap = 2;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label)}">`;
    for (let v = 0; v <= top; v += step) {
      const y = T + (H - B - T) * (1 - v / top);
      s += `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 6}" y="${y + 3}" text-anchor="end">${v}</text>`;
    }
    data.forEach((d, i) => {
      const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap), h = (H - B - T) * (d.y / top), y = H - B - h;
      const r = Math.min(4, w / 2, h);
      if (h > 0) s += `<path class="bar" d="M${x},${H - B} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${H - B} Z"/>`;
      s += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - B - T}" data-tip="${esc(d.tip)}"/>`;
      if (opt.every && i % opt.every === 0) s += `<text class="axis" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(d.x)}</text>`;
    });
    return s + `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/></svg>`;
  }
  function hbarChart(rows, opt) {
    // rows: [{label, value, tip}] horizontale staven, gesorteerd
    if (!rows.length) return `<div class="empty">Nog geen gegevens.</div>`;
    const W = 640, rowH = 22, L = 120, R = 46, H = rows.length * rowH + 4;
    const max = Math.max(1, ...rows.map((r) => r.value));
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label)}">`;
    rows.forEach((r, i) => {
      const y = i * rowH + 3, w = Math.max(0, (W - L - R) * r.value / max), h = rowH - 8;
      s += `<text class="lbl" x="${L - 8}" y="${y + h - 2}" text-anchor="end">${esc(r.label)}</text>`;
      if (w > 0) s += `<path class="bar" d="M${L},${y} H${L + w - Math.min(4, w)} Q${L + w},${y} ${L + w},${y + Math.min(4, w)} V${y + h - Math.min(4, w)} Q${L + w},${y + h} ${L + w - Math.min(4, w)},${y + h} H${L} Z"/>`;
      s += `<text class="val" x="${L + w + 6}" y="${y + h - 2}">${esc(r.text ?? r.value)}</text>`;
      s += `<rect class="hit" x="0" y="${y - 2}" width="${W}" height="${rowH}" data-tip="${esc(r.tip)}"/>`;
    });
    return s + "</svg>";
  }

  // ---------------------------------------------------------------- tabs
  function renderHeader() {
    const st = S.status, bs = botState();
    // "JohnsArbBets" → "Johns" wit + "ArbBets" blauw, net als in het logo
    $("title").innerHTML = esc(C.title).replace(/^(Johns)(.+)$/, '$1<span class="p">$2</span>');
    document.title = C.title + " — dashboard";
    $("tagline").textContent = C.tagline || "";
    const on = $("online"); on.className = "sub " + bs.cls; on.textContent = "● " + bs.label;
    if (!st) return;
    const books = st.bookmakers || [];
    $("m-upd").textContent = ago(st.generated_at);
    $("m-books").textContent = `${books.filter((b) => b.ok).length}/${books.length}`;
    $("m-matches").textContent = String(st.last_cycle?.multi ?? "–");
    $("m-stake").textContent = st.bankroll || "–";
    $("b-open").textContent = `${(S.arbs?.open || []).length} open`;
    $("b-books").textContent = `${books.filter((b) => b.ok).length}/${books.length}`;
  }

  function renderHome() {
    const st = S.status, ar = S.arbs, bs = botState();
    if (!st) { $("tab-home").innerHTML = `<div class="empty">Wachten op de eerste gegevens van de bot…</div>`; return; }
    const lc = st.last_cycle || {}, books = st.bookmakers || [];
    const last24 = (ar?.history || []).filter((h) => Date.now() - new Date(h.first_seen) < 864e5);
    const best24 = Math.max(0, ...last24.map((h) => h.peak || h.pct));
    const upFor = ago(st.started_at).replace(" geleden", "");
    const tg = C.telegram || st.telegram;
    let h = `<div class="grid2">
      <div class="card status-card ${bs.cls}"><div class="pulse"></div><div>
        <div class="kicker">status arb-bot</div><h2>${bs.label[0].toUpperCase() + bs.label.slice(1)}</h2>
        <p>${bs.text || `Scant ${books.length} bookmakers elke ${Math.round(st.interval_s / 60)} min · draait al ${upFor}.`}</p>
        <div class="hb">laatste ronde: ${hm(lc.time)} (${num(lc.duration, 0)} s) · min. winst ${num(st.min_profit_pct, 1)}%</div>
      </div></div>
      <div class="card"><div class="kicker">meldingen op je telefoon</div>
        <p class="muted" style="margin-top:6px">Elke kans direct in Telegram, met ✅/❌-feedback en knoppen voor inzet en markten.</p>
        ${tg ? `<a class="cta" href="${esc(tg)}" target="_blank" rel="noopener">✈ Open de Telegram-bot</a>` : `<span class="cta off">Telegram-link niet ingesteld</span>`}
      </div></div>
    <div class="tiles">
      <div class="tile"><div class="kicker">bookmakers actief</div><div class="big">${books.filter((b) => b.ok).length}<span class="muted" style="font-size:16px">/${books.length}</span></div><div class="small">${(st.not_supported || []).length} niet ondersteund</div></div>
      <div class="tile"><div class="kicker">wedstrijden gekoppeld</div><div class="big">${lc.multi ?? "–"}</div><div class="small">gem. ${num(lc.avg_books, 1)} bookmakers per wedstrijd</div></div>
      <div class="tile"><div class="kicker">open arbs</div><div class="big hot">${(ar?.open || []).length}</div><div class="small">nu zichtbaar</div></div>
      <div class="tile"><div class="kicker">arbs 24 u</div><div class="big">${last24.length}</div><div class="small">hoogste ${num(best24)}%</div></div>
    </div>`;
    h += sectionHead("open arbs", `<a href="#arbs">alle arbs →</a>`);
    h += (ar?.open || []).length ? ar.open.slice(0, 6).map(arbCard).join("") : `<div class="empty">Op dit moment geen arbitrage-kansen boven ${num(st.min_profit_pct, 1)}%.</div>`;
    h += sectionHead("bookmakers", `<a href="#bookmakers">details →</a>`);
    h += `<div class="books">${books.map((b) => `<div class="book ${bookClass(b)}"><span class="dot"></span><div style="min-width:0">
      <div class="nm">${esc(b.name)}</div><div class="st">${b.ok ? `${b.events} wedstr. · ${b.linked} gekoppeld` : esc((b.error || "geen data").slice(0, 60))}</div></div></div>`).join("")}</div>`;
    h += sectionHead("laatste arbs", `<a href="#arbs">logboek →</a>`);
    h += historyTable((ar?.history || []).slice(0, 8), true);
    $("tab-home").innerHTML = h;
  }

  function historyTable(rows, compact) {
    if (!rows.length) return `<div class="empty">Nog geen arbs gezien.</div>`;
    const tr = rows.map((r) => {
      const books = [...new Set(r.legs.map((l) => l.book))].map((b) => `<span class="pill">${esc(b)}</span>`).join("");
      const fb = r.fb ? (r.fb.v === "ok" ? `<span class="pill ok">✅</span>` : `<span class="pill bad">❌ ${esc(r.fb.r || "")}</span>`) : "";
      const stt = r.status === "open" ? `<span class="pill open">open</span>` : "";
      const sels = compact ? "" : `<div class="muted">${r.legs.map((l) => `${esc(l.book)}: ${esc(l.sel)} @${num(l.odds)}`).join(" · ")}</div>`;
      return `<tr><td class="mono">${dayhm(r.first_seen)}</td>
        <td><div>${esc(r.home)} – ${esc(r.away)} ${stt}${fb}</div>${sels}</td>
        <td class="mono">${esc(LEAGUES[r.league] || r.league)}</td>
        <td>${books}</td>
        <td class="num">+${num(r.peak || r.pct)}%</td>
        <td class="num">${durTxt(r.dur_min)}</td></tr>`;
    }).join("");
    return `<div class="tablewrap"><table><thead><tr><th>gezien</th><th>wedstrijd</th><th>competitie</th><th>bookmakers</th>
      <th class="num">winst (piek)</th><th class="num">duur</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  }

  const AF = { q: "", league: "", minp: "", fb: "" };
  function renderArbs() {
    const ar = S.arbs;
    if (!ar) { $("tab-arbs").innerHTML = `<div class="empty">Laden…</div>`; return; }
    const daily = ar.daily || [];
    const tot = daily.reduce((s, d) => s + d.count, 0);
    const byBook = Object.entries(ar.by_book || {}).filter(([b]) => b && b !== "null").sort((a, b) => b[1] - a[1]).slice(0, 19);
    let h = sectionHead("statistiek 30 dagen");
    h += `<div class="charts2">
      <div class="chart"><h4>Arbs per dag</h4><div class="sub">${tot} in 30 dagen · hover voor gemiddeld en hoogste %</div>
        ${barChart(daily.map((d) => ({ x: d.date.slice(8) + "/" + d.date.slice(5, 7), y: d.count,
          tip: `${d.date.split("-").reverse().join("-")}<br>${d.count} arbs · gem. ${num(d.avg)}% · hoogste ${num(d.max)}%` })), { label: "Arbs per dag", every: 5 })}</div>
      <div class="chart"><h4>Bookmakers in arbs</h4><div class="sub">hoe vaak een bookmaker één van de benen was</div>
        ${hbarChart(byBook.map(([b, n]) => ({ label: b, value: n, tip: `${b}: in ${n} arb-benen` })), { label: "Bookmakers in arbs" })}</div>
    </div>`;
    h += sectionHead(`open arbs (${(ar.open || []).length})`);
    h += (ar.open || []).length ? ar.open.map(arbCard).join("") : `<div class="empty">Geen open arbs.</div>`;
    h += sectionHead("logboek arbs");
    const leagues = [...new Set((ar.history || []).map((r) => r.league))];
    h += `<div class="filters">
      <input type="search" id="f-q" placeholder="Zoek wedstrijd of bookmaker…" value="${esc(AF.q)}">
      <select id="f-league"><option value="">Alle competities</option>${leagues.map((l) => `<option value="${esc(l)}" ${AF.league === l ? "selected" : ""}>${esc(LEAGUES[l] || l)}</option>`).join("")}</select>
      <select id="f-minp"><option value="">Elke %</option>${[1, 2, 3, 5].map((p) => `<option value="${p}" ${AF.minp == p ? "selected" : ""}>≥ ${p}%</option>`).join("")}</select>
      <select id="f-fb"><option value="">Alle feedback</option><option value="ok" ${AF.fb === "ok" ? "selected" : ""}>✅ klopt</option><option value="wrong" ${AF.fb === "wrong" ? "selected" : ""}>❌ fout</option><option value="none" ${AF.fb === "none" ? "selected" : ""}>zonder feedback</option></select>
    </div><div id="hist"></div>`;
    $("tab-arbs").innerHTML = h;
    const apply = () => {
      const q = AF.q.toLowerCase();
      const rows = (ar.history || []).filter((r) =>
        (!AF.league || r.league === AF.league) && (!AF.minp || (r.peak || r.pct) >= +AF.minp) &&
        (!AF.fb || (AF.fb === "none" ? !r.fb : r.fb && r.fb.v === AF.fb)) &&
        (!q || (r.home + " " + r.away + " " + r.legs.map((l) => l.book + " " + l.sel).join(" ")).toLowerCase().includes(q)));
      $("hist").innerHTML = historyTable(rows.slice(0, 400), false) + (rows.length > 400 ? `<p class="muted" style="margin-top:8px">${rows.length - 400} oudere niet getoond — gebruik de filters.</p>` : "");
    };
    $("f-q").oninput = (e) => { AF.q = e.target.value; apply(); };
    $("f-league").onchange = (e) => { AF.league = e.target.value; apply(); };
    $("f-minp").onchange = (e) => { AF.minp = e.target.value; apply(); };
    $("f-fb").onchange = (e) => { AF.fb = e.target.value; apply(); };
    apply();
    bindTips($("tab-arbs"));
  }

  function renderBookmakers() {
    const st = S.status;
    if (!st) { $("tab-bookmakers").innerHTML = `<div class="empty">Laden…</div>`; return; }
    const cyc = S.cycles?.cycles || [];
    const last = cyc.slice(-72);
    let h = sectionHead("ondersteunde bookmakers");
    h += `<div class="legend"><span><i style="background:var(--good)"></i>data ontvangen</span><span><i style="background:var(--neg)"></i>mislukt / leeg</span>
      <span>balk = laatste ${last.length} rondes (oud → nieuw)</span></div>`;
    h += `<div class="books" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">`;
    for (const b of st.bookmakers || []) {
      const cls = bookClass(b);
      const label = b.ok ? (b.fails ? "hersteld" : "actief") : cls === "off" ? "storing" : "geen data";
      const strip = last.map((c) => `<i class="${c.ok.includes(b.name) ? "" : "f"}" data-tip="${hm(c.t)} · ${c.ok.includes(b.name) ? "✓ data" : "✗ mislukt"}"></i>`).join("");
      const groups = Object.entries(b.groups || {}).sort((x, y) => y[1] - x[1]).map(([g, n]) => `<span class="pill">${esc(marketLabel(g))} ${n}</span>`).join("");
      h += `<div class="bookx"><div class="hd"><div class="nm">${esc(b.name)}</div><span class="state ${cls === "" ? "ok" : cls}">${label}</span></div>
        <dl class="kv"><dt>platform</dt><dd>${esc(b.platform)}</dd>
        <dt>wedstrijden</dt><dd>${b.events} (${b.linked} gekoppeld)</dd>
        <dt>selecties/wedstr.</dt><dd>${num(b.sel_per_event, 1)}</dd>
        <dt>uptime 24 u</dt><dd>${b.uptime_24h == null ? "–" : b.uptime_24h + "%"}</dd>
        <dt>ophaaltijd</dt><dd>${b.duration == null ? "–" : num(b.duration, 1) + " s"}</dd>
        <dt>laatst ok</dt><dd>${ago(b.last_ok)}</dd></dl>
        ${b.error && !b.ok ? `<div class="book"><div class="err">${esc(b.error)}</div></div>` : ""}
        <div class="strip">${strip || '<i class="n"></i>'}</div>
        <div style="margin-top:8px">${groups || '<span class="muted">geen markten</span>'}</div></div>`;
    }
    h += `</div>`;
    h += sectionHead("niet ondersteund");
    h += `<div class="books">${(st.not_supported || []).map((b) => `<div class="book na"><span class="dot"></span><div><div class="nm">${esc(b.name)}</div><div class="st">${esc(b.reason)}</div></div></div>`).join("")}</div>`;
    $("tab-bookmakers").innerHTML = h;
    bindTips($("tab-bookmakers"));
  }

  let MKT = {};
  const marketLabel = (g) => MKT[g] || g;
  function renderMarkets() {
    const st = S.status;
    if (!st) { $("tab-markten").innerHTML = `<div class="empty">Laden…</div>`; return; }
    const mk = st.markets || [];
    const books = (st.bookmakers || []).filter((b) => b.events);
    let h = sectionHead("markten");
    h += `<p class="muted" style="margin-bottom:10px">Aan/uit zetten doe je in Telegram met ⚙️ Markten. Gelijkwaardige markten (bijv. Over 2.5 = Asian Over 2.5, Dubbele kans 1X = AH thuis +0.5) worden automatisch als hetzelfde herkend.</p>`;
    h += `<div class="tablewrap"><table><thead><tr><th>markt</th><th>status</th><th class="num">selecties nu</th><th class="num">bookmakers</th></tr></thead><tbody>`;
    h += mk.map((m) => `<tr><td>${esc(m.label)}</td><td>${m.enabled ? '<span class="pill ok">✅ aan</span>' : '<span class="pill bad">⬜ uit</span>'}</td>
      <td class="num">${m.offers}</td><td class="num">${m.books}</td></tr>`).join("");
    h += `</tbody></table></div>`;
    h += sectionHead("aanbod per bookmaker (gem. selecties per wedstrijd)");
    const max = Math.max(1, ...books.flatMap((b) => mk.map((m) => (b.groups[m.group] || 0) / b.events)));
    h += `<div class="tablewrap"><table class="heat"><thead><tr><th>bookmaker</th>${mk.map((m) => `<th class="num" title="${esc(m.label)}">${esc(m.label.split(" (")[0])}</th>`).join("")}</tr></thead><tbody>`;
    h += books.map((b) => `<tr><td>${esc(b.name)}</td>${mk.map((m) => {
      const v = (b.groups[m.group] || 0) / b.events;
      const a = v ? (0.12 + 0.6 * v / max).toFixed(2) : 0;
      return `<td class="cell ${v ? "" : "zero"}" style="${v ? `background:rgba(var(--signal-rgb),${a})` : ""}" data-tip="${esc(b.name)} · ${esc(m.label)}: ${num(v, 1)} per wedstrijd">${v ? num(v, 1) : "–"}</td>`;
    }).join("")}</tr>`).join("");
    h += `</tbody></table></div><p class="muted" style="margin-top:8px">Hoe donkerder, hoe meer lijnen een bookmaker in die markt aanbiedt. "–" = niet aangeboden of (nog) niet uitgelezen.</p>`;
    $("tab-markten").innerHTML = h;
    bindTips($("tab-markten"));
  }

  const OF = { q: "", league: "" };
  function renderOdds() {
    const st = S.status;
    if (C.mode !== "local" && st && !st.odds_published) {
      $("tab-odds").innerHTML = `<div class="empty">De volledige odds-tabellen worden niet openbaar gepubliceerd (instelling <code>publish_odds: false</code>).<br>
        Bekijk ze op het lokale dashboard op je thuisnetwerk: <b>http://&lt;server-ip&gt;:8088</b></div>`;
      return;
    }
    const od = S.odds;
    if (!od) { $("tab-odds").innerHTML = `<div class="empty">Odds laden…</div>`; loadOdds(true).then(renderOdds); return; }
    if (od.error) { $("tab-odds").innerHTML = `<div class="empty">Odds konden niet geladen worden.</div>`; return; }
    const leagues = [...new Set(od.events.map((e) => e.league))];
    let h = `<div class="filters"><input type="search" id="o-q" placeholder="Zoek team…" value="${esc(OF.q)}">
      <select id="o-league"><option value="">Alle competities</option>${leagues.map((l) => `<option value="${esc(l)}" ${OF.league === l ? "selected" : ""}>${esc(LEAGUES[l] || l)}</option>`).join("")}</select></div>
      <p class="muted" style="margin-bottom:10px">Bijgewerkt ${ago(od.generated_at)}. Klik op een wedstrijd voor alle odds; <span style="color:var(--signal);font-weight:700">groen</span> = beste odds.</p><div id="o-list"></div>`;
    $("tab-odds").innerHTML = h;
    const apply = () => {
      const q = OF.q.toLowerCase();
      const evs = od.events.filter((e) => (!OF.league || e.league === OF.league) && (!q || (e.home + " " + e.away).toLowerCase().includes(q)));
      $("o-list").innerHTML = evs.length ? evs.map((e, i) => `<details class="ev" data-i="${od.events.indexOf(e)}">
        <summary><span class="t">${dayhm(e.kickoff)}</span><span class="m">${esc(e.home)} – ${esc(e.away)}</span>
        <span class="pill">${esc(LEAGUES[e.league] || e.league)}</span><span class="pill">${e.books.length} bookmakers</span><span class="pill">${e.sels.length} selecties</span></summary>
        <div class="body"></div></details>`).join("") : `<div class="empty">Geen wedstrijden gevonden.</div>`;
      $("o-list").querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => {
        if (d.open && !d.dataset.done) { d.querySelector(".body").innerHTML = oddsTable(od.events[+d.dataset.i]); d.dataset.done = 1; }
      }));
    };
    $("o-q").oninput = (e) => { OF.q = e.target.value; apply(); };
    $("o-league").onchange = (e) => { OF.league = e.target.value; apply(); };
    apply();
  }
  function oddsTable(e) {
    const books = e.books;
    let h = `<table class="odds"><thead><tr><th>selectie</th>${books.map((b) => `<th class="num">${e.urls[b] ? `<a href="${esc(e.urls[b])}" target="_blank" rel="noopener">${esc(b)}</a>` : esc(b)}</th>`).join("")}</tr></thead><tbody>`;
    let grp = null;
    for (const s of e.sels) {
      if (s.g !== grp) { grp = s.g; h += `<tr class="grp"><td colspan="${books.length + 1}">${esc(marketLabel(grp))}</td></tr>`; }
      const best = Math.max(...Object.values(s.o));
      h += `<tr><td>${esc(s.l)}</td>${books.map((b) => s.o[b] ? `<td class="cell ${s.o[b] === best && Object.keys(s.o).length > 1 ? "best" : ""}">${num(s.o[b])}</td>` : `<td class="cell muted">·</td>`).join("")}</tr>`;
    }
    return h + "</tbody></table>";
  }

  function renderLog() {
    const lg = S.log?.entries || [];
    let h = sectionHead("systeemlogboek");
    h += lg.length ? `<div class="tablewrap">${lg.map((r) => `<div class="logrow ${esc(r.level)}"><span class="t">${dayhm(r.t)}</span><span>${esc(r.msg)}</span></div>`).join("")}</div>`
      : `<div class="empty">Nog geen logregels.</div>`;
    const cyc = (S.cycles?.cycles || []).slice(-48).reverse();
    h += sectionHead("laatste rondes");
    h += cyc.length ? `<div class="tablewrap"><table><thead><tr><th>tijd</th><th class="num">duur</th><th class="num">events</th><th class="num">gekoppeld</th><th class="num">arbs</th><th class="num">bookmakers ok</th></tr></thead><tbody>${
      cyc.map((c) => `<tr><td class="mono">${dayhm(c.t)}</td><td class="num">${num(c.dur, 0)} s</td><td class="num">${c.ev}</td><td class="num">${c.mu}</td><td class="num">${c.a}</td><td class="num">${c.ok.length}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Nog geen rondes.</div>`;
    $("tab-logboek").innerHTML = h;
  }

  // ---------------------------------------------------------------- routing
  const RENDER = { home: renderHome, arbs: renderArbs, bookmakers: renderBookmakers, markten: renderMarkets, odds: renderOdds, logboek: renderLog };
  function renderAll() {
    MKT = Object.fromEntries((S.status?.markets || []).map((m) => [m.group, m.label]));
    renderHeader();
    RENDER[S.tab]();
  }
  function route() {
    const t = (location.hash || "#home").slice(1);
    S.tab = RENDER[t] ? t : "home";
    document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === S.tab));
    document.querySelectorAll("main > section").forEach((s) => { s.hidden = s.id !== "tab-" + S.tab; });
    tip.hidden = true;
    if (S.tab === "odds") loadOdds().then(renderAll); else renderAll();
  }
  window.addEventListener("hashchange", route);
  route();
  loadAll().catch((e) => console.warn(e));
  setInterval(() => {
    // filters/zoekvelden niet resetten terwijl je typt
    if (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    if (document.querySelector("details.ev[open]")) { renderHeader(); return; }
    loadAll().catch((e) => console.warn(e));
  }, (C.refresh_s || 60) * 1000);
})();

/* Arb-dashboard. Leest JSON van de bot: lokaal (data/) of van de GitHub data-branch. */
(() => {
  "use strict";
  const C = Object.assign({ mode: "local", repo: "", branch: "data", title: "JohnsArbBets", tagline: "", telegram: "", refresh_s: 60 },
    window.ARB_CONFIG || {});
  const TZ = "Europe/Amsterdam";
  const LEAGUES = { NED: "Eredivisie", ENG: "Premier League", ESP: "LaLiga", ITA: "Serie A", GER: "Bundesliga", FRA: "Ligue 1", POR: "Primeira Liga" };
  const S = { status: null, arbs: null, rondes: null, cycles: null, log: null, odds: null, oddsAt: 0, tab: "home" };
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
    const [st, ar, cy, lg, rd] = await Promise.allSettled([getJSON("status.json"), getJSON("arbs.json"), getJSON("cycles.json"), getJSON("log.json"), getJSON("rondes.json")]);
    if (rd.status === "fulfilled") S.rondes = rd.value;
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
    if ($("b-rondes") && S.rondes && !S.rondes.disabled) {
      const n = (S.rondes.open || []).length;
      $("b-rondes").textContent = n ? `${n} lopend` : `${S.rondes.totals?.all?.rounds || 0}`;
      $("b-rondes").classList.toggle("hot", n > 0);
    }
    $("b-books").textContent = `${books.filter((b) => b.ok).length}/${books.length}`;
    if (st.coverage && $("b-comp")) {
      const miss = st.coverage.rows.reduce((n, r) => n + Object.values(r.cells).filter((c) => c.state === "mist").length, 0);
      $("b-comp").textContent = miss ? `${miss} ⚠️` : `${st.coverage.rows.filter((r) => r.max).length} actief`;
      $("b-comp").classList.toggle("hot", miss > 0);
    }
  }

  function renderHome() {
    const st = S.status, ar = S.arbs, bs = botState();
    if (!st) { $("tab-home").innerHTML = `<div class="empty">Wachten op de eerste gegevens van de bot…</div>`; return; }
    const lc = st.last_cycle || {}, books = st.bookmakers || [];
    const last24 = (ar?.history || []).filter((h) => Date.now() - new Date(h.first_seen) < 864e5);
    const best24 = Math.max(0, ...last24.map((h) => h.peak || h.pct));
    const upFor = ago(st.started_at).replace(" geleden", "");
    const tg = st.telegram || C.telegram;
    const isChannel = st.telegram_kind === "channel";
    let h = `<div class="grid2">
      <div class="card status-card ${bs.cls}"><div class="pulse"></div><div>
        <div class="kicker">status arb-bot</div><h2>${bs.label[0].toUpperCase() + bs.label.slice(1)}</h2>
        <p>${bs.text || `Scant ${books.length} bookmakers ${st.pace_mode === "fixed" ? `elke ${st.interval_s} s` : "elk in een eigen, zelflerend tempo"} · draait al ${upFor}.`}</p>
        <div class="hb">laatste analyse: ${hm(lc.time)} · min. winst ${num(st.min_profit_pct, 1)}%</div>
      </div></div>
      <div class="card"><div class="kicker">meldingen op je telefoon</div>
        <p class="muted" style="margin-top:6px">${isChannel ? "Volg het kanaal en krijg elke arbitrage-kans direct op je telefoon: odds, inzetten en gegarandeerde winst." : "Elke kans direct in Telegram, met ✅/❌-feedback en knoppen voor inzet en markten."}</p>
        ${tg ? `<a class="cta" href="${esc(tg)}" target="_blank" rel="noopener">✈ ${isChannel ? "Volg het Telegram-kanaal" : "Open de Telegram-bot"}</a>` : `<span class="cta off">Telegram-link niet ingesteld</span>`}
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
        <dt>tempo</dt><dd>${b.tempo == null ? "–" : "elke " + num(b.tempo, 0) + " s" + (b.tempo_state === "slow" ? " · afgeremd" : "")}</dd>
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

  function renderCompetitions() {
    const st = S.status;
    const el = $("tab-competities");
    if (!st) { el.innerHTML = `<div class="empty">Laden…</div>`; return; }
    const cov = st.coverage;
    if (!cov) { el.innerHTML = `<div class="empty">Nog geen gegevens – werk de bot bij.</div>`; return; }
    const books = cov.books;
    const issues = cov.rows.reduce((n, r) => n + Object.values(r.cells).filter((c) => c.state === "mist").length, 0);
    let h = sectionHead("competities");
    h += `<p class="muted" style="margin-bottom:10px">Alle competities die de bot volgt, met per bookmaker het aantal wedstrijden dat nu binnenkomt (komende ${esc(String(st.days_ahead || 7))} dagen).
      Bekers, Europees en landenwedstrijden zoekt de bot per site zelf op naam op.
      <span class="pill bad">0!</span> = de meeste andere bookmakers hebben hier wél wedstrijden → waarschijnlijk niet goed opgehaald ·
      <span class="pill">·</span> = competitie niet gevonden op deze site · <span class="pill bad">fout</span> = site faalt nu.</p>`;
    h += `<div class="tablewrap"><table class="heat"><thead><tr><th>competitie</th><th class="num">max</th><th class="num">books</th>${books.map((b) => `<th class="num" title="${esc(b)}">${esc(b.length > 8 ? b.slice(0, 7) + "…" : b)}</th>`).join("")}</tr></thead><tbody>`;
    h += cov.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.max}</td><td class="num">${r.books_with}/${books.length}</td>${books.map((b) => {
      const c = r.cells[b] || { n: 0, ids: [], state: "geen-id" };
      const tip = `${b} · ${r.name}: ${c.n} wedstrijden · ID's: ${c.ids.length ? c.ids.join(", ") : "geen"}`;
      if (c.state === "fout") return `<td class="cell zero" data-tip="${esc(tip)}"><span class="pill bad">fout</span></td>`;
      if (c.state === "mist") return `<td class="cell" data-tip="${esc(tip + " – mist waarschijnlijk")}"><span class="pill bad">0!</span></td>`;
      if (c.state === "geen-id" && !c.n) return `<td class="cell zero" data-tip="${esc(tip)}">·</td>`;
      const a = r.max ? (0.12 + 0.6 * c.n / r.max).toFixed(2) : 0;
      return `<td class="cell ${c.n ? "" : "zero"}" style="${c.n ? `background:rgba(var(--signal-rgb),${a})` : ""}" data-tip="${esc(tip + (c.state === "weinig" ? " – opvallend weinig" : ""))}">${c.n ? c.n + (c.state === "weinig" ? "?" : "") : "–"}</td>`;
    }).join("")}</tr>`).join("");
    h += `</tbody></table></div><p class="muted" style="margin-top:8px">${issues ? `⚠️ ${issues} combinatie(s) waar een bookmaker waarschijnlijk wedstrijden mist.` : "✅ Geen bookmaker lijkt wedstrijden te missen."} Beweeg over een vakje voor de gebruikte competitie-ID's.</p>`;
    el.innerHTML = h;
    bindTips(el);
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

  // ---------------------------------------------------------------- speelrondes × singles (alle odds)
  const RF = { lg: "ALL", src: "odds" };
  const sgn = (x, d = 2) => x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + num(Math.abs(x), d);
  const cls = (x) => x > 0 ? "pos" : x < 0 ? "neg" : "";
  const SCOL = { alles: "var(--ink-faint)", fav: "var(--signal)", dog: "var(--warn)", draw: "var(--good)", anti: "var(--neg)" };
  const SIDE_NL = { H: "Thuis (1)", D: "Gelijk (X)", A: "Uit (2)" };
  const lgName = (rd, c) => (rd.names || {})[c] || LEAGUES[c] || c;
  const range = (b) => b.hi > 1e8 ? `${num(b.lo)}+` : `${num(b.lo)} – ${num(b.hi)}`;
  const favOf = (o) => ["H", "D", "A"].reduce((a, s) => o[s] < o[a] ? s : a, "H");
  function roundName(r) {
    const a = new Date(r.first_kickoff), b = new Date(r.last_kickoff);
    const f = (d, m) => d.toLocaleDateString("nl-NL", Object.assign({ timeZone: TZ, weekday: "short", day: "numeric" }, m ? { month: "short" } : {}));
    const same = f(a, true) === f(b, true);
    return (r.matchday ? `speelronde ${r.matchday} · ` : "") + (same ? f(a, true) : `${f(a, a.getMonth() !== b.getMonth())} – ${f(b, true)}`);
  }
  function cumChart(rd, hist) {
    if (hist.length < 2) return `<div class="empty">Na twee afgesloten rondes verschijnt hier de grafiek.</div>`;
    const keys = Object.keys(rd.strategies), cum = Object.fromEntries(keys.map((k) => [k, 0]));
    const pts = hist.map((h) => { keys.forEach((k) => { cum[k] += h.p[k]; }); return { h, c: { ...cum } }; });
    const W = 640, H = 210, L = 40, B = 20, T = 10, R = 8;
    const vals = pts.flatMap((p) => keys.map((k) => p.c[k]));
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const X = (i) => L + (W - L - R) * (i / (pts.length - 1)), Y = (v) => T + (H - B - T) * (1 - (v - lo) / span);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulatieve winst per strategie">`;
    for (let k = 0; k <= 4; k++) {
      const v = lo + span * k / 4, y = Y(v);
      s += `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 6}" y="${y + 3}" text-anchor="end">${Math.round(v)}</text>`;
    }
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>`;
    for (const k of keys) s += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.c[k]).toFixed(1)}`).join(" ")}" fill="none" stroke="${SCOL[k]}" stroke-width="${k === "anti" || k === "fav" ? 2.4 : 1.6}"/>`;
    const w = (W - L - R) / pts.length;
    pts.forEach((p, i) => {
      const t = `${esc(lgName(rd, p.h.league))} · ${dayhm(p.h.t)}<br>` + keys.map((k) => `${esc(rd.strategies[k])}: ${sgn(p.c[k])} u`).join("<br>");
      s += `<rect class="hit" x="${X(i) - w / 2}" y="${T}" width="${w}" height="${H - B - T}" data-tip="${esc(t)}"/>`;
    });
    return s + "</svg>";
  }
  function stratTable(rd, grp, best) {
    return `<table><thead><tr><th>strategie</th><th class="num">bets</th><th class="num">raak</th><th class="num">winst</th><th class="num">ROI</th>${best ? `<th class="num">ROI beste odds</th>` : ""}</tr></thead><tbody>${
      Object.keys(rd.strategies).map((k) => { const v = grp[k], b = best && best[k];
        return `<tr><td style="white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${SCOL[k]};margin-right:7px"></span>${esc(rd.strategies[k])}</td>
          <td class="num">${v.bets}</td><td class="num">${v.bets ? num(100 * v.hits / v.bets, 1) + "%" : "–"}</td>
          <td class="num ${cls(v.profit)}">${v.bets ? sgn(v.profit) + " u" : "–"}</td><td class="num ${cls(v.roi_pct)}">${v.roi_pct == null ? "–" : sgn(v.roi_pct, 1) + "%"}</td>
          ${best ? `<td class="num ${cls(b.roi_pct)}">${b.roi_pct == null ? "–" : sgn(b.roi_pct, 1) + "%"}</td>` : ""}</tr>`; }).join("")}</tbody></table>`;
  }
  function calBar(b) {
    const W = 120, sc = (x) => Math.max(0, Math.min(W, W * x / 100)), sig = Math.abs(b.z) >= 2;
    return `<svg viewBox="0 0 ${W} 14" width="${W}" height="14" style="vertical-align:middle">
      <rect x="0" y="2" width="${W}" height="10" rx="2" fill="var(--panel-2)"/>
      <rect x="${sc(b.implied_pct - 2 * b.se_pct)}" y="2" width="${Math.max(1, sc(b.implied_pct + 2 * b.se_pct) - sc(b.implied_pct - 2 * b.se_pct))}" height="10" fill="rgba(var(--signal-rgb),.2)"/>
      <line x1="${sc(b.implied_pct)}" x2="${sc(b.implied_pct)}" y1="0" y2="14" stroke="var(--ink-dim)" stroke-width="2"/>
      <circle cx="${sc(b.actual_pct)}" cy="7" r="4" fill="${sig ? "var(--warn)" : "var(--signal)"}"/></svg>`;
  }
  function diffCell(b) {
    const d = b.actual_pct - b.implied_pct, sig = Math.abs(b.z) >= 2;
    return `<td class="num ${sig ? cls(d) : ""}">${sgn(d, 1)} <span class="muted">±${num(2 * b.se_pct, 1)}</span>${sig ? " ❗" : ""}</td>`;
  }
  function calTable(an) {
    if (!an || !an.matches) return `<div class="empty">Nog geen wedstrijden met uitslag${RF.lg !== "ALL" ? " in deze competitie" : ""}.</div>`;
    const row = (b, name) => !b.n ? `<tr><td>${esc(name)}</td><td class="num">0</td><td colspan="5" class="muted">–</td></tr>`
      : `<tr><td>${esc(name)}</td><td class="num">${b.n}</td><td class="num">${num(b.implied_pct, 1)}%</td><td class="num">${num(b.actual_pct, 1)}%</td>${diffCell(b)}<td>${calBar(b)}</td><td class="num ${cls(b.roi_pct)}">${sgn(b.roi_pct, 1)}%</td></tr>`;
    const grp = (t) => `<tr><td colspan="7" style="font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-faint);background:var(--panel-2)">${t}</td></tr>`;
    return `<div class="tablewrap"><table><thead><tr><th>odds</th><th class="num">n</th><th class="num">bookmaker zegt</th><th class="num">werkelijk</th><th class="num">verschil ±2×fout</th><th></th><th class="num">ROI 1 u/bet</th></tr></thead><tbody>
      ${an.buckets.map((b) => row(b, range(b))).join("")}${grp("per uitkomst")}${an.sides.map((b) => row(b, SIDE_NL[b.side])).join("")}</tbody></table></div>`;
  }
  function bandTable(an) {
    if (!an || !an.matches) return "";
    return `<div class="tablewrap"><table><thead><tr><th>odds favoriet</th><th class="num">wedstr.</th><th class="num">wint volgens bookmaker</th><th class="num">wint werkelijk</th><th class="num">verschil ±2×fout</th><th></th><th class="num">ROI op favoriet</th><th class="num">ROI tegen favoriet</th></tr></thead><tbody>${
      an.bands.map((b) => !b.n ? `<tr><td>${range(b)}</td><td class="num">0</td><td colspan="6" class="muted">–</td></tr>`
        : `<tr><td>${range(b)}</td><td class="num">${b.n}</td><td class="num">${num(b.implied_pct, 1)}%</td><td class="num">${num(b.actual_pct, 1)}%</td>${diffCell(b)}<td>${calBar(b)}</td>
          <td class="num ${cls(b.roi_pct)}">${sgn(b.roi_pct, 1)}%</td><td class="num ${cls(b.anti_roi_pct)}">${sgn(b.anti_roi_pct, 1)}%</td></tr>`).join("")}</tbody></table></div>`;
  }
  function matchTable(r) {
    const rows = (r.matches || []).map((m) => {
      const o = m.odds;
      if (!o) return `<tr><td class="mono">${dayhm(m.kickoff)}</td><td>${esc(m.home)} – ${esc(m.away)}</td><td colspan="5" class="muted">geen odds</td></tr>`;
      const fav = favOf(o), played = ["H", "D", "A"].includes(m.result);
      const cell = (s) => `<td class="cell ${m.result === s ? "best" : ""}">${num(o[s])}${s === fav ? ` <span class="muted" style="font-size:10px">fav</span>` : ""}${m.best ? `<div class="muted" style="font-size:10.5px">${num(m.best[s][0])} ${esc(m.best[s][1])}</div>` : ""}</td>`;
      return `<tr><td class="mono">${dayhm(m.kickoff)}</td><td>${esc(m.home)} – ${esc(m.away)}${m.src && m.src !== r.book ? ` <span class="pill">${esc(m.src)}</span>` : ""}</td>
        ${cell("H")}${cell("D")}${cell("A")}<td class="num">${num(100 * (1 / o.H + 1 / o.D + 1 / o.A - 1), 1)}%</td><td class="num">${m.score ? esc(m.score) : "–"}${played ? (m.result === fav ? " ✅" : " ⚡") : ""}</td></tr>`;
    }).join("");
    return `<table class="odds"><thead><tr><th>aftrap</th><th>wedstrijd</th><th class="num">1</th><th class="num">X</th><th class="num">2</th><th class="num">marge</th><th class="num">uitslag</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function roundDetails(rd, r, done) {
    const c = r.calc, f = c && c.strats.fav, a = c && c.strats.anti;
    return `<details class="ev"><summary><span class="t">${dayhm(r.first_kickoff)}</span>
      <span class="m">${esc(lgName(rd, r.league))} · ${esc(roundName(r))}</span>
      ${done ? "" : `<span class="pill open">loopt</span>`}
      ${c && done && c.settled ? `<span class="pill">${c.settled} wedstr.</span><span class="pill ${f.hits === f.bets ? "ok" : ""}">fav. ${f.hits}/${f.bets}</span>
        <span class="num ${cls(a.profit)}" style="font-family:var(--mono);font-weight:700">tegen fav. ${sgn(a.roi_pct, 1)}%</span>` : ""}</summary>
      <div class="body">${c && done && c.settled ? `<div class="tablewrap" style="margin-bottom:10px">${stratTable(rd, c.strats, r.calc_best?.strats)}</div>` : ""}
        ${r.matches ? `<p class="muted" style="margin:0 4px 8px">Odds ${esc(r.book)} vastgelegd ${dayhm(r.snapshot_at)} (klein = beste odds van alle bookmakers) · blauw = uitslag · ✅ favoriet won · ⚡ niet</p>${matchTable(r)}`
          : `<p class="muted">Details van oudere rondes staan in <code>data/rondes_selecties.csv</code> op de server.</p>`}</div></details>`;
  }
  function downloadCSV(rd) {
    const head = ["competitie", "speelronde", "aftrap", "thuis", "uit", "bookmaker", "uitkomst", "odds", "kans_bookmaker", "favoriet", "uitslag", "score", "raak", "beste_odds", "beste_bookmaker"];
    const q = (v) => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
    const lines = [head.join(";")];
    for (const r of rd.rounds || []) for (const m of r.matches || []) {
      const o = m.odds; if (!o) continue;
      const mg = 1 / o.H + 1 / o.D + 1 / o.A, fav = favOf(o);
      for (const s of ["H", "D", "A"]) lines.push([r.league, r.matchday || "", m.kickoff, m.home, m.away, m.src || r.book, { H: "1", D: "X", A: "2" }[s],
        String(o[s]).replace(".", ","), String(((1 / o[s]) / mg).toFixed(4)).replace(".", ","), +(s === fav), { H: "1", D: "X", A: "2" }[m.result] || m.result || "",
        m.score || "", ["H", "D", "A"].includes(m.result) ? +(m.result === s) : "", m.best ? String(m.best[s][0]).replace(".", ",") : "", m.best ? m.best[s][1] : ""].map(q).join(";"));
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    a.download = "speelrondes_selecties.csv"; a.click();
  }
  function renderRondes() {
    const el = $("tab-rondes"), rd = S.rondes;
    if (!rd) { el.innerHTML = `<div class="empty">Laden…</div>`; return; }
    if (rd.disabled) { el.innerHTML = `<div class="empty">Speelrondes staan uit (config: <code>rondes.enabled</code>).</div>`; return; }
    const act = rd.active || [];
    if (RF.lg !== "ALL" && !act.includes(RF.lg)) RF.lg = "ALL";
    const t = rd.totals || {}, sel = RF.lg === "ALL" ? t.all : (t.leagues || {})[RF.lg];
    const tot = sel || { rounds: 0, matches: 0, strats: Object.fromEntries(Object.keys(rd.strategies).map((k) => [k, { bets: 0, hits: 0, profit: 0, roi_pct: null }])) };
    const an = (RF.src === "odds" ? rd.analysis : rd.analysis_best || {})[RF.lg];
    const hist = (rd.history || []).filter((h) => RF.lg === "ALL" || h.league === RF.lg);
    const done = (rd.rounds || []).filter((r) => RF.lg === "ALL" || r.league === RF.lg);
    const open = (rd.open || []).filter((r) => RF.lg === "ALL" || r.league === RF.lg);
    const miss = (rd.results?.missing || []);
    let h = `<div class="card"><div class="kicker">wat is dit?</div>
      <p class="muted" style="margin-top:6px">Toetst of bookmakers structureel fouten maken in hun 1X2-odds. Van <b>elke</b> wedstrijd in ${act.length || (rd.leagues || []).length} competities worden de odds vastgelegd op het moment
      dat de eerste wedstrijd van de speelronde begint (${esc((rd.bookmakers || [rd.bookmaker]).join(" → "))}; ter vergelijking ook de beste odds van alle bookmakers), en na de ronde naast de uitslagen gelegd.
      <b>Kalibratie</b>: zegt de bookmaker 80%, gebeurt het dan ook 80% van de keren? <b>Strategieën</b>: 1 unit per bet; <i>Alles</i> (1, X én 2) is de referentie en verliest gemiddeld ±de marge.</p>
      ${miss.length ? `<p style="margin-top:8px;color:var(--warn);font-size:13px">⚠️ Geen uitslagbron voor: ${miss.map((c) => esc(lgName(rd, c))).join(", ")} — zet FOOTBALL_DATA_KEY en/of ODDS_API_KEY in .env.</p>` : ""}</div>`;
    h += `<div class="filters" style="margin-top:14px">${["ALL", ...act].map((c) => `<button class="chip ${RF.lg === c ? "on" : ""}" data-lg="${c}">${c === "ALL" ? "Alle competities" : esc(lgName(rd, c))}</button>`).join("")}</div>`;
    const st = tot.strats;
    const tileS = (k, label) => { const v = st[k] || {}; return `<div class="tile"><div class="kicker">${label}</div>
      <div class="big ${cls(v.roi_pct)}">${v.roi_pct == null ? "–" : sgn(v.roi_pct, 1) + "%"}</div><div class="small">${v.bets ? `${v.hits}/${v.bets} raak · ${sgn(v.profit)} u` : "nog geen bets"}</div></div>`; };
    h += `<div class="tiles">
      <div class="tile"><div class="kicker">rondes afgesloten</div><div class="big">${tot.rounds}</div><div class="small">${tot.matches} wedstrijden · ${open.length} lopend</div></div>
      ${tileS("alles", "alles (referentie)")}${tileS("fav", "favorieten")}${tileS("anti", "tegen de favoriet")}</div>`;
    h += sectionHead("kalibratie: kloppen de kansen?", `<a href="#" id="src-sw">${RF.src === "odds" ? "toon beste odds →" : "toon " + esc(rd.bookmaker) + " →"}</a>`);
    h += calTable(an);
    h += `<p class="muted" style="margin-top:6px">Streep = kans volgens de bookmaker (marge eruit), band = ±2× foutmarge, stip = werkelijk. Valt de stip buiten de band (❗), dan is het verschil waarschijnlijk geen toeval. Met een paar honderd per regel is bijna alles nog ruis.</p>`;
    if (an && an.matches) { h += sectionHead("favorieten per odds-band"); h += bandTable(an); }
    h += sectionHead("strategieën (1 u per bet)");
    h += `<div class="charts2"><div class="chart"><h4>Cumulatieve winst (units)</h4><div class="sub">${Object.keys(rd.strategies).map((k) => `<span style="color:${SCOL[k]}">■</span> ${esc(rd.strategies[k])}`).join(" · ")}</div>${cumChart(rd, hist)}</div>
      <div class="chart"><h4>Totaal per strategie</h4><div class="sub">${esc(RF.lg === "ALL" ? "alle competities" : lgName(rd, RF.lg))} · ${esc(rd.bookmaker)} vs. beste odds</div>
        <div style="margin-top:8px">${tot.rounds ? stratTable(rd, st, tot.best) : `<div class="empty">Nog geen afgesloten rondes.</div>`}</div></div></div>`;
    if (RF.lg === "ALL" && act.some((lg) => (t.leagues || {})[lg])) {
      h += sectionHead("per competitie");
      h += `<div class="tablewrap"><table><thead><tr><th>competitie</th><th class="num">rondes</th><th class="num">wedstr.</th><th class="num">alles</th><th class="num">favorieten</th><th class="num">underdogs</th><th class="num">gelijkspel</th><th class="num">tegen fav.</th></tr></thead><tbody>${
        act.filter((lg) => t.leagues[lg]).map((lg) => { const v = t.leagues[lg];
          return `<tr><td><a href="#" data-lg="${lg}" class="lg-link">${esc(lgName(rd, lg))}</a></td><td class="num">${v.rounds}</td><td class="num">${v.matches}</td>${["alles", "fav", "dog", "draw", "anti"].map((k) =>
            `<td class="num ${cls(v.strats[k].roi_pct)}">${v.strats[k].roi_pct == null ? "–" : sgn(v.strats[k].roi_pct, 1) + "%"}</td>`).join("")}</tr>`; }).join("")}</tbody></table></div>`;
    }
    if (open.length) { h += sectionHead("lopende rondes (odds vastgelegd, wacht op uitslagen)"); h += open.map((r) => roundDetails(rd, r, false)).join(""); }
    h += sectionHead("logboek rondes", `<a href="#" id="csv-dl">download CSV ↓</a>`);
    h += done.length ? done.map((r) => roundDetails(rd, r, true)).join("") : `<div class="empty">Nog geen afgesloten speelrondes.</div>`;
    el.innerHTML = h;
    el.querySelectorAll("[data-lg]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); RF.lg = b.dataset.lg; renderRondes(); }));
    $("src-sw").onclick = (e) => { e.preventDefault(); RF.src = RF.src === "odds" ? "best" : "odds"; renderRondes(); };
    $("csv-dl").onclick = (e) => { e.preventDefault(); downloadCSV(rd); };
    bindTips(el);
  }

  // ---------------------------------------------------------------- routing
  const RENDER = { home: renderHome, arbs: renderArbs, bookmakers: renderBookmakers, markten: renderMarkets, competities: renderCompetitions, odds: renderOdds, rondes: renderRondes, logboek: renderLog };
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

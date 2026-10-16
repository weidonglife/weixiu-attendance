// 今日出勤看板（員工打卡頁的分頁與 board.html 共用）
// 只讀取精簡資料：presence（今日動態）、leaveBoard（請假時段，不含假別與事由）、settings/directory（員工名單）
import {
  db, fmtTime, fmtTimeSec, fmtDateLong, todayStr, ymdOf, toHolidayMap, offDayLabel,
  leaveDaySegments, summarizeDay, esc, COMPANIES
} from "./common.js?v=10";
import {
  collection, query, where, onSnapshot, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const hh = n => `${String(n).padStart(2, "0")}:00`;
const COMPANY_CLASS = { "唯修科技": "cw", "唯校中心": "cs", "傳創機電": "cc" };
const GRACE = 10;

export function startBoard(root, { big = false } = {}) {
  root.innerHTML = `
    <div class="board${big ? " big" : ""}" data-r="root">
      <header class="fp">
        <div class="fp-id">
          <img class="fp-mark" src="vmark.png" alt="WEIXIU 唯修">
          <div>
            <div class="fp-title">唯修集團　今日出勤</div>
            <div class="fp-date" data-r="date"></div>
          </div>
        </div>
        <div class="vfd" aria-label="目前時間">
          <span class="ghost" aria-hidden="true">${big ? "88:88:88" : "88:88"}</span>
          <span class="val" data-r="time"></span>
        </div>
        <div class="fp-meter">
          <div class="gauge" data-r="gauge"></div>
          <div class="readouts" data-r="stats"></div>
        </div>
      </header>
      <div class="b-off hidden" data-r="off"></div>
      <div class="b-bar">
        <div class="seg-sw" data-r="view">
          <button data-v="plates" class="on" type="button">名牌牆</button>
          <button data-v="groups" type="button">依狀態分類</button>
        </div>
        <div class="seg-sw" data-r="filter">
          <button data-c="" class="on" type="button">全部</button>
          ${Object.values(COMPANIES).map(c => `<button data-c="${esc(c)}" type="button">${esc(c)}</button>`).join("")}
        </div>
        <div class="seg-sw theme-sw" data-r="theme" title="畫面亮度">
          <button data-t="t-light" type="button">亮色</button>
          <button data-t="t-bright" type="button">藍色</button>
          <button data-t="t-dark" type="button">深色</button>
        </div>
        <div class="b-legend" data-r="legend">
          <span class="lg in"><i></i>上班</span><span class="lg field"><i></i>外勤</span><span class="lg leave"><i></i>請假</span>
          <span class="lg none"><i></i>尚未打卡</span><span class="lg late"><i></i>未到</span><span class="lg off"><i></i>已下班</span>
        </div>
      </div>
      <div data-r="sections"></div>
      <footer class="b-foot">
        <span class="live" aria-hidden="true"></span><span data-r="updated">連線中…</span>
        <span class="b-note">有人打卡會即時更新，另每 2 分鐘重新讀取一次。請假只顯示時段，不顯示假別。</span>
      </footer>
    </div>`;
  const $r = k => root.querySelector(`[data-r="${k}"]`);

  let directory = [], holidays = new Map(), presence = {}, leaveDocs = [], filter = "";
  let view = "plates";
  let theme = "t-bright";
  try { theme = localStorage.getItem("wx_board_theme") || theme; } catch (e) { /* 無痕模式 */ }
  let lastUpdated = new Date();
  try { view = localStorage.getItem("wx_board_view") || "plates"; } catch (e) { /* 無痕模式 */ }
  let today = todayStr(), ymd = ymdOf(new Date());
  const prevStatus = {};
  const unsubs = [];

  $r("filter").onclick = e => {
    const b = e.target.closest("button[data-c]");
    if (!b) return;
    filter = b.dataset.c;
    $r("filter").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  };

  const setView = v => {
    view = v;
    try { localStorage.setItem("wx_board_view", v); } catch (e) { /* 無痕模式 */ }
    $r("view").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.v === v));
    $r("legend").classList.toggle("hidden", v !== "plates");
    render();
  };
  const setTheme = t => {
    theme = ["t-light", "t-bright", "t-dark"].includes(t) ? t : "t-bright";
    try { localStorage.setItem("wx_board_theme", theme); } catch (e) { /* 無痕模式 */ }
    const r = $r("root");
    r.classList.remove("t-light", "t-bright", "t-dark");
    r.classList.add(theme);
    if (document.body.classList.contains("dark-page")) document.body.dataset.boardTheme = theme;
    $r("theme").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.t === theme));
  };
  $r("theme").onclick = e => { const b = e.target.closest("button[data-t]"); if (b) setTheme(b.dataset.t); };
  setTheme(theme);
  $r("view").onclick = e => { const b = e.target.closest("button[data-v]"); if (b) setView(b.dataset.v); };

  function subscribe() {
    unsubs.splice(0).forEach(u => u());
    presence = {}; leaveDocs = [];
    const onErr = e => { $r("sections").innerHTML = `<div class="msg err">無法讀取資料：${esc(e.message || e.code)}</div>`; };
    unsubs.push(onSnapshot(doc(db, "settings", "directory"), s => { directory = s.exists() ? s.data().list || [] : []; render(); }, onErr));
    unsubs.push(onSnapshot(doc(db, "settings", "holidays"), s => { holidays = toHolidayMap(s.exists() ? s.data().list : []); render(); }, onErr));
    unsubs.push(onSnapshot(query(collection(db, "presence"), where("ymd", "==", ymd)), s => {
      presence = {};
      s.docs.forEach(d => { const v = d.data({ serverTimestamps: "estimate" }); presence[v.empId] = v; });
      lastUpdated = new Date();
      render();
    }, onErr));
    unsubs.push(onSnapshot(query(collection(db, "leaveBoard"), where("endDate", ">=", today)), s => {
      leaveDocs = s.docs.map(d => d.data());
      render();
    }, onErr));
  }

  function statusOf(p, nowMin, workday) {
    const pr = presence[p.empId];
    const wins = [];
    for (const r of leaveDocs) {
      if (r.empId !== p.empId || r.startDate > today) continue;
      for (const seg of leaveDaySegments(r, holidays)) if (seg.date === today) wins.push(seg);
    }
    const inAt = pr && pr.inAt ? pr.inAt.toDate() : null;
    const outAt = pr && pr.outAt ? pr.outAt.toDate() : null;
    const part = p.empType === "part";
    const sum = summarizeDay(inAt ? [{ type: "in", ts: inAt }] : [], workday ? wins : [], part);
    const leaveTxt = wins.length ? (sum.fullLeave ? "全天" : wins.map(w => `${hh(w.s)}–${hh(w.e)}`).join("、")) : "";
    const toMin = d => { const [h, m] = fmtTime(d).split(":").map(Number); return h * 60 + m; };
    const late = !!(!part && workday && inAt && toMin(inAt) > sum.effStart * 60 + GRACE);
    let st, sub = "", tags = [];
    if (pr && pr.lastType === "out" && outAt) {
      st = "off"; sub = `${inAt ? fmtTime(inAt) + " 上班・" : ""}${fmtTime(outAt)} 下班`;
    } else if (pr && (pr.lastType === "in" || inAt)) {
      st = pr.mode === "field" ? "field" : "in";
      sub = st === "field" ? `${esc(pr.customer || "外勤")}・${inAt ? fmtTime(inAt) : ""}` : `${inAt ? fmtTime(inAt) : ""} 上班`;
    } else if (wins.length && workday) {
      st = "leave"; sub = `請假 ${leaveTxt}`;
    } else if (part) {
      // 兼職時間不固定：沒打卡＝今天沒來，不算未到
      return { st: "none", sub: "今日未上班", tags: [], overdue: false, idle: true };
    } else {
      st = "none";
      const shouldBe = sum.effStart * 60 + GRACE;
      sub = workday && nowMin > shouldBe ? "未到" : "尚未打卡";
      if (wins.length) sub += `（請假 ${leaveTxt}）`;
    }
    if (late && (st === "in" || st === "field" || st === "off")) tags.push(["late", "遲到"]);
    if (wins.length && st !== "leave" && st !== "none") tags.push(["field", `請假 ${leaveTxt}`]);
    return { st, sub, tags, overdue: st === "none" && workday && nowMin > sum.effStart * 60 + GRACE };
  }

  const SECTIONS = [
    ["in", "已上班", "🟢"], ["field", "外勤中", "🔵"], ["leave", "請假", "🟡"], ["none", "尚未打卡", "⚪"], ["off", "已下班", "⚫"]
  ];

  function render() {
    const now = new Date();
    const nowParts = fmtTime(now).split(":").map(Number);
    const nowMin = nowParts[0] * 60 + nowParts[1];
    const offLabel = offDayLabel(today, holidays);
    const workday = !offLabel;
    $r("off").classList.toggle("hidden", workday);
    $r("off").textContent = workday ? "" : `今天是${offLabel === "假日" ? "週末假日" : offLabel}，以下只列出有打卡的同仁。`;

    const people = directory.filter(p => !filter || p.company === filter);
    const groups = { in: [], field: [], leave: [], none: [], off: [] };
    let idle = 0;
    for (const p of people) {
      const s = statusOf(p, nowMin, workday);
      if ((!workday || s.idle) && s.st === "none") { if (s.idle) idle++; continue; }
      groups[s.st].push({ p, s });
    }
    const counted = people.length - idle; // 兼職今天沒來的不列入應到人數
    const arrived = groups.in.length + groups.field.length + groups.off.length;
    const overdue = groups.none.filter(x => x.s.overdue).length;
    const readout = (n, label, cls, of) => `<div class="ro ${cls}"><div class="ro-l">${label}</div>
      <div class="ro-v"><span class="seg7">${n}</span>${of != null ? `<span class="ro-of">/${of}</span>` : ""}</div></div>`;
    $r("stats").innerHTML = readout(arrived, "已到", "c-in", workday ? counted : null)
      + readout(groups.field.length, "外勤", "c-field")
      + (workday ? readout(groups.leave.length, "請假", "c-leave") + readout(overdue, "未到", overdue ? "c-late" : "c-zero") : "");
    renderGauge(groups, counted, workday, overdue);

    if (view === "plates") {
      renderPlates(people, nowMin, workday);
      return;
    }
    $r("sections").innerHTML = SECTIONS.map(([key, title, icon]) => {
      const list = groups[key];
      if (!list.length && (key === "off" || !workday)) return "";
      list.sort((a, b) => a.p.empId.localeCompare(b.p.empId));
      return `<section class="rack"><h3 class="rack-h"><span class="dot d-${key}"></span>${title}<span class="rack-n">${list.length}</span><span class="rule" aria-hidden="true"></span></h3>
        <div class="b-grid">${list.length ? list.map(({ p, s }) => {
          const changed = prevStatus[p.empId] && prevStatus[p.empId] !== s.st;
          prevStatus[p.empId] = s.st;
          return `<div class="b-card st-${key}${s.overdue ? " overdue" : ""}${changed ? " pop" : ""}">
            <div class="av ${COMPANY_CLASS[p.company] || ""}">${esc((p.name || "?").slice(0, 1))}</div>
            <div class="info"><div class="nm">${esc(p.name)}</div>
              <div class="sub">${s.sub}</div>
              ${s.tags.length ? `<div>${s.tags.map(([c, t]) => `<span class="tag ${c}">${esc(t)}</span>`).join(" ")}</div>` : ""}
            </div></div>`;
        }).join("") : `<div class="b-empty sm">無</div>`}</div></section>`;
    }).join("");
    if (!directory.length) $r("sections").innerHTML = `<div class="b-empty">員工名單尚未建立。請管理員打開一次管理後台，名單就會自動建立。</div>`;
  }

  // 出勤量尺：像校驗用的刻度尺，依狀態分段上色，游標指在「已到」人數
  function renderGauge(groups, total, workday, overdue) {
    const g = $r("gauge");
    if (!workday || !total) { g.innerHTML = ""; g.classList.add("hidden"); return; }
    g.classList.remove("hidden");
    const pct = n => (n / total * 100).toFixed(3) + "%";
    const pending = groups.none.length - overdue;
    const parts = [["in", groups.in.length], ["field", groups.field.length], ["off", groups.off.length],
      ["leave", groups.leave.length], ["late", overdue], ["none", pending]];
    const arrived = groups.in.length + groups.field.length + groups.off.length;
    let ticks = "";
    for (let i = 0; i <= total; i++) {
      const major = i % 5 === 0 || i === total;
      ticks += `<i class="${major ? "mj" : ""}" style="left:${pct(i)}">${major ? `<b>${i}</b>` : ""}</i>`;
    }
    g.innerHTML = `<div class="g-track">${parts.filter(p => p[1]).map(([k, n]) => `<span class="g-${k}" style="width:${pct(n)}"></span>`).join("")}</div>
      <div class="g-ticks">${ticks}</div>
      <div class="g-cursor" style="left:${pct(arrived)}"></div>`;
  }

  // 名牌牆：所有員工固定排列（依公司、員工編號），用指示燈與顏色表示狀態
  const PLATE_LABEL = { in: "上班", field: "外勤", leave: "請假", none: "尚未打卡", off: "已下班" };
  function renderPlates(people, nowMin, workday) {
    const byCo = new Map();
    for (const p of people) {
      if (!byCo.has(p.company)) byCo.set(p.company, []);
      byCo.get(p.company).push(p);
    }
    const order = Object.values(COMPANIES);
    const cos = [...byCo.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    $r("sections").innerHTML = cos.map(co => {
      const list = byCo.get(co).sort((a, b) => a.empId.localeCompare(b.empId));
      return `<section class="rack">
        <h3 class="rack-h"><span class="co ${COMPANY_CLASS[co] || ""}"></span>${esc(co)}<span class="rack-n">${list.length} 人</span><span class="rule" aria-hidden="true"></span></h3>
        <div class="plates">${list.map(p => {
          const s = statusOf(p, nowMin, workday);
          const cls = s.overdue ? "late" : ((!workday || s.idle) && s.st === "none" ? "rest" : s.st);
          const label = s.overdue ? "未到" : (s.idle ? "未上班" : !workday && s.st === "none" ? "休假日" : PLATE_LABEL[s.st]);
          const changed = prevStatus[p.empId] && prevStatus[p.empId] !== s.st;
          prevStatus[p.empId] = s.st;
          const pr = presence[p.empId] || {};
          const tIn = pr.inAt ? fmtTime(pr.inAt.toDate()) : "";
          const tOut = pr.outAt ? fmtTime(pr.outAt.toDate()) : "";
          const leaveTag = s.tags.find(t => t[1].startsWith("請假"));
          const late = s.tags.some(t => t[1] === "遲到");
          let detail = "";
          if (s.st === "in") detail = tIn + (leaveTag ? `　${leaveTag[1]}` : "");
          else if (s.st === "field") detail = `${esc(pr.customer || "")}${tIn ? "　" + tIn : ""}`;
          else if (s.st === "off") detail = `${tIn}–${tOut}`;
          else if (s.idle) detail = "時間不固定";
          else if (s.st === "leave") detail = s.sub.replace(/^請假\s*/, "");
          else if (s.sub.includes("請假")) detail = s.sub.replace(/^(未到|尚未打卡)/, "").replace(/[（）]/g, "");
          return `<div class="plate p-${cls}${late ? " is-late" : ""}${changed ? " pop" : ""}" title="${esc(p.name)} ${label}">
            <span class="co ${COMPANY_CLASS[co] || ""}" aria-hidden="true"></span>
            <span class="led" aria-hidden="true"></span>
            <div class="pn">${esc(p.name)}</div>
            <div class="pid">${esc(p.empId)}${p.empType === "part" ? "・兼職" : ""}</div>
            <div class="pst">${label}${late ? `<em>遲到</em>` : ""}</div>
            <div class="pdt">${detail || "&nbsp;"}</div>
          </div>`;
        }).join("")}</div></section>`;
    }).join("") || `<div class="b-empty">沒有員工</div>`;
    if (!directory.length) $r("sections").innerHTML = `<div class="b-empty">員工名單尚未建立。請管理員打開一次管理後台，名單就會自動建立。</div>`;
  }

  function tick() {
    const now = new Date();
    $r("time").textContent = big ? fmtTimeSec(now) : fmtTime(now);
    $r("date").textContent = fmtDateLong(now);
    const t = todayStr();
    if (t !== today) { today = t; ymd = ymdOf(now); subscribe(); }
  }
  tick();
  setView(view);
  subscribe();
  const t1 = setInterval(tick, 1000);
  // 每 2 分鐘重新讀取全部資料（網路斷線恢復、或電視長時間開著時確保畫面正確）
  const REFRESH_MS = 2 * 60 * 1000;
  let nextRefresh = Date.now() + REFRESH_MS;
  const refresh = () => { subscribe(); lastUpdated = new Date(); nextRefresh = Date.now() + REFRESH_MS; };
  const t2 = setInterval(refresh, REFRESH_MS);
  const t3 = setInterval(() => {
    const left = Math.max(0, Math.round((nextRefresh - Date.now()) / 1000));
    $r("updated").textContent = `即時連線・最後更新 ${fmtTimeSec(lastUpdated)}・${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} 後重新讀取`;
  }, 1000);
  return () => { unsubs.forEach(u => u()); clearInterval(t1); clearInterval(t2); clearInterval(t3); };
}

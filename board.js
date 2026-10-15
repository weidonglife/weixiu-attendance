// 今日出勤看板（員工打卡頁的分頁與 board.html 共用）
// 只讀取精簡資料：presence（今日動態）、leaveBoard（請假時段，不含假別與事由）、settings/directory（員工名單）
import {
  db, fmtTime, fmtTimeSec, fmtDateLong, todayStr, ymdOf, toHolidayMap, offDayLabel,
  leaveDaySegments, summarizeDay, esc, COMPANIES
} from "./common.js";
import {
  collection, query, where, onSnapshot, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const hh = n => `${String(n).padStart(2, "0")}:00`;
const COMPANY_CLASS = { "唯修科技": "cw", "唯校中心": "cs", "傳創機電": "cc" };
const GRACE = 10;

export function startBoard(root, { big = false } = {}) {
  root.innerHTML = `
    <div class="board${big ? " big" : ""}">
      <div class="b-head">
        <div>
          <div class="b-time" data-r="time">--:--</div>
          <div class="b-date" data-r="date"></div>
        </div>
        <div class="b-stats" data-r="stats"></div>
      </div>
      <div class="b-off hidden" data-r="off"></div>
      <div class="tabs b-filter" data-r="filter">
        <button data-c="" class="on" type="button">全部</button>
        ${Object.values(COMPANIES).map(c => `<button data-c="${esc(c)}" type="button">${esc(c)}</button>`).join("")}
      </div>
      <div data-r="sections"></div>
      <p class="muted b-note">畫面會即時更新，不用重新整理。請假只顯示時段，不顯示假別。</p>
    </div>`;
  const $r = k => root.querySelector(`[data-r="${k}"]`);

  let directory = [], holidays = new Map(), presence = {}, leaveDocs = [], filter = "";
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

  function subscribe() {
    unsubs.splice(0).forEach(u => u());
    presence = {}; leaveDocs = [];
    const onErr = e => { $r("sections").innerHTML = `<div class="msg err">無法讀取資料：${esc(e.message || e.code)}</div>`; };
    unsubs.push(onSnapshot(doc(db, "settings", "directory"), s => { directory = s.exists() ? s.data().list || [] : []; render(); }, onErr));
    unsubs.push(onSnapshot(doc(db, "settings", "holidays"), s => { holidays = toHolidayMap(s.exists() ? s.data().list : []); render(); }, onErr));
    unsubs.push(onSnapshot(query(collection(db, "presence"), where("ymd", "==", ymd)), s => {
      presence = {};
      s.docs.forEach(d => { const v = d.data({ serverTimestamps: "estimate" }); presence[v.empId] = v; });
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
    const sum = summarizeDay(inAt ? [{ type: "in", ts: inAt }] : [], workday ? wins : []);
    const leaveTxt = wins.length ? (sum.fullLeave ? "全天" : wins.map(w => `${hh(w.s)}–${hh(w.e)}`).join("、")) : "";
    const toMin = d => { const [h, m] = fmtTime(d).split(":").map(Number); return h * 60 + m; };
    const late = !!(workday && inAt && toMin(inAt) > sum.effStart * 60 + GRACE);
    let st, sub = "", tags = [];
    if (pr && pr.lastType === "out" && outAt) {
      st = "off"; sub = `${inAt ? fmtTime(inAt) + " 上班・" : ""}${fmtTime(outAt)} 下班`;
    } else if (pr && (pr.lastType === "in" || inAt)) {
      st = pr.mode === "field" ? "field" : "in";
      sub = st === "field" ? `${esc(pr.customer || "外勤")}・${inAt ? fmtTime(inAt) : ""}` : `${inAt ? fmtTime(inAt) : ""} 上班`;
    } else if (wins.length && workday) {
      st = "leave"; sub = `請假 ${leaveTxt}`;
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
    for (const p of people) {
      const s = statusOf(p, nowMin, workday);
      if (!workday && s.st === "none") continue;
      groups[s.st].push({ p, s });
    }
    const arrived = groups.in.length + groups.field.length + groups.off.length;
    const stat = (n, label, cls) => `<div class="b-stat ${cls}"><div class="n">${n}</div><div class="l">${label}</div></div>`;
    $r("stats").innerHTML = (workday ? stat(people.length, "應到", "") : "")
      + stat(arrived, "已到", "s-in") + stat(groups.field.length, "外勤", "s-field")
      + (workday ? stat(groups.leave.length, "請假", "s-leave") + stat(groups.none.filter(x => x.s.overdue).length, "未到", "s-none") : "");

    $r("sections").innerHTML = SECTIONS.map(([key, title, icon]) => {
      const list = groups[key];
      if (!list.length && (key === "off" || !workday)) return "";
      list.sort((a, b) => a.p.empId.localeCompare(b.p.empId));
      return `<div class="b-sec"><h3>${icon} ${title} <span class="muted">${list.length}</span></h3>
        <div class="b-grid">${list.length ? list.map(({ p, s }) => {
          const changed = prevStatus[p.empId] && prevStatus[p.empId] !== s.st;
          prevStatus[p.empId] = s.st;
          return `<div class="b-card st-${key}${s.overdue ? " overdue" : ""}${changed ? " pop" : ""}">
            <div class="av ${COMPANY_CLASS[p.company] || ""}">${esc((p.name || "?").slice(0, 1))}</div>
            <div class="info"><div class="nm">${esc(p.name)}</div>
              <div class="sub">${s.sub}</div>
              ${s.tags.length ? `<div>${s.tags.map(([c, t]) => `<span class="tag ${c}">${esc(t)}</span>`).join(" ")}</div>` : ""}
            </div></div>`;
        }).join("") : `<div class="muted">無</div>`}</div></div>`;
    }).join("");
    if (!directory.length) $r("sections").innerHTML = `<div class="muted">員工名單尚未建立，請管理員先開啟一次管理後台。</div>`;
  }

  function tick() {
    const now = new Date();
    $r("time").textContent = big ? fmtTimeSec(now) : fmtTime(now);
    $r("date").textContent = fmtDateLong(now);
    const t = todayStr();
    if (t !== today) { today = t; ymd = ymdOf(now); subscribe(); }
  }
  tick();
  subscribe();
  const t1 = setInterval(tick, 1000);
  const t2 = setInterval(render, 60000); // 「未到」會隨時間變化
  return () => { unsubs.forEach(u => u()); clearInterval(t1); clearInterval(t2); };
}

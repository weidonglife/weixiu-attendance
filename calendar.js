// 出勤月曆：給直屬主管、主官／副主官、管理員看
// 資料來源：leaveList（請假一覽，不含事由）、shifts（兼職上班預告）、settings/holidays（國定假日、公休、半天停班）
import {
  db, esc, todayStr, addDays, weekdayOf, toHolidayMap, isOffDay, offDayLabel, isMakeupDay, closureOf,
  leaveDaySegments, LEAVE_LABEL, COMPANY_LIST
} from "./common.js?v=19";
import {
  collection, query, where, onSnapshot, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const WK = ["日", "一", "二", "三", "四", "五", "六"];
const hh = n => `${String(n).padStart(2, "0")}:00`;
const ymdNum = s => Number(s.replace(/-/g, ""));
const PEND = ["pending_supervisor", "pending_admin"];

export function startCalendar(root) {
  const today = todayStr();
  let ym = today.slice(0, 7);          // 目前顯示的月份 YYYY-MM
  let sel = today;                     // 選取的日期
  let company = "";
  let holidays = new Map();
  let leaves = [], shifts = [];
  let unsubs = [];
  let errText = "";

  root.innerHTML = `<div class="cal">
    <div class="cal-head">
      <button type="button" class="secondary small" data-c="prev" aria-label="上個月">‹</button>
      <b data-c="title"></b>
      <button type="button" class="secondary small" data-c="next" aria-label="下個月">›</button>
      <button type="button" class="secondary small" data-c="today">今天</button>
      <select data-c="company" aria-label="公司"><option value="">全部公司</option>${COMPANY_LIST.map(c => `<option>${esc(c)}</option>`).join("")}</select>
    </div>
    <div class="cal-legend"><span class="cc ok">已核准</span><span class="cc pend">審核中</span><span class="cc shift">兼職預告</span><span class="cal-hol-l">紅字＝放假</span></div>
    <div class="cal-grid" data-c="grid"></div>
    <div class="cal-day" data-c="day"></div>
  </div>`;
  const $c = k => root.querySelector(`[data-c="${k}"]`);

  getDoc(doc(db, "settings", "holidays"))
    .then(s => { holidays = toHolidayMap(s.exists() ? s.data().list : []); render(); })
    .catch(() => {});

  function monthRange() {
    const first = `${ym}-01`;
    const start = addDays(first, -weekdayOf(first));                    // 月曆第一格（週日）
    let last = addDays(`${addDays(`${ym}-28`, 4).slice(0, 7)}-01`, -1);   // 本月最後一天
    const end = addDays(last, 6 - weekdayOf(last));                      // 月曆最後一格（週六）
    return { first, last, start, end };
  }

  function subscribe() {
    unsubs.splice(0).forEach(u => u());
    const { start, end } = monthRange();
    errText = "";
    unsubs.push(onSnapshot(query(collection(db, "leaveList"), where("endDate", ">=", start)),
      snap => { leaves = snap.docs.map(d => ({ id: d.id, kind: "leave", ...d.data() })).filter(r => r.startDate <= end); render(); },
      () => { errText = "目前讀不到請假資料。請管理員先打開一次管理後台，再重新整理這一頁。"; render(); }));
    unsubs.push(onSnapshot(query(collection(db, "shifts"), where("ymd", ">=", ymdNum(start))),
      snap => { shifts = snap.docs.map(d => d.data()).filter(s => s.date <= end); render(); },
      () => { shifts = []; render(); }));
  }

  // 每一天的請假與兼職預告
  function byDay() {
    const m = {};
    const put = (d, x) => (m[d] = m[d] || { lv: [], sh: [] })[x.t].push(x);
    for (const r of leaves) {
      if (!["approved", ...PEND].includes(r.status)) continue;
      if (company && r.company !== company) continue;
      for (const seg of leaveDaySegments(r, holidays)) put(seg.date, { t: "lv", r, seg });
    }
    for (const s of shifts) {
      if (company && s.company !== company) continue;
      put(s.date, { t: "sh", s });
    }
    for (const k in m) {
      m[k].lv.sort((a, b) => a.seg.s - b.seg.s || a.r.empId.localeCompare(b.r.empId));
      m[k].sh.sort((a, b) => a.s.start.localeCompare(b.s.start));
    }
    return m;
  }

  function render() {
    const { start, end } = monthRange();
    $c("title").textContent = `${ym.slice(0, 4)} 年 ${Number(ym.slice(5, 7))} 月`;
    const m = byDay();
    let cells = WK.map((w, i) => `<div class="cal-wk${i === 0 || i === 6 ? " we" : ""}">${w}</div>`).join("");
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const day = m[d] || { lv: [], sh: [] };
      const off = isOffDay(d, holidays), hol = holidays.has(d) ? holidays.get(d) : "", cl = closureOf(d, holidays);
      const cls = ["cd", d.slice(0, 7) !== ym ? "out" : "", off ? "off" : "", d === today ? "today" : "", d === sel ? "sel" : ""].filter(Boolean).join(" ");
      const chips = [
        ...day.lv.map(x => `<span class="cc ${x.r.status === "approved" ? "ok" : "pend"}">${esc(x.r.name)}</span>`),
        ...day.sh.map(x => `<span class="cc shift">${esc(x.s.name)}</span>`)
      ];
      const nLv = day.lv.length, nSh = day.sh.length;
      cells += `<button type="button" class="${cls}" data-d="${d}">
        <span class="n">${Number(d.slice(8, 10))}</span>
        ${hol ? `<span class="hn">${esc(hol)}</span>` : cl ? `<span class="hn cl">⛈ ${esc(cl.name)}</span>` : ""}
        <span class="chips">${chips.slice(0, 3).join("")}${chips.length > 3 ? `<span class="more">+${chips.length - 3}</span>` : ""}</span>
        <span class="cnt">${nLv ? `<i class="dot lv"></i>${nLv}` : ""}${nSh ? ` <i class="dot sh"></i>${nSh}` : ""}</span>
      </button>`;
    }
    $c("grid").innerHTML = cells;
    renderDay(m);
  }

  function renderDay(m) {
    const d = sel, day = m[d] || { lv: [], sh: [] };
    const label = offDayLabel(d, holidays), cl = closureOf(d, holidays);
    const wd = WK[weekdayOf(d)];
    let h = `<h3>${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${wd}）${label ? ` <span class="tag late">${esc(label)}</span>` : ""}${isMakeupDay(d, holidays) ? ` <span class="tag warn">${esc(holidays.get(d))}</span>` : ""}${cl ? ` <span class="tag gray">⛈ ${hh(cl.s)}–${hh(cl.e)} ${esc(cl.name)}</span>` : ""}</h3>`;
    if (errText) h += `<p class="msg err">${esc(errText)}</p>`;
    h += day.lv.length ? day.lv.map(({ r, seg }) => `<div class="cal-row">
        <span><span class="empno">${esc(r.empId)}</span>${esc(r.name)}</span>
        <span>${esc(LEAVE_LABEL[r.leaveType] || r.leaveType || "請假")}</span>
        <span>${hh(seg.s)}–${hh(seg.e)}</span>
        <span class="tag ${r.status === "approved" ? "ok" : "warn"}">${r.status === "approved" ? "已核准" : "審核中"}</span>
      </div>`).join("") : `<p class="muted">${isOffDay(d, holidays) ? "放假日" : "沒有人請假"}</p>`;
    if (day.sh.length) {
      h += `<h4>兼職上班預告</h4>` + day.sh.map(({ s }) => `<div class="cal-row">
        <span><span class="empno">${esc(s.empId)}</span>${esc(s.name)}</span><span>兼職</span><span>${esc(s.start)}–${esc(s.end)}</span><span></span></div>`).join("");
    }
    $c("day").innerHTML = h;
  }

  const go = n => {
    const [y, mo] = ym.split("-").map(Number);
    const t = new Date(Date.UTC(y, mo - 1 + n, 1));
    ym = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    sel = ym === today.slice(0, 7) ? today : `${ym}-01`;
    subscribe(); render();
  };
  root.querySelector(".cal").addEventListener("click", e => {
    const b = e.target.closest("[data-c],[data-d]");
    if (!b) return;
    if (b.dataset.c === "prev") go(-1);
    else if (b.dataset.c === "next") go(1);
    else if (b.dataset.c === "today") { ym = today.slice(0, 7); sel = today; subscribe(); render(); }
    else if (b.dataset.d) {
      sel = b.dataset.d;
      if (sel.slice(0, 7) !== ym) { ym = sel.slice(0, 7); subscribe(); }
      render();
    }
  });
  $c("company").onchange = e => { company = e.target.value; render(); };

  subscribe(); render();
  return () => unsubs.splice(0).forEach(u => u());
}

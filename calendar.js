// 出勤月曆＋公司行事曆
//   完整版（直屬主管、主官／副主官、管理員）：請假含假別、審核中的假（資料來源 leaveList）
//   員工版：只看已核准的「誰請假」，不顯示假別（資料來源 leaveBoard）
//   所有人都看得到：公司活動（events）、兼職上班預告（shifts）、國定假日／公休／半天停班（settings/holidays）
//   所有人都可以新增公司活動；只能修改、刪除自己建的（管理員可以改全部）
import {
  db, esc, todayStr, addDays, weekdayOf, toHolidayMap, isOffDay, offDayLabel, isMakeupDay, closureOf,
  leaveDaySegments, LEAVE_LABEL, COMPANY_LIST
} from "./common.js?v=26";
import { lunarOf } from "./lunar.js?v=1";
import {
  collection, query, where, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const WK = ["日", "一", "二", "三", "四", "五", "六"];
// 活動類別：一般（紫）、行程（綠藍）、訓練（橘黃）
const CAT = { "": ["一般", "ev"], trip: ["行程", "trip"], training: ["訓練", "trn"] };
const catOf = e => CAT[e.category || ""] || CAT[""];
const hh = n => `${String(n).padStart(2, "0")}:00`;
const ymdNum = s => Number(s.replace(/-/g, ""));
const PEND = ["pending_supervisor", "pending_admin"];
const TIMES = (() => { const o = []; for (let m = 7 * 60; m <= 22 * 60; m += 30) o.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); return o; })();

// opts: { me: {empId, name}, full: 是否看完整請假（含假別）, admin: 是否可以修改所有活動 }
export function startCalendar(root, opts = {}) {
  const me = opts.me || {};
  const full = !!opts.full, admin = !!opts.admin;
  const today = todayStr();
  let ym = today.slice(0, 7);          // 目前顯示的月份 YYYY-MM
  let sel = today;                     // 選取的日期
  let company = "";
  let catF = "*";                      // 活動類別篩選
  let holidays = new Map();
  let leaves = [], shifts = [], events = [];
  let unsubs = [];
  let errText = "";
  let editing = null;                  // 正在編輯的活動（null＝沒有開表單；{}＝新增）
  let delArm = "";                     // 按過一次「刪除」的活動 id（再按一次才真的刪）

  root.innerHTML = `<div class="cal">
    <div class="cal-head">
      <button type="button" class="secondary small" data-c="prev" aria-label="上個月">‹</button>
      <b data-c="title"></b>
      <button type="button" class="secondary small" data-c="next" aria-label="下個月">›</button>
      <button type="button" class="secondary small" data-c="today">今天</button>
      <button type="button" class="small" data-c="add">＋ 新增活動</button>
      <select data-c="company" aria-label="公司"><option value="">全部公司</option>${COMPANY_LIST.map(c => `<option>${esc(c)}</option>`).join("")}</select>
      <select data-c="cat" aria-label="活動類別"><option value="*">全部活動</option>${Object.entries(CAT).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join("")}<option value="none">不顯示活動</option></select>
    </div>
    <div class="cal-legend"><span class="cc ev">一般活動</span><span class="cc trip">行程</span><span class="cc trn">訓練</span><span class="cc ok">請假${full ? "（已核准）" : ""}</span>${full ? `<span class="cc pend">審核中</span>` : ""}<span class="cc shift">兼職預告</span><span class="cal-hol-l">紅字＝放假</span></div>
    <div class="cal-grid" data-c="grid"></div>
    <div class="cal-form hidden" data-c="form"></div>
    <div class="cal-day" data-c="day"></div>
  </div>`;
  const $c = k => root.querySelector(`[data-c="${k}"]`);

  getDoc(doc(db, "settings", "holidays"))
    .then(s => { holidays = toHolidayMap(s.exists() ? s.data().list : []); render(); })
    .catch(() => {});

  function monthRange() {
    const first = `${ym}-01`;
    const start = addDays(first, -weekdayOf(first));                    // 月曆第一格（週日）
    const last = addDays(`${addDays(`${ym}-28`, 4).slice(0, 7)}-01`, -1); // 本月最後一天
    const end = addDays(last, 6 - weekdayOf(last));                      // 月曆最後一格（週六）
    return { first, last, start, end };
  }

  function subscribe() {
    unsubs.splice(0).forEach(u => u());
    const { start, end } = monthRange();
    errText = "";
    if (full) {
      unsubs.push(onSnapshot(query(collection(db, "leaveList"), where("endDate", ">=", start)),
        snap => { leaves = snap.docs.map(d => ({ id: d.id, kind: "leave", ...d.data() })).filter(r => r.startDate <= end); render(); },
        () => { errText = "目前讀不到請假資料。請管理員先打開一次管理後台，再重新整理這一頁。"; render(); }));
    } else {
      unsubs.push(onSnapshot(query(collection(db, "leaveBoard"), where("endDate", ">=", start)),
        snap => { leaves = snap.docs.map(d => ({ id: d.id, kind: "leave", status: "approved", ...d.data() })).filter(r => r.startDate <= end); render(); },
        () => { leaves = []; render(); }));
    }
    unsubs.push(onSnapshot(query(collection(db, "shifts"), where("ymd", ">=", ymdNum(start))),
      snap => { shifts = snap.docs.map(d => d.data()).filter(s => s.date <= end); render(); },
      () => { shifts = []; render(); }));
    unsubs.push(onSnapshot(query(collection(db, "events"), where("endDate", ">=", start)),
      snap => { events = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.startDate <= end); render(); },
      () => { events = []; render(); }));
  }

  const evTime = e => e.allDay ? "整天" : `${esc(e.startTime)}–${esc(e.endTime)}`;
  const canEdit = e => admin || e.createdBy === me.empId;

  // 每一天的活動、請假、兼職預告
  function byDay() {
    const m = {};
    const slot = d => (m[d] = m[d] || { ev: [], lv: [], sh: [] });
    for (const e of events) {
      if (company && e.company && e.company !== company) continue;
      if (catF === "none" || (catF !== "*" && (e.category || "") !== catF)) continue;
      for (let d = e.startDate, i = 0; d <= e.endDate && i < 62; d = addDays(d, 1), i++) slot(d).ev.push(e);
    }
    for (const r of leaves) {
      if (!["approved", ...PEND].includes(r.status)) continue;
      if (company && r.company !== company) continue;
      for (const seg of leaveDaySegments(r, holidays)) slot(seg.date).lv.push({ r, seg });
    }
    for (const s of shifts) {
      if (company && s.company !== company) continue;
      slot(s.date).sh.push(s);
    }
    for (const k in m) {
      m[k].ev.sort((a, b) => (a.allDay ? "" : a.startTime).localeCompare(b.allDay ? "" : b.startTime));
      m[k].lv.sort((a, b) => a.seg.s - b.seg.s || a.r.empId.localeCompare(b.r.empId));
      m[k].sh.sort((a, b) => a.start.localeCompare(b.start));
    }
    return m;
  }

  // 手機版格子裡的小圓點（顏色和舊 Google 日曆一致）：藍＝請假（已核准）、橘＝審核中、黃綠＝行程、粉紅＝訓練、紫＝一般活動、青＝兼職
  function cnt(day) {
    const ok = day.lv.filter(x => x.r.status === "approved").length, pd = day.lv.length - ok;
    const ec = c => day.ev.filter(e => catOf(e)[1] === c).length;
    return [[ok, "lv"], [pd, "pd"], [ec("trip"), "trip"], [ec("trn"), "trn"], [ec("ev"), "ev"], [day.sh.length, "sh"]]
      .filter(([n]) => n).map(([n, c]) => `<span><i class="dot ${c}"></i>${n}</span>`).join(" ");
  }

  function render() {
    const { start, end } = monthRange();
    $c("title").textContent = `${ym.slice(0, 4)} 年 ${Number(ym.slice(5, 7))} 月`;
    const m = byDay();
    let cells = WK.map((w, i) => `<div class="cal-wk${i === 0 || i === 6 ? " we" : ""}">${w}</div>`).join("");
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const day = m[d] || { ev: [], lv: [], sh: [] };
      const off = isOffDay(d, holidays), hol = holidays.has(d) ? holidays.get(d) : "", cl = closureOf(d, holidays);
      const cls = ["cd", d.slice(0, 7) !== ym ? "out" : "", off ? "off" : "", d === today ? "today" : "", d === sel ? "sel" : ""].filter(Boolean).join(" ");
      const chips = [
        ...day.ev.map(e => `<span class="cc ${catOf(e)[1]}">${e.allDay ? "" : esc(e.startTime) + " "}${esc(e.title)}</span>`),
        ...day.lv.map(x => `<span class="cc ${x.r.status === "approved" ? "ok" : "pend"}">${esc(x.r.name)}</span>`),
        ...day.sh.map(s => `<span class="cc shift">${esc(s.name)}</span>`)
      ];
      cells += `<button type="button" class="${cls}" data-d="${d}">
        <span class="dh"><span class="n">${Number(d.slice(8, 10))}</span>${lunarCell(d)}</span>
        ${hol ? `<span class="hn">${esc(hol)}</span>` : cl ? `<span class="hn cl">⛈ ${esc(cl.name)}</span>` : ""}
        <span class="chips">${chips.slice(0, 3).join("")}${chips.length > 3 ? `<span class="more">+${chips.length - 3}</span>` : ""}</span>
        <span class="cnt">${cnt(day)}</span>
      </button>`;
    }
    $c("grid").innerHTML = cells;
    renderDay(m);
  }

  // 農民曆：格子裡顯示農曆日（初一顯示月份），遇到傳統節日、節氣改顯示名稱
  function lunarCell(d) {
    const l = lunarOf(d);
    if (!l) return "";
    return `<span class="ln${l.fest ? " fest" : l.term ? " term" : ""}">${esc(l.label)}</span>`;
  }
  function lunarLine(d) {
    const l = lunarOf(d);
    if (!l) return "";
    return `<div class="cal-lunar">${esc(l.full)}${l.fest ? `<span class="tag field">${esc(l.fest)}</span>` : ""}${l.term ? `<span class="tag ok">${esc(l.term)}</span>` : ""}</div>`;
  }

  function renderDay(m) {
    const d = sel, day = m[d] || { ev: [], lv: [], sh: [] };
    const label = offDayLabel(d, holidays), cl = closureOf(d, holidays);
    let h = `<h3>${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WK[weekdayOf(d)]}）${label ? ` <span class="tag late">${esc(label)}</span>` : ""}${isMakeupDay(d, holidays) ? ` <span class="tag warn">${esc(holidays.get(d))}</span>` : ""}${cl ? ` <span class="tag gray">⛈ ${hh(cl.s)}–${hh(cl.e)} ${esc(cl.name)}</span>` : ""}</h3>${lunarLine(d)}`;
    if (errText) h += `<p class="msg err">${esc(errText)}</p>`;

    h += `<h4>公司活動</h4>`;
    h += day.ev.length ? day.ev.map(e => `<div class="cal-ev ${catOf(e)[1]}">
        <div class="t"><span class="cc ${catOf(e)[1]} cat">${catOf(e)[0]}</span> <b>${esc(e.title)}</b>${e.company ? ` <span class="tag gray">${esc(e.company)}</span>` : ""}</div>
        <div class="meta">${e.startDate === e.endDate ? "" : `${esc(e.startDate.slice(5))} ～ ${esc(e.endDate.slice(5))}　`}${evTime(e)}${e.location ? `　📍 ${esc(e.location)}` : ""}</div>
        ${e.note ? `<div class="meta">${esc(e.note)}</div>` : ""}
        <div class="meta muted">建立：${esc(e.createdByName || e.createdBy || "")}</div>
        ${canEdit(e) ? `<div class="acts"><button type="button" class="small secondary" data-edit="${e.id}">修改</button>
          <button type="button" class="small danger" data-del="${e.id}">${delArm === e.id ? "確定刪除？" : "刪除"}</button></div>` : ""}
      </div>`).join("") : `<p class="muted">沒有活動</p>`;

    h += `<h4>請假</h4>`;
    h += day.lv.length ? day.lv.map(({ r, seg }) => `<div class="cal-row">
        <span><span class="empno">${esc(r.empId)}</span>${esc(r.name)}</span>
        <span>${full ? esc(LEAVE_LABEL[r.leaveType] || r.leaveType || "請假") : "請假"}</span>
        <span>${hh(seg.s)}–${hh(seg.e)}</span>
        ${full ? `<span class="tag ${r.status === "approved" ? "ok" : "warn"}">${r.status === "approved" ? "已核准" : "審核中"}</span>` : "<span></span>"}
      </div>`).join("") : `<p class="muted">${isOffDay(d, holidays) ? "放假日" : "沒有人請假"}</p>`;
    if (day.sh.length) {
      h += `<h4>兼職上班預告</h4>` + day.sh.map(s => `<div class="cal-row">
        <span><span class="empno">${esc(s.empId)}</span>${esc(s.name)}</span><span>兼職</span><span>${esc(s.start)}–${esc(s.end)}</span><span></span></div>`).join("");
    }
    $c("day").innerHTML = h;
  }

  // ===== 新增／修改活動 =====
  function openForm(e) {
    editing = e || {};
    const v = { title: "", startDate: sel, endDate: sel, allDay: false, startTime: "09:00", endTime: "10:00", location: "", note: "", company: "", ...editing };
    const opt = (list, cur) => list.map(t => `<option${t === cur ? " selected" : ""}>${t}</option>`).join("");
    const f = $c("form");
    f.innerHTML = `<h3>${editing.id ? "修改活動" : "新增公司活動"}</h3>
      <label>活動名稱</label><input data-f="title" maxlength="60" value="${esc(v.title)}" placeholder="例如：ISO 內部稽核、客戶到廠、教育訓練">
      <div class="row">
        <div><label>開始日期</label><input type="date" data-f="startDate" value="${esc(v.startDate)}"></div>
        <div><label>結束日期</label><input type="date" data-f="endDate" value="${esc(v.endDate)}"></div>
      </div>
      <label class="chk"><input type="checkbox" data-f="allDay"${v.allDay ? " checked" : ""}> 整天</label>
      <div class="row" data-f="times"${v.allDay ? ' style="display:none"' : ""}>
        <div><label>開始時間</label><select data-f="startTime">${opt(TIMES, v.startTime)}</select></div>
        <div><label>結束時間</label><select data-f="endTime">${opt(TIMES, v.endTime)}</select></div>
      </div>
      <label>地點（選填）</label><input data-f="location" maxlength="60" value="${esc(v.location)}">
      <label>說明（選填）</label><textarea data-f="note" maxlength="300" rows="2">${esc(v.note)}</textarea>
      <label>類別</label><select data-f="category">${Object.entries(CAT).map(([k, [n]]) => `<option value="${k}"${k === (v.category || "") ? " selected" : ""}>${n}</option>`).join("")}</select>
      <label>對象</label><select data-f="company"><option value="">全體同仁</option>${COMPANY_LIST.map(c => `<option${c === v.company ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <div class="acts" style="margin-top:12px">
        <button type="button" data-c="save">${editing.id ? "儲存修改" : "新增活動"}</button>
        <button type="button" class="secondary" data-c="cancel">取消</button>
      </div>
      <div class="msg hidden" data-c="fmsg"></div>`;
    f.classList.remove("hidden");
    f.querySelector('[data-f="allDay"]').onchange = ev => { f.querySelector('[data-f="times"]').style.display = ev.target.checked ? "none" : ""; };
    f.querySelector('[data-f="title"]').focus();
    f.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function closeForm() { editing = null; $c("form").classList.add("hidden"); $c("form").innerHTML = ""; }
  function fmsg(t, k) { const el = $c("fmsg"); el.className = `msg ${k}`; el.textContent = t; }

  async function saveForm() {
    const f = $c("form"), g = k => f.querySelector(`[data-f="${k}"]`);
    const d = {
      title: g("title").value.trim(), startDate: g("startDate").value, endDate: g("endDate").value || g("startDate").value,
      allDay: g("allDay").checked, startTime: null, endTime: null,
      location: g("location").value.trim(), note: g("note").value.trim(), company: g("company").value, category: g("category").value
    };
    if (!d.allDay) { d.startTime = g("startTime").value; d.endTime = g("endTime").value; }
    if (!d.title) return fmsg("請輸入活動名稱", "err");
    if (!d.startDate) return fmsg("請選開始日期", "err");
    if (d.endDate < d.startDate) return fmsg("結束日期不能早於開始日期", "err");
    if (addDays(d.startDate, 61) < d.endDate) return fmsg("活動最長 62 天", "err");
    if (!d.allDay && d.startDate === d.endDate && d.endTime <= d.startTime) return fmsg("結束時間要晚於開始時間", "err");
    const btn = $c("save"); btn.disabled = true;
    try {
      if (editing.id) {
        await updateDoc(doc(db, "events", editing.id), { ...d, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "events"), { ...d, createdBy: me.empId, createdByName: me.name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      sel = d.startDate;
      if (sel.slice(0, 7) !== ym) { ym = sel.slice(0, 7); subscribe(); }
      closeForm(); render();
    } catch (e) {
      fmsg(e && e.code === "permission-denied" ? "沒有權限：只能修改自己建立的活動" : (e.message || "儲存失敗"), "err");
      btn.disabled = false;
    }
  }

  const go = n => {
    const [y, mo] = ym.split("-").map(Number);
    const t = new Date(Date.UTC(y, mo - 1 + n, 1));
    ym = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    sel = ym === today.slice(0, 7) ? today : `${ym}-01`;
    subscribe(); render();
  };
  root.querySelector(".cal").addEventListener("click", async e => {
    const b = e.target.closest("[data-c],[data-d],[data-edit],[data-del]");
    if (!b) return;
    if (b.dataset.edit) { openForm(events.find(x => x.id === b.dataset.edit)); return; }
    if (b.dataset.del) {
      if (delArm !== b.dataset.del) { delArm = b.dataset.del; render(); return; }
      delArm = "";
      try { await deleteDoc(doc(db, "events", b.dataset.del)); } catch (err) { errText = "刪除失敗：只能刪除自己建立的活動"; render(); }
      return;
    }
    const c = b.dataset.c;
    if (c === "prev") go(-1);
    else if (c === "next") go(1);
    else if (c === "today") { ym = today.slice(0, 7); sel = today; subscribe(); render(); }
    else if (c === "add") openForm(null);
    else if (c === "save") saveForm();
    else if (c === "cancel") closeForm();
    else if (b.dataset.d) {
      sel = b.dataset.d; delArm = "";
      if (sel.slice(0, 7) !== ym) { ym = sel.slice(0, 7); subscribe(); }
      render();
    }
  });
  $c("company").onchange = e => { company = e.target.value; render(); };
  $c("cat").onchange = e => { catF = e.target.value; render(); };

  subscribe(); render();
  return () => unsubs.splice(0).forEach(u => u());
}

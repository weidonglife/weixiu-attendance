// 管理後台
import {
  firebaseConfig, auth, db, loginWithEmpId, logout, normEmpId, validEmpId, EMPID_RULE, COMPANY_LIST, makeEmail,
  fmtTime, ymOf, ymdOf, ymdToInput, inputToYmd, summarizeDay, tagsHtml, MODE_LABEL, TYPE_LABEL,
  getPosition, DEFAULT_RADIUS, esc, errMsg, showMsg, hideMsg,
  todayStr, toHolidayMap, isOffDay, offDayLabel, buildLeaveMap, computeBalances, fmtHours,
  LEAVE_LABEL, STATUS_INFO, reqTitle, reqWhen, reqSortKey,
  computeMonthReport, leaveBalanceOverview, fmtTimeSec, OT_COMP_LABEL,
  isPart, EMP_TYPE_LABEL, closureWins, closureOf, closureText, notify, callNotify, NOTIFY_URL, annualEntitlement, workMinutes, FULLTIME_YEAR_HOURS, addMonths, HOURS_PER_DAY
} from "./common.js?v=18";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch,
  serverTimestamp, Timestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const views = ["vLoading", "vLogin", "vDenied", "vMain"];
function show(v) { views.forEach(x => $(x).classList.toggle("hidden", x !== v)); }

// 用第二個連線建立員工帳號，避免管理員自己被登出
const secondaryAuth = getAuth(initializeApp(firebaseConfig, "secondary"));

let me = null;
let staff = [];            // 在職員工
let holidays = new Map();  // 國定假日
let approvedLeaves = [];   // 所有已核准的假單（出勤表用）
let officeCfg = {};        // 公司位置設定（含系統啟用日 goLive）

onAuthStateChanged(auth, async user => {
  if (!user) { me = null; stopPendingWatch(); $("who").textContent = ""; show("vLogin"); return; }
  show("vLoading");
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active !== true || snap.data().role !== "admin") { show("vDenied"); return; }
    me = { uid: user.uid, ...snap.data() };
    $("who").textContent = `${me.name}（${me.empId}）`;
    show("vMain");
    $("dayPick").value = ymdToInput(ymdOf(new Date()));
    $("recMonth").value = $("rptMonth").value = todayStr().slice(0, 7);
    $("bkYear").value = todayStr().slice(0, 4);
    await Promise.all([loadStaff(), loadHolidays(), loadApprovedLeaves(), loadOffice()]);
    loadDay();
    loadReport();
    loadRecords();
    watchPending();
  } catch (e) { show("vDenied"); }
});

$("btnLogin").onclick = async () => {
  hideMsg($("loginMsg"));
  $("btnLogin").disabled = true;
  try { await loginWithEmpId($("loginId").value, $("loginPw").value); $("loginPw").value = ""; }
  catch (e) { showMsg($("loginMsg"), errMsg(e), "err"); }
  $("btnLogin").disabled = false;
};
$("loginPw").addEventListener("keydown", e => { if (e.key === "Enter") $("btnLogin").click(); });
document.querySelectorAll(".btnLogout").forEach(b => b.onclick = () => logout());

// ===== 分頁 =====
const TABS = ["tToday", "tReport", "tStaff", "tCor", "tReq", "tRec", "tOffice", "tHol"];
document.querySelectorAll(".tabs button[data-tab]").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tabs button[data-tab]").forEach(b => b.classList.toggle("on", b === btn));
    TABS.forEach(id => $(id).classList.toggle("hidden", id !== btn.dataset.tab));
  };
});

function staffName(empId) {
  const s = staff.find(x => x.empId === empId);
  return s ? `${s.name}（${s.empId}）` : empId || "";
}

// ===== 共用資料 =====
async function loadHolidays() {
  const snap = await getDoc(doc(db, "settings", "holidays"));
  const list = snap.exists() ? snap.data().list || [] : [];
  holidays = toHolidayMap(list);
  $("holText").value = list.map(holLine).join("\n");
  holYearHint(list);
}
// 今年或明年（10 月起）還沒設定假日時，提醒管理員匯入
function holYearHint(list) {
  const t = todayStr(), y = Number(t.slice(0, 4));
  const want = [y].concat(Number(t.slice(5, 7)) >= 10 ? [y + 1] : []);
  const missing = want.filter(yy => !list.some(h => h.date.startsWith(yy + "-")));
  if (!$("holYear").value) $("holYear").value = missing[0] || y;
  $("holHint").classList.toggle("hidden", !missing.length);
  $("holHint").textContent = missing.length ? `還沒有設定 ${missing.join("、")} 年的國定假日，請選年度後按「從政府行事曆自動匯入」。` : "";
}
async function loadApprovedLeaves() {
  const snap = await getDocs(query(collection(db, "requests"), where("status", "==", "approved")));
  approvedLeaves = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.kind === "leave");
  syncLeaveBoard().catch(e => console.warn("leaveBoard", e));
}

// 看板用的請假時段（只有時間，不含假別與事由），跟著已核准假單同步
const LB_KEYS = ["empId", "name", "company", "startDate", "endDate", "startHour", "endHour"];
async function syncLeaveBoard() {
  const today = todayStr();
  const want = new Map(approvedLeaves.filter(r => r.endDate >= today)
    .map(r => [r.id, Object.fromEntries(LB_KEYS.map(k => [k, r[k] ?? null]))]));
  const snap = await getDocs(collection(db, "leaveBoard"));
  const have = new Map(snap.docs.map(d => [d.id, d.data()]));
  const batch = writeBatch(db);
  let n = 0;
  for (const [id, v] of want) {
    const h = have.get(id);
    if (!h || LB_KEYS.some(k => (h[k] ?? null) !== v[k])) { batch.set(doc(db, "leaveBoard", id), v); n++; }
  }
  for (const id of have.keys()) if (!want.has(id)) { batch.delete(doc(db, "leaveBoard", id)); n++; }
  if (n) await batch.commit();
}

// 看板用的員工名單（只有編號、姓名、公司）
async function syncDirectory() {
  const list = staff.map(s => ({ empId: s.empId, name: s.name, company: s.company, ...(isPart(s) ? { empType: "part" } : {}) }));
  const cur = await getDoc(doc(db, "settings", "directory"));
  if (cur.exists() && JSON.stringify(cur.data().list) === JSON.stringify(list)) return;
  await setDoc(doc(db, "settings", "directory"), { list, updatedAt: serverTimestamp() });
}

// ===== 每日出勤 =====
$("dayPick").onchange = () => loadDay();
$("btnReloadDay").onclick = async () => { await loadApprovedLeaves(); loadDay(); };

async function loadDay() {
  const body = $("dayBody");
  body.innerHTML = `<tr><td colspan="6" class="muted">載入中…</td></tr>`;
  try {
    const ds = $("dayPick").value;
    const ymd = inputToYmd(ds);
    const [snap, shSnap] = await Promise.all([
      getDocs(query(collection(db, "punches"), where("ymd", "==", ymd))),
      getDocs(query(collection(db, "shifts"), where("date", "==", ds)))
    ]);
    const shiftOf = {};
    shSnap.docs.forEach(d => { const v = d.data(); shiftOf[v.empId] = v; });
    const nowMin = (() => { const [h, m] = fmtTime(new Date()).split(":").map(Number); return h * 60 + m; })();
    const byEmp = {};
    snap.docs.forEach(d => {
      const p = { ...d.data(), ts: d.data().ts.toDate() };
      (byEmp[p.empId] = byEmp[p.empId] || []).push(p);
    });
    const isToday = ymd === ymdOf(new Date());
    const off = offDayLabel(ds, holidays) || (officeCfg.goLive && ds < officeCfg.goLive ? "系統啟用前" : "");
    const leaveByEmp = {};
    for (const r of approvedLeaves) {
      const m = buildLeaveMap([r], holidays);
      if (m[ds]) (leaveByEmp[r.empId] = leaveByEmp[r.empId] || []).push(...m[ds]);
    }
    const rows = staff.map(s => {
      const list = (byEmp[s.empId] || []).sort((a, b) => a.ts - b.ts);
      const wins = leaveByEmp[s.empId] || [];
      const leaveTxt = wins.length ? `<br><span class="muted">${wins.map(w => `${esc(LEAVE_LABEL[w.type] || w.type)} ${w.hours}h`).join("、")}</span>` : "";
      const nameCell = `<td>${esc(s.name)}${isPart(s) ? ' <span class="tag gray">兼職</span>' : ""}<br><span class="muted">${esc(s.empId)}</span></td><td>${esc(s.company)}</td>`;
      if (!list.length) {
        let tags;
        if (isPart(s) && shiftOf[s.empId]) {
          const sh = shiftOf[s.empId];
          const [h, m] = sh.start.split(":").map(Number);
          const late = isToday ? nowMin > h * 60 + m + 10 : ds < todayStr(); // 未來日期不算未打卡
          tags = [[late ? "warn" : "gray", `預計 ${sh.start}–${sh.end}${late ? " 未打卡" : ""}`]];
        }
        else if (off) tags = [["gray", off]];
        else if (isPart(s) && !wins.length) tags = [["gray", "兼職・未上班"]];
        else {
          const sum = summarizeDay([], wins.concat(closureWins(ds, holidays)));
          if (sum.fullLeave || sum.closedAll) tags = sum.tags;
          else tags = [["warn", isToday ? "尚未打卡" : "未打卡"]].concat(wins.length ? [["field", `請假 ${sum.leaveHours}h`]] : []).concat(sum.tags.filter(t => t[0] === "gray"));
        }
        return `<tr>${nameCell}<td>—</td><td>—</td><td>${tagsHtml(tags)}</td><td>${leaveTxt}</td></tr>`;
      }
      const sum = summarizeDay(list, wins.concat(closureWins(ds, holidays)), isPart(s));
      let tags = isToday ? sum.tags.filter(t => t[1] !== "未打下班卡" && t[1] !== "早退") : sum.tags;
      if (off) tags = [["gray", off]].concat(tags.filter(t => !["未打上班卡", "未打下班卡", "遲到", "早退", "正常"].includes(t[1])));
      if (isPart(s) && shiftOf[s.empId]) tags = tags.concat([["field", `預告 ${shiftOf[s.empId].start}–${shiftOf[s.empId].end}`]]);
      const detail = list.map(p => {
        const where_ = p.mode === "field" ? `：${esc(p.customer)}` : p.distance != null ? `（${p.distance} m）` : "";
        const map = p.lat != null ? ` <a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener">地圖</a>` : "";
        return `${fmtTime(p.ts)} ${TYPE_LABEL[p.type]}・${MODE_LABEL[p.mode]}${where_}${map}`;
      }).join("<br>");
      return `<tr>${nameCell}
        <td>${sum.firstIn ? fmtTime(sum.firstIn.ts) : "—"}</td><td>${sum.lastOut ? fmtTime(sum.lastOut.ts) : "—"}</td>
        <td>${tagsHtml(tags.length ? tags : [["ok", "正常"]])}</td><td class="muted">${detail}${leaveTxt}</td></tr>`;
    });
    body.innerHTML = rows.join("") || `<tr><td colspan="6" class="muted">尚未建立員工</td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="6">${esc(errMsg(e))}</td></tr>`; }
}

// ===== 月報表 =====
let lastReport = null;
$("rptMonth").onchange = () => loadReport();
$("btnRpt").onclick = async () => { await loadApprovedLeaves(); loadReport(); };

const num = v => v ? v : '<span class="muted">0</span>';
async function loadReport() {
  const body = $("rptSum");
  body.innerHTML = `<tr><td colspan="14" class="muted">計算中…</td></tr>`;
  hideMsg($("rptMsg"));
  try {
    const ym = Number($("rptMonth").value.replace("-", ""));
    const [pSnap, rSnap, allSnap] = await Promise.all([
      getDocs(query(collection(db, "punches"), where("ym", "==", ym))),
      getDocs(query(collection(db, "requests"), where("ym", "==", ym))),
      getDocs(collection(db, "requests"))
    ]);
    const punches = pSnap.docs.map(d => ({ ...d.data(), ts: d.data().ts.toDate() }));
    const monthReqs = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allReqs = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const today = todayStr();
    const R = computeMonthReport({ ym, staff, punches, leaves: approvedLeaves, monthReqs, holidays, today, goLive: officeCfg.goLive || null });
    const bal = leaveBalanceOverview(staff, allReqs, today);
    lastReport = { ym, R, punches, monthReqs, bal };

    $("rptNote").textContent = (R.lastDate ? `統計期間：${String(ym).slice(0, 4)}-${String(ym).slice(4)}-01 ～ ${R.lastDate}（今天的資料還不完整，不列入）。` : "這個月還沒有可以統計的日子。")
      + "遲到以 08:10 後打卡計，遲到分鐘數從 08:00 起算；請假時段不算遲到或早退。工時＝上班到下班，扣掉 12:00–13:00 午休。兼職不算遲到早退，只統計有來的日子。";
    body.innerHTML = R.summary.map(s => {
      const other = s.leave.comp + s.leave.family + s.leave.menstrual + s.leave.other;
      const bad = s.lateCount + s.earlyCount + s.missIn + s.missOut + s.absent > 0;
      return `<tr class="${bad ? "hl" : ""}"><td>${esc(s.name)}${s.part ? ' <span class="tag gray">兼職</span>' : ""}<br><span class="muted">${esc(s.empId)}</span></td>
        <td>${s.part ? '<span class="muted">—</span>' : s.workdays}</td><td>${s.attended}</td><td>${s.workHours ? `<b>${s.workHours}</b> h` : num(0)}</td><td>${num(s.fullLeaveDays)}</td><td>${num(s.absent)}</td>
        <td>${s.lateCount ? `${s.lateCount} 次<br><span class="muted">${s.lateMin} 分</span>` : num(0)}</td>
        <td>${s.earlyCount ? `${s.earlyCount} 次<br><span class="muted">${s.earlyMin} 分</span>` : num(0)}</td>
        <td>${num(s.missIn + s.missOut)}</td>
        <td>${num(s.leave.annual)}</td><td>${num(s.leave.sick)}</td><td>${num(s.leave.personal)}</td><td>${num(other)}</td>
        <td>${num(s.otPay + s.otComp)}</td></tr>`;
    }).join("") || `<tr><td colspan="14" class="muted">沒有資料</td></tr>`;

    $("anoCount").textContent = R.anomalies.length ? `（${R.anomalies.length} 筆）` : "";
    $("anoBody").innerHTML = R.anomalies.map(a => `<tr>
        <td>${esc(a.date.slice(5))}（${a.weekday}）</td><td>${esc(a.name)}<br><span class="muted">${esc(a.empId)}</span></td>
        <td>${a.firstIn || "—"}</td><td>${a.lastOut || "—"}</td><td>${tagsHtml(a.issues.map(i => [i.startsWith("遲到") || i.startsWith("早退") ? "late" : "warn", i]))}</td></tr>`).join("")
      || `<tr><td colspan="5" class="muted">本月沒有異常 👍</td></tr>`;

    $("balBody").innerHTML = bal.map(b => {
      const warn = b.daysLeft != null && b.daysLeft <= 60 && b.annualLeft > 0;
      const period = !b.hireDate ? '<span class="tag warn">未設定到職日</span>'
        : !b.ent.start ? `${esc(b.ent.end)} 起可休` : `${esc(b.ent.start)} ～ ${esc(b.ent.end)}${b.daysLeft != null ? `<br><span class="muted">剩 ${b.daysLeft} 天結束</span>` : ""}`;
      return `<tr class="${warn ? "hl" : ""}"><td>${esc(b.name)}<br><span class="muted">${esc(b.empId)}</span></td>
        <td>${esc(b.hireDate || "—")}</td><td>${period}</td><td>${!b.ent ? "—" : b.part ? (b.ent.start ? `${b.annualTotal} 小時<br><span class="muted">兼職按比例</span>` : "—") : b.ent.days + " 天"}</td>
        <td>${fmtHours(b.annualUsed)}</td><td><b>${fmtHours(b.annualLeft)}</b></td><td>${fmtHours(b.compLeft)}</td></tr>`;
    }).join("") || `<tr><td colspan="7" class="muted">沒有員工</td></tr>`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="14">${esc(errMsg(e))}</td></tr>`;
  }
}

// ----- Excel 匯出（使用 SheetJS，需要時才載入）-----
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = resolve;
      s.onerror = () => { xlsxLoading = null; reject(new Error("無法載入 Excel 元件，請檢查網路後再試")); };
      document.head.appendChild(s);
    });
  }
  return xlsxLoading;
}
function addSheet(wb, name, headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = headers.map((h, i) => {
    const len = Math.max(String(h).length, ...rows.map(r => String(r[i] ?? "").length));
    return { wch: Math.min(50, Math.max(8, len + 2)) };
  });
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, name);
}
const hh = n => `${String(n).padStart(2, "0")}:00`;
const STATUS_TEXT = s => (STATUS_INFO[s] || ["", s])[1];
function reqRow(r) {
  const leave = r.kind === "leave";
  return [
    r.empId, r.name, r.company, leave ? "請假" : "加班",
    leave ? (LEAVE_LABEL[r.leaveType] || r.leaveType) : (OT_COMP_LABEL[r.comp] || r.comp),
    leave ? `${r.startDate} ${hh(r.startHour)}` : `${r.date} ${r.startTime}`,
    leave ? `${r.endDate} ${hh(r.endHour)}` : `${r.date} ${r.endTime}`,
    r.hours, r.reason, STATUS_TEXT(r.status),
    r.supBy || "", r.supNote || "", r.adminBy || "", r.adminNote || ""
  ];
}
const REQ_HEAD = ["員工編號 Emp ID", "姓名 Name", "公司 Company", "類別 Kind", "假別／補償 Type", "開始 Start", "結束 End",
  "時數 Hours", "事由 Reason", "狀態 Status", "主管 Supervisor", "主管意見 Sup. Note", "核准人 Approved By", "管理員意見 Admin Note"];
function punchRow(p) {
  return [
    ymdToInput(p.ymd), fmtTimeSec(p.ts), p.empId, p.name, p.company, TYPE_LABEL[p.type], MODE_LABEL[p.mode],
    p.customer || "", p.distance ?? "", p.lat ?? "", p.lng ?? "", p.accuracy ?? "",
    p.mode === "correction" ? `補打卡：${p.note || ""}（核准：${p.approvedBy || ""}）` : ""
  ];
}
const PUNCH_HEAD = ["日期 Date", "時間 Time", "員工編號 Emp ID", "姓名 Name", "公司 Company", "上下班 In/Out", "方式 Mode",
  "客戶／地點 Customer", "距公司(m) Distance", "緯度 Lat", "經度 Lng", "定位誤差(m) Accuracy", "備註 Note"];

$("btnRptXlsx").onclick = async () => {
  const msg = $("rptMsg");
  if (!lastReport) { showMsg(msg, "報表還在計算中，請稍候", "err"); return; }
  $("btnRptXlsx").disabled = true;
  try {
    await loadXlsx();
    const { ym, R, punches, monthReqs, bal } = lastReport;
    const label = `${String(ym).slice(0, 4)}-${String(ym).slice(4)}`;
    const wb = XLSX.utils.book_new();
    addSheet(wb, "月總表", ["員工編號 Emp ID", "姓名 Name", "公司 Company", "身分 Type", "應出勤日 Workdays", "出勤日 Attended",
      "全天請假日 Leave Days", "未打卡日 Absent", "遲到次數 Late", "遲到分鐘 Late Min", "早退次數 Early", "早退分鐘 Early Min",
      "未打上班卡 Missed In", "未打下班卡 Missed Out", "假日出勤 Off-day Work", "外勤日 Field Days", "補打卡 Corrections",
      "在勤時數 Hours", "特休(h) Annual", "補休(h) Comp", "事假(h) Personal", "家庭照顧假(h) Family", "病假(h) Sick",
      "生理假(h) Menstrual", "其他假(h) Other", "加班-加班費(h) OT Pay", "加班-補休(h) OT Comp"],
      R.summary.map(s => [s.empId, s.name, s.company, s.part ? "兼職" : "正職", s.part ? "" : s.workdays, s.attended, s.fullLeaveDays, s.absent, s.lateCount, s.lateMin,
        s.earlyCount, s.earlyMin, s.missIn, s.missOut, s.offDayWork, s.field, s.correction, s.workHours,
        s.leave.annual, s.leave.comp, s.leave.personal, s.leave.family, s.leave.sick, s.leave.menstrual, s.leave.other, s.otPay, s.otComp]));
    addSheet(wb, "每日明細", ["日期 Date", "星期 Day", "員工編號 Emp ID", "姓名 Name", "公司 Company", "上班 In", "下班 Out",
      "在勤時數 Hours", "遲到分鐘 Late Min", "早退分鐘 Early Min", "請假 Leave", "加班(h) OT", "狀態 Status"],
      R.days.map(d => [d.date, d.weekday, d.empId, d.name, d.company, d.firstIn, d.lastOut, d.workHours, d.lateMin, d.earlyMin, d.leave, d.overtime, d.status]));
    addSheet(wb, "異常清單", ["日期 Date", "星期 Day", "員工編號 Emp ID", "姓名 Name", "上班 In", "下班 Out", "異常 Issue"],
      R.anomalies.map(a => [a.date, a.weekday, a.empId, a.name, a.firstIn, a.lastOut, a.issues.join("、")]));
    addSheet(wb, "請假加班", REQ_HEAD, [...monthReqs].sort((a, b) => reqSortKey(a).localeCompare(reqSortKey(b))).map(reqRow));
    addSheet(wb, "打卡原始紀錄", PUNCH_HEAD, [...punches].sort((a, b) => a.ts - b.ts).map(punchRow));
    addSheet(wb, "特休補休餘額", ["員工編號 Emp ID", "姓名 Name", "到職日 Hire Date", "年度開始 Period Start", "年度結束 Period End",
      "年度天數 Days", "已用(h) Used", "特休剩餘(h) Annual Left", "補休剩餘(h) Comp Left"],
      bal.map(b => [b.empId, b.name, b.hireDate, b.ent && b.ent.start || "", b.ent ? b.ent.end : "", b.ent ? b.ent.days : "",
        b.annualUsed, b.annualLeft, b.compLeft]));
    XLSX.writeFile(wb, `出勤月報_${label}.xlsx`);
    showMsg(msg, `已匯出「出勤月報_${label}.xlsx」，請到瀏覽器的下載資料夾查看`, "ok");
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnRptXlsx").disabled = false;
};

$("btnBackup").onclick = async () => {
  const msg = $("bkMsg");
  const y = Number($("bkYear").value);
  if (!(y >= 2020 && y <= 2100)) { showMsg(msg, "請輸入正確的年度", "err"); return; }
  $("btnBackup").disabled = true;
  showMsg(msg, "正在讀取全年資料…", "info");
  try {
    await loadXlsx();
    const yms = Array.from({ length: 12 }, (_, i) => y * 100 + i + 1);
    const [pSnap, rSnap, cSnap, uSnap] = await Promise.all([
      getDocs(query(collection(db, "punches"), where("ym", "in", yms))),
      getDocs(query(collection(db, "requests"), where("ym", "in", yms))),
      getDocs(collection(db, "corrections")),
      getDocs(collection(db, "users"))
    ]);
    const punches = pSnap.docs.map(d => ({ ...d.data(), ts: d.data().ts.toDate() })).sort((a, b) => a.ts - b.ts);
    const reqs = rSnap.docs.map(d => d.data()).sort((a, b) => reqSortKey(a).localeCompare(reqSortKey(b)));
    const cors = cSnap.docs.map(d => d.data()).filter(c => String(c.date).startsWith(String(y))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const users = uSnap.docs.map(d => d.data()).sort((a, b) => a.empId.localeCompare(b.empId) || (b.active ? 1 : 0) - (a.active ? 1 : 0));
    const wb = XLSX.utils.book_new();
    addSheet(wb, "打卡紀錄", PUNCH_HEAD, punches.map(punchRow));
    addSheet(wb, "請假加班", REQ_HEAD, reqs.map(reqRow));
    addSheet(wb, "補打卡申請", ["員工編號 Emp ID", "姓名 Name", "日期 Date", "時間 Time", "上下班 In/Out", "原因 Reason", "狀態 Status", "審核人 Reviewer"],
      cors.map(c => [c.empId, c.name, c.date, c.time, TYPE_LABEL[c.type], c.reason,
        { pending: "審核中", approved: "已核准", rejected: "已駁回" }[c.status] || c.status, c.reviewedBy || ""]));
    addSheet(wb, "員工名單", ["員工編號 Emp ID", "姓名 Name", "公司 Company", "身分 Type", "權限 Role", "到職日 Hire Date", "直屬主管 Supervisor", "帳號狀態 Status"],
      users.map(u => [u.empId, u.name, u.company, isPart(u) ? "兼職" : "正職", u.role === "admin" ? "管理員" : "員工", u.hireDate || "", u.supervisorEmpId || "",
        u.active ? "使用中" : (u.replacedBy ? "已重設密碼（舊帳號）" : "已停用")]));
    XLSX.writeFile(wb, `打卡系統備份_${y}.xlsx`);
    showMsg(msg, `已匯出「打卡系統備份_${y}.xlsx」：打卡 ${punches.length} 筆、請假加班 ${reqs.length} 筆、補打卡 ${cors.length} 筆。請存到公司的雲端硬碟或 NAS。`, "ok");
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnBackup").disabled = false;
};

// ===== 員工管理 =====
// 公司名稱下拉選單
const companyOpts = (withBlank) => (withBlank ? `<option value="">請選擇公司</option>` : "")
  + COMPANY_LIST.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
$("nCompany").innerHTML = companyOpts(true);
$("eCompany").innerHTML = companyOpts(false);

function supOptions(excludeEmpId) {
  return `<option value="">（無，直接由管理員核准）</option>` + staff.filter(s => s.empId !== excludeEmpId)
    .map(s => `<option value="${esc(s.empId)}">${esc(s.empId)} ${esc(s.name)}</option>`).join("");
}

async function loadStaff() {
  const snap = await getDocs(query(collection(db, "users"), where("active", "==", true)));
  staff = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.empId.localeCompare(b.empId));
  $("staffBody").innerHTML = staff.map(s => `<tr>
      <td>${esc(s.empId)}</td><td>${esc(s.name)}</td><td>${esc(s.company)}</td>
      <td>${s.role === "admin" ? '<span class="tag field">管理員</span>' : "員工"}</td>
      <td>${isPart(s) ? '<span class="tag gray">兼職</span>' : "正職"}</td>
      <td>${s.hireDate ? esc(s.hireDate) : '<span class="tag warn">未設定</span>'}</td>
      <td>${s.supervisorEmpId ? esc(staffName(s.supervisorEmpId)) : '<span class="muted">—</span>'}</td>
      <td>${s.deviceId ? '<span class="tag ok">已綁定</span>' : '<span class="tag gray">未綁定</span>'}</td>
      <td data-linecell="${esc(s.empId)}"><span class="muted">—</span></td>
      <td>
        ${s.deviceId ? `<button class="small secondary" data-act="unbind" data-uid="${s.uid}">重設手機</button>` : ""}
        ${s.uid !== me.uid ? `<button class="small danger" data-act="disable" data-uid="${s.uid}">停用</button>` : ""}
      </td></tr>`).join("") || `<tr><td colspan="10" class="muted">尚無員工</td></tr>`;
  $("rEmp").innerHTML = staff.filter(s => s.uid !== me.uid)
    .map(s => `<option value="${s.uid}">${esc(s.empId)} ${esc(s.name)}</option>`).join("");
  $("nSup").innerHTML = supOptions(null);
  const keep = $("eEmp").value;
  $("eEmp").innerHTML = staff.map(s => `<option value="${s.uid}">${esc(s.empId)} ${esc(s.name)}</option>`).join("");
  if (keep && staff.some(s => s.uid === keep)) $("eEmp").value = keep;
  fillEdit();
  syncDirectory().catch(e => console.warn("directory", e));
  fillLineCol();
}
// 員工列表的「LINE」欄：誰已綁定 LINE 通知（同時讓通知服務更新誰是管理員）
async function fillLineCol() {
  if (!NOTIFY_URL) return;
  try {
    const { list } = await callNotify("list");
    const bound = new Map(list.map(x => [x.empId, x.displayName]));
    document.querySelectorAll("#staffBody td[data-linecell]").forEach(td => {
      const name = bound.get(td.dataset.linecell);
      td.innerHTML = bound.has(td.dataset.linecell)
        ? `<span class="tag ok" title="${esc(name || "")}">已綁定</span>` : '<span class="tag gray">未綁定</span>';
    });
  } catch (e) { console.warn("LINE list", e); }
}

function fillEdit() {
  const s = staff.find(x => x.uid === $("eEmp").value);
  if (!s) return;
  $("eName").value = s.name || "";
  $("eRole").value = s.role || "employee";
  if (s.company && !COMPANY_LIST.includes(s.company)) $("eCompany").insertAdjacentHTML("beforeend", `<option value="${esc(s.company)}">${esc(s.company)}</option>`);
  $("eCompany").value = s.company || COMPANY_LIST[0];
  $("eHire").value = s.hireDate || "";
  $("eSup").innerHTML = supOptions(s.empId);
  $("eSup").value = s.supervisorEmpId || "";
  $("eType").value = isPart(s) ? "part" : "full";
  $("ePartAnnual").value = s.partAnnualHours ?? "";
  $("ePartCalc").textContent = "兼職特休＝同年資正職的特休時數 ×（過去一年實際工時 ÷ 2080 小時）。可以先按「試算」，再自行調整。";
  togglePartBox();
}
function togglePartBox() { $("ePartBox").classList.toggle("hidden", $("eType").value !== "part"); }
$("eType").onchange = togglePartBox;
$("eEmp").onchange = fillEdit;

// 兼職特休試算：讀取這位員工本特休年度開始前一年的打卡，算出實際工時，再按比例換算
$("btnPartCalc").onclick = async () => {
  const s = staff.find(x => x.uid === $("eEmp").value);
  const out = $("ePartCalc");
  if (!s) return;
  const hire = $("eHire").value || s.hireDate;
  if (!hire) { out.textContent = "請先設定到職日。"; return; }
  const today = todayStr();
  const ent = annualEntitlement(hire, today);
  if (!ent.start) { out.textContent = `到職未滿半年，${ent.end} 起才有特休。`; return; }
  $("btnPartCalc").disabled = true;
  out.textContent = "計算中…";
  try {
    const from = addMonths(ent.start, -12) < hire ? hire : addMonths(ent.start, -12);
    const snap = await getDocs(query(collection(db, "punches"), where("empId", "==", s.empId)));
    const byDay = {};
    snap.docs.forEach(d => {
      const p = { ...d.data(), ts: d.data().ts.toDate() };
      const ds = ymdToInput(p.ymd);
      if (ds >= from && ds < ent.start) (byDay[ds] = byDay[ds] || []).push(p);
    });
    let mins = 0, days = 0;
    for (const list of Object.values(byDay)) {
      const sum = summarizeDay(list, [], true);
      if (sum.firstIn && sum.lastOut) { mins += workMinutes(sum.firstIn.ts, sum.lastOut.ts); days++; }
    }
    const hours = Math.round(mins / 60 * 10) / 10;
    // 未滿一整年（例如到職第一年）時，正職工時也按同一段期間的週數比例計算
    const spanDays = Math.max(1, Math.round((Date.parse(ent.start) - Date.parse(from)) / 86400000));
    const fullHours = FULLTIME_YEAR_HOURS * Math.min(1, spanDays / 365);
    const suggest = Math.round(ent.days * HOURS_PER_DAY * Math.min(1, hours / fullHours) * 2) / 2;
    $("ePartAnnual").value = suggest;
    out.textContent = `${from} ～ ${ent.start} 共上班 ${days} 天、${hours} 小時；同年資正職特休 ${ent.days} 天（${ent.days * HOURS_PER_DAY} 小時）`
      + ` × ${hours} ÷ ${Math.round(fullHours)} ＝ 建議 ${suggest} 小時（本年度 ${ent.start} ～ ${ent.end}）。確認後請按「儲存變更」。`
      + (snap.empty ? "（系統裡還沒有這段期間的打卡紀錄，請依實際工時自行填寫）" : "");
  } catch (e) { out.textContent = errMsg(e); }
  $("btnPartCalc").disabled = false;
};

$("btnEdit").onclick = async () => {
  const msg = $("eMsg");
  const s = staff.find(x => x.uid === $("eEmp").value);
  if (!s) { showMsg(msg, "請選擇員工", "err"); return; }
  const name = $("eName").value.trim();
  if (!name) { showMsg(msg, "姓名不能空白", "err"); return; }
  if (s.uid === me.uid && $("eRole").value !== "admin") { showMsg(msg, "不能移除自己的管理員權限", "err"); return; }
  $("btnEdit").disabled = true;
  try {
    await updateDoc(doc(db, "users", s.uid), {
      name, company: $("eCompany").value, role: $("eRole").value,
      hireDate: $("eHire").value || null,
      supervisorEmpId: $("eSup").value || null,
      empType: $("eType").value,
      partAnnualHours: $("eType").value === "part" && $("ePartAnnual").value !== "" ? Math.max(0, Number($("ePartAnnual").value)) : null
    });
    showMsg(msg, `已更新 ${name} 的資料` + (s.company !== $("eCompany").value ? `。公司已改為「${$("eCompany").value}」，之後的打卡會記在新公司；改之前的紀錄維持原公司。` : ""), "ok");
    await loadStaff();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnEdit").disabled = false;
};

$("staffBody").onclick = async e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const s = staff.find(x => x.uid === btn.dataset.uid);
  if (!s) return;
  const msg = $("staffMsg");
  btn.disabled = true;
  try {
    if (btn.dataset.act === "unbind") {
      await updateDoc(doc(db, "users", s.uid), { deviceId: null });
      showMsg(msg, `已重設 ${s.name} 的手機綁定，員工下次用新手機登入時會自動綁定。`, "ok");
    } else if (btn.dataset.act === "disable") {
      if (!btn.dataset.confirm) {
        btn.dataset.confirm = "1";
        btn.textContent = "確定停用？";
        btn.disabled = false;
        return;
      }
      await updateDoc(doc(db, "users", s.uid), { active: false });
      const subs = staff.filter(x => x.supervisorEmpId === s.empId).map(x => x.name);
      showMsg(msg, `已停用 ${s.name} 的帳號（出勤紀錄仍會保留）。`
        + (subs.length ? `提醒：${subs.join("、")} 的直屬主管是 ${s.name}，請到「編輯員工資料」改設新主管。` : ""), "ok");
    }
    await loadStaff();
  } catch (err) { showMsg(msg, errMsg(err), "err"); btn.disabled = false; }
};

$("btnAdd").onclick = async () => {
  const msg = $("addMsg");
  const empId = normEmpId($("nEmpId").value), name = $("nName").value.trim(), pw = $("nPw").value;
  if (!validEmpId(empId)) { showMsg(msg, EMPID_RULE, "err"); return; }
  const company = $("nCompany").value;
  if (!company) { showMsg(msg, "請選擇公司名稱", "err"); return; }
  if (!name) { showMsg(msg, "請填寫姓名", "err"); return; }
  if (pw.length < 8) { showMsg(msg, "初始密碼至少 8 個字元", "err"); return; }
  $("btnAdd").disabled = true;
  try {
    const exist = await getDoc(doc(db, "logins", empId));
    if (exist.exists()) {
      const u = await getDoc(doc(db, "users", exist.data().uid));
      if (u.exists() && u.data().active) throw new Error(`員工編號 ${empId} 已經存在`);
    }
    const email = makeEmail(empId);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pw);
    await signOut(secondaryAuth);
    const batch = writeBatch(db);
    batch.set(doc(db, "users", cred.user.uid), {
      empId, name, company, role: $("nRole").value,
      hireDate: $("nHire").value || null, supervisorEmpId: $("nSup").value || null,
      empType: $("nType").value, partAnnualHours: null,
      active: true, deviceId: null, mustChangePassword: true, createdAt: serverTimestamp()
    });
    batch.set(doc(db, "logins", empId), { email, uid: cred.user.uid });
    await batch.commit();
    showMsg(msg, `已新增 ${name}（${empId}）。請告訴員工：編號 ${empId}，初始密碼為你剛設定的密碼。`, "ok");
    $("nEmpId").value = $("nName").value = $("nPw").value = $("nCompany").value = $("nHire").value = "";
    await loadStaff();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnAdd").disabled = false;
};

// 重設密碼：建立新的登入帳號並沿用原本的員工資料（舊帳號隨即失效）
$("btnResetPw").onclick = async () => {
  const msg = $("rMsg");
  const s = staff.find(x => x.uid === $("rEmp").value);
  const pw = $("rPw").value;
  if (!s) { showMsg(msg, "請選擇員工", "err"); return; }
  if (pw.length < 8) { showMsg(msg, "臨時密碼至少 8 個字元", "err"); return; }
  $("btnResetPw").disabled = true;
  try {
    const email = makeEmail(s.empId);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pw);
    await signOut(secondaryAuth);
    const batch = writeBatch(db);
    batch.set(doc(db, "users", cred.user.uid), {
      empId: s.empId, name: s.name, company: s.company, role: s.role,
      hireDate: s.hireDate || null, supervisorEmpId: s.supervisorEmpId || null,
      empType: s.empType || "full", partAnnualHours: s.partAnnualHours ?? null,
      active: true, deviceId: s.deviceId || null, mustChangePassword: true, createdAt: serverTimestamp()
    });
    batch.update(doc(db, "users", s.uid), { active: false, replacedBy: cred.user.uid });
    batch.set(doc(db, "logins", s.empId), { email, uid: cred.user.uid });
    await batch.commit();
    $("rPw").value = "";
    showMsg(msg, `已重設 ${s.name} 的密碼，請把臨時密碼告訴員工。`, "ok");
    await loadStaff();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnResetPw").disabled = false;
};

// ===== 待審核即時提醒 =====
// 有人送出補打卡、請假／加班，或主管核准後，數字和頂端提醒會馬上更新（不用重新整理）
let pendingUnsubs = [];
const counts = { cor: 0, req: 0 };
const baseTitle = document.title;
function watchPending() {
  stopPendingWatch();
  let t1 = null, t2 = null;
  pendingUnsubs.push(onSnapshot(query(collection(db, "corrections"), where("status", "==", "pending")), () => {
    clearTimeout(t1); t1 = setTimeout(loadCorrections, 300);
  }, () => {}));
  pendingUnsubs.push(onSnapshot(query(collection(db, "requests"), where("status", "in", ["pending_supervisor", "pending_admin"])), () => {
    clearTimeout(t2); t2 = setTimeout(loadPendingRequests, 300);
  }, () => {}));
}
function stopPendingWatch() { pendingUnsubs.splice(0).forEach(u => u()); }
function renderBanner() {
  const parts = [];
  if (counts.req) parts.push(`<a href="#" data-go="tReq">請假／加班 ${counts.req} 張</a>`);
  if (counts.cor) parts.push(`<a href="#" data-go="tCor">補打卡 ${counts.cor} 張</a>`);
  $("admBanner").classList.toggle("hidden", !parts.length);
  $("admBanner").innerHTML = parts.length ? `🔔 等你核准：${parts.join("、")}` : "";
  const n = counts.req + counts.cor;
  document.title = n ? `(${n}) ${baseTitle}` : baseTitle;
}
$("admBanner").onclick = e => {
  const a = e.target.closest("a[data-go]");
  if (!a) return;
  e.preventDefault();
  document.querySelector(`.tabs button[data-tab="${a.dataset.go}"]`).click();
};

// ===== 補打卡審核 =====
let pending = [];
async function loadCorrections() {
  const body = $("corBody");
  try {
    const snap = await getDocs(query(collection(db, "corrections"), where("status", "==", "pending")));
    pending = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    $("corCount").textContent = pending.length ? `(${pending.length})` : "";
    counts.cor = pending.length; renderBanner();
    body.innerHTML = pending.map(c => `<tr>
        <td>${esc(c.name)}<br><span class="muted">${esc(c.empId)}</span></td>
        <td>${esc(c.date)} ${esc(c.time)}</td><td>${TYPE_LABEL[c.type]}</td><td>${esc(c.reason)}</td>
        <td><button class="small" data-act="approve" data-id="${c.id}">核准</button>
            <button class="small danger" data-act="reject" data-id="${c.id}">駁回</button></td></tr>`).join("")
      || `<tr><td colspan="5" class="muted">目前沒有待審核的申請</td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="5">${esc(errMsg(e))}</td></tr>`; }
}

$("corBody").onclick = async e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const c = pending.find(x => x.id === btn.dataset.id);
  if (!c) return;
  btn.disabled = true;
  try {
    const batch = writeBatch(db);
    const review = { reviewedBy: me.empId, reviewedAt: serverTimestamp() };
    if (btn.dataset.act === "approve") {
      const when = new Date(`${c.date}T${c.time}:00+08:00`);
      batch.set(doc(collection(db, "punches")), {
        uid: c.uid, empId: c.empId, name: c.name, company: c.company,
        type: c.type, mode: "correction",
        ts: Timestamp.fromDate(when), ym: ymOf(when), ymd: ymdOf(when),
        lat: null, lng: null, accuracy: null, distance: null,
        customer: "", note: c.reason, correctionId: c.id, approvedBy: me.empId, deviceId: null
      });
      batch.update(doc(db, "corrections", c.id), { status: "approved", ...review });
      if (c.date === todayStr()) {
        // 今天的補打卡也更新到看板
        const pref = doc(db, "presence", `${ymdOf(when)}_${c.empId}`);
        const cur = await getDoc(pref);
        const pd = cur.exists() ? cur.data() : {};
        const upd = { ymd: ymdOf(when), empId: c.empId, name: c.name, company: c.company, lastAt: serverTimestamp() };
        if (!cur.exists()) { upd.mode = "office"; upd.customer = ""; upd.lastType = c.type; }
        if (c.type === "in" && (!pd.inAt || pd.inAt.toDate() > when)) upd.inAt = Timestamp.fromDate(when);
        if (c.type === "out") { upd.outAt = Timestamp.fromDate(when); upd.lastType = "out"; }
        batch.set(pref, upd, { merge: true });
      }
    } else {
      batch.update(doc(db, "corrections", c.id), { status: "rejected", ...review });
    }
    await batch.commit();
    notify("correction", c.id);
    showMsg($("corMsg"), `已${btn.dataset.act === "approve" ? "核准" : "駁回"} ${c.name} 的申請`, "ok");
    await loadCorrections();
    loadDay();
    loadReport();
  } catch (err) { showMsg($("corMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// ===== 請假／加班審核 =====
let pendingReqs = [];
const reqCache = {}; // empId → 該員工所有申請（算餘額用）
async function reqsOf(empId) {
  if (!reqCache[empId]) {
    const snap = await getDocs(query(collection(db, "requests"), where("empId", "==", empId)));
    reqCache[empId] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return reqCache[empId];
}
function statusTag(r) { return tagsHtml([STATUS_INFO[r.status] || ["gray", r.status]]); }

async function loadPendingRequests() {
  const body = $("reqBody");
  try {
    Object.keys(reqCache).forEach(k => delete reqCache[k]);
    const snap = await getDocs(query(collection(db, "requests"), where("status", "in", ["pending_supervisor", "pending_admin"])));
    pendingReqs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => reqSortKey(a).localeCompare(reqSortKey(b)));
    $("reqCount").textContent = pendingReqs.length ? `(${pendingReqs.length})` : "";
    counts.req = pendingReqs.filter(r => r.status === "pending_admin").length; renderBanner();
    if (!pendingReqs.length) { body.innerHTML = "目前沒有待核准的申請"; return; }
    const today = todayStr();
    const parts = [];
    for (const r of pendingReqs) {
      let bal = "";
      if (r.kind === "leave" && (r.leaveType === "annual" || r.leaveType === "comp")) {
        const emp = staff.find(s => s.empId === r.empId);
        const b = computeBalances(await reqsOf(r.empId), emp ? emp.hireDate : null, today, emp);
        bal = r.leaveType === "annual"
          ? (emp && emp.hireDate ? `特休剩餘 ${fmtHours(b.annualLeft)}（已含本單）` : "⚠ 尚未設定到職日，無法核對特休")
          : `補休剩餘 ${fmtHours(b.compLeft)}（已含本單）`;
      }
      if (r.kind === "overtime") {
        const month = (await reqsOf(r.empId)).filter(x => x.kind === "overtime" && x.ym === r.ym
          && ["pending_supervisor", "pending_admin", "approved"].includes(x.status)).reduce((a, x) => a + x.hours, 0);
        bal = `該員工本月加班累計 ${month} 小時` + (month > 46 ? "（⚠ 超過 46 小時）" : "");
      }
      parts.push(`<div class="req">
        <div class="top"><span class="title">${esc(r.name)}（${esc(r.empId)}）・${esc(reqTitle(r))}・${r.hours} 小時</span>${statusTag(r)}</div>
        <div class="meta">${esc(reqWhen(r))}</div>
        <div class="meta">事由：${esc(r.reason)}</div>
        ${r.supNote ? `<div class="meta">主管意見：${esc(r.supNote)}</div>` : ""}
        ${r.status === "pending_supervisor" ? `<div class="meta">主管 ${esc(staffName(r.supervisorEmpId))} 尚未審核</div>` : ""}
        ${bal ? `<div class="meta">${esc(bal)}</div>` : ""}
        <div class="acts">
          <input placeholder="意見（選填）" data-note="${r.id}">
          <button class="small" data-act="approve" data-id="${r.id}">${r.status === "pending_supervisor" ? "直接核准" : "核准"}</button>
          <button class="small danger" data-act="reject" data-id="${r.id}">駁回</button>
        </div></div>`);
    }
    body.innerHTML = parts.join("");
  } catch (e) { body.textContent = errMsg(e); }
}

$("reqBody").onclick = async e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const r = pendingReqs.find(x => x.id === btn.dataset.id);
  if (!r) return;
  const note = (document.querySelector(`#reqBody input[data-note="${r.id}"]`)?.value || "").trim();
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "requests", r.id), {
      status: btn.dataset.act === "approve" ? "approved" : "rejected",
      adminBy: me.empId, adminAt: serverTimestamp(), adminNote: note
    });
    notify("request", r.id);
    showMsg($("reqMsg"), `已${btn.dataset.act === "approve" ? "核准" : "駁回"} ${r.name} 的${reqTitle(r)}申請`, "ok");
    await loadApprovedLeaves();
    loadPendingRequests();
    loadRecords();
    loadDay();
    loadReport();
  } catch (err) { showMsg($("reqMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// ===== 請假／加班紀錄 =====
let monthReqs = [];
$("recMonth").onchange = () => loadRecords();

async function loadRecords() {
  try {
    const ym = Number($("recMonth").value.replace("-", ""));
    const snap = await getDocs(query(collection(db, "requests"), where("ym", "==", ym)));
    monthReqs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => reqSortKey(a).localeCompare(reqSortKey(b)));
    // 統計
    const sums = {};
    for (const r of monthReqs.filter(x => x.status === "approved")) {
      const s = sums[r.empId] = sums[r.empId] || { name: r.name, annual: 0, comp: 0, personal: 0, sick: 0, other: 0, otPay: 0, otComp: 0 };
      if (r.kind === "overtime") { r.comp === "comp" ? s.otComp += r.hours : s.otPay += r.hours; continue; }
      if (r.leaveType === "annual") s.annual += r.hours;
      else if (r.leaveType === "comp") s.comp += r.hours;
      else if (r.leaveType === "personal" || r.leaveType === "family") s.personal += r.hours;
      else if (r.leaveType === "sick") s.sick += r.hours;
      else s.other += r.hours;
    }
    const ids = Object.keys(sums).sort();
    const n = v => v ? v : '<span class="muted">0</span>';
    $("recSum").innerHTML = ids.length ? ids.map(id => {
      const s = sums[id];
      return `<tr><td>${esc(s.name)}<br><span class="muted">${esc(id)}</span></td><td>${n(s.annual)}</td><td>${n(s.comp)}</td>
        <td>${n(s.personal)}</td><td>${n(s.sick)}</td><td>${n(s.other)}</td><td>${n(s.otPay)}</td><td>${n(s.otComp)}</td></tr>`;
    }).join("") : `<tr><td colspan="8" class="muted">本月沒有已核准的請假或加班</td></tr>`;
    // 明細
    $("recList").innerHTML = monthReqs.length ? monthReqs.map(r => `<div class="req">
        <div class="top"><span class="title">${esc(r.name)}（${esc(r.empId)}）・${esc(reqTitle(r))}・${r.hours} 小時</span>${statusTag(r)}</div>
        <div class="meta">${esc(reqWhen(r))}</div>
        <div class="meta">事由：${esc(r.reason)}</div>
        ${r.supNote ? `<div class="meta">主管意見：${esc(r.supNote)}</div>` : ""}
        ${r.adminNote ? `<div class="meta">管理員意見：${esc(r.adminNote)}</div>` : ""}
        ${r.status === "approved" ? `<div class="acts"><button class="small secondary" data-revoke="${r.id}">撤銷核准</button></div>` : ""}
      </div>`).join("") : "本月沒有申請";
  } catch (e) {
    $("recSum").innerHTML = `<tr><td colspan="8">${esc(errMsg(e))}</td></tr>`;
    $("recList").textContent = errMsg(e);
  }
}

$("recList").onclick = async e => {
  const btn = e.target.closest("button[data-revoke]");
  if (!btn) return;
  const r = monthReqs.find(x => x.id === btn.dataset.revoke);
  if (!r) return;
  if (!btn.dataset.confirm) { btn.dataset.confirm = "1"; btn.textContent = "確定撤銷？"; return; }
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "requests", r.id), { status: "cancelled", cancelledBy: me.empId, cancelledAt: serverTimestamp() });
    showMsg($("recMsg"), `已撤銷 ${r.name} 的${reqTitle(r)}（時數已退回）`, "ok");
    await loadApprovedLeaves();
    loadRecords();
    loadDay();
    loadReport();
  } catch (err) { showMsg($("recMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// ===== 國定假日／公司休假 =====
// 一行一天：「2026-12-25 行憲紀念日」＝整天放假；「2026-10-23 13:00-17:00 颱風停班」＝只有這段時間停班
const hh2 = n => `${String(n).padStart(2, "0")}:00`;
function holLine(h) { return `${h.date}${h.from != null ? ` ${hh2(h.from)}-${hh2(h.to)}` : ""} ${h.name || ""}`.trim(); }
function parseHolLine(l) {
  const m = l.match(/^(\d{4}-\d{2}-\d{2})\s*(?:(\d{1,2}):(\d{2})\s*[-~～–]\s*(\d{1,2}):(\d{2})|(\d{1,2}):(\d{2})\s*起)?\s*(.*)$/);
  if (!m || isNaN(Date.parse(m[1]))) return { error: `這一行格式不對：「${l}」，請用「2026-12-25 行憲紀念日」或「2026-10-23 13:00-17:00 颱風停班」的格式` };
  const h = { date: m[1], name: (m[8] || "").trim() };
  let from = null, to = null;
  if (m[2] != null) { from = +m[2]; to = +m[4]; if (m[3] !== "00" || m[5] !== "00") return { error: `「${l}」：停班時間請用整點（例如 13:00）` }; }
  else if (m[6] != null) { from = +m[6]; to = 17; if (m[7] !== "00") return { error: `「${l}」：停班時間請用整點（例如 13:00）` }; }
  if (from != null) {
    if (!(from >= 8 && to <= 17 && from < to)) return { error: `「${l}」：停班時段要在 08:00–17:00 之間，而且開始要早於結束` };
    if (from <= 8 && to >= 17) { from = to = null; } // 整天停班就當成整天放假
  }
  if (from != null) { h.from = from; h.to = to; h.name = h.name || "停班"; }
  else h.name = h.name || "國定假日";
  return { h };
}
// 資料來源：行政院人事行政總處「政府行政機關辦公日曆表」，由開源專案 ruyut/TaiwanCalendar 整理成 JSON 放在 GitHub
const HOL_SRC = y => `https://raw.githubusercontent.com/ruyut/TaiwanCalendar/master/data/${y}.json`;
$("btnImportHol").onclick = async () => {
  const msg = $("holMsg");
  const y = Number($("holYear").value);
  if (!(y >= 2020 && y <= 2100)) { showMsg(msg, "請輸入正確的年度", "err"); return; }
  $("btnImportHol").disabled = true;
  showMsg(msg, `正在讀取 ${y} 年政府行事曆…`, "info");
  try {
    const res = await fetch(HOL_SRC(y), { cache: "no-store" });
    if (res.status === 404) throw new Error(`政府還沒公告 ${y} 年的行事曆（通常在前一年 6 月左右公告），請晚點再試`);
    if (!res.ok) throw new Error(`讀取失敗（${res.status}），請稍後再試`);
    const days = await res.json();
    if (!Array.isArray(days) || !days.length) throw new Error("資料格式不正確，請改用手動輸入");
    const add = [];
    for (const d of days) {
      if (!/^\d{8}$/.test(d.date || "")) continue;
      const ds = `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`;
      const weekend = d.week === "六" || d.week === "日";
      if (d.isHoliday && !weekend) add.push({ date: ds, name: d.description || "放假" });
      else if (!d.isHoliday && weekend) add.push({ date: ds, name: d.description ? `補班（${d.description}）` : "補班" });
    }
    // 保留其他年度，以及這個年度自己加的公司假日（例如公司旅遊）；同一天以政府資料為準
    const lines = $("holText").value.split("\n").map(l => l.trim()).filter(Boolean);
    const keep = lines.filter(l => !add.some(a => l.startsWith(a.date)));
    const all = keep.concat(add.map(a => `${a.date} ${a.name}`)).sort();
    $("holText").value = all.join("\n");
    const mk = add.filter(a => a.name.includes("補班")).length;
    showMsg(msg, `已帶入 ${y} 年：平日放假 ${add.length - mk} 天${mk ? `、補班 ${mk} 天` : ""}。請檢查下面的清單，沒問題就按「儲存」。`, "ok");
  } catch (e) {
    showMsg(msg, e instanceof TypeError ? "無法連線到政府行事曆資料，請檢查網路，或改用手動輸入。" : (e.message || String(e)), "err");
  }
  $("btnImportHol").disabled = false;
};
$("btnSaveHol").onclick = async () => {
  const msg = $("holMsg");
  const lines = $("holText").value.split("\n").map(l => l.trim()).filter(Boolean);
  const list = [];
  for (const l of lines) {
    const r = parseHolLine(l);
    if (r.error) { showMsg(msg, r.error, "err"); return; }
    if (list.some(x => x.date === r.h.date)) { showMsg(msg, `${r.h.date} 重複了，同一天只能有一行`, "err"); return; }
    list.push(r.h);
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  try {
    await setDoc(doc(db, "settings", "holidays"), { list, updatedBy: me.empId, updatedAt: serverTimestamp() });
    holidays = toHolidayMap(list);
    $("holText").value = list.map(holLine).join("\n");
    const half = list.filter(h => h.from != null).length;
    showMsg(msg, `已儲存 ${list.length - half} 個放假日${half ? `、${half} 個半天停班` : ""}`, "ok");
    holYearHint(list);
    loadDay();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
};

// ===== 公司位置 =====
async function loadOffice() {
  const snap = await getDoc(doc(db, "settings", "office"));
  const o = snap.exists() ? snap.data() : {};
  officeCfg = o;
  $("oAddr").value = o.address || "新竹市香山區中華路四段518號9樓";
  $("oLat").value = o.lat ?? "";
  $("oLng").value = o.lng ?? "";
  $("oRadius").value = o.radius ?? DEFAULT_RADIUS;
  updateMapLink();
  if (!snap.exists()) showMsg($("oMsg"), "尚未設定公司位置，員工目前無法內勤打卡。請先完成設定。", "err");
}
function updateMapLink() {
  const lat = $("oLat").value, lng = $("oLng").value;
  $("oMap").innerHTML = lat && lng
    ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}" target="_blank" rel="noopener">在 Google 地圖確認位置</a>` : "";
}
$("oLat").oninput = $("oLng").oninput = updateMapLink;

$("btnHere").onclick = async () => {
  showMsg($("oMsg"), "正在取得目前位置…", "info");
  try {
    const c = await getPosition();
    $("oLat").value = c.latitude.toFixed(6);
    $("oLng").value = c.longitude.toFixed(6);
    updateMapLink();
    showMsg($("oMsg"), `已取得位置（誤差約 ${Math.round(c.accuracy)} 公尺），確認無誤後請按「儲存」。`, "info");
  } catch (e) { showMsg($("oMsg"), errMsg(e), "err"); }
};

$("btnSaveOffice").onclick = async () => {
  const lat = Number($("oLat").value), lng = Number($("oLng").value), radius = Number($("oRadius").value);
  if (!(lat > 21 && lat < 26 && lng > 119 && lng < 123)) { showMsg($("oMsg"), "經緯度看起來不在台灣，請確認", "err"); return; }
  if (!(radius >= 50 && radius <= 2000)) { showMsg($("oMsg"), "打卡半徑請設定在 50～2000 公尺之間", "err"); return; }
  try {
    const goLive = officeCfg.goLive || todayStr();
    await setDoc(doc(db, "settings", "office"), {
      address: $("oAddr").value.trim(), lat, lng, radius, goLive, updatedBy: me.empId, updatedAt: serverTimestamp()
    });
    officeCfg = { ...officeCfg, lat, lng, radius, goLive };
    showMsg($("oMsg"), "公司位置已儲存", "ok");
  } catch (e) { showMsg($("oMsg"), errMsg(e), "err"); }
};

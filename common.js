// 共用設定與工具函式 — 打卡系統
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firebase 連線設定（這組設定本來就是公開的，安全性由資料庫規則把關）
export const firebaseConfig = {
  apiKey: "AIzaSyD0EEFmV3LWmGXLrYCWAY6r0o0YD0Eka4k",
  authDomain: "weixiu-attendance.firebaseapp.com",
  projectId: "weixiu-attendance",
  storageBucket: "weixiu-attendance.firebasestorage.app",
  messagingSenderId: "276294469641",
  appId: "1:276294469641:web:26f060c4646a5ecad310d8"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ===== 公司規則 =====
// 公司名稱清單（新增員工時從這裡選；看板也依這個順序分組）
export const COMPANIES = { W: "唯修科技", C: "傳創機電", S: "唯校中心" };
export const COMPANY_LIST = Object.values(COMPANIES);
export const WORK = { start: "08:00", lateAfter: "08:10", end: "17:00" };
export const DEFAULT_RADIUS = 200; // 公尺
// 員工身分：full 正職、part 兼職（時間不固定，只記工時）。舊資料沒有這個欄位＝正職
export const EMP_TYPE_LABEL = { full: "正職", part: "兼職" };
export function isPart(u) { return !!u && u.empType === "part"; }
export const FULLTIME_YEAR_HOURS = 2080; // 正職一年的正常工時（每週 40 小時 × 52 週），兼職特休按比例試算用
const EMAIL_DOMAIN = "staff.weixiu-attendance.app"; // 內部用的虛擬信箱網域，不會寄信

export function normEmpId(s) { return (s || "").trim().toUpperCase(); }
// 員工編號：英文字母、數字，可含 - 或 _，最多 20 字（不再用開頭字母區分公司）
export function validEmpId(s) { return /^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(s); }
export const EMPID_RULE = "員工編號只能用英文字母、數字（可含 - 或 _），最多 20 個字";
export function makeEmail(empId) {
  // 每次建立帳號都加上獨特尾碼，重設密碼時才能換新帳號
  return `${empId.toLowerCase()}.${Date.now().toString(36)}@${EMAIL_DOMAIN}`;
}

// ===== 登入 =====
export async function loginWithEmpId(empIdRaw, password) {
  const empId = normEmpId(empIdRaw);
  if (!validEmpId(empId)) throw new Error("員工編號不正確，請再確認一次");
  const snap = await getDoc(doc(db, "logins", empId));
  if (!snap.exists()) throw new Error("查無此員工編號");
  await signInWithEmailAndPassword(auth, snap.data().email, password);
  return empId;
}
export function logout() { return signOut(auth); }

// ===== LINE 通知 =====
// NOTIFY_URL：Google Apps Script 通知服務的網址（部署後填入）；空白＝通知功能尚未啟用，網站其他功能照常
// LINE_OA_ID：出勤通知官方帳號的 ID（例如 "@123abcde"）
export const NOTIFY_URL = "https://script.google.com/macros/s/AKfycbyRplOidL8m1MxkN0fVKrAsf2XYY0Dl9OtzXszHw9dv-8PcjeqpTJz9y_47jC_inZ7fwg/exec";
export const LINE_OA_ID = "@068imzxt";
export async function callNotify(action, data = {}) {
  if (!NOTIFY_URL) throw new Error("通知服務尚未設定");
  if (!auth.currentUser) throw new Error("請先登入");
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(NOTIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // 用 text/plain 避免跨網域預檢
    body: JSON.stringify({ action, idToken, ...data })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "通知服務發生錯誤");
  return j;
}
// 送出／審核後通知下一個處理的人；失敗不影響原本的操作
export function notify(kind, id) {
  if (!NOTIFY_URL || !id) return;
  callNotify("notify", { kind, id }).catch(e => console.warn("LINE 通知失敗", e));
}

// ===== 台灣時間 =====
const TZ = "Asia/Taipei";
export function twParts(date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  if (p.hour === "24") p.hour = "00";
  return p;
}
export function ymOf(date) { const p = twParts(date); return Number(p.year + p.month); }
export function ymdOf(date) { const p = twParts(date); return Number(p.year + p.month + p.day); }
export function fmtTime(date) { const p = twParts(date); return `${p.hour}:${p.minute}`; }
export function fmtTimeSec(date) { const p = twParts(date); return `${p.hour}:${p.minute}:${p.second}`; }
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export function weekdayOfYmd(ymd) {
  const s = String(ymd);
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00+08:00`);
  return d.getUTCDay();
}
export function fmtYmd(ymd) {
  const s = String(ymd);
  return `${s.slice(4, 6)}/${s.slice(6, 8)}（${WEEK[weekdayOfYmd(ymd)]}）`;
}
export function fmtDateLong(date) {
  const p = twParts(date);
  return `${p.year} 年 ${Number(p.month)} 月 ${Number(p.day)} 日（${WEEK[weekdayOfYmd(ymdOf(date))]}）`;
}
export function ymdToInput(ymd) { const s = String(ymd); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }
export function inputToYmd(v) { return Number(v.replace(/-/g, "")); }
export function daysInYm(ym) { const y = Math.floor(ym / 100), m = ym % 100; return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// ===== 打卡判定 =====
// list：同一天的打卡紀錄（含 ts:Date、type）
// wins：當天已核准的請假時段 [{s, e, hours}]（s、e 為整點，例如 8、12）
// 請假會把「應上班時間」往後推、「應下班時間」往前移，避免請假時段被判成遲到或早退
const GRACE_MIN = 10;
function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
// part = true：兼職（時間不固定），不判斷遲到、早退
export function summarizeDay(list, wins = [], part = false) {
  const sorted = [...list].sort((a, b) => a.ts - b.ts);
  const ins = sorted.filter(p => p.type === "in");
  const outs = sorted.filter(p => p.type === "out");
  const firstIn = ins[0] || null;
  const lastOut = outs[outs.length - 1] || null;

  let effStart = 8, effEnd = 17;
  for (let guard = 0, changed = true; changed && guard < 20; guard++) {
    changed = false;
    for (const w of wins) {
      if (w.s <= effStart && w.e > effStart) { effStart = w.e; changed = true; }
      if (w.e >= effEnd && w.s < effEnd) { effEnd = w.s; changed = true; }
    }
    if (effStart >= 12 && effStart < 13) { effStart = 13; changed = true; }
    if (effEnd > 12 && effEnd <= 13) { effEnd = 12; changed = true; }
  }
  const realWins = wins.filter(w => !w.off); // 停班時段不算請假
  const offWin = wins.find(w => w.off);
  const fullLeave = realWins.length > 0 && effStart >= effEnd;
  const closedAll = !realWins.length && !!offWin && effStart >= effEnd; // 剩下的上班時間全部停班
  const leaveHours = realWins.reduce((a, w) => a + w.hours, 0);

  const tags = [];
  if (closedAll && !list.length) {
    tags.push(["gray", offWin.name]);
  } else if (part) {
    if (list.length && !firstIn) tags.push(["warn", "未打上班卡"]);
    if (list.length && !lastOut) tags.push(["warn", "未打下班卡"]);
    if (realWins.length) tags.push(["field", `請假 ${leaveHours}h`]);
  } else if (fullLeave) {
    tags.push(["field", "請假"]);
  } else {
    if (!firstIn) tags.push(["warn", "未打上班卡"]);
    else if (toMin(fmtTime(firstIn.ts)) > effStart * 60 + GRACE_MIN) tags.push(["late", "遲到"]);
    if (!lastOut) tags.push(["warn", "未打下班卡"]);
    else if (toMin(fmtTime(lastOut.ts)) < effEnd * 60) tags.push(["late", "早退"]);
    if (realWins.length) tags.push(["field", `請假 ${leaveHours}h`]);
  }
  if (offWin && !closedAll) tags.push(["gray", closureText(offWin)]);
  if (sorted.some(p => p.mode === "field")) tags.push(["field", "外勤"]);
  if (sorted.some(p => p.mode === "correction")) tags.push(["gray", "含補打卡"]);
  if ((part ? list.length > 0 : !fullLeave && !(closedAll && !list.length)) && !tags.some(t => t[0] === "late" || t[0] === "warn")) tags.unshift(["ok", "正常"]);
  return { firstIn, lastOut, tags, fullLeave, closedAll, leaveHours, effStart, effEnd };
}
export function tagsHtml(tags) {
  return tags.map(([cls, text]) => `<span class="tag ${cls}">${esc(text)}</span>`).join(" ");
}
export const MODE_LABEL = { office: "內勤", field: "外勤", correction: "補打卡" };
export const TYPE_LABEL = { in: "上班", out: "下班" };

// ===== 日期字串工具（格式 YYYY-MM-DD）=====
function parseD(s) { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; }
function fmtD(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
export function todayStr() { const p = twParts(new Date()); return `${p.year}-${p.month}-${p.day}`; }
export function addDays(s, n) {
  const { y, m, d } = parseD(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmtD(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function addMonths(s, n) {
  const { y, m, d } = parseD(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12 + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmtD(ny, nm, Math.min(d, dim));
}
export function weekdayOf(s) { const { y, m, d } = parseD(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
export function ymOfStr(s) { return Number(s.slice(0, 4) + s.slice(5, 7)); }
export function fmtDateStr(s) { return `${s.slice(5, 7)}/${s.slice(8, 10)}（${WEEK[weekdayOf(s)]}）`; }

// ===== 假日 =====
// holidays：Map(日期 → 名稱)
// 假日清單 → Map（日期 → 名稱，只含整天放假）；半天停班（有 from、to 整點）另外放在 .partial
export function toHolidayMap(list) {
  const all = list || [];
  const m = new Map(all.filter(h => h.from == null).map(h => [h.date, h.name || "國定假日"]));
  m.partial = new Map(all.filter(h => h.from != null).map(h => [h.date, { s: Number(h.from), e: Number(h.to), name: h.name || "停班" }]));
  return m;
}
// 半天停班（例如颱風下午停班）：回傳 {s, e, name} 或 null
export function closureOf(s, holidays) {
  return (holidays && holidays.partial && holidays.partial.get(s)) || null;
}
// 給 summarizeDay 用的停班時段（當成「不用上班」的時段，但不算請假）
export function closureWins(s, holidays) {
  const c = closureOf(s, holidays);
  return c ? [{ s: c.s, e: c.e, hours: 0, off: true, name: c.name }] : [];
}
export function closureText(c) { return c ? `${String(c.s).padStart(2, "0")}:00–${String(c.e).padStart(2, "0")}:00 ${c.name}` : ""; }
// 名稱含「補班」的日期視為上班日（例如週六補班）
export function isMakeupDay(s, holidays) {
  return !!(holidays && holidays.has(s) && String(holidays.get(s)).includes("補班"));
}
export function isOffDay(s, holidays) {
  if (isMakeupDay(s, holidays)) return false;
  const w = weekdayOf(s);
  return w === 0 || w === 6 || !!(holidays && holidays.has(s));
}
export function offDayLabel(s, holidays) {
  if (isMakeupDay(s, holidays)) return "";
  if (holidays && holidays.has(s)) return holidays.get(s);
  const w = weekdayOf(s);
  return w === 0 || w === 6 ? "假日" : "";
}

// ===== 請假／加班 =====
export const LEAVE_TYPES = [
  { key: "annual", label: "特休" },
  { key: "comp", label: "補休", note: "使用加班換得的補休時數" },
  { key: "personal", label: "事假", note: "全年 14 日內，不給工資" },
  { key: "family", label: "家庭照顧假", note: "全年 7 日，併入事假計算" },
  { key: "sick", label: "病假", note: "未住院全年 30 日內，工資折半" },
  { key: "menstrual", label: "生理假", note: "每月 1 日" },
  { key: "marriage", label: "婚假", note: "8 日" },
  { key: "funeral", label: "喪假", note: "依親等 3～8 日" },
  { key: "official", label: "公假" },
  { key: "injury", label: "公傷病假" },
  { key: "maternity", label: "產假" },
  { key: "paternity", label: "陪產檢及陪產假", note: "7 日" }
];
export const LEAVE_LABEL = Object.fromEntries(LEAVE_TYPES.map(t => [t.key, t.label]));
export const STATUS_INFO = {
  pending_supervisor: ["warn", "待主管審核"],
  pending_admin: ["warn", "待管理員核准"],
  approved: ["ok", "已核准"],
  rejected: ["late", "已駁回"],
  cancelled: ["gray", "已取消"]
};
export const ACTIVE_STATUS = ["pending_supervisor", "pending_admin", "approved"];
export const OT_COMP_LABEL = { pay: "加班費", comp: "換補休" };
export const OT_MONTH_LIMIT = 46;
export const HOURS_PER_DAY = 8;

// 一段時間內落在上班時段（08–12、13–17）的時數
export function overlapWork(s, e) {
  const o = (a, b) => Math.max(0, Math.min(e, b) - Math.max(s, a));
  return o(8, 12) + o(13, 17);
}
// 把一張假單拆成每天的時段（跳過週末與國定假日）
export function leaveDaySegments(r, holidays) {
  const out = [];
  if (!r.startDate || !r.endDate || r.endDate < r.startDate) return out;
  let d = r.startDate;
  for (let i = 0; d <= r.endDate && i < 400; i++, d = addDays(d, 1)) {
    if (isOffDay(d, holidays)) continue;
    const s = d === r.startDate ? r.startHour : 8;
    const e = d === r.endDate ? r.endHour : 17;
    const c = closureOf(d, holidays); // 停班時段不用請假
    const h = overlapWork(s, e) - (c ? overlapWork(Math.max(s, c.s), Math.min(e, c.e)) : 0);
    if (h > 0) out.push({ date: d, s, e, hours: h });
  }
  return out;
}
export function calcLeaveHours(r, holidays) {
  return leaveDaySegments(r, holidays).reduce((a, x) => a + x.hours, 0);
}
// 已核准假單 → { 日期: [時段…] }
export function buildLeaveMap(leaves, holidays) {
  const m = {};
  for (const r of leaves) {
    for (const seg of leaveDaySegments(r, holidays)) (m[seg.date] = m[seg.date] || []).push({ ...seg, type: r.leaveType });
  }
  return m;
}
export function calcOtHours(start, end) {
  if (!start || !end) return 0;
  return (toMin(end) - toMin(start)) / 60;
}

// 特休：依勞基法第 38 條，以到職日（週年制）計算目前這一年度的天數與期間
export function annualEntitlement(hireDate, onDate) {
  if (!hireDate) return null;
  const sixMonths = addMonths(hireDate, 6);
  if (onDate < sixMonths) return { start: null, end: sixMonths, days: 0 };
  let k = 6;
  while (k < 1200 && addMonths(hireDate, k + 1) <= onDate) k++;
  if (k < 12) return { start: sixMonths, end: addMonths(hireDate, 12), days: 3 };
  const y = Math.floor(k / 12);
  const days = y === 1 ? 7 : y === 2 ? 10 : y <= 4 ? 14 : y <= 9 ? 15 : Math.min(30, 15 + (y - 9));
  return { start: addMonths(hireDate, 12 * y), end: addMonths(hireDate, 12 * (y + 1)), days };
}

// 計算特休、補休餘額。reqs：該員工所有申請
// 兼職：特休時數由管理員依比例設定（partAnnualHours），不套用正職天數
export function computeBalances(reqs, hireDate, today, emp = null) {
  const ent = annualEntitlement(hireDate, today);
  const part = isPart(emp);
  const active = r => ACTIVE_STATUS.includes(r.status);
  const sum = arr => arr.reduce((a, r) => a + (r.hours || 0), 0);
  const annualTotal = !ent ? 0 : part ? (ent.start ? Number(emp.partAnnualHours) || 0 : 0) : ent.days * HOURS_PER_DAY;
  const annualUsed = ent && ent.start
    ? sum(reqs.filter(r => r.kind === "leave" && r.leaveType === "annual" && active(r) && r.startDate >= ent.start && r.startDate < ent.end))
    : 0;
  const compEarned = sum(reqs.filter(r => r.kind === "overtime" && r.comp === "comp" && r.status === "approved"));
  const compUsed = sum(reqs.filter(r => r.kind === "leave" && r.leaveType === "comp" && active(r)));
  return {
    ent, part, annualTotal, annualUsed, annualLeft: annualTotal - annualUsed,
    compEarned, compUsed, compLeft: compEarned - compUsed
  };
}
export function fmtHours(h) {
  const n = Math.round(h * 10) / 10;
  const neg = n < 0, v = Math.abs(n);
  const d = Math.floor(v / HOURS_PER_DAY), r = Math.round((v - d * HOURS_PER_DAY) * 10) / 10;
  const txt = d ? `${d} 天${r ? ` ${r} 小時` : ""}` : `${r} 小時`;
  return (neg ? "-" : "") + txt;
}
function hh(n) { return `${String(n).padStart(2, "0")}:00`; }
// 申請單的顯示文字
export function reqTitle(r) {
  return r.kind === "leave" ? LEAVE_LABEL[r.leaveType] || r.leaveType : `加班（${OT_COMP_LABEL[r.comp] || ""}）`;
}
export function reqWhen(r) {
  if (r.kind === "leave") {
    return r.startDate === r.endDate
      ? `${fmtDateStr(r.startDate)} ${hh(r.startHour)}–${hh(r.endHour)}`
      : `${fmtDateStr(r.startDate)} ${hh(r.startHour)} ～ ${fmtDateStr(r.endDate)} ${hh(r.endHour)}`;
  }
  return `${fmtDateStr(r.date)} ${r.startTime}–${r.endTime}`;
}
export function reqSortKey(r) { return (r.kind === "leave" ? r.startDate : r.date) || ""; }
// 兩張請假單是否有時段重疊
export function leaveOverlaps(a, b, holidays) {
  const sa = leaveDaySegments(a, holidays), sb = leaveDaySegments(b, holidays);
  return sa.some(x => sb.some(y => x.date === y.date && x.s < y.e && y.s < x.e));
}

// ===== 月出勤報表 =====
// 輸入：ym（例如 202610）、staff、當月打卡、所有已核准假單、當月申請、假日、今天日期
// 只統計到「昨天」，今天的資料還不完整
const LEAVE_COLS = ["annual", "comp", "personal", "family", "sick", "menstrual", "other"];
function minutesOf(d) { return toMin(fmtTime(d)); }
export function workMinutes(inD, outD) {
  const a = minutesOf(inD), b = minutesOf(outD);
  if (b <= a) return 0;
  const lunch = Math.max(0, Math.min(b, 13 * 60) - Math.max(a, 12 * 60));
  return b - a - lunch;
}
export function computeMonthReport({ ym, staff, punches, leaves, monthReqs, holidays, today, goLive = null }) {
  const y = Math.floor(ym / 100), m = ym % 100;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const people = new Map(staff.map(s => [s.empId, { empId: s.empId, name: s.name, company: s.company, hireDate: s.hireDate || null, part: isPart(s) }]));
  for (const p of punches) if (!people.has(p.empId)) people.set(p.empId, { empId: p.empId, name: p.name, company: p.company, hireDate: null });

  const punchBy = {};
  for (const p of punches) {
    const ds = ymdToInput(p.ymd);
    ((punchBy[p.empId] = punchBy[p.empId] || {})[ds] = punchBy[p.empId][ds] || []).push(p);
  }
  const leaveBy = {};
  for (const r of leaves) {
    for (const seg of leaveDaySegments(r, holidays)) {
      if (!seg.date.startsWith(monthStart.slice(0, 8))) continue;
      ((leaveBy[r.empId] = leaveBy[r.empId] || {})[seg.date] = leaveBy[r.empId][seg.date] || []).push({ ...seg, type: r.leaveType });
    }
  }
  const otBy = {};
  for (const r of monthReqs) {
    if (r.kind !== "overtime" || r.status !== "approved") continue;
    const k = `${r.empId}|${r.date}`;
    otBy[k] = (otBy[k] || 0) + r.hours;
  }

  const days = [], anomalies = [], summary = [];
  let lastDate = null;
  for (const person of [...people.values()].sort((a, b) => a.empId.localeCompare(b.empId))) {
    const S = {
      empId: person.empId, name: person.name, company: person.company, part: !!person.part,
      workdays: 0, attended: 0, fullLeaveDays: 0, offDayWork: 0,
      lateCount: 0, lateMin: 0, earlyCount: 0, earlyMin: 0,
      missIn: 0, missOut: 0, absent: 0, field: 0, correction: 0, workHours: 0,
      leave: Object.fromEntries(LEAVE_COLS.map(k => [k, 0])), otPay: 0, otComp: 0
    };
    for (let d = 1; d <= dim; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (ds >= today) break;
      lastDate = lastDate && lastDate > ds ? lastDate : ds;
      const list = ((punchBy[person.empId] || {})[ds] || []).slice().sort((a, b) => a.ts - b.ts);
      const wins = (leaveBy[person.empId] || {})[ds] || [];
      const off = isOffDay(ds, holidays);
      const beforeHire = (person.hireDate && ds < person.hireDate) || (goLive && ds < goLive);
      if ((off || beforeHire) && !list.length) continue;
      if (person.part && !list.length && !wins.length) continue; // 兼職沒來上班的日子不列入

      const sum = summarizeDay(list, off ? [] : wins.concat(closureWins(ds, holidays)), person.part);
      const row = {
        date: ds, weekday: WEEK[weekdayOf(ds)], empId: person.empId, name: person.name, company: person.company,
        firstIn: sum.firstIn ? fmtTime(sum.firstIn.ts) : "", lastOut: sum.lastOut ? fmtTime(sum.lastOut.ts) : "",
        workHours: 0, lateMin: 0, earlyMin: 0,
        leave: wins.map(w => `${LEAVE_LABEL[w.type] || w.type} ${w.hours}h`).join("、"), leaveHours: sum.leaveHours,
        overtime: otBy[`${person.empId}|${ds}`] || 0, status: "", issues: []
      };
      if (sum.firstIn && sum.lastOut) row.workHours = Math.round(workMinutes(sum.firstIn.ts, sum.lastOut.ts) / 60 * 100) / 100;
      S.workHours += row.workHours;
      if (list.some(p => p.mode === "field")) S.field++;
      if (list.some(p => p.mode === "correction")) S.correction++;
      for (const w of wins) S.leave[LEAVE_COLS.includes(w.type) ? w.type : "other"] += w.hours;

      if (off) {
        S.offDayWork++;
        row.status = `${offDayLabel(ds, holidays)}出勤`;
      } else {
        S.workdays++;
        if (sum.fullLeave) { S.fullLeaveDays++; row.status = "請假"; }
        else if (!list.length && sum.closedAll) { row.status = sum.tags[0][1]; }
        else if (!list.length && person.part) { row.status = `請假 ${sum.leaveHours}h`; }
        else if (!list.length) { S.absent++; row.status = "未打卡"; row.issues.push("整天未打卡"); }
        else {
          S.attended++;
          if (!sum.firstIn) { S.missIn++; row.issues.push("未打上班卡"); }
          if (!sum.lastOut) { S.missOut++; row.issues.push("未打下班卡"); }
          if (sum.tags.some(t => t[1] === "遲到")) {
            row.lateMin = minutesOf(sum.firstIn.ts) - sum.effStart * 60;
            S.lateCount++; S.lateMin += row.lateMin; row.issues.push(`遲到 ${row.lateMin} 分`);
          }
          if (sum.tags.some(t => t[1] === "早退")) {
            row.earlyMin = sum.effEnd * 60 - minutesOf(sum.lastOut.ts);
            S.earlyCount++; S.earlyMin += row.earlyMin; row.issues.push(`早退 ${row.earlyMin} 分`);
          }
          row.status = row.issues.length ? row.issues.join("、") : "正常";
          if (wins.length) row.status += `（請假 ${sum.leaveHours}h）`;
        }
      }
      days.push(row);
      if (row.issues.length) anomalies.push(row);
    }
    for (const r of monthReqs) {
      if (r.empId !== person.empId || r.kind !== "overtime" || r.status !== "approved") continue;
      r.comp === "comp" ? S.otComp += r.hours : S.otPay += r.hours;
    }
    S.workHours = Math.round(S.workHours * 100) / 100;
    summary.push(S);
  }
  return { days, anomalies, summary, lastDate };
}

// 特休／補休餘額總覽（年度快結束還有剩餘的員工要特別注意）
export function leaveBalanceOverview(staff, allReqs, today) {
  return staff.map(s => {
    const reqs = allReqs.filter(r => r.empId === s.empId);
    const b = computeBalances(reqs, s.hireDate, today, s);
    const daysLeft = b.ent && b.ent.start
      ? Math.round((Date.parse(b.ent.end) - Date.parse(today)) / 86400000) : null;
    return { empId: s.empId, name: s.name, company: s.company, hireDate: s.hireDate || "", ...b, daysLeft };
  });
}

// ===== GPS =====
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("此瀏覽器不支援定位功能")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      err => {
        if (err.code === 1) reject(new Error("請允許瀏覽器使用定位，才能打卡"));
        else if (err.code === 3) reject(new Error("定位逾時，請到窗邊或戶外再試一次"));
        else reject(new Error("無法取得目前位置，請稍後再試"));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// ===== 手機綁定用的裝置代碼 =====
export function getDeviceId() {
  try {
    let id = localStorage.getItem("wx_device_id");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem("wx_device_id", id);
    }
    return id;
  } catch (e) {
    return null; // 無痕模式等情況無法儲存
  }
}

// ===== 其他 =====
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function errMsg(e) {
  const code = e && e.code ? e.code : "";
  const map = {
    "auth/invalid-credential": "員工編號或密碼錯誤",
    "auth/wrong-password": "員工編號或密碼錯誤",
    "auth/user-not-found": "員工編號或密碼錯誤",
    "auth/too-many-requests": "嘗試次數過多，請稍後再試",
    "auth/weak-password": "密碼太簡單，請至少 8 個字元",
    "auth/network-request-failed": "網路連線失敗，請檢查網路",
    "auth/requires-recent-login": "請重新登入後再修改密碼",
    "permission-denied": "沒有權限執行此動作",
    "unavailable": "網路連線不穩，請稍後再試"
  };
  return map[code] || (e && e.message) || "發生錯誤，請稍後再試";
}
export function showMsg(el, text, kind = "info") {
  el.className = `msg ${kind}`;
  el.textContent = text;
  el.classList.remove("hidden");
}
export function hideMsg(el) { el.classList.add("hidden"); }
export function checkNewPassword(p1, p2) {
  if (p1.length < 8) return "密碼至少需要 8 個字元";
  if (p1 !== p2) return "兩次輸入的密碼不一致";
  return "";
}

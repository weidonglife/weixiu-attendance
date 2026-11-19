// 共用設定與工具函式 — 打卡系統
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { parseD, fmtD, addDays, addMonths, isPart, ACTIVE_STATUS, HOURS_PER_DAY, annualEntitlement, annualPeriodInfo } from "./leavecalc.js?v=1";
export { addDays, addMonths, isPart, ACTIVE_STATUS, HOURS_PER_DAY, annualEntitlement, annualPeriodInfo };

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

// 公司活動類別：[名稱, CSS 樣式]（順序＝選單順序；"" 是「一般」）
export const EVENT_CATS = {
  trip: ["外勤行程", "trip"], training: ["教育訓練", "trn"], audit: ["稽核", "aud"],
  meeting: ["會議", "mtg"], visit: ["客戶來訪", "vis"], "": ["一般", "ev"]
};
export const WORK = { start: "08:00", lateAfter: "08:10", end: "17:00" };
export const DEFAULT_RADIUS = 200; // 公尺
// 員工身分：full 正職、part 兼職（時間不固定，只記工時）。舊資料沒有這個欄位＝正職
export const EMP_TYPE_LABEL = { full: "正職", part: "兼職" };
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
export function todayStr() { const p = twParts(new Date()); return `${p.year}-${p.month}-${p.day}`; }
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
// 依勞動基準法、勞工請假規則、性別平等工作法（含 2026-01-01 起新制）
//   cap：法定上限（小時）；per：year＝同一曆年、month＝同一月份
//   超過上限時系統會提醒、要求再按一次確認（雇主可以給得比法律多，所以不完全擋）
export const LEAVE_TYPES = [
  { key: "annual", label: "特休", note: "依年資計算（勞基法第 38 條），工資照給；年度終了未休完應發給工資或經雙方同意遞延一年" },
  { key: "comp", label: "補休", note: "使用加班換得的補休時數；依加班先後順序使用，1 年內要休完（但最晚到該特休年度結束），到期未休完改發加班費" },
  { key: "personal", label: "事假", note: "全年 14 日（含家庭照顧假），不給工資", cap: 112, per: "year" },
  { key: "family", label: "家庭照顧假", note: "全年 56 小時（7 日），可以按小時請，併入事假計算；不給工資，但不得因此扣全勤獎金", cap: 56, per: "year" },
  { key: "sick", label: "病假", note: "未住院全年 30 日內工資折半；一年內未超過 10 日，公司不得因此給予不利處分", cap: 240, per: "year" },
  { key: "hospital", label: "病假（住院）", note: "住院者 2 年內合計不超過 1 年（含未住院病假）；全年 30 日內工資折半" },
  { key: "menstrual", label: "生理假", note: "每月 1 日，工資折半；全年前 3 日不併入病假，超過的併入病假計算", cap: 8, per: "month" },
  { key: "marriage", label: "婚假", note: "8 日，工資照給（原則上於結婚前 10 日至結婚後 3 個月內請畢）" },
  { key: "funeral", label: "喪假", note: "依親等 3～8 日，工資照給：父母、養父母、繼父母、配偶 8 日；祖父母、子女、配偶之父母 6 日；曾祖父母、兄弟姊妹、配偶之祖父母 3 日" },
  { key: "official", label: "公假", note: "依實際需要，工資照給" },
  { key: "injury", label: "公傷病假", note: "職業災害，依實際需要；公司按原領工資補償" },
  { key: "maternity", label: "產假", note: "分娩前後 8 週；懷孕 3 個月以上流產 4 週、2～3 個月流產 1 週、未滿 2 個月流產 5 日。以日曆天連續計算（含假日）；到職滿 6 個月工資照給，未滿減半" },
  { key: "prenatal", label: "產檢假", note: "懷孕期間共 7 日，可以按小時請，工資照給" },
  { key: "tocolysis", label: "安胎休養", note: "依醫師診斷，併入住院病假計算；不得因此扣全勤獎金" },
  { key: "paternity", label: "陪產檢及陪產假", note: "配偶懷孕期間至分娩後 15 日內，共 7 日，可以按小時請，工資照給" },
  { key: "childcare", label: "育嬰留停（按日）", note: "2026 年起可以「日」為單位申請，每次請整天；留職停薪不給工資（可向勞保局申請育嬰津貼）；原則上 5 日前提出", fullDay: true }
];
export const LEAVE_LABEL = Object.fromEntries(LEAVE_TYPES.map(t => [t.key, t.label]));

// 法定上限檢查：draft＝這張假單（含 hours），reqs＝這個人所有申請。回傳提醒文字（空字串＝沒問題）
export function leaveLegalWarn(draft, reqs) {
  const t = LEAVE_TYPES.find(x => x.key === draft.leaveType);
  if (!t) return "";
  const year = (draft.startDate || "").slice(0, 4), month = (draft.startDate || "").slice(0, 7);
  const act = reqs.filter(r => r.kind === "leave" && ACTIVE_STATUS.includes(r.status) && r.id !== draft.id);
  const used = (keys, prefix) => act.filter(r => keys.includes(r.leaveType) && (r.startDate || "").startsWith(prefix))
    .reduce((a, r) => a + (r.hours || 0), 0);
  const d = n => fmtHours(n);
  const out = [];
  if (t.cap) {
    const prefix = t.per === "month" ? month : year;
    const u = used([t.key], prefix) + draft.hours;
    if (u > t.cap) out.push(`${t.label}${t.per === "month" ? "本月" : "今年"}累計將達 ${d(u)}，超過法定的 ${d(t.cap)}`);
  }
  if (draft.leaveType === "family") {   // 家庭照顧假併入事假
    const u = used(["personal", "family"], year) + draft.hours;
    if (u > 112) out.push(`事假＋家庭照顧假今年累計將達 ${d(u)}，超過法定的 14 天`);
  }
  if (draft.leaveType === "sick" || draft.leaveType === "menstrual") {   // 生理假超過 3 日的部分併入病假
    const sick = used(["sick"], year) + (draft.leaveType === "sick" ? draft.hours : 0);
    const men = used(["menstrual"], year) + (draft.leaveType === "menstrual" ? draft.hours : 0);
    const u = sick + Math.max(0, men - 24);
    if (u > 240 && !(draft.leaveType === "sick" && sick > 240)) out.push(`病假（含超過 3 日的生理假）今年累計將達 ${d(u)}，超過未住院 30 天`);
  }
  return out.join("；");
}
export const STATUS_INFO = {
  pending_supervisor: ["warn", "待主管審核"],
  pending_admin: ["warn", "待核定"],          // 內部名稱沿用 pending_admin，代表「等副主官／主官最終核定」
  pending: ["warn", "待核定"],                // 舊版補打卡的狀態
  approved: ["ok", "已核准"],
  rejected: ["late", "已駁回"],
  cancelled: ["gray", "已取消"]
};
export const OT_COMP_LABEL = { pay: "加班費", comp: "換補休" };
export const OT_MONTH_LIMIT = 46;

// ===================================================================
// 簽核流程（settings/approval：{ chief: 主官員工編號, deputy: 副主官員工編號 }）
//   一般員工：直屬主管 → 8 小時以內直接生效；超過 8 小時再送副主官核定（主官隨時也可以核定）
//   沒有直屬主管：直接送副主官（主官也可以）
//   主官本人的申請 → 副主官核定；副主官本人的申請 → 主官核定
//   直屬主管本身就是主官或副主官 → 他核准就生效
//   補打卡比照辦理（視為 1 天以內）
// ===================================================================
export const FINAL_HOURS = HOURS_PER_DAY;
export const PENDING = ["pending_supervisor", "pending_admin", "pending"];
export function normApproval(a) { return { chief: (a && a.chief) || null, deputy: (a && a.deputy) || null }; }
export function topRole(a, empId) {
  if (!empId) return null;
  if (a.chief === empId) return "chief";
  if (a.deputy === empId) return "deputy";
  return null;
}
export const TOP_LABEL = { chief: "主官", deputy: "副主官", admin: "管理員" };
// 送出時：要先給誰審
export function routeOf(a, emp) {
  const sup = topRole(a, emp.empId) ? null : (emp.supervisorEmpId || null);
  return { supervisorEmpId: sup, status: sup ? "pending_supervisor" : "pending_admin" };
}
// 直屬主管核准後的狀態
export function afterSupervisor(a, supEmpId, hours) {
  return (hours <= FINAL_HOURS || topRole(a, supEmpId)) ? "approved" : "pending_admin";
}
// 這張單的最終核定應由誰處理（用來顯示與通知；主官另外隨時都可以核定）
export function finalApprover(a, empId) {
  if (empId === a.deputy) return a.chief;
  if (empId === a.chief) return a.deputy;
  return a.deputy || a.chief;
}
// 我能不能做最終核定
export function canFinal(a, myEmpId, r) {
  return !!topRole(a, myEmpId) && r.empId !== myEmpId && (r.status === "pending_admin" || r.status === "pending");
}
// 送出後給員工看的提示
export function routeMsg(a, route, empId) {
  if (route.status === "pending_supervisor") return "已送出，等待直屬主管審核";
  const f = finalApprover(a, empId);
  return f ? `已送出，等待${TOP_LABEL[topRole(a, f)]}核定` : "已送出，等待管理員核定";
}
// 這張單目前停在哪裡（給管理員和主管看）
export function stageText(a, r, nameOf = x => x) {
  if (r.status === "pending_supervisor") return `等待直屬主管 ${nameOf(r.supervisorEmpId)} 審核`;
  if (r.status === "pending_admin" || r.status === "pending") {
    const f = finalApprover(a, r.empId);
    if (!f) return "尚未設定主官／副主官，請管理員代為核定";
    const role = topRole(a, f);
    return role === "deputy" && a.chief && r.empId !== a.chief
      ? `等待副主官 ${nameOf(f)} 核定（主官 ${nameOf(a.chief)} 也可以核定）`
      : `等待${TOP_LABEL[role]} ${nameOf(f)} 核定`;
  }
  return "";
}
// 請假一覽（主管看的精簡資料，不含事由）：leaveList/{假單編號}，內容永遠和假單一致
export const LL_KEYS = ["empId", "name", "company", "leaveType", "hours", "startDate", "endDate", "startHour", "endHour", "status"];
export const leaveListOf = r => Object.fromEntries(LL_KEYS.map(k => [k, r[k] ?? null]));
export const LL_DAYS = 30;

// 審核意見（新舊欄位都顯示）
export function reviewNotes(r, nameOf = x => x) {
  const out = [];
  if (r.supNote) out.push(`主管意見：${r.supNote}`);
  if (r.finalNote) out.push(`${TOP_LABEL[r.finalRole] || "核定"}${r.finalRole === "admin" ? "代核" : ""}意見：${r.finalNote}`);
  if (r.adminNote) out.push(`管理員意見：${r.adminNote}`);
  return out;
}
export function timelineHtml(r, nameOf = x => x) {
  const t = reviewTimeline(r, nameOf);
  return t.length ? `<div class="tl">${t.map(([i, x]) => `<div><span class="tl-i">${i}</span>${esc(x)}</div>`).join("")}</div>` : "";
}
// 簽核時間軸：送出 → 直屬主管 → 主官／副主官（或管理員代核）
function tsDate(t) { return t && typeof t.toDate === "function" ? t.toDate() : (t instanceof Date ? t : null); }
export function fmtStamp(t) {
  const d = tsDate(t);
  if (!d) return "";
  const p = twParts(d), w = WEEK[new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay()];
  return `${+p.month}/${+p.day}（${w}）${p.hour}:${p.minute}`;
}
export function reviewTimeline(r, nameOf = x => x) {
  const out = [];
  const at = t => fmtStamp(t) || "時間未記錄";
  if (r.createdAt) out.push(["📤", `${at(r.createdAt)}　送出申請`]);
  const finalDone = !!(r.finalBy || r.adminBy || r.reviewedBy);
  if (r.supBy) {
    const rej = r.status === "rejected" && !finalDone;
    out.push([rej ? "❌" : "✅", `${at(r.supAt)}　直屬主管 ${nameOf(r.supBy)} ${rej ? "駁回" : "核准"}`]);
  }
  const fin = r.finalBy ? [r.finalBy, r.finalAt, r.finalRole] : r.adminBy ? [r.adminBy, r.adminAt, "admin"] : r.reviewedBy ? [r.reviewedBy, r.reviewedAt, "admin"] : null;
  const revoked = r.status === "cancelled" && !!r.cancelledBy;   // 管理員撤銷已核准的單
  if (fin && (r.status === "approved" || r.status === "rejected" || revoked)) {
    const ok = r.status !== "rejected", admin = fin[2] === "admin";
    const who = `${TOP_LABEL[fin[2]] || ""} ${nameOf(fin[0])}`.trim();
    out.push([ok ? "✅" : "❌", `${at(fin[1])}　${who} ${admin ? (ok ? "代為核准" : "駁回") : (ok ? "核定" : "駁回")}`]);
  }
  if (r.status === "cancelled") out.push(["🚫", `${r.cancelledAt ? at(r.cancelledAt) + "　" : ""}${revoked ? `管理員 ${nameOf(r.cancelledBy)} 撤銷核准` : "員工自行取消"}`]);
  return out;
}

// 誰核准的（已核准的單）
export function approvedByText(r, nameOf = x => x) {
  if (r.status !== "approved") return "";
  if (r.finalBy) return `${TOP_LABEL[r.finalRole] || ""} ${nameOf(r.finalBy)} ${r.finalRole === "admin" ? "代為核准" : "核定"}`.trim();
  if (r.supBy) return `直屬主管 ${nameOf(r.supBy)} 核准`;
  if (r.adminBy) return `管理員 ${nameOf(r.adminBy)} 核准`;
  if (r.reviewedBy) return `${nameOf(r.reviewedBy)} 核准`;
  return "";
}

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


// 補休：加班換得的時數 1 年內要休完（勞基法第 32-1 條，期限由勞資約定）
//   施行細則第 22-2 條：依加班先後順序補休；期限超過特休年度（本系統用到職週年制）末日者，以該年度末日為期限
export const COMP_MONTHS = 12;
export function compExpiry(date, hireDate) {
  const exp = addMonths(date, COMP_MONTHS);
  const ent = hireDate ? annualEntitlement(hireDate, date) : null;
  return ent && ent.end && ent.end < exp ? ent.end : exp;   // exp＝當天起就不能再用
}
// 到期補休的發給期限：補休期限末日（exp 前一天）起 30 日內（或次一工資給付日）
export function compPayDeadline(exp) { return addDays(exp, 29); }
// paid：users.compSettle＝{ 加班申請 id: { hours, payDate, at, by, byName } }，已折發工資的到期補休
export function compLots(reqs, today, hireDate, paid = {}) {
  const active = r => ACTIVE_STATUS.includes(r.status);
  const lots = reqs.filter(r => r.kind === "overtime" && r.comp === "comp" && r.status === "approved")
    .map(r => ({ id: r.id, date: r.date, exp: compExpiry(r.date, hireDate), hours: r.hours || 0, left: r.hours || 0 }))
    .sort((x, y) => x.date.localeCompare(y.date) || x.exp.localeCompare(y.exp));
  const uses = reqs.filter(r => r.kind === "leave" && r.leaveType === "comp" && active(r))
    .sort((x, y) => x.startDate.localeCompare(y.startDate));
  const short = {};
  for (const u of uses) {
    let need = u.hours || 0;
    for (const l of lots) {
      if (need <= 0) break;
      if (l.left <= 0 || l.exp <= u.startDate) continue;   // 請假那天已經到期的不能用
      if (l.date > u.startDate) continue;                    // 請假日之後才加班換得的補休，不能拿來抵這次請假
      const t = Math.min(need, l.left); l.left -= t; need -= t;
    }
    if (need > 0) short[u.id] = need;
  }
  for (const l of lots) {                                   // 已折發工資的到期補休：不再列為未處理
    const p = paid && paid[l.id];
    if (p) { l.paid = p; l.left = Math.max(0, l.left - (Number(p.hours) || 0)); }
  }
  const paidLots = lots.filter(l => l.paid);
  const expiredLots = lots.filter(l => l.left > 0 && l.exp <= today);
  const live = lots.filter(l => l.left > 0 && l.exp > today);
  return {
    lots, short, paidLots,
    expired: expiredLots.reduce((a, l) => a + l.left, 0), expiredLots,
    left: live.reduce((a, l) => a + l.left, 0),
    next: live[0] ? { exp: live[0].exp, hours: live.filter(l => l.exp === live[0].exp).reduce((a, l) => a + l.left, 0) } : null
  };
}


// 計算特休、補休餘額。reqs：該員工所有申請
// 兼職：特休時數由管理員依比例設定（partAnnualHours），不套用正職天數
export function computeBalances(reqs, hireDate, today, emp = null) {
  const ent = annualEntitlement(hireDate, today);
  const part = isPart(emp);
  const active = r => ACTIVE_STATUS.includes(r.status);
  const sum = arr => arr.reduce((a, r) => a + (r.hours || 0), 0);
  const empH = { ...(emp || {}), hireDate };
  const info = ent && ent.start ? annualPeriodInfo(empH, reqs, ent.start) : null;
  const annualTotal = !ent ? 0 : info ? info.total : 0;
  // 系統上線前（舊休假表）已休的特休：只算在填寫時的那個特休年度
  const annualPre = info ? info.pre : 0;
  const annualUsed = info ? info.used : 0;
  const annualCarry = info ? info.carry : 0;
  const compEarned = sum(reqs.filter(r => r.kind === "overtime" && r.comp === "comp" && r.status === "approved"));
  const compUsed = sum(reqs.filter(r => r.kind === "leave" && r.leaveType === "comp" && active(r)));
  const cl = compLots(reqs, today, hireDate, (emp && emp.compSettle) || {});
  return {
    ent, part, annualTotal, annualUsed, annualPre, annualCarry, annualLeft: annualTotal - annualUsed,
    compEarned, compUsed, compLeft: cl.left, compExpired: cl.expired, compNext: cl.next
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

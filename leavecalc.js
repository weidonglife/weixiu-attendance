// 特休計算（純計算，不連資料庫）
//   網站（common.js）和 LINE 通知服務（每天下載這個檔案來算特休提醒）共用同一份，避免兩套算法不一致
//   注意：這個檔案不能 import 任何東西，也只能用一般 JavaScript 語法（通知服務會直接執行它）
export function parseD(s) { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; }
export function fmtD(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
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
export function isPart(u) { return !!u && u.empType === "part"; }
export const ACTIVE_STATUS = ["pending_supervisor", "pending_admin", "approved"];
export const HOURS_PER_DAY = 8;
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
// 特休年度結算：users.annualSettle = { 年度起算日: { pay: 發給工資的時數, defer: 遞延到下一年度的時數, at, by } }
// 某年度的特休總額（含上一年度遞延過來的）、已休、未休
export function annualPeriodInfo(emp, reqs, start) {
  if (!emp || !emp.hireDate || !start) return null;
  const ent = annualEntitlement(emp.hireDate, start);
  if (!ent || ent.start !== start) return null;
  const part = isPart(emp);
  const base = part ? Number(emp.partAnnualHours) || 0 : ent.days * HOURS_PER_DAY;
  const prev = annualEntitlement(emp.hireDate, addDays(start, -1));
  const carry = prev && prev.start ? Number(((emp.annualSettle || {})[prev.start] || {}).defer) || 0 : 0;
  const pre = emp.preAnnualFrom === start ? Number(emp.preAnnualHours) || 0 : 0;
  const used = reqs.filter(r => r.kind === "leave" && r.leaveType === "annual" && ACTIVE_STATUS.includes(r.status)
    && r.startDate >= ent.start && r.startDate < ent.end).reduce((a, r) => a + (r.hours || 0), 0) + pre;
  const total = base + carry, unused = Math.max(0, total - used);
  const payOnly = Math.min(unused, Math.max(0, carry - used));   // 遞延過來沒休完的，不能再遞延，一定要發工資
  return { start: ent.start, end: ent.end, days: ent.days, base, carry, pre, used, total, unused, payOnly,
    deferrable: unused - payOnly, settle: (emp.annualSettle || {})[ent.start] || null, prevStart: prev ? prev.start : null };
}

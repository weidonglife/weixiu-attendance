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
export const COMPANIES = { W: "唯修科技", S: "唯校中心", C: "傳創機電" };
export const WORK = { start: "08:00", lateAfter: "08:10", end: "17:00" };
export const DEFAULT_RADIUS = 200; // 公尺
const EMAIL_DOMAIN = "staff.weixiu-attendance.app"; // 內部用的虛擬信箱網域，不會寄信

export function normEmpId(s) { return (s || "").trim().toUpperCase(); }
export function validEmpId(s) { return /^[WSC]\d{3}$/.test(s); }
export function companyOf(empId) { return COMPANIES[empId.charAt(0)] || ""; }
export function makeEmail(empId) {
  // 每次建立帳號都加上獨特尾碼，重設密碼時才能換新帳號
  return `${empId.toLowerCase()}.${Date.now().toString(36)}@${EMAIL_DOMAIN}`;
}

// ===== 登入 =====
export async function loginWithEmpId(empIdRaw, password) {
  const empId = normEmpId(empIdRaw);
  if (!validEmpId(empId)) throw new Error("員工編號格式不正確（例如 W001）");
  const snap = await getDoc(doc(db, "logins", empId));
  if (!snap.exists()) throw new Error("查無此員工編號");
  await signInWithEmailAndPassword(auth, snap.data().email, password);
  return empId;
}
export function logout() { return signOut(auth); }

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
// 傳入同一天的打卡紀錄（含 ts:Date、type），回傳上班／下班時間與狀態
export function summarizeDay(list) {
  const sorted = [...list].sort((a, b) => a.ts - b.ts);
  const ins = sorted.filter(p => p.type === "in");
  const outs = sorted.filter(p => p.type === "out");
  const firstIn = ins[0] || null;
  const lastOut = outs[outs.length - 1] || null;
  const tags = [];
  if (!firstIn) tags.push(["warn", "未打上班卡"]);
  else if (fmtTime(firstIn.ts) > WORK.lateAfter) tags.push(["late", "遲到"]);
  if (!lastOut) tags.push(["warn", "未打下班卡"]);
  else if (fmtTime(lastOut.ts) < WORK.end) tags.push(["late", "早退"]);
  if (sorted.some(p => p.mode === "field")) tags.push(["field", "外勤"]);
  if (sorted.some(p => p.mode === "correction")) tags.push(["gray", "含補打卡"]);
  if (!tags.some(t => t[0] === "late" || t[0] === "warn")) tags.unshift(["ok", "正常"]);
  return { firstIn, lastOut, tags };
}
export function tagsHtml(tags) {
  return tags.map(([cls, text]) => `<span class="tag ${cls}">${esc(text)}</span>`).join(" ");
}
export const MODE_LABEL = { office: "內勤", field: "外勤", correction: "補打卡" };
export const TYPE_LABEL = { in: "上班", out: "下班" };

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

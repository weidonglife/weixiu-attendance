// 員工打卡頁（含請假／加班／主管審核）
import {
  auth, db, loginWithEmpId, logout, getDeviceId, getPosition, distanceM,
  fmtTime, fmtTimeSec, fmtDateLong, fmtYmd, ymOf, ymdOf, daysInYm, ymdToInput,
  summarizeDay, tagsHtml, MODE_LABEL, TYPE_LABEL, esc, errMsg, showMsg, hideMsg,
  checkNewPassword, WORK,
  todayStr, ymOfStr, toHolidayMap, isOffDay, offDayLabel, buildLeaveMap, calcLeaveHours, calcOtHours,
  computeBalances, compLots, fmtHours, LEAVE_TYPES, leaveLegalWarn, STATUS_INFO, ACTIVE_STATUS, OT_MONTH_LIMIT,
  reqTitle, reqWhen, reqSortKey, leaveOverlaps, fmtDateStr
  , isPart, notify, callNotify, NOTIFY_URL, LINE_OA_ID, addDays, closureWins
  , normApproval, topRole, routeOf, afterSupervisor, canFinal, finalApprover, routeMsg, stageText, reviewNotes,
  approvedByText, TOP_LABEL, PENDING, leaveListOf, LL_DAYS, LEAVE_LABEL, timelineHtml, EVENT_CATS
} from "./common.js?v=27";
import { onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { adoptUserLang, setLangSaver } from "./i18n.js?v=3";
import { startBoard } from "./board.js?v=30";
import { startCalendar } from "./calendar.js?v=15";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, onSnapshot,
  writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const views = ["vLoading", "vLogin", "vChangePw", "vBlocked", "vMain"];
function show(v) { views.forEach(x => $(x).classList.toggle("hidden", x !== v)); }

let me = null;        // 目前登入員工的資料
let office = null;    // 公司位置設定
let holidays = new Map(); // 國定假日
let myReqs = [];      // 我的請假／加班申請
let mode = "office";  // office | field
let boardStop = null; // 今日出勤看板（點分頁時才啟動）
let calStop = null;   // 出勤月曆＋公司行事曆（點分頁時才啟動；主管看完整版）
let calFull = false;
let approval = normApproval(null); // 主官／副主官設定
let dirList = [];     // 員工名單（顯示姓名用）
const deviceId = getDeviceId();

// LINE 內建瀏覽器：提醒改用手機瀏覽器（LINE 看到 openExternalBrowser=1 會改用 Safari／Chrome 開啟）
if (/\bLine\//i.test(navigator.userAgent)) {
  $("lineWarn").classList.remove("hidden");
  $("btnOpenExt").onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("openExternalBrowser", "1");
    location.href = u.toString();
  };
}

// ===== 時鐘（僅顯示用，實際打卡時間由伺服器決定）=====
function tick() {
  const now = new Date();
  $("clockTime").textContent = fmtTimeSec(now);
  $("clockDate").textContent = fmtDateLong(now);
}
setInterval(tick, 1000); tick();

// ===== 登入狀態 =====
onAuthStateChanged(auth, async user => {
  if (!user) { setLangSaver(null); me = null; stopReviewWatch(); $("who").textContent = ""; show("vLogin"); return; }
  show("vLoading");
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active !== true) {
      return blocked("帳號已停用", "這個帳號目前無法使用，請聯絡管理員。");
    }
    me = { uid: user.uid, ...snap.data() };
    const saveLang = l => updateDoc(doc(db, "users", me.uid), { lang: l });
    adoptUserLang(me.lang, saveLang);
    setLangSaver(saveLang);
    $("who").textContent = `${me.name}（${me.empId}）`;

    if (me.mustChangePassword) { show("vChangePw"); return; }

    // 手機綁定
    if (!deviceId) {
      return blocked("無法綁定手機", "請不要使用無痕模式，並允許瀏覽器儲存網站資料後再試一次。");
    }
    if (!me.deviceId) {
      await updateDoc(doc(db, "users", me.uid), { deviceId });
      me.deviceId = deviceId;
    } else if (me.deviceId !== deviceId) {
      return blocked("這支手機尚未綁定",
        "你的帳號已綁定另一支手機（或瀏覽器資料被清除）。如果換了手機，請聯絡管理員重設手機綁定。");
    }

    const [oSnap, hSnap, aSnap] = await Promise.all([
      getDoc(doc(db, "settings", "office")),
      getDoc(doc(db, "settings", "holidays")),
      getDoc(doc(db, "settings", "approval")).catch(() => null)
    ]);
    approval = normApproval(aSnap && aSnap.exists() ? aSnap.data() : null);
    office = oSnap.exists() ? oSnap.data() : null;
    holidays = toHolidayMap(hSnap.exists() ? hSnap.data().list : []);

    show("vMain");
    initMain();
  } catch (e) {
    blocked("發生錯誤", errMsg(e));
  }
});

function blocked(title, text) {
  $("blockedTitle").textContent = title;
  $("blockedText").textContent = text;
  show("vBlocked");
}

$("btnLogin").onclick = async () => {
  hideMsg($("loginMsg"));
  $("btnLogin").disabled = true;
  try {
    await loginWithEmpId($("loginId").value, $("loginPw").value);
    $("loginPw").value = "";
  } catch (e) { showMsg($("loginMsg"), errMsg(e), "err"); }
  $("btnLogin").disabled = false;
};
$("loginPw").addEventListener("keydown", e => { if (e.key === "Enter") $("btnLogin").click(); });

$("btnChangePw").onclick = async () => {
  const p1 = $("newPw1").value, p2 = $("newPw2").value;
  const bad = checkNewPassword(p1, p2);
  if (bad) { showMsg($("pwMsg"), bad, "err"); return; }
  $("btnChangePw").disabled = true;
  try {
    await updatePassword(auth.currentUser, p1);
    await updateDoc(doc(db, "users", me.uid), { mustChangePassword: false });
    $("newPw1").value = $("newPw2").value = "";
    location.reload();
  } catch (e) { showMsg($("pwMsg"), errMsg(e), "err"); }
  $("btnChangePw").disabled = false;
};

$("btnLogout").onclick = $("btnBlockedLogout").onclick = () => logout();

// ===== 行事曆 =====
function openCalendar() {
  calFull = isSup || !!myTop();
  calStop = startCalendar($("calRoot"), { me, full: calFull, admin: me && me.role === "admin" });
}

// 手機行事曆訂閱：每人專屬連結（calTokens/{uid}）。所有人都是同一版（請假只寫「請假」，假別只在系統內查看）
let calToken = "";
function newToken() {
  const a = new Uint8Array(20); crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function loadCalLinks(renew = false) {
  try {
    const ref = doc(db, "calTokens", me.uid);
    const s = renew ? null : await getDoc(ref);
    const t = s && s.exists() ? s.data().token || "" : "";
    if (/^[0-9a-f]{40}$/.test(t)) calToken = t;
    else { calToken = newToken(); await setDoc(ref, { token: calToken, at: serverTimestamp() }); }
  } catch (e) { console.warn("calToken", e); calToken = ""; }
  renderCalLink();
}
function renderCalLink() {
  const box = $("calLinkBody");
  if (!box) return;
  if (!calToken || !NOTIFY_URL) { box.innerHTML = `<p class="muted">暫時無法取得訂閱連結，請稍後再試。</p>`; return; }
  const url = `${NOTIFY_URL}?ics=${calToken}`;
  const webcal = url.replace(/^https?:\/\//, "webcal://");
  const gcal = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal);
  box.innerHTML = `<p class="muted" style="margin-top:-6px">把公司行事曆加到手機，公司活動、放假和請假會自動出現，也可以用手機的提醒功能。</p>
    <div class="acts">
      <a class="btnlink" href="${esc(webcal)}">加到 iPhone 行事曆</a>
      <a class="btnlink" href="${esc(gcal)}" target="_blank" rel="noopener">加到 Google 日曆</a>
      <button type="button" class="secondary small" id="btnCopyCal">複製連結</button>
    </div>
    <p class="muted" style="font-size:12px">這是你專屬的連結，請不要分享給別人。Android 手機請按「加到 Google 日曆」，用你的 Google 帳號登入後按「新增」。Google 日曆大約每幾小時更新一次。<br>
      懷疑連結外流？<a href="#" id="btnRenewCal">換一個新連結</a>（舊的會失效，要重新訂閱一次）</p>`;
  $("btnCopyCal").onclick = async () => {
    try { await navigator.clipboard.writeText(url); $("btnCopyCal").textContent = "已複製"; } catch (e) { prompt("請複製這個連結", url); }
  };
  $("btnRenewCal").onclick = async ev => {
    ev.preventDefault();
    const a = ev.target;
    if (a.dataset.sure !== "1") { a.dataset.sure = "1"; a.textContent = "確定要換？再按一次"; return; }
    await loadCalLinks(true);
  };
}

// ===== 我的設定 =====
function renderMe() {
  if (!me) return;
  const rows = [
    ["員工編號", me.empId], ["姓名", me.name], ["公司", me.company],
    ["身分", isPart(me) ? "兼職" : "正職"],
    ["直屬主管", me.supervisorEmpId ? nameOf(me.supervisorEmpId) : "（無）"]
  ];
  if (me.hireDate) rows.push(["到職日", me.hireDate]);
  $("meInfo").innerHTML = rows.map(([k, v]) => `<div><span class="muted">${k}</span><b>${esc(v || "")}</b></div>`).join("");
}
$("btnMyPw").onclick = async () => {
  const cur = $("myPwCur").value, p1 = $("myPw1").value, p2 = $("myPw2").value;
  const msg = $("myPwMsg");
  if (!cur) { showMsg(msg, "請輸入目前的密碼", "err"); return; }
  const bad = checkNewPassword(p1, p2);
  if (bad) { showMsg(msg, bad, "err"); return; }
  if (p1 === cur) { showMsg(msg, "新密碼不能和目前的密碼一樣", "err"); return; }
  $("btnMyPw").disabled = true;
  try {
    const u = auth.currentUser;
    // 先用目前的密碼確認是本人，再改成新密碼
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur));
    } catch (e) {
      const c = e && e.code;
      throw (c === "auth/invalid-credential" || c === "auth/wrong-password") ? new Error("目前的密碼不正確") : e;
    }
    await updatePassword(u, p1);
    $("myPwCur").value = $("myPw1").value = $("myPw2").value = "";
    showMsg(msg, "密碼已修改，下次登入請用新密碼", "ok");
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnMyPw").disabled = false;
};

// ===== 分頁 =====
document.querySelectorAll("#mainTabs button[data-tab]").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#mainTabs button[data-tab]").forEach(b => b.classList.toggle("on", b === btn));
    ["pPunch", "pLeave", "pBoard", "pReview", "pCal", "pEv", "pMe"].forEach(id => $(id).classList.toggle("hidden", id !== btn.dataset.tab));
    if (btn.dataset.tab === "pEv") loadUpcomingEvents();
    $("who").classList.toggle("on", btn.dataset.tab === "pMe");
    if (btn.dataset.tab === "pMe") renderMe();
    if (btn.dataset.tab === "pCal" && !calStop) openCalendar();
    if (btn.dataset.tab === "pBoard" && !boardStop) boardStop = startBoard($("boardRoot"));
  };
});

// ===== 主畫面 =====
let mainReady = false;
async function initMain() {
  const ym = ymOf(new Date());
  $("monthPick").value = `${String(ym).slice(0, 4)}-${String(ym).slice(4)}`;
  if (!mainReady) {
    $("monthPick").onchange = () => loadMonth();
    initLeaveForm();
    mainReady = true;
  }
  loadToday();
  loadCorrections();
  await loadRequests();
  loadMonth();
  watchReview();
  loadLine();
  initShifts();
  loadAgents();
}

// ===== 「公司活動」分頁：今天、明天、接下來一週 =====
const EV_CAT = EVENT_CATS;
async function loadUpcomingEvents() {
  try {
    const t = todayStr(), t1 = addDays(t, 1), last = addDays(t, 8);
    const snap = await getDocs(query(collection(db, "events"), where("endDate", ">=", t)));
    const evs = snap.docs.map(d => d.data()).filter(e => e.startDate <= last);
    const day = d => evs.filter(e => e.startDate <= d && e.endDate >= d)
      .sort((a, b) => (a.allDay ? "" : a.startTime).localeCompare(b.allDay ? "" : b.startTime));
    const list = (d, label) => {
      const a = day(d);
      return `<div class="ev-day"><div class="ev-h">${label} <span class="muted">${esc(fmtDateStr(d))}</span></div>${a.length
        ? a.map(e => {
            const c = EV_CAT[e.category || ""] || EV_CAT[""];
            const when = e.allDay || e.startDate !== d && e.endDate !== d ? "整天" : `${e.startDate === d ? esc(e.startTime) : ""}–${e.endDate === d ? esc(e.endTime) : ""}`;
            const pp = (e.people || []).map(p => p.n).filter(Boolean), mine = (e.people || []).some(p => p.e === me.empId);
            return `<div class="ev-it${mine ? " mine" : ""}"><span class="cc ${c[1]}">${c[0]}</span><span class="ev-w">${when}</span><span>${mine ? "⭐ " : ""}${e.company ? `［${esc(e.company)}］` : ""}<span translate="no">${esc(e.title)}</span>${e.location ? `<span class="muted">＠<span translate="no">${esc(e.location)}</span></span>` : ""}${pp.length ? `<span class="ev-pp">👥 <span translate="no">${esc(pp.join("、"))}</span></span>` : ""}</span></div>`;
          }).join("")
        : '<div class="muted small">沒有活動</div>'}</div>`;
    };
    let h = list(t, "今天") + list(t1, "明天");
    const later = [];
    for (let d = addDays(t, 2); d <= last; d = addDays(d, 1)) if (day(d).length) later.push(d);
    h += later.length ? `<h3 class="ev-sub">接下來一週</h3>` + later.map(d => list(d, "")).join("") : "";
    $("evBody").innerHTML = h;
  } catch (e) { console.warn("events", e); $("evBody").innerHTML = `<p class="muted">${esc(errMsg(e))}</p>`; }
}

// ===== 兼職：上班預告 =====
let myShifts = [];
let shiftReady = false;
function timeOptions(sel, def) {
  const opts = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 30) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    opts.push(`<option value="${t}"${t === def ? " selected" : ""}>${t}</option>`);
  }
  sel.innerHTML = opts.join("");
}
function initShifts() {
  $("shiftCard").classList.toggle("hidden", !isPart(me));
  if (!isPart(me)) return;
  if (!shiftReady) {
    timeOptions($("shStart"), "08:00");
    timeOptions($("shEnd"), "17:00");
    shiftReady = true;
  }
  const t = todayStr();
  $("shDate").min = t;
  $("shDate").max = addDays(t, 30);
  if (!$("shDate").value || $("shDate").value < t) $("shDate").value = addDays(t, 1);
  loadShifts();
}
async function loadShifts() {
  try {
    const snap = await getDocs(query(collection(db, "shifts"), where("empId", "==", me.empId)));
    const t = todayStr();
    myShifts = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.date >= t).sort((a, b) => a.date.localeCompare(b.date));
    $("shiftList").innerHTML = myShifts.length ? myShifts.map(x => `<div class="req"><div class="top">
        <span class="title">${esc(fmtDateStr(x.date))}　${esc(x.start)}–${esc(x.end)}</span>
        <button class="small secondary" type="button" data-unshift="${esc(x.id)}">取消</button></div></div>`).join("")
      : "尚未登記";
  } catch (e) { $("shiftList").textContent = errMsg(e); }
}
$("btnShift").onclick = async () => {
  const msg = $("shiftMsg");
  const date = $("shDate").value, start = $("shStart").value, end = $("shEnd").value;
  const t = todayStr();
  if (!date) { showMsg(msg, "請選擇日期", "err"); return; }
  if (date < t || date > addDays(t, 30)) { showMsg(msg, "只能登記今天到 30 天內的日子", "err"); return; }
  if (end <= start) { showMsg(msg, "結束時間要晚於開始時間", "err"); return; }
  const id = `${date}_${me.empId}`;
  const existed = myShifts.some(x => x.id === id);
  $("btnShift").disabled = true;
  try {
    await setDoc(doc(db, "shifts", id), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      date, ymd: Number(date.replace(/-/g, "")), start, end, updatedAt: serverTimestamp()
    });
    showMsg(msg, `${existed ? "已更新" : "已登記"}：${fmtDateStr(date)} ${start}–${end}`, "ok");
    $("shDate").value = addDays(date, 1) <= addDays(t, 30) ? addDays(date, 1) : date;
    await loadShifts();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnShift").disabled = false;
};
$("shiftList").onclick = async e => {
  const btn = e.target.closest("button[data-unshift]");
  if (!btn) return;
  if (!btn.dataset.confirm) { btn.dataset.confirm = "1"; btn.textContent = "確定取消？"; return; }
  btn.disabled = true;
  try {
    await deleteDoc(doc(db, "shifts", btn.dataset.unshift));
    showMsg($("shiftMsg"), "已取消這天的預告", "ok");
    await loadShifts();
  } catch (err) { showMsg($("shiftMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// ===== LINE 通知綁定 =====
async function loadLine() {
  if (!NOTIFY_URL) return; // 通知服務還沒設定好時不顯示
  $("lineCard").classList.remove("hidden");
  hideMsg($("lineMsg"));
  $("lineBody").innerHTML = `<p class="muted">讀取中…</p>`;
  try {
    const r = await callNotify("status");
    $("lineBody").innerHTML = r.bound
      ? `<p>✅ 已綁定 LINE${r.displayName ? `（${esc(r.displayName)}）` : ""}。請假、加班、補打卡的審核通知會傳到你的 LINE。</p>
         <button class="small secondary" type="button" data-line="unbind">解除綁定</button>`
      : `<p class="muted">綁定後，有人送申請給你審核、或你的申請有結果時，會馬上用 LINE 通知你。</p>
         <button type="button" data-line="bind">綁定 LINE</button>`;
  } catch (e) { $("lineBody").innerHTML = `<p class="muted">暫時無法連線到通知服務（${esc(e.message)}）</p>`; }
}
$("lineBody").onclick = async e => {
  const btn = e.target.closest("[data-line]");
  if (!btn) return;
  const act = btn.dataset.line;
  if (act === "check") { loadLine(); return; }
  if (act === "unbind" && !btn.dataset.confirm) { btn.dataset.confirm = "1"; btn.textContent = "確定解除？"; return; }
  btn.disabled = true;
  try {
    if (act === "unbind") { await callNotify("unbind"); showMsg($("lineMsg"), "已解除綁定", "ok"); loadLine(); return; }
    const { code } = await callNotify("bindStart");
    const oa = encodeURIComponent(LINE_OA_ID);
    $("lineBody").innerHTML = `
      <p><b>步驟 1</b>　加入出勤通知官方帳號好友（已加過可跳過）</p>
      <a class="btnlink" href="https://line.me/R/ti/p/${oa}" target="_blank" rel="noopener">加入好友</a>
      <p style="margin-top:14px"><b>步驟 2</b>　把綁定碼傳給官方帳號：按下面按鈕會打開 LINE 並帶入文字，<b>記得再按「送出」</b></p>
      <div class="bindcode">${esc(code)}</div>
      <a class="btnlink" href="https://line.me/R/oaMessage/${oa}/?${encodeURIComponent("綁定 " + code)}" target="_blank" rel="noopener">傳送綁定碼</a>
      <p class="muted">綁定碼 10 分鐘內有效。也可以直接在「唯修集團 出勤通知」的對話裡自己打「綁定 ${esc(code)}」送出。</p>
      <p style="margin-top:14px"><b>步驟 3</b>　LINE 回覆「綁定成功」後，按這裡確認</p>
      <button type="button" class="secondary" data-line="check">我已完成，重新檢查</button>`;
  } catch (err) { showMsg($("lineMsg"), errMsg(err), "err"); btn.disabled = false; }
};

function setMode(m) {
  mode = m;
  $("modeOffice").classList.toggle("on", m === "office");
  $("modeField").classList.toggle("on", m === "field");
  $("fieldBox").classList.toggle("hidden", m !== "field");
}
$("modeOffice").onclick = () => setMode("office");
$("modeField").onclick = () => setMode("field");
$("btnIn").onclick = () => punch("in");
$("btnOut").onclick = () => punch("out");

async function punch(type) {
  const msg = $("punchMsg");
  const customer = $("customer").value.trim();
  if (mode === "field" && !customer) { showMsg(msg, "外勤打卡請填寫客戶名稱或地點", "err"); return; }
  if (mode === "office" && !office) { showMsg(msg, "管理員尚未設定公司位置，暫時無法內勤打卡", "err"); return; }

  $("btnIn").disabled = $("btnOut").disabled = true;
  showMsg(msg, "正在取得位置…", "info");
  try {
    const c = await getPosition();
    let distance = null;
    if (mode === "office") {
      distance = distanceM(c.latitude, c.longitude, office.lat, office.lng);
      if (distance > office.radius) {
        showMsg(msg, `你距離公司約 ${distance} 公尺，超出打卡範圍（${office.radius} 公尺）。如果正在外勤，請切換到「外勤打卡」。`, "err");
        return;
      }
    }
    showMsg(msg, "打卡中…", "info");
    const now = new Date();
    const ref = await addDoc(collection(db, "punches"), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      type, mode,
      ts: serverTimestamp(),
      ym: ymOf(now), ymd: ymdOf(now),
      lat: c.latitude, lng: c.longitude, accuracy: Math.round(c.accuracy), distance,
      customer: mode === "field" ? customer : "",
      deviceId
    });
    const saved = await getDoc(ref);
    const t = saved.data().ts.toDate();
    showMsg(msg, `${TYPE_LABEL[type]}打卡成功：${fmtTime(t)}（${MODE_LABEL[mode]}）`, "ok");
    updatePresence(type, customer);
    if (mode === "field") $("customer").value = "";
    loadToday(); loadMonth();
  } catch (e) {
    const text = e.code === "permission-denied"
      ? "打卡失敗：請確認手機時間設定為「自動」，並重新整理頁面後再試。"
      : errMsg(e);
    showMsg(msg, text, "err");
  } finally {
    $("btnIn").disabled = $("btnOut").disabled = false;
  }
}

// 更新「今日出勤看板」用的精簡資料（失敗不影響打卡紀錄本身）
async function updatePresence(type, customer) {
  try {
    const ymd = ymdOf(new Date());
    const ref = doc(db, "presence", `${ymd}_${me.empId}`);
    const cur = await getDoc(ref);
    const data = {
      ymd, empId: me.empId, name: me.name, company: me.company,
      mode, customer: mode === "field" ? customer : "", lastType: type, lastAt: serverTimestamp()
    };
    if (type === "in" && !(cur.exists() && cur.data().inAt)) data.inAt = serverTimestamp();
    if (type === "out") data.outAt = serverTimestamp();
    await setDoc(ref, data, { merge: true });
  } catch (e) { console.warn("presence", e); }
}

async function fetchPunches(ym) {
  const q = query(collection(db, "punches"), where("empId", "==", me.empId), where("ym", "==", ym));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().ts.toDate() })).sort((a, b) => a.ts - b.ts);
}

async function loadToday() {
  try {
    const now = new Date();
    const list = (await fetchPunches(ymOf(now))).filter(p => p.ymd === ymdOf(now));
    $("todayList").innerHTML = list.length
      ? `<table><tbody>${list.map(p => `<tr>
          <td>${fmtTime(p.ts)}</td><td>${TYPE_LABEL[p.type]}</td>
          <td><span class="tag ${p.mode === "office" ? "ok" : p.mode === "field" ? "field" : "gray"}">${MODE_LABEL[p.mode]}</span></td>
          <td class="muted">${p.mode === "field" ? `<span translate="no">${esc(p.customer)}</span>` : p.distance != null ? `距公司 ${p.distance} m` : ""}</td>
        </tr>`).join("")}</tbody></table>`
      : "尚無紀錄";
  } catch (e) { $("todayList").textContent = errMsg(e); }
}

async function loadMonth() {
  const body = $("monthBody");
  body.innerHTML = `<tr><td colspan="4" class="muted">載入中…</td></tr>`;
  try {
    const ym = Number($("monthPick").value.replace("-", ""));
    const list = await fetchPunches(ym);
    const byDay = {};
    list.forEach(p => (byDay[p.ymd] = byDay[p.ymd] || []).push(p));
    const leaveMap = buildLeaveMap(myReqs.filter(r => r.kind === "leave" && r.status === "approved"), holidays);
    const todayYmd = ymdOf(new Date());
    const rows = [];
    for (let d = 1; d <= daysInYm(ym); d++) {
      const ymd = ym * 100 + d;
      if (ymd > todayYmd) break;
      const ds = ymdToInput(ymd);
      const dayList = byDay[ymd] || [];
      const wins = (leaveMap[ds] || []).concat(closureWins(ds, holidays)); // 含半天停班時段
      const isToday = ymd === todayYmd;
      if (!dayList.length) {
        if (isOffDay(ds, holidays)) continue; // 假日沒打卡就略過
        if (office && office.goLive && ds < office.goLive) continue; // 系統啟用前
        if (me.hireDate && ds < me.hireDate) continue; // 到職前
        if (isPart(me) && !wins.some(w => !w.off)) continue; // 兼職沒來上班的日子不列
        const s = summarizeDay([], wins, isPart(me));
        if (s.closedAll) {
          rows.push(`<tr><td>${fmtYmd(ymd)}</td><td>—</td><td>—</td><td>${tagsHtml(s.tags)}</td></tr>`);
        } else if (s.fullLeave || (isPart(me) && s.leaveHours > 0)) {
          if (isPart(me)) s.tags = [["field", `請假 ${s.leaveHours}h`]];
          rows.push(`<tr><td>${fmtYmd(ymd)}</td><td>—</td><td>—</td><td>${tagsHtml(s.tags)}</td></tr>`);
        } else if (!isToday) {
          const tags = [["warn", "未打卡"]].concat(s.leaveHours ? [["field", `請假 ${s.leaveHours}h`]] : []).concat(s.tags.filter(t => t[0] === "gray"));
          rows.push(`<tr><td>${fmtYmd(ymd)}</td><td>—</td><td>—</td><td>${tagsHtml(tags)}</td></tr>`);
        }
        continue;
      }
      const s = summarizeDay(dayList, wins, isPart(me));
      let tags = isToday ? s.tags.filter(t => t[1] !== "未打下班卡" && t[1] !== "早退") : s.tags;
      const off = offDayLabel(ds, holidays);
      if (off) tags = [["gray", off]].concat(tags.filter(t => t[1] !== "未打上班卡" && t[1] !== "未打下班卡" && t[1] !== "遲到" && t[1] !== "早退"));
      rows.push(`<tr><td>${fmtYmd(ymd)}</td>
        <td>${s.firstIn ? fmtTime(s.firstIn.ts) : "—"}</td>
        <td>${s.lastOut ? fmtTime(s.lastOut.ts) : "—"}</td>
        <td>${tagsHtml(tags.length ? tags : [["ok", "正常"]])}</td></tr>`);
    }
    body.innerHTML = rows.reverse().join("") || `<tr><td colspan="4" class="muted">本月尚無紀錄</td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="4">${esc(errMsg(e))}</td></tr>`; }
}

// ===== 補打卡申請 =====
$("btnCor").onclick = async () => {
  const msg = $("corMsg");
  const date = $("corDate").value, time = $("corTime").value, reason = $("corReason").value.trim();
  if (!date || !time) { showMsg(msg, "請選擇日期與時間", "err"); return; }
  if (!reason) { showMsg(msg, "請填寫原因", "err"); return; }
  if (new Date(`${date}T${time}:00+08:00`) > new Date()) { showMsg(msg, "不能申請未來的時間", "err"); return; }
  $("btnCor").disabled = true;
  try {
    const route = routeOf(approval, me);
    const ref = await addDoc(collection(db, "corrections"), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      date, time, type: $("corType").value, reason,
      ...route, createdAt: serverTimestamp()
    });
    notify("correction", ref.id);
    showMsg(msg, routeMsg(approval, route, me.empId), "ok");
    $("corReason").value = "";
    loadCorrections();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnCor").disabled = false;
};

const COR_STATUS = STATUS_INFO;
async function loadCorrections() {
  try {
    const snap = await getDocs(query(collection(db, "corrections"), where("empId", "==", me.empId)));
    const list = snap.docs.map(d => d.data()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 10);
    $("corList").innerHTML = list.length
      ? `<table><tbody>${list.map(c => `<tr>
          <td>${esc(c.date.slice(5))} ${esc(c.time)}</td><td>${TYPE_LABEL[c.type]}</td>
          <td>${tagsHtml([COR_STATUS[c.status] || ["gray", c.status]])}</td>
          <td class="muted" translate="no">${esc(c.reason)}</td></tr>`).join("")}</tbody></table>`
      : "尚無申請";
  } catch (e) { $("corList").textContent = errMsg(e); }
}

// 預設補打卡日期為今天、時間為上班時間
$("corDate").value = todayStr();
$("corTime").value = WORK.start;

// ===================================================================
// 請假／加班
// ===================================================================
function hourOptions(sel, def) {
  sel.innerHTML = Array.from({ length: 10 }, (_, i) => i + 8)
    .map(h => `<option value="${h}"${h === def ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("");
}

// 代理人：從員工名單（settings/directory）選，不含自己
async function loadAgents() {
  try {
    const snap = await getDoc(doc(db, "settings", "directory"));
    const all = snap.exists() ? snap.data().list || [] : [];
    dirList = all;
    renderMyRequests();
    isSup = all.some(p => p.empId === me.empId && p.sup === true);
    if (calStop && !calFull && (isSup || myTop())) { calStop(); openCalendar(); } // 剛確認是主管 → 換成完整版
    loadCalLinks();
    loadReview();
    const list = all.filter(p => p.empId && p.empId !== me.empId);
    $("lvAgent").innerHTML = '<option value="">（不指定）</option>' +
      list.map(p => `<option value="${esc(p.empId)}">${esc(p.name)}（${esc(p.empId)}）</option>`).join("");
  } catch (e) { console.warn("agents", e); }
}
function agentFields() {
  const sel = $("lvAgent"), v = sel.value;
  if (!v) return {};
  return { agent: v, agentName: sel.options[sel.selectedIndex].text.replace(/（.*）$/, "") };
}
function agentLine(r) { return r.agentName ? `<div class="meta">代理人：${esc(r.agentName)}</div>` : ""; }

function initLeaveForm() {
  $("lvType").innerHTML = LEAVE_TYPES.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join("");
  hourOptions($("lvStartHour"), 8);
  hourOptions($("lvEndHour"), 17);
  const t = todayStr();
  $("lvStartDate").value = $("lvEndDate").value = t;
  $("otDate").value = t;
  $("otStart").value = "17:00";
  $("otEnd").value = "19:00";
  ["lvType", "lvStartDate", "lvStartHour", "lvEndDate", "lvEndHour"].forEach(id => $(id).addEventListener("change", updateLeaveCalc));
  $("lvStartDate").addEventListener("change", () => {
    if ($("lvEndDate").value < $("lvStartDate").value) $("lvEndDate").value = $("lvStartDate").value;
    updateLeaveCalc();
  });
  ["otDate", "otStart", "otEnd", "otComp"].forEach(id => $(id).addEventListener("change", updateOtCalc));
  ["lvType", "lvStartDate", "lvStartHour", "lvEndDate", "lvEndHour"].forEach(id => $(id).addEventListener("change", () => hideMsg($("lvMsg"))));
  ["otDate", "otStart", "otEnd", "otComp"].forEach(id => $(id).addEventListener("change", () => hideMsg($("otMsg"))));
  updateLeaveCalc(); updateOtCalc();
}

function leaveDraft() {
  return {
    leaveType: $("lvType").value,
    startDate: $("lvStartDate").value, endDate: $("lvEndDate").value,
    startHour: Number($("lvStartHour").value), endHour: Number($("lvEndHour").value)
  };
}
function balances() { return computeBalances(myReqs, me.hireDate, todayStr(), me); }

// 檢查假單，回傳 { hours, error }
function checkLeave(r) {
  if (!r.startDate || !r.endDate) return { hours: 0, error: "請選擇日期" };
  if (r.endDate < r.startDate) return { hours: 0, error: "結束日期不能早於開始日期" };
  if (r.startDate === r.endDate && r.endHour <= r.startHour) return { hours: 0, error: "結束時間要晚於開始時間" };
  const hours = calcLeaveHours(r, holidays);
  if (hours <= 0) return { hours, error: "這段時間都不是上班時間（週末、國定假日或午休），不需要請假" };
  const lt = LEAVE_TYPES.find(x => x.key === r.leaveType);
  if (lt && lt.fullDay && (r.startHour > 8 || r.endHour < 17)) return { hours, error: `${lt.label}要以整天為單位（08:00 到 17:00）` };
  const b = balances();
  if (r.leaveType === "annual") {
    if (!me.hireDate) return { hours, error: "管理員尚未設定你的到職日，暫時無法計算特休，請先聯絡管理員" };
    if (hours > b.annualLeft) return { hours, error: `特休不足：剩餘 ${fmtHours(b.annualLeft)}，這次需要 ${fmtHours(hours)}` };
  }
  if (r.leaveType === "comp") {
    const sim = compLots([...myReqs, { ...r, id: "__draft", kind: "leave", hours, status: "pending_supervisor" }], todayStr(), me.hireDate);
    if (sim.short.__draft) return { hours, error: `補休不足：到 ${r.startDate} 還能用的補休不夠（補休 1 年內、最晚到特休年度結束要休完，到期就不能用），這次需要 ${fmtHours(hours)}` };
  }
  const clash = myReqs.find(x => x.kind === "leave" && ACTIVE_STATUS.includes(x.status) && leaveOverlaps(r, x, holidays));
  if (clash) return { hours, error: `和已申請的假單時間重疊（${reqTitle(clash)}：${reqWhen(clash)}）` };
  return { hours, error: "" };
}

function updateLeaveCalc() {
  const t = LEAVE_TYPES.find(x => x.key === $("lvType").value);
  $("lvTypeNote").textContent = t && t.note ? t.note : "";
  if (!me) return;
  const { hours, error } = checkLeave(leaveDraft());
  const el = $("lvCalc");
  el.classList.toggle("err", !!error);
  const warn = error ? "" : leaveLegalWarn({ ...leaveDraft(), hours }, myReqs);
  el.classList.toggle("err", !!(error || warn));
  el.textContent = error || `共請假 ${fmtHours(hours)}（${hours} 小時，已扣除午休與假日）${warn ? `。注意：${warn}` : ""}`;
  lvConfirm = false; $("btnLeave").textContent = "送出請假申請";
}
let lvConfirm = false;

function otDraft() {
  return { date: $("otDate").value, startTime: $("otStart").value, endTime: $("otEnd").value, comp: $("otComp").value };
}
function checkOt(r) {
  if (!r.date || !r.startTime || !r.endTime) return { hours: 0, error: "請填寫日期與時間" };
  const hours = calcOtHours(r.startTime, r.endTime);
  if (hours <= 0) return { hours, error: "結束時間要晚於開始時間（不能跨過午夜，跨日請分兩張申請）" };
  if (Math.round(hours * 2) !== hours * 2) return { hours, error: "加班時間請以 30 分鐘為單位" };
  const clash = myReqs.find(x => x.kind === "overtime" && ACTIVE_STATUS.includes(x.status) && x.date === r.date
    && r.startTime < x.endTime && x.startTime < r.endTime);
  if (clash) return { hours, error: `和已申請的加班時間重疊（${reqWhen(clash)}）` };
  return { hours, error: "" };
}
function otMonthTotal(dateStr) {
  const ym = ymOfStr(dateStr);
  return myReqs.filter(x => x.kind === "overtime" && ACTIVE_STATUS.includes(x.status) && x.ym === ym)
    .reduce((a, x) => a + x.hours, 0);
}
let otConfirm = false;
function updateOtCalc() {
  otConfirm = false;
  $("btnOT").textContent = "送出加班申請";
  if (!me) return;
  const r = otDraft();
  const { hours, error } = checkOt(r);
  const el = $("otCalc");
  el.classList.toggle("err", !!error);
  if (error) { el.textContent = error; return; }
  const month = otMonthTotal(r.date) + hours;
  const warn = otLegalWarn(r, hours);
  el.classList.toggle("err", !!warn);
  el.textContent = `共加班 ${hours} 小時（本月累計 ${month} 小時）${warn ? `。注意：${warn}` : ""}`;
}
// 勞基法第 32、36 條：一天正常工時＋加班不得超過 12 小時；休息日最多 12 小時；例假日（週日）除天災等不得出勤
function otLegalWarn(r, hours) {
  const day = myReqs.filter(x => x.kind === "overtime" && ACTIVE_STATUS.includes(x.status) && x.date === r.date)
    .reduce((a, x) => a + x.hours, 0) + hours;
  const p = r.date.split("-"), wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  const workday = calcLeaveHours({ startDate: r.date, endDate: r.date, startHour: 8, endHour: 17 }, holidays) > 0;
  if (!workday && wd === 0) return "週日是例假日，除天災、事變或突發事件外不得出勤";
  if (workday && day > 4) return `當天加班將達 ${day} 小時，上班日正常工時加上加班不得超過 12 小時（加班最多 4 小時）`;
  if (!workday && day > 12) return `當天加班將達 ${day} 小時，休息日或假日出勤一天最多 12 小時`;
  return "";
}

$("btnLeave").onclick = async () => {
  const msg = $("lvMsg");
  const r = leaveDraft();
  const reason = $("lvReason").value.trim();
  const { hours, error } = checkLeave(r);
  if (error) { showMsg(msg, error, "err"); return; }
  if (!reason) { showMsg(msg, "請填寫事由", "err"); return; }
  const warn = leaveLegalWarn({ ...r, hours }, myReqs);
  if (warn && !lvConfirm) {
    lvConfirm = true;
    $("btnLeave").textContent = "確定仍要送出";
    showMsg(msg, `注意：${warn}。超過法定天數的部分需要公司同意，確定要送出請再按一次。`, "err");
    return;
  }
  lvConfirm = false; $("btnLeave").textContent = "送出請假申請";
  $("btnLeave").disabled = true;
  try {
    const route = routeOf(approval, me);
    const ref = doc(collection(db, "requests"));
    const data = {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      kind: "leave", ...r, hours, ym: ymOfStr(r.startDate), reason, ...agentFields(),
      ...route, createdAt: serverTimestamp()
    };
    // 假單和「請假一覽」一起寫入
    const batch = writeBatch(db);
    batch.set(ref, data);
    batch.set(doc(db, "leaveList", ref.id), leaveListOf(data));
    await batch.commit();
    notify("request", ref.id);
    showMsg(msg, routeMsg(approval, route, me.empId), "ok");
    $("lvReason").value = "";
    $("lvAgent").value = "";
    await loadRequests();
    // 送出成功後不再立刻重新檢查（否則會拿剛送出的那張比對，誤顯示「重疊」）；改日期時才會再檢查
    $("lvCalc").textContent = ""; $("lvCalc").classList.remove("err");
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnLeave").disabled = false;
};

$("btnOT").onclick = async () => {
  const msg = $("otMsg");
  const r = otDraft();
  const reason = $("otReason").value.trim();
  const { hours, error } = checkOt(r);
  if (error) { showMsg(msg, error, "err"); return; }
  if (!reason) { showMsg(msg, "請填寫加班事由", "err"); return; }
  const month = otMonthTotal(r.date) + hours;
  const warns = [];
  if (month > OT_MONTH_LIMIT) warns.push(`送出後本月加班將達 ${month} 小時，超過勞基法每月 ${OT_MONTH_LIMIT} 小時的上限（經勞資會議同意者最多 54 小時、每 3 個月 138 小時）`);
  const dw = otLegalWarn(r, hours);
  if (dw) warns.push(dw);
  if (warns.length && !otConfirm) {
    otConfirm = true;
    $("btnOT").textContent = "確定仍要送出";
    showMsg(msg, `注意：${warns.join("；")}。確定要送出請再按一次。`, "err");
    return;
  }
  $("btnOT").disabled = true;
  try {
    const route = routeOf(approval, me);
    const ref = await addDoc(collection(db, "requests"), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      kind: "overtime", ...r, hours, ym: ymOfStr(r.date), reason,
      ...route, createdAt: serverTimestamp()
    });
    notify("request", ref.id);
    showMsg(msg, routeMsg(approval, route, me.empId), "ok");
    $("otReason").value = "";
    await loadRequests();
    otConfirm = false; $("btnOT").textContent = "送出加班申請";
    $("otCalc").textContent = ""; $("otCalc").classList.remove("err");
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnOT").disabled = false;
};

async function loadRequests() {
  try {
    const snap = await getDocs(query(collection(db, "requests"), where("empId", "==", me.empId)));
    myReqs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBalances();
    renderMyRequests();
  } catch (e) {
    $("balBox").textContent = errMsg(e);
    $("reqList").textContent = errMsg(e);
  }
}

function renderBalances() {
  const b = balances();
  let annual;
  if (!me.hireDate) {
    annual = `<div><div class="sub">特休</div><div class="num">—</div><div class="sub">管理員尚未設定到職日</div></div>`;
  } else if (!b.ent.start) {
    annual = `<div><div class="sub">特休</div><div class="num">0</div><div class="sub">${esc(b.ent.end)} 起可休${b.part ? "（兼職按工時比例）" : " 3 天"}</div></div>`;
  } else {
    annual = `<div><div class="sub">特休剩餘</div><div class="num">${fmtHours(b.annualLeft)}</div>
      <div class="sub">本年度 ${b.part ? `${b.annualTotal} 小時（兼職按工時比例）` : `${b.ent.days} 天`}，${b.annualCarry ? `＋上年度遞延 ${fmtHours(b.annualCarry)}，` : ""}已用 ${fmtHours(b.annualUsed)}（含審核中${b.annualPre ? `、系統上線前 ${fmtHours(b.annualPre)}` : ""}）<br>年度期間 ${esc(b.ent.start)} ～ ${esc(b.ent.end)}</div></div>`;
  }
  const comp = `<div><div class="sub">補休剩餘</div><div class="num">${fmtHours(b.compLeft)}</div>
    <div class="sub">加班換得 ${b.compEarned} 小時，已用 ${b.compUsed} 小時${b.compNext ? `<br>${esc(b.compNext.exp)} 前要休完 ${fmtHours(b.compNext.hours)}` : ""}${b.compExpired ? `<br>已到期 ${fmtHours(b.compExpired)}（改發加班費）` : ""}<br>補休 1 年內要休完（最晚到特休年度結束），依加班先後順序使用</div></div>`;
  // 今年各假別使用（已核准）
  const year = todayStr().slice(0, 4);
  const used = {};
  myReqs.filter(r => r.kind === "leave" && r.status === "approved" && r.startDate.startsWith(year))
    .forEach(r => { used[r.leaveType] = (used[r.leaveType] || 0) + r.hours; });
  const usedTxt = LEAVE_TYPES.filter(t => used[t.key]).map(t => `${t.label} ${fmtHours(used[t.key])}`).join("、");
  $("balBox").innerHTML = `<div class="bal">${annual}${comp}</div>
    <p class="muted" style="margin:10px 0 0">${year} 年已核准請假：${usedTxt ? esc(usedTxt) : "無"}</p>`;
}

function statusTag(r) { return tagsHtml([STATUS_INFO[r.status] || ["gray", r.status]]); }
function nameOf(empId) {
  if (!empId) return "";
  const p = dirList.find(x => x.empId === empId);
  return p ? p.name : empId;
}
function noteLines(r) {
  const out = reviewNotes(r, nameOf).map(esc);
  if (PENDING.includes(r.status)) { const st = stageText(approval, r, nameOf); if (st) out.push("⏳ " + esc(st)); }
  return timelineHtml(r, nameOf) + (out.length ? `<div class="meta">${out.join("<br>")}</div>` : "");
}

function renderMyRequests() {
  const list = [...myReqs].sort((a, b) => reqSortKey(b).localeCompare(reqSortKey(a))).slice(0, 30);
  $("reqList").innerHTML = list.length ? list.map(r => `<div class="req">
      <div class="top"><span class="title">${esc(reqTitle(r))}・${r.hours} 小時</span>${statusTag(r)}</div>
      <div class="meta">${esc(reqWhen(r))}</div>
      <div class="meta">事由：${esc(r.reason)}</div>${agentLine(r)}
      ${noteLines(r)}
      ${r.status === "pending_supervisor" || r.status === "pending_admin"
        ? `<div class="acts"><button class="small secondary" data-cancel="${r.id}">取消申請</button></div>` : ""}
    </div>`).join("") : "尚無申請";
}

$("reqList").onclick = async e => {
  const btn = e.target.closest("button[data-cancel]");
  if (!btn) return;
  if (!btn.dataset.confirm) { btn.dataset.confirm = "1"; btn.textContent = "確定取消？"; return; }
  btn.disabled = true;
  try {
    const r0 = myReqs.find(x => x.id === btn.dataset.cancel);
    const batch = writeBatch(db);
    batch.update(doc(db, "requests", btn.dataset.cancel), { status: "cancelled", cancelledAt: serverTimestamp() });
    if (r0 && r0.kind === "leave") batch.set(doc(db, "leaveList", r0.id), leaveListOf({ ...r0, status: "cancelled" }));
    await batch.commit();
    showMsg($("reqMsg"), "已取消申請", "ok");
    await loadRequests();
    updateLeaveCalc(); updateOtCalc();
  } catch (err) { showMsg($("reqMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// ===================================================================
// 審核：直屬主管（第一關）＋ 主官／副主官（最終核定）
//   只有被設為直屬主管、或主官／副主官的人才會看到「待我審核」
// ===================================================================
let teamReqs = [];   // 我是直屬主管的請假／加班
let teamCors = [];   // 我是直屬主管的補打卡
let finalReqs = [];  // 等最終核定的請假／加班（主官／副主官才會讀）
let finalCors = [];  // 等最終核定的補打卡
let doneReqs = [];   // 我最終核定過的請假／加班
let doneCors = [];   // 我最終核定過的補打卡
let isSup = false;     // 被設定為某位員工的直屬主管（從 settings/directory 判斷）
let reviewUnsubs = [];
let reviewItems = [];
let llUnsub = null, llDocs = [];
const baseTitle = document.title;
function myTop() { return me ? topRole(approval, me.empId) : null; }

// 即時監看：一有人送出或上一關核准，「待我審核」的數字和頂端提醒就會馬上出現
function watchReview() {
  if (reviewUnsubs.length) return;
  const sub = (q, set) => reviewUnsubs.push(onSnapshot(q,
    snap => { set(snap.docs.map(d => ({ id: d.id, ...d.data() }))); loadReview(); },
    () => { set([]); loadReview(); }));
  sub(query(collection(db, "requests"), where("supervisorEmpId", "==", me.empId)), v => { teamReqs = v; });
  sub(query(collection(db, "corrections"), where("supervisorEmpId", "==", me.empId)), v => { teamCors = v; });
  if (myTop()) {
    sub(query(collection(db, "requests"), where("status", "==", "pending_admin")), v => { finalReqs = v; });
    sub(query(collection(db, "corrections"), where("status", "in", ["pending_admin", "pending"])), v => { finalCors = v; });
    sub(query(collection(db, "requests"), where("finalBy", "==", me.empId)), v => { doneReqs = v; });
    sub(query(collection(db, "corrections"), where("finalBy", "==", me.empId)), v => { doneCors = v; });
  }
}
function stopReviewWatch() {
  reviewUnsubs.splice(0).forEach(u => u());
  if (llUnsub) { llUnsub(); llUnsub = null; } llDocs = [];
  teamReqs = []; teamCors = []; finalReqs = []; finalCors = []; doneReqs = []; doneCors = []; isSup = false;
}

const corKey = c => `${c.date} ${c.time}`;
function itemKey(it) { return it.k === "req" ? reqSortKey(it.r) : corKey(it.r); }
function itemTitle(it, withId = true) {
  const r = it.r, who = withId ? `${esc(r.name)}（${esc(r.empId)}）` : esc(r.name);
  return it.k === "req"
    ? `${who}・${esc(reqTitle(r))}・${r.hours} 小時`
    : `${who}・補打卡・${TYPE_LABEL[r.type] || ""}`;
}
function itemWhen(it) { return it.k === "req" ? esc(reqWhen(it.r)) : `${esc(it.r.date)} ${esc(it.r.time)}`; }
function itemHint(it) {
  const r = it.r;
  if (it.step === "sup") {
    if (it.k === "cor") return "你核准後就生效";
    return afterSupervisor(approval, me.empId, r.hours) === "approved"
      ? "1 天以內，你核准後就生效"
      : `超過 1 天，你核准後會再送 ${esc(stageText(approval, { ...r, status: "pending_admin" }, nameOf).replace(/^等待/, ""))}`;
  }
  const exp = finalApprover(approval, r.empId);
  if (myTop() === "chief" && exp && exp !== me.empId) return `原本由副主官 ${esc(nameOf(exp))} 核定，你是主官也可以直接核定；核准後就生效`;
  return "你核准後就生效";
}

function loadReview() {
  const items = [];
  teamReqs.filter(r => r.status === "pending_supervisor").forEach(r => items.push({ k: "req", step: "sup", r }));
  teamCors.filter(r => r.status === "pending_supervisor").forEach(r => items.push({ k: "cor", step: "sup", r }));
  if (myTop()) {
    finalReqs.filter(r => canFinal(approval, me.empId, r)).forEach(r => items.push({ k: "req", step: "final", r }));
    finalCors.filter(r => canFinal(approval, me.empId, r)).forEach(r => items.push({ k: "cor", step: "final", r }));
  }
  items.sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  reviewItems = items;

  const seen = new Set(), hist = [];
  const addHist = (list, k) => list.filter(r => !PENDING.includes(r.status) || r.supBy === me.empId).forEach(r => {
    if (seen.has(k + r.id)) return; seen.add(k + r.id); hist.push({ k, r });
  });
  addHist(teamReqs, "req"); addHist(doneReqs, "req"); addHist(teamCors, "cor"); addHist(doneCors, "cor");
  hist.sort((a, b) => itemKey(b).localeCompare(itemKey(a)));

  const show = isSup || !!myTop() || teamReqs.length > 0 || teamCors.length > 0;
  $("tabReview").classList.toggle("hidden", !show);
  if ((isSup || myTop()) && !llUnsub) watchLeaveList();
  const n = items.length;
  $("revCount").textContent = n ? `(${n})` : "";
  $("revBanner").classList.toggle("hidden", !n);
  $("revBanner").textContent = n ? `🔔 有 ${n} 張申請等你審核，點這裡處理` : "";
  document.title = n ? `(${n}) ${baseTitle}` : baseTitle;
  $("revRole").textContent = myTop()
    ? `你是${TOP_LABEL[myTop()]}：超過 1 天的請假、加班會送到這裡給你核定。`
    : "1 天以內的申請你核准後就生效；超過 1 天會再送副主官核定。";

  $("revList").innerHTML = n ? items.map(it => {
    const r = it.r;
    return `<div class="req">
      <div class="top"><span class="title">${itemTitle(it)}</span>${statusTag(r)}</div>
      <div class="meta">${itemWhen(it)}</div>
      <div class="meta">${it.k === "req" ? "事由" : "原因"}：${esc(r.reason)}</div>${it.k === "req" ? agentLine(r) : ""}
      ${timelineHtml(r, nameOf)}
      ${r.supNote ? `<div class="meta">主管意見：${esc(r.supNote)}</div>` : ""}
      <div class="meta hint">👉 ${itemHint(it)}</div>
      <div class="acts">
        <input placeholder="意見（選填）" data-note="${it.k}:${r.id}">
        <button class="small" data-act="approve" data-k="${it.k}" data-id="${r.id}">核准</button>
        <button class="small danger" data-act="reject" data-k="${it.k}" data-id="${r.id}">駁回</button>
      </div></div>`;
  }).join("") : "目前沒有待審核的申請";
  $("revHist").innerHTML = hist.length ? hist.slice(0, 20).map(it => `<div class="req">
      <div class="top"><span class="title">${itemTitle(it, false)}</span>${statusTag(it.r)}</div>
      <div class="meta">${itemWhen(it)}</div>${noteLines(it.r)}</div>`).join("") : "尚無紀錄";
}

// ===== 全員請假一覽（主管、主官、副主官）=====
function watchLeaveList() {
  const from = addDays(todayStr(), -LL_DAYS);
  llUnsub = onSnapshot(query(collection(db, "leaveList"), where("endDate", ">=", from)),
    snap => { llDocs = snap.docs.map(d => ({ id: d.id, kind: "leave", ...d.data() })); renderLeaveList(); },
    () => { $("llBody").textContent = "請管理員先打開一次管理後台，請假一覽就會開放給主管查看。"; });
}
function renderLeaveList() {
  const today = todayStr(), to = addDays(today, LL_DAYS);
  const list = llDocs.filter(r => r.startDate <= to && ["pending_supervisor", "pending_admin", "approved"].includes(r.status));
  const now = list.filter(r => r.endDate >= today).sort((a, b) => reqSortKey(a).localeCompare(reqSortKey(b)));
  const past = list.filter(r => r.endDate < today).sort((a, b) => reqSortKey(b).localeCompare(reqSortKey(a)));
  const row = r => `<div class="req">
      <div class="top"><span class="title"><span class="empno">${esc(r.empId)}</span>${esc(r.name)}・${esc(LEAVE_LABEL[r.leaveType] || r.leaveType || "")}・${r.hours} 小時</span>${tagsHtml([r.status === "approved" ? ["ok", "已核准"] : ["warn", "審核中"]])}</div>
      <div class="meta">${esc(reqWhen(r))}</div></div>`;
  const block = (title, rows, empty) => `<h3 class="ll-h">${title}</h3>` + (rows.length ? rows.map(row).join("") : `<p class="muted">${empty}</p>`);
  $("llBody").innerHTML = block(`請假中與接下來 30 天（${now.length}）`, now, "接下來 30 天沒有人請假")
    + block(`過去 30 天（${past.length}）`, past, "過去 30 天沒有人請假");
}

// 看板用的請假時段
const LB_KEYS = ["empId", "name", "company", "startDate", "endDate", "startHour", "endHour"];
const lbOf = r => Object.fromEntries(LB_KEYS.map(k => [k, r[k] ?? null]));

// 補打卡核准：同時寫入一筆打卡紀錄；如果是今天，也更新出勤看板
async function addCorrectionPunch(batch, c) {
  const when = new Date(`${c.date}T${c.time}:00+08:00`);
  batch.set(doc(collection(db, "punches")), {
    uid: c.uid, empId: c.empId, name: c.name, company: c.company,
    type: c.type, mode: "correction",
    ts: Timestamp.fromDate(when), ym: ymOf(when), ymd: ymdOf(when),
    lat: null, lng: null, accuracy: null, distance: null,
    customer: "", note: c.reason, correctionId: c.id, approvedBy: me.empId, deviceId: null
  });
  if (c.date === todayStr()) {
    const pref = doc(db, "presence", `${ymdOf(when)}_${c.empId}`);
    const cur = await getDoc(pref);
    const pd = cur.exists() ? cur.data() : {};
    const upd = { ymd: ymdOf(when), empId: c.empId, name: c.name, company: c.company, lastAt: serverTimestamp(), corrId: c.id };
    if (!cur.exists()) { upd.mode = "office"; upd.customer = ""; upd.lastType = c.type; }
    if (c.type === "in" && (!pd.inAt || pd.inAt.toDate() > when)) upd.inAt = Timestamp.fromDate(when);
    if (c.type === "out") { upd.outAt = Timestamp.fromDate(when); upd.lastType = "out"; }
    batch.set(pref, upd, { merge: true });
  }
}

$("revBanner").onclick = () => $("tabReview").click();
// 右上角的名字＝「我的設定」
$("who").onclick = () => { if (!me) return; document.querySelector('#mainTabs [data-tab="pMe"]').click(); window.scrollTo(0, 0); };
$("revList").onclick = async e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const it = reviewItems.find(x => x.k === btn.dataset.k && x.r.id === btn.dataset.id);
  if (!it) return;
  const r = it.r, ok = btn.dataset.act === "approve";
  const note = (document.querySelector(`#revList input[data-note="${it.k}:${r.id}"]`)?.value || "").trim();
  btn.disabled = true;
  try {
    let status, upd;
    if (it.step === "sup") {
      status = !ok ? "rejected" : (it.k === "cor" ? "approved" : afterSupervisor(approval, me.empId, r.hours));
      upd = { status, supBy: me.empId, supAt: serverTimestamp(), supNote: note };
    } else {
      status = ok ? "approved" : "rejected";
      upd = { status, finalBy: me.empId, finalAt: serverTimestamp(), finalNote: note, finalRole: myTop() };
    }
    const batch = writeBatch(db);
    batch.update(doc(db, it.k === "req" ? "requests" : "corrections", r.id), upd);
    if (it.k === "req" && r.kind === "leave") batch.set(doc(db, "leaveList", r.id), leaveListOf({ ...r, status }));
    if (status === "approved") {
      if (it.k === "req" && r.kind === "leave") batch.set(doc(db, "leaveBoard", r.id), lbOf(r));
      if (it.k === "cor") await addCorrectionPunch(batch, r);
    }
    await batch.commit();
    notify(it.k === "req" ? "request" : "correction", r.id);
    const what = `${r.name} 的${it.k === "req" ? reqTitle(r) : "補打卡"}`;
    showMsg($("revMsg"), !ok ? `已駁回 ${what}`
      : status === "approved" ? `已核准 ${what}，已經生效`
      : `已核准 ${what}，因為超過 1 天，已送${stageText(approval, { ...r, status }, nameOf).replace(/^等待/, "")}`, "ok");
    loadReview();
  } catch (err) { showMsg($("revMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// 員工打卡頁（含請假／加班／主管審核）
import {
  auth, db, loginWithEmpId, logout, getDeviceId, getPosition, distanceM,
  fmtTime, fmtTimeSec, fmtDateLong, fmtYmd, ymOf, ymdOf, daysInYm, ymdToInput,
  summarizeDay, tagsHtml, MODE_LABEL, TYPE_LABEL, esc, errMsg, showMsg, hideMsg,
  checkNewPassword, WORK,
  todayStr, ymOfStr, toHolidayMap, isOffDay, offDayLabel, buildLeaveMap, calcLeaveHours, calcOtHours,
  computeBalances, fmtHours, LEAVE_TYPES, STATUS_INFO, ACTIVE_STATUS, OT_MONTH_LIMIT,
  reqTitle, reqWhen, reqSortKey, leaveOverlaps, fmtDateStr
  , isPart, notify, callNotify, NOTIFY_URL, LINE_OA_ID, addDays
} from "./common.js?v=17";
import { onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { startBoard } from "./board.js?v=17";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, onSnapshot
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
const deviceId = getDeviceId();

// ===== 時鐘（僅顯示用，實際打卡時間由伺服器決定）=====
function tick() {
  const now = new Date();
  $("clockTime").textContent = fmtTimeSec(now);
  $("clockDate").textContent = fmtDateLong(now);
}
setInterval(tick, 1000); tick();

// ===== 登入狀態 =====
onAuthStateChanged(auth, async user => {
  if (!user) { me = null; stopReviewWatch(); $("who").textContent = ""; show("vLogin"); return; }
  show("vLoading");
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active !== true) {
      return blocked("帳號已停用", "這個帳號目前無法使用，請聯絡管理員。");
    }
    me = { uid: user.uid, ...snap.data() };
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

    const [oSnap, hSnap] = await Promise.all([
      getDoc(doc(db, "settings", "office")),
      getDoc(doc(db, "settings", "holidays"))
    ]);
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

// ===== 分頁 =====
document.querySelectorAll("#mainTabs button[data-tab]").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#mainTabs button[data-tab]").forEach(b => b.classList.toggle("on", b === btn));
    ["pPunch", "pLeave", "pBoard", "pReview"].forEach(id => $(id).classList.toggle("hidden", id !== btn.dataset.tab));
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
          <td class="muted">${p.mode === "field" ? esc(p.customer) : p.distance != null ? `距公司 ${p.distance} m` : ""}</td>
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
      const wins = leaveMap[ds] || [];
      const isToday = ymd === todayYmd;
      if (!dayList.length) {
        if (isOffDay(ds, holidays)) continue; // 假日沒打卡就略過
        if (office && office.goLive && ds < office.goLive) continue; // 系統啟用前
        if (me.hireDate && ds < me.hireDate) continue; // 到職前
        if (isPart(me) && !wins.length) continue; // 兼職沒來上班的日子不列
        const s = summarizeDay([], wins, isPart(me));
        if (s.fullLeave || (isPart(me) && wins.length)) {
          if (isPart(me)) s.tags = [["field", `請假 ${s.leaveHours}h`]];
          rows.push(`<tr><td>${fmtYmd(ymd)}</td><td>—</td><td>—</td><td>${tagsHtml(s.tags)}</td></tr>`);
        } else if (!isToday) {
          const tags = [["warn", "未打卡"]].concat(wins.length ? [["field", `請假 ${s.leaveHours}h`]] : []);
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
    const ref = await addDoc(collection(db, "corrections"), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      date, time, type: $("corType").value, reason,
      status: "pending", createdAt: serverTimestamp()
    });
    notify("correction", ref.id);
    showMsg(msg, "已送出，等待管理員核准", "ok");
    $("corReason").value = "";
    loadCorrections();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnCor").disabled = false;
};

const COR_STATUS = { pending: ["warn", "審核中"], approved: ["ok", "已核准"], rejected: ["late", "已駁回"] };
async function loadCorrections() {
  try {
    const snap = await getDocs(query(collection(db, "corrections"), where("empId", "==", me.empId)));
    const list = snap.docs.map(d => d.data()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 10);
    $("corList").innerHTML = list.length
      ? `<table><tbody>${list.map(c => `<tr>
          <td>${esc(c.date.slice(5))} ${esc(c.time)}</td><td>${TYPE_LABEL[c.type]}</td>
          <td>${tagsHtml([COR_STATUS[c.status] || ["gray", c.status]])}</td>
          <td class="muted">${esc(c.reason)}</td></tr>`).join("")}</tbody></table>`
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
  const b = balances();
  if (r.leaveType === "annual") {
    if (!me.hireDate) return { hours, error: "管理員尚未設定你的到職日，暫時無法計算特休，請先聯絡管理員" };
    if (hours > b.annualLeft) return { hours, error: `特休不足：剩餘 ${fmtHours(b.annualLeft)}，這次需要 ${fmtHours(hours)}` };
  }
  if (r.leaveType === "comp" && hours > b.compLeft) {
    return { hours, error: `補休不足：剩餘 ${fmtHours(b.compLeft)}，這次需要 ${fmtHours(hours)}` };
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
  el.textContent = error || `共請假 ${fmtHours(hours)}（${hours} 小時，已扣除午休與假日）`;
}

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
  el.textContent = `共加班 ${hours} 小時（本月累計 ${month} 小時）`;
}

$("btnLeave").onclick = async () => {
  const msg = $("lvMsg");
  const r = leaveDraft();
  const reason = $("lvReason").value.trim();
  const { hours, error } = checkLeave(r);
  if (error) { showMsg(msg, error, "err"); return; }
  if (!reason) { showMsg(msg, "請填寫事由", "err"); return; }
  $("btnLeave").disabled = true;
  try {
    const sup = me.supervisorEmpId || null;
    const ref = await addDoc(collection(db, "requests"), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      kind: "leave", ...r, hours, ym: ymOfStr(r.startDate), reason,
      supervisorEmpId: sup, status: sup ? "pending_supervisor" : "pending_admin",
      createdAt: serverTimestamp()
    });
    notify("request", ref.id);
    showMsg(msg, sup ? "已送出，等待主管審核" : "已送出，等待管理員核准", "ok");
    $("lvReason").value = "";
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
  if (month > OT_MONTH_LIMIT && !otConfirm) {
    otConfirm = true;
    $("btnOT").textContent = "確定仍要送出";
    showMsg(msg, `注意：送出後本月加班將達 ${month} 小時，超過勞基法每月 ${OT_MONTH_LIMIT} 小時的上限（經勞資會議同意者最多 54 小時）。確定要送出請再按一次。`, "err");
    return;
  }
  $("btnOT").disabled = true;
  try {
    const sup = me.supervisorEmpId || null;
    const ref = await addDoc(collection(db, "requests"), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      kind: "overtime", ...r, hours, ym: ymOfStr(r.date), reason,
      supervisorEmpId: sup, status: sup ? "pending_supervisor" : "pending_admin",
      createdAt: serverTimestamp()
    });
    notify("request", ref.id);
    showMsg(msg, sup ? "已送出，等待主管審核" : "已送出，等待管理員核准", "ok");
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
      <div class="sub">本年度 ${b.part ? `${b.annualTotal} 小時（兼職按工時比例）` : `${b.ent.days} 天`}，已用 ${fmtHours(b.annualUsed)}（含審核中）<br>年度期間 ${esc(b.ent.start)} ～ ${esc(b.ent.end)}</div></div>`;
  }
  const comp = `<div><div class="sub">補休剩餘</div><div class="num">${fmtHours(b.compLeft)}</div>
    <div class="sub">加班換得 ${b.compEarned} 小時，已用 ${b.compUsed} 小時</div></div>`;
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
function noteLines(r) {
  const out = [];
  if (r.supNote) out.push(`主管意見：${esc(r.supNote)}`);
  if (r.adminNote) out.push(`管理員意見：${esc(r.adminNote)}`);
  return out.length ? `<div class="meta">${out.join("<br>")}</div>` : "";
}

function renderMyRequests() {
  const list = [...myReqs].sort((a, b) => reqSortKey(b).localeCompare(reqSortKey(a))).slice(0, 30);
  $("reqList").innerHTML = list.length ? list.map(r => `<div class="req">
      <div class="top"><span class="title">${esc(reqTitle(r))}・${r.hours} 小時</span>${statusTag(r)}</div>
      <div class="meta">${esc(reqWhen(r))}</div>
      <div class="meta">事由：${esc(r.reason)}</div>
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
    await updateDoc(doc(db, "requests", btn.dataset.cancel), { status: "cancelled", cancelledAt: serverTimestamp() });
    showMsg($("reqMsg"), "已取消申請", "ok");
    await loadRequests();
    updateLeaveCalc(); updateOtCalc();
  } catch (err) { showMsg($("reqMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// ===================================================================
// 主管審核（只有被設定為主管的人才會看到）
// ===================================================================
let teamReqs = [];
let reviewUnsub = null;
const baseTitle = document.title;
// 即時監看：部屬一送出申請，「待我審核」的數字和頂端提醒就會馬上出現
function watchReview() {
  if (reviewUnsub) return;
  reviewUnsub = onSnapshot(query(collection(db, "requests"), where("supervisorEmpId", "==", me.empId)), snap => {
    teamReqs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    loadReview();
  }, () => { teamReqs = []; loadReview(); });
}
function stopReviewWatch() { if (reviewUnsub) { reviewUnsub(); reviewUnsub = null; } teamReqs = []; }
function loadReview() {
  const pending = teamReqs.filter(r => r.status === "pending_supervisor").sort((a, b) => reqSortKey(a).localeCompare(reqSortKey(b)));
  const hist = teamReqs.filter(r => r.status !== "pending_supervisor").sort((a, b) => reqSortKey(b).localeCompare(reqSortKey(a))).slice(0, 20);
  $("tabReview").classList.toggle("hidden", teamReqs.length === 0);
  $("revCount").textContent = pending.length ? `(${pending.length})` : "";
  $("revBanner").classList.toggle("hidden", !pending.length);
  $("revBanner").textContent = pending.length ? `🔔 有 ${pending.length} 張請假／加班申請等你審核，點這裡處理` : "";
  document.title = pending.length ? `(${pending.length}) ${baseTitle}` : baseTitle;
  $("revList").innerHTML = pending.length ? pending.map(r => `<div class="req">
      <div class="top"><span class="title">${esc(r.name)}（${esc(r.empId)}）・${esc(reqTitle(r))}・${r.hours} 小時</span>${statusTag(r)}</div>
      <div class="meta">${esc(reqWhen(r))}</div>
      <div class="meta">事由：${esc(r.reason)}</div>
      <div class="acts">
        <input placeholder="意見（選填）" data-note="${r.id}">
        <button class="small" data-act="approve" data-id="${r.id}">核准</button>
        <button class="small danger" data-act="reject" data-id="${r.id}">駁回</button>
      </div></div>`).join("") : "目前沒有待審核的申請";
  $("revHist").innerHTML = hist.length ? hist.map(r => `<div class="req">
      <div class="top"><span class="title">${esc(r.name)}・${esc(reqTitle(r))}・${r.hours} 小時</span>${statusTag(r)}</div>
      <div class="meta">${esc(reqWhen(r))}</div>${noteLines(r)}</div>`).join("") : "尚無紀錄";
}

$("revBanner").onclick = () => $("tabReview").click();
$("revList").onclick = async e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const r = teamReqs.find(x => x.id === btn.dataset.id);
  if (!r) return;
  const note = (document.querySelector(`input[data-note="${r.id}"]`)?.value || "").trim();
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "requests", r.id), {
      status: btn.dataset.act === "approve" ? "pending_admin" : "rejected",
      supBy: me.empId, supAt: serverTimestamp(), supNote: note
    });
    notify("request", r.id);
    showMsg($("revMsg"), btn.dataset.act === "approve"
      ? `已核准 ${r.name} 的申請，已送交管理員做最終核准` : `已駁回 ${r.name} 的申請`, "ok");
    loadReview();
  } catch (err) { showMsg($("revMsg"), errMsg(err), "err"); btn.disabled = false; }
};

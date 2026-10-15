// 員工打卡頁
import {
  auth, db, loginWithEmpId, logout, getDeviceId, getPosition, distanceM,
  fmtTime, fmtTimeSec, fmtDateLong, fmtYmd, ymOf, ymdOf, daysInYm, weekdayOfYmd,
  summarizeDay, tagsHtml, MODE_LABEL, TYPE_LABEL, esc, errMsg, showMsg, hideMsg,
  checkNewPassword, WORK
} from "./common.js";
import { onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, updateDoc, addDoc, collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const views = ["vLoading", "vLogin", "vChangePw", "vBlocked", "vMain"];
function show(v) { views.forEach(x => $(x).classList.toggle("hidden", x !== v)); }

let me = null;        // 目前登入員工的資料
let office = null;    // 公司位置設定
let mode = "office";  // office | field
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
  if (!user) { me = null; $("who").textContent = ""; show("vLogin"); return; }
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

    const oSnap = await getDoc(doc(db, "settings", "office"));
    office = oSnap.exists() ? oSnap.data() : null;

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

// ===== 主畫面 =====
let mainReady = false;
function initMain() {
  const now = new Date();
  const ym = ymOf(now);
  $("monthPick").value = `${String(ym).slice(0, 4)}-${String(ym).slice(4)}`;
  if (!mainReady) {
    $("monthPick").onchange = () => loadMonth();
    mainReady = true;
  }
  loadToday();
  loadMonth();
  loadCorrections();
}

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
    const todayYmd = ymdOf(new Date());
    const rows = [];
    for (let d = 1; d <= daysInYm(ym); d++) {
      const ymd = ym * 100 + d;
      if (ymd > todayYmd) break;
      const dayList = byDay[ymd] || [];
      const wd = weekdayOfYmd(ymd);
      if (!dayList.length && (wd === 0 || wd === 6)) continue; // 週末沒打卡就略過
      if (!dayList.length) {
        if (ymd === todayYmd) continue;
        rows.push(`<tr><td>${fmtYmd(ymd)}</td><td>—</td><td>—</td><td><span class="tag warn">未打卡</span></td></tr>`);
        continue;
      }
      const s = summarizeDay(dayList);
      const isToday = ymd === todayYmd;
      const tags = isToday ? s.tags.filter(t => t[1] !== "未打下班卡" && t[1] !== "早退") : s.tags;
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
    await addDoc(collection(db, "corrections"), {
      uid: me.uid, empId: me.empId, name: me.name, company: me.company,
      date, time, type: $("corType").value, reason,
      status: "pending", createdAt: serverTimestamp()
    });
    showMsg(msg, "已送出，等待管理員核准", "ok");
    $("corReason").value = "";
    loadCorrections();
  } catch (e) { showMsg(msg, errMsg(e), "err"); }
  $("btnCor").disabled = false;
};

const STATUS = { pending: ["warn", "審核中"], approved: ["ok", "已核准"], rejected: ["late", "已駁回"] };
async function loadCorrections() {
  try {
    const snap = await getDocs(query(collection(db, "corrections"), where("empId", "==", me.empId)));
    const list = snap.docs.map(d => d.data()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 10);
    $("corList").innerHTML = list.length
      ? `<table><tbody>${list.map(c => `<tr>
          <td>${esc(c.date.slice(5))} ${esc(c.time)}</td><td>${TYPE_LABEL[c.type]}</td>
          <td>${tagsHtml([STATUS[c.status] || ["gray", c.status]])}</td>
          <td class="muted">${esc(c.reason)}</td></tr>`).join("")}</tbody></table>`
      : "尚無申請";
  } catch (e) { $("corList").textContent = errMsg(e); }
}

// 預設補打卡日期為今天、時間為上班時間
$("corDate").value = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
$("corTime").value = WORK.start;

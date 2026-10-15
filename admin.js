// 管理後台
import {
  firebaseConfig, auth, db, loginWithEmpId, logout, normEmpId, validEmpId, companyOf, makeEmail,
  fmtTime, ymOf, ymdOf, ymdToInput, inputToYmd, summarizeDay, tagsHtml, MODE_LABEL, TYPE_LABEL,
  getPosition, DEFAULT_RADIUS, esc, errMsg, showMsg, hideMsg, weekdayOfYmd
} from "./common.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const views = ["vLoading", "vLogin", "vDenied", "vMain"];
function show(v) { views.forEach(x => $(x).classList.toggle("hidden", x !== v)); }

// 用第二個連線建立員工帳號，避免管理員自己被登出
const secondaryAuth = getAuth(initializeApp(firebaseConfig, "secondary"));

let me = null;
let staff = []; // 在職員工

onAuthStateChanged(auth, async user => {
  if (!user) { me = null; $("who").textContent = ""; show("vLogin"); return; }
  show("vLoading");
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active !== true || snap.data().role !== "admin") { show("vDenied"); return; }
    me = { uid: user.uid, ...snap.data() };
    $("who").textContent = `${me.name}（${me.empId}）`;
    show("vMain");
    $("dayPick").value = ymdToInput(ymdOf(new Date()));
    await loadStaff();
    loadDay();
    loadCorrections();
    loadOffice();
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
document.querySelectorAll(".tabs button[data-tab]").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tabs button[data-tab]").forEach(b => b.classList.toggle("on", b === btn));
    ["tToday", "tStaff", "tCor", "tOffice"].forEach(id => $(id).classList.toggle("hidden", id !== btn.dataset.tab));
  };
});

// ===== 每日出勤 =====
$("dayPick").onchange = () => loadDay();
$("btnReloadDay").onclick = () => loadDay();

async function loadDay() {
  const body = $("dayBody");
  body.innerHTML = `<tr><td colspan="6" class="muted">載入中…</td></tr>`;
  try {
    const ymd = inputToYmd($("dayPick").value);
    const snap = await getDocs(query(collection(db, "punches"), where("ymd", "==", ymd)));
    const byEmp = {};
    snap.docs.forEach(d => {
      const p = { ...d.data(), ts: d.data().ts.toDate() };
      (byEmp[p.empId] = byEmp[p.empId] || []).push(p);
    });
    const isToday = ymd === ymdOf(new Date());
    const wd = weekdayOfYmd(ymd);
    const weekend = wd === 0 || wd === 6;
    const rows = staff.map(s => {
      const list = (byEmp[s.empId] || []).sort((a, b) => a.ts - b.ts);
      if (!list.length) {
        const tag = weekend ? ["gray", "假日"] : ["warn", isToday ? "尚未打卡" : "未打卡"];
        return `<tr><td>${esc(s.name)}<br><span class="muted">${esc(s.empId)}</span></td><td>${esc(s.company)}</td><td>—</td><td>—</td><td>${tagsHtml([tag])}</td><td></td></tr>`;
      }
      const sum = summarizeDay(list);
      const tags = isToday ? sum.tags.filter(t => t[1] !== "未打下班卡" && t[1] !== "早退") : sum.tags;
      const detail = list.map(p => {
        const where_ = p.mode === "field" ? `：${esc(p.customer)}` : p.distance != null ? `（${p.distance} m）` : "";
        const map = p.lat != null ? ` <a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener">地圖</a>` : "";
        return `${fmtTime(p.ts)} ${TYPE_LABEL[p.type]}・${MODE_LABEL[p.mode]}${where_}${map}`;
      }).join("<br>");
      return `<tr><td>${esc(s.name)}<br><span class="muted">${esc(s.empId)}</span></td><td>${esc(s.company)}</td>
        <td>${sum.firstIn ? fmtTime(sum.firstIn.ts) : "—"}</td><td>${sum.lastOut ? fmtTime(sum.lastOut.ts) : "—"}</td>
        <td>${tagsHtml(tags.length ? tags : [["ok", "正常"]])}</td><td class="muted">${detail}</td></tr>`;
    });
    body.innerHTML = rows.join("") || `<tr><td colspan="6" class="muted">尚未建立員工</td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="6">${esc(errMsg(e))}</td></tr>`; }
}

// ===== 員工管理 =====
$("nEmpId").oninput = () => { $("nCompany").value = companyOf(normEmpId($("nEmpId").value)); };

async function loadStaff() {
  const snap = await getDocs(query(collection(db, "users"), where("active", "==", true)));
  staff = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.empId.localeCompare(b.empId));
  $("staffBody").innerHTML = staff.map(s => `<tr>
      <td>${esc(s.empId)}</td><td>${esc(s.name)}</td><td>${esc(s.company)}</td>
      <td>${s.role === "admin" ? '<span class="tag field">管理員</span>' : "員工"}</td>
      <td>${s.deviceId ? '<span class="tag ok">已綁定</span>' : '<span class="tag gray">未綁定</span>'}</td>
      <td>
        ${s.deviceId ? `<button class="small secondary" data-act="unbind" data-uid="${s.uid}">重設手機</button>` : ""}
        ${s.uid !== me.uid ? `<button class="small danger" data-act="disable" data-uid="${s.uid}">停用</button>` : ""}
      </td></tr>`).join("") || `<tr><td colspan="6" class="muted">尚無員工</td></tr>`;
  $("rEmp").innerHTML = staff.filter(s => s.uid !== me.uid)
    .map(s => `<option value="${s.uid}">${esc(s.empId)} ${esc(s.name)}</option>`).join("");
}

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
      showMsg(msg, `已停用 ${s.name} 的帳號（出勤紀錄仍會保留）。`, "ok");
    }
    await loadStaff();
  } catch (err) { showMsg(msg, errMsg(err), "err"); btn.disabled = false; }
};

$("btnAdd").onclick = async () => {
  const msg = $("addMsg");
  const empId = normEmpId($("nEmpId").value), name = $("nName").value.trim(), pw = $("nPw").value;
  if (!validEmpId(empId)) { showMsg(msg, "員工編號格式：W、S 或 C 開頭，加 3 位數字（例如 W001）", "err"); return; }
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
      empId, name, company: companyOf(empId), role: $("nRole").value,
      active: true, deviceId: null, mustChangePassword: true, createdAt: serverTimestamp()
    });
    batch.set(doc(db, "logins", empId), { email, uid: cred.user.uid });
    await batch.commit();
    showMsg(msg, `已新增 ${name}（${empId}）。請告訴員工：編號 ${empId}，初始密碼為你剛設定的密碼。`, "ok");
    $("nEmpId").value = $("nName").value = $("nPw").value = $("nCompany").value = "";
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

// ===== 補打卡審核 =====
let pending = [];
async function loadCorrections() {
  const body = $("corBody");
  try {
    const snap = await getDocs(query(collection(db, "corrections"), where("status", "==", "pending")));
    pending = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    $("corCount").textContent = pending.length ? `(${pending.length})` : "";
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
    } else {
      batch.update(doc(db, "corrections", c.id), { status: "rejected", ...review });
    }
    await batch.commit();
    showMsg($("corMsg"), `已${btn.dataset.act === "approve" ? "核准" : "駁回"} ${c.name} 的申請`, "ok");
    await loadCorrections();
    loadDay();
  } catch (err) { showMsg($("corMsg"), errMsg(err), "err"); btn.disabled = false; }
};

// ===== 公司位置 =====
async function loadOffice() {
  const snap = await getDoc(doc(db, "settings", "office"));
  const o = snap.exists() ? snap.data() : {};
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
    await setDoc(doc(db, "settings", "office"), {
      address: $("oAddr").value.trim(), lat, lng, radius, updatedBy: me.empId, updatedAt: serverTimestamp()
    });
    showMsg($("oMsg"), "公司位置已儲存", "ok");
  } catch (e) { showMsg($("oMsg"), errMsg(e), "err"); }
};

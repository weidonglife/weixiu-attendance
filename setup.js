// 初始設定：建立第一位管理員（只能使用一次）
import {
  auth, db, normEmpId, validEmpId, companyOf, makeEmail, errMsg, showMsg, checkNewPassword
} from "./common.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
function show(v) { ["vLoading", "vDone", "vForm"].forEach(x => $(x).classList.toggle("hidden", x !== v)); }

(async () => {
  try {
    const snap = await getDoc(doc(db, "settings", "bootstrap"));
    show(snap.exists() ? "vDone" : "vForm");
  } catch (e) {
    show("vForm");
    showMsg($("sMsg"), errMsg(e), "err");
  }
})();

$("sEmpId").oninput = () => { $("sCompany").value = companyOf(normEmpId($("sEmpId").value)); };

$("btnSetup").onclick = async () => {
  const msg = $("sMsg");
  const empId = normEmpId($("sEmpId").value), name = $("sName").value.trim();
  if (!validEmpId(empId)) { showMsg(msg, "員工編號格式：W、S 或 C 開頭，加 3 位數字（例如 W001）", "err"); return; }
  if (!name) { showMsg(msg, "請填寫姓名", "err"); return; }
  const bad = checkNewPassword($("sPw1").value, $("sPw2").value);
  if (bad) { showMsg(msg, bad, "err"); return; }
  $("btnSetup").disabled = true;
  try {
    const email = makeEmail(empId);
    const cred = await createUserWithEmailAndPassword(auth, email, $("sPw1").value);
    const batch = writeBatch(db);
    batch.set(doc(db, "users", cred.user.uid), {
      empId, name, company: companyOf(empId), role: "admin",
      active: true, deviceId: null, mustChangePassword: false, createdAt: serverTimestamp()
    });
    batch.set(doc(db, "logins", empId), { email, uid: cred.user.uid });
    batch.set(doc(db, "settings", "bootstrap"), { uid: cred.user.uid, createdAt: serverTimestamp() });
    await batch.commit();
    $("sPw1").value = $("sPw2").value = "";
    showMsg(msg, "管理員建立完成！即將前往管理後台…", "ok");
    setTimeout(() => { location.href = "admin.html"; }, 1500);
  } catch (e) {
    showMsg(msg, errMsg(e), "err");
    $("btnSetup").disabled = false;
  }
};

// 中英切換（WeiWork 員工頁面）
//   做法：畫面照原本的中文產生，英文模式時再把畫面上的中文換成英文（不改任何計算或資料）
//   對照表在 i18n-en.js：EXACT（整句對照）、PATS（有變數的句子）、WORDS（句子裡的常用詞）
//   使用者自己輸入的內容（事由、活動名稱、地點、姓名…）放在 translate="no" 裡，不會被翻譯
//   LINE 通知服務也會下載 i18n-en.js，用同一份對照表翻譯英文同仁的通知
import { makeTr } from "./i18n-en.js?v=2";

const KEY = "wx_lang";
const ADMIN_PAGE = /\/(admin|board|setup|phone|stage)\.html$/.test(location.pathname);
const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;   // 中文字或全形標點

function read() { try { return localStorage.getItem(KEY) === "en" ? "en" : "zh"; } catch { return "zh"; } }
export const LANG = ADMIN_PAGE ? "zh" : read();
export const isEn = () => LANG === "en";

// ===== 翻譯一段文字（算法在 i18n-en.js，LINE 通知服務共用）=====
export const missing = new Set();
if (typeof window !== "undefined") window.__i18nMissing = missing;
export const tr = makeTr(s => missing.add(s));

// ===== 畫面 =====
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const done = new WeakMap();   // text node → 已經寫入的英文（避免重複翻譯）
function skip(el) { return !!(el && el.closest && el.closest('[translate="no"], script, style, textarea, .lunar-x')); }
function doText(n) {
  const v = n.nodeValue;
  if (!v || !CJK.test(v) || done.get(n) === v) return;
  if (skip(n.parentElement)) return;
  const t = tr(v);
  done.set(n, t);
  if (t !== v) n.nodeValue = t;
}
function doEl(el) {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v && CJK.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
  }
  if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && CJK.test(el.value)) { const t = tr(el.value); if (t !== el.value) el.value = t; }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doEl(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = it.nextNode())) n.nodeType === 3 ? doText(n) : doEl(n);
}

let saver = null;
export function setLangSaver(f) { saver = f; }
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { }
  Promise.resolve(saver ? saver(l) : null).catch(() => { }).finally(() => location.reload());
}
// 管理員在後台幫員工設定的語言：登入後以帳號上的設定為準
export function adoptUserLang(l, save) {
  if (ADMIN_PAGE) return;
  if (l !== "en" && l !== "zh") {   // 帳號還沒設定語言：把目前選的語言存到帳號（LINE 通知才知道要用英文）
    if (LANG === "en" && save) Promise.resolve(save("en")).catch(() => { });
    return;
  }
  if (l !== LANG) { try { localStorage.setItem(KEY, l); } catch { } location.reload(); }
}

function addToggle() {
  if (ADMIN_PAGE) return;
  const host = document.querySelector("header.top .inner");
  if (!host || document.getElementById("langBtn")) return;
  const b = document.createElement("button");
  b.id = "langBtn"; b.type = "button"; b.className = "lang-btn";
  b.setAttribute("translate", "no");
  b.textContent = LANG === "en" ? "中文" : "EN";
  b.title = LANG === "en" ? "切換成中文" : "Switch to English";
  b.addEventListener("click", () => setLang(LANG === "en" ? "zh" : "en"));
  host.appendChild(b);
}

if (typeof document !== "undefined") {
  const start = () => {
    addToggle();
    if (LANG !== "en") return;
    document.documentElement.lang = "en";
    document.documentElement.classList.add("lang-en");
    walk(document.body);
    document.title = tr(document.title);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") doEl(m.target);
        else m.addedNodes.forEach(walk);
      }
      if (CJK.test(document.title)) document.title = tr(document.title);
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // 跳出的確認視窗也翻成英文
    const c = window.confirm.bind(window), a = window.alert.bind(window), p = window.prompt.bind(window);
    window.confirm = m => c(tr(m));
    window.alert = m => a(tr(m));
    window.prompt = (m, d) => p(tr(m), d);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}

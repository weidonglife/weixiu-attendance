// 英文對照表（WeiWork 員工頁面＋LINE 通知共用）
//   EXACT：整句對照（畫面上一整段字完全相同才換）
//   PATS ：有變數的句子 [正規表示式, 取代函式]，人名、事由這些變數照原文保留
//   WORDS：上面兩種都對不到時，句子裡的常用詞逐一替換（最後再把全形標點換成英文標點）
// 修改英文用語只要改這個檔案；中文畫面完全不受影響

const W7 = { 日: "Sun", 一: "Mon", 二: "Tue", 三: "Wed", 四: "Thu", 五: "Fri", 六: "Sat" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ROLE = { 主官: "Chief", 副主官: "Deputy chief", 管理員: "Administrator", 直屬主管: "Supervisor" };
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function lunarDay(s) {
  if (s === "初十") return 10; if (s === "二十") return 20; if (s === "三十") return 30;
  const a = s[0], b = s[1];
  if (a === "初") return CN[b];
  if (a === "十") return 10 + CN[b];
  if (a === "廿") return 20 + CN[b];
  return 0;
}
function lunarMonth(s) { return s === "正" ? 1 : s === "冬" ? 11 : s === "臘" ? 12 : s === "十一" ? 11 : s === "十二" ? 12 : CN[s] || 0; }
const days = n => `${n} ${Number(n) === 1 ? "day" : "days"}`;

export const EXACT = {
  // ===== 頁首、登入 =====
  "WeiWork｜唯修集團 員工平台": "WeiWork | WEIXIU Group Staff Portal",
  "唯修集團 員工平台": "WEIXIU Group Staff Portal",
  "唯修集團 員工平台・一起把事做好": "WEIXIU Group Staff Portal · Getting things done together",
  "WEIXIU 唯修": "WEIXIU",
  "載入中…": "Loading…",
  "讀取中…": "Loading…",
  "登入": "Sign in",
  "員工編號": "Employee ID",
  "請輸入員工編號": "Enter your employee ID",
  "密碼": "Password",
  "忘記密碼請聯絡管理員重設。": "Forgot your password? Ask an administrator to reset it.",
  "請設定新密碼": "Set a new password",
  "第一次登入或密碼剛被重設，請改成只有你知道的密碼（至少 8 個字元）。": "This is your first sign-in or your password was just reset. Please choose a password only you know (at least 8 characters).",
  "新密碼": "New password",
  "再輸入一次": "Enter it again",
  "確認修改": "Save",
  "無法使用": "Not available",
  "登出": "Sign out",
  "帳號已停用": "Account disabled",
  "這個帳號目前無法使用，請聯絡管理員。": "This account can't be used right now. Please contact an administrator.",
  "無法綁定手機": "Can't register this phone",
  "請不要使用無痕模式，並允許瀏覽器儲存網站資料後再試一次。": "Please don't use private browsing, allow the browser to store site data, and try again.",
  "這支手機尚未綁定": "This phone isn't registered",
  "你的帳號已綁定另一支手機（或瀏覽器資料被清除）。如果換了手機，請聯絡管理員重設手機綁定。": "Your account is registered to another phone (or the browser data was cleared). If you changed phones, ask an administrator to reset your phone registration.",
  "發生錯誤": "Something went wrong",
  "發生錯誤，請稍後再試": "Something went wrong. Please try again later.",

  // ===== 分頁 =====
  "打卡": "Clock",
  "請假／加班": "Leave / OT",
  "今日出勤": "Today",
  "待我審核": "To review",
  "行事曆": "Calendar",
  "公司活動": "Events",
  "我的設定": "Settings",

  // ===== 打卡 =====
  "內勤打卡": "Office",
  "外勤打卡": "Field",
  "客戶名稱／地點（必填）": "Customer / location (required)",
  "例如：台積電 Fab 12": "e.g. customer site name",
  "上班打卡": "Clock in",
  "下班打卡": "Clock out",
  "打卡時間以伺服器時間為準，會同時記錄 GPS 位置。": "The server time is used, and your GPS location is recorded.",
  "我的上班預告": "My work schedule",
  "預計要來上班的日子請先登記，主管和管理員就會知道你哪天會來。行程有變請記得取消或修改。": "Register the days you plan to work so your supervisor and administrators know when you'll be in. If plans change, please update or cancel.",
  "日期": "Date",
  "開始": "Start",
  "結束": "End",
  "登記": "Register",
  "已登記": "Registered",
  "尚未登記": "Nothing registered",
  "今天的打卡紀錄": "Today's clock records",
  "尚無紀錄": "No records yet",
  "出勤紀錄": "Attendance record",
  "上班": "In",
  "下班": "Out",
  "狀態": "Status",
  "忘記打卡？申請補打卡": "Forgot to clock? Request a correction",
  "時間": "Time",
  "類別": "Type",
  "原因（必填）": "Reason (required)",
  "例如：手機沒電，08:00 已到公司": "e.g. phone battery was dead; arrived at 08:00",
  "送出申請": "Submit request",
  "我的補打卡申請": "My correction requests",
  "尚無申請": "No requests yet",
  "外勤打卡請填寫客戶名稱或地點": "For field clock-in, please enter the customer or location",
  "管理員尚未設定公司位置，暫時無法內勤打卡": "The office location hasn't been set by an administrator, so office clock-in isn't available yet",
  "正在取得位置…": "Getting your location…",
  "打卡中…": "Clocking…",
  "打卡失敗：請確認手機時間設定為「自動」，並重新整理頁面後再試。": "Clock failed: make sure your phone's time is set to “Automatic”, then reload the page and try again.",
  "本月尚無紀錄": "No records this month",
  "未打卡": "No clock record",
  "整天未打卡": "No clock record all day",
  "未打上班卡": "Missed clock-in",
  "未打下班卡": "Missed clock-out",
  "遲到": "Late",
  "早退": "Left early",
  "正常": "OK",
  "外勤": "Field",
  "內勤": "Office",
  "補打卡": "Correction",
  "含補打卡": "Incl. correction",
  "請選擇日期與時間": "Please choose a date and time",
  "請填寫原因": "Please enter a reason",
  "不能申請未來的時間": "You can't request a future time",
  "請選擇日期": "Please choose a date",
  "只能登記今天到 30 天內的日子": "You can only register dates from today up to 30 days ahead",
  "結束時間要晚於開始時間": "The end time must be after the start time",
  "確定取消？": "Cancel this?",
  "已取消這天的預告": "This day has been cancelled",
  "取消": "Cancel",

  // ===== 請假、加班 =====
  "我的假別餘額": "My leave balance",
  "申請請假": "Request leave",
  "假別": "Leave type",
  "開始日期": "Start date",
  "開始時間": "Start time",
  "結束日期": "End date",
  "結束時間": "End time",
  "事由（必填）": "Reason (required)",
  "代理人（選填）": "Stand-in (optional)",
  "（不指定）": "(none)",
  "送出請假申請": "Submit leave request",
  "申請加班": "Request overtime",
  "補償方式": "Compensation",
  "領加班費": "Overtime pay",
  "換成補休": "Comp time off",
  "加班事由（必填）": "Overtime reason (required)",
  "例如：趕修客戶急件 Agilent 3458A": "e.g. urgent repair for a customer",
  "送出加班申請": "Submit overtime request",
  "我的申請紀錄": "My requests",
  "已取消申請": "Request cancelled",
  "取消申請": "Cancel request",
  "結束日期不能早於開始日期": "The end date can't be before the start date",
  "這段時間都不是上班時間（週末、國定假日或午休），不需要請假": "This period is all outside working hours (weekend, public holiday or lunch break), so no leave is needed",
  "管理員尚未設定你的到職日，暫時無法計算特休，請先聯絡管理員": "Your start date hasn't been set by an administrator, so annual leave can't be calculated yet. Please contact an administrator",
  "請填寫日期與時間": "Please enter the date and time",
  "結束時間要晚於開始時間（不能跨過午夜，跨日請分兩張申請）": "The end time must be after the start time (it can't cross midnight — use two requests for two days)",
  "加班時間請以 30 分鐘為單位": "Overtime must be in 30-minute steps",
  "週日是例假日，除天災、事變或突發事件外不得出勤": "Sunday is the regular day off; work is not allowed except for natural disasters, emergencies or unexpected events",
  "請填寫事由": "Please enter a reason",
  "請填寫加班事由": "Please enter the overtime reason",
  "確定仍要送出": "Submit anyway",
  "特休剩餘": "Annual leave left",
  "補休剩餘": "Comp time left",
  "管理員尚未設定到職日": "Start date not set by administrator",
  "補休 1 年內要休完（最晚到特休年度結束），依加班先後順序使用": "Comp time must be used within 1 year (no later than the end of your annual-leave year), oldest first",
  "已核准": "Approved",
  "審核中": "Pending",
  "待主管審核": "Awaiting supervisor",
  "待核定": "Awaiting final approval",
  "已駁回": "Rejected",
  "已取消": "Cancelled",
  "加班費": "overtime pay",
  "換補休": "comp time",
  "已送出，等待直屬主管審核": "Sent — waiting for your supervisor's review",
  "已送出，等待管理員核定": "Sent — waiting for an administrator's approval",
  "尚未設定主官／副主官，請管理員代為核定": "No chief / deputy chief is set; an administrator will approve",
  "時間未記錄": "time not recorded",
  "員工自行取消": "Cancelled by employee",
  "無": "none",

  // ===== 假別 =====
  "特休": "Annual leave",
  "補休": "Comp time off",
  "事假": "Personal leave",
  "家庭照顧假": "Family care leave",
  "病假": "Sick leave",
  "病假（住院）": "Sick leave (hospitalized)",
  "生理假": "Menstrual leave",
  "婚假": "Marriage leave",
  "喪假": "Bereavement leave",
  "公假": "Official leave",
  "公傷病假": "Occupational injury leave",
  "產假": "Maternity leave",
  "產檢假": "Prenatal check-up leave",
  "安胎休養": "Pregnancy rest leave",
  "陪產檢及陪產假": "Paternity leave",
  "育嬰留停（按日）": "Parental leave (by day)",
  "請假": "Leave",
  "依年資計算（勞基法第 38 條），工資照給；年度終了未休完應發給工資或經雙方同意遞延一年": "Based on seniority (Labor Standards Act Art. 38), fully paid. Unused days at year end are paid out, or carried over one year if both sides agree.",
  "使用加班換得的補休時數；依加班先後順序使用，1 年內要休完（但最晚到該特休年度結束），到期未休完改發加班費": "Uses comp time earned from overtime, oldest first. Must be used within 1 year (no later than the end of the annual-leave year); anything unused is paid as overtime.",
  "全年 14 日（含家庭照顧假），不給工資": "Up to 14 days a year (including family care leave), unpaid.",
  "全年 56 小時（7 日），可以按小時請，併入事假計算；不給工資，但不得因此扣全勤獎金": "Up to 56 hours (7 days) a year, can be taken by the hour, counted within personal leave. Unpaid, but your perfect-attendance bonus can't be reduced for it.",
  "未住院全年 30 日內工資折半；一年內未超過 10 日，公司不得因此給予不利處分": "Without hospitalization: up to 30 days a year at half pay. If under 10 days a year, the company may not treat you unfavorably for it.",
  "住院者 2 年內合計不超過 1 年（含未住院病假）；全年 30 日內工資折半": "When hospitalized: up to 1 year in total within 2 years (including non-hospital sick leave). Half pay for the first 30 days a year.",
  "每月 1 日，工資折半；全年前 3 日不併入病假，超過的併入病假計算": "1 day a month at half pay. The first 3 days a year are not counted as sick leave; any more are.",
  "8 日，工資照給（原則上於結婚前 10 日至結婚後 3 個月內請畢）": "8 days, fully paid (normally taken between 10 days before and 3 months after the wedding).",
  "依親等 3～8 日，工資照給：父母、養父母、繼父母、配偶 8 日；祖父母、子女、配偶之父母 6 日；曾祖父母、兄弟姊妹、配偶之祖父母 3 日": "3–8 days depending on the relationship, fully paid: parents, adoptive or step-parents, spouse 8 days; grandparents, children, spouse's parents 6 days; great-grandparents, siblings, spouse's grandparents 3 days.",
  "依實際需要，工資照給": "As actually needed, fully paid.",
  "職業災害，依實際需要；公司按原領工資補償": "For work-related injury or illness, as needed; the company pays your regular wage.",
  "分娩前後 8 週；懷孕 3 個月以上流產 4 週、2～3 個月流產 1 週、未滿 2 個月流產 5 日。以日曆天連續計算（含假日）；到職滿 6 個月工資照給，未滿減半": "8 weeks around childbirth; miscarriage after 3+ months 4 weeks, 2–3 months 1 week, under 2 months 5 days. Counted in consecutive calendar days (including holidays). Fully paid after 6 months of service, otherwise half pay.",
  "懷孕期間共 7 日，可以按小時請，工資照給": "7 days in total during pregnancy, can be taken by the hour, fully paid.",
  "依醫師診斷，併入住院病假計算；不得因此扣全勤獎金": "Based on a doctor's diagnosis, counted as hospitalized sick leave. Your perfect-attendance bonus can't be reduced for it.",
  "配偶懷孕期間至分娩後 15 日內，共 7 日，可以按小時請，工資照給": "7 days in total, from your spouse's pregnancy up to 15 days after the birth, can be taken by the hour, fully paid.",
  "2026 年起可以「日」為單位申請，每次請整天；留職停薪不給工資（可向勞保局申請育嬰津貼）；原則上 5 日前提出": "From 2026 it can be requested by the day (whole days only). Unpaid leave (you can apply to the Bureau of Labor Insurance for a parental allowance). Normally request 5 days in advance.",

  // ===== 審核 =====
  "1 天以內的申請你核准後就生效；超過 1 天會再送副主官核定。": "Requests of 1 day or less take effect once you approve. Longer ones then go to the deputy chief for final approval.",
  "目前沒有待審核的申請": "Nothing to review right now",
  "最近審核紀錄": "Recent reviews",
  "全員請假一覽": "Everyone's leave",
  "過去 30 天到未來 30 天所有員工的請假，含審核中的假（不顯示事由）。": "Everyone's leave from 30 days ago to 30 days ahead, including pending leave (reasons are not shown).",
  "你核准後就生效": "Takes effect once you approve",
  "1 天以內，你核准後就生效": "1 day or less — takes effect once you approve",
  "意見（選填）": "Note (optional)",
  "核准": "Approve",
  "駁回": "Reject",
  "請管理員先打開一次管理後台，請假一覽就會開放給主管查看。": "Ask an administrator to open the admin console once; the leave list will then be available to supervisors.",
  "接下來 30 天沒有人請假": "No one is on leave in the next 30 days",
  "過去 30 天沒有人請假": "No one was on leave in the past 30 days",

  // ===== 我的設定 =====
  "我的資料": "My profile",
  "姓名": "Name",
  "公司": "Company",
  "身分": "Employment",
  "兼職": "Part-time",
  "正職": "Full-time",
  "直屬主管": "Supervisor",
  "（無）": "(none)",
  "到職日": "Start date",
  "LINE 通知": "LINE notifications",
  "行事曆加到手機": "Add calendar to your phone",
  "修改密碼": "Change password",
  "新密碼至少 8 個字元。忘記目前的密碼請找管理員重設。": "Your new password needs at least 8 characters. If you forgot your current password, ask an administrator to reset it.",
  "目前的密碼": "Current password",
  "再輸入一次新密碼": "Enter the new password again",
  "請輸入目前的密碼": "Please enter your current password",
  "新密碼不能和目前的密碼一樣": "The new password must be different from the current one",
  "目前的密碼不正確": "The current password is incorrect",
  "密碼已修改，下次登入請用新密碼": "Password changed. Use the new password next time you sign in",
  "密碼至少需要 8 個字元": "The password needs at least 8 characters",
  "兩次輸入的密碼不一致": "The two passwords don't match",
  "綁定後，有人送申請給你審核、或你的申請有結果時，會馬上用 LINE 通知你。": "Once linked, you'll get a LINE message right away when someone sends you a request to review, or when your own request has a result.",
  "綁定 LINE": "Link LINE",
  "解除綁定": "Unlink",
  "確定解除？": "Unlink?",
  "已解除綁定": "Unlinked",
  "加入好友": "Add friend",
  "傳送綁定碼": "Send the code",
  "我已完成，重新檢查": "Done — check again",
  "暫時無法取得訂閱連結，請稍後再試。": "The subscription link isn't available right now. Please try again later.",
  "把公司行事曆加到手機，公司活動、放假和請假會自動出現，也可以用手機的提醒功能。": "Add the company calendar to your phone. Events, holidays and leave appear automatically, and you can use your phone's reminders.",
  "加到 iPhone 行事曆": "Add to iPhone Calendar",
  "加到 Google 日曆": "Add to Google Calendar",
  "複製連結": "Copy link",
  "已複製": "Copied",
  "請複製這個連結": "Please copy this link",
  "這是你專屬的連結，請不要分享給別人。Android 手機請按「加到 Google 日曆」，用你的 Google 帳號登入後按「新增」。Google 日曆大約每幾小時更新一次。": "This link is just for you — please don't share it. On Android, tap “Add to Google Calendar”, sign in with your Google account and tap “Add”. Google Calendar refreshes every few hours.",
  "懷疑連結外流？": "Think the link was leaked?",
  "換一個新連結": "Get a new link",
  "（舊的會失效，要重新訂閱一次）": "(the old one stops working; you'll need to subscribe again)",
  "確定要換？再按一次": "Tap again to confirm",

  // ===== 公司活動、行事曆 =====
  "今天、明天和接下來一週的公司活動（行程、訓練、一般活動）。⭐＝有你參加。完整內容請看「行事曆」。": "Company events for today, tomorrow and the next week (trips, training and other events). ⭐ = you're taking part. See “Calendar” for everything.",
  "今天": "Today",
  "明天": "Tomorrow",
  "接下來一週": "Next week",
  "沒有活動": "No events",
  "整天": "All day",
  "全天": "All day",
  "外勤行程": "Trip",
  "教育訓練": "Training",
  "稽核": "Audit",
  "會議": "Meeting",
  "客戶來訪": "Visitor",
  "一般": "General",
  "上個月": "Previous month",
  "下個月": "Next month",
  "＋ 新增活動": "+ New event",
  "新增活動": "Add event",
  "全部公司": "All companies",
  "全部活動": "All events",
  "不顯示活動": "Hide events",
  "活動類別": "Event type",
  "請假（已核准）": "Leave (approved)",
  "兼職預告": "Part-time schedule",
  "紅字＝放假": "Red = day off",
  "目前讀不到請假資料。請管理員先打開一次管理後台，再重新整理這一頁。": "Leave data can't be read yet. Ask an administrator to open the admin console once, then reload this page.",
  "確定刪除？": "Delete?",
  "刪除": "Delete",
  "修改": "Edit",
  "放假日": "Day off",
  "沒有人請假": "No one on leave",
  "兼職上班預告": "Part-time work schedule",
  "修改活動": "Edit event",
  "新增公司活動": "New company event",
  "活動名稱": "Event name",
  "例如：ISO 內部稽核、客戶到廠、教育訓練": "e.g. ISO internal audit, customer visit, training",
  "地點（選填）": "Location (optional)",
  "說明（選填）": "Details (optional)",
  "人員（選填，可複選）": "People (optional, choose any)",
  "對象": "For",
  "全體同仁": "Everyone",
  "儲存修改": "Save changes",
  "其他": "Other",
  "讀不到員工名單": "Can't load the staff list",
  "請輸入活動名稱": "Please enter an event name",
  "請選開始日期": "Please choose a start date",
  "活動最長 62 天": "An event can last at most 62 days",
  "沒有權限：只能修改自己建立的活動": "Not allowed: you can only edit events you created",
  "儲存失敗": "Save failed",
  "刪除失敗：只能刪除自己建立的活動": "Delete failed: you can only delete events you created",
  "國定假日": "Public holiday",
  "停班": "Office closed",
  "補班": "Make-up workday",
  "假日": "Day off",

  // ===== 今日出勤 =====
  "唯修集團　今日出勤": "WEIXIU Group · Today",
  "目前時間": "Current time",
  "名牌牆": "Name wall",
  "依狀態分類": "By status",
  "全部": "All",
  "畫面亮度": "Display",
  "亮色": "Light",
  "藍色": "Blue",
  "深色": "Dark",
  "尚未打卡": "Not clocked in",
  "未到": "Not in",
  "已下班": "Left",
  "已上班": "In",
  "外勤中": "Field",
  "已到": "In",
  "連線中…": "Connecting…",
  "有人打卡會即時更新，另每 2 分鐘重新讀取一次。請假只顯示時段，不顯示假別。": "Updates live when someone clocks in, and reloads every 2 minutes. Leave shows only the time, not the type.",
  "時間不固定": "Flexible hours",
  "今日未上班": "Not working today",
  "今日停班": "Closed today",
  "目前沒有人登記": "No one registered",
  "沒有員工": "No staff",
  "員工名單尚未建立。請管理員打開一次管理後台，名單就會自動建立。": "The staff list isn't ready yet. Ask an administrator to open the admin console once and it will be created.",
  "預計上班": "Scheduled",

  // ===== 公司 =====
  "唯修科技": "WEIXIU",
  "傳創機電": "Chuan Chuang",
  "唯校中心": "Smile Verification",
  "唯修科技 · 傳創機電 · 唯校中心": "WEIXIU · Chuan Chuang · Smile Verification",

  // ===== LINE 通知 =====
  "📝 請假／加班待審核": "📝 Leave / overtime to review",
  "🕘 補打卡待審核": "🕘 Clock correction to review",
  "🕘 補打卡待你核定": "🕘 Clock correction waiting for your final approval",
  "✅ 你的申請已核准": "✅ Your request was approved",
  "❌ 你的申請被駁回": "❌ Your request was rejected",
  "✅ 你的補打卡已核准": "✅ Your clock correction was approved",
  "❌ 你的補打卡被駁回": "❌ Your clock correction was rejected",
  "之後請假、加班、補打卡的審核通知都會傳到這裡。": "From now on, approval notices for leave, overtime and corrections will be sent here.",
  "要取消請傳「解除綁定」。": "To unlink, send “解除綁定”.",
  "依勞動基準法第 38 條，您本年度的特別休假如下：": "Under Article 38 of the Labor Standards Act, your annual leave for this year is:",
  "請在期間內和主管討論排休，到期沒休完的天數依法結算。": "Please plan your leave with your supervisor within this period. Days not used by the end are settled according to the law.",
  // ===== 錯誤訊息 =====
  "員工編號只能用英文字母、數字（可含 - 或 _），最多 20 個字": "Employee IDs can only use letters and numbers (plus - or _), up to 20 characters",
  "員工編號不正確，請再確認一次": "That employee ID isn't valid. Please check it",
  "查無此員工編號": "Employee ID not found",
  "通知服務尚未設定": "The notification service isn't set up",
  "請先登入": "Please sign in first",
  "通知服務發生錯誤": "The notification service had an error",
  "此瀏覽器不支援定位功能": "This browser doesn't support location",
  "請允許瀏覽器使用定位，才能打卡": "Please allow the browser to use your location so you can clock in",
  "定位逾時，請到窗邊或戶外再試一次": "Location timed out. Move near a window or outside and try again",
  "無法取得目前位置，請稍後再試": "Can't get your location. Please try again later",
  "員工編號或密碼錯誤": "Wrong employee ID or password",
  "嘗試次數過多，請稍後再試": "Too many attempts. Please try again later",
  "密碼太簡單，請至少 8 個字元": "Password too simple — use at least 8 characters",
  "網路連線失敗，請檢查網路": "Network error. Please check your connection",
  "請重新登入後再修改密碼": "Please sign in again before changing your password",
  "沒有權限執行此動作": "You don't have permission to do this",
  "網路連線不穩，請稍後再試": "Unstable connection. Please try again later",

  // ===== 農曆節日、節氣 =====
  "日": "Sun", "一": "Mon", "二": "Tue", "三": "Wed", "四": "Thu", "五": "Fri", "六": "Sat",
  "春節": "Lunar New Year", "元宵節": "Lantern Festival", "頭牙": "Tou Ya", "端午節": "Dragon Boat Festival", "七夕": "Qixi",
  "中元節": "Ghost Festival", "中秋節": "Mid-Autumn Festival", "重陽節": "Double Ninth", "臘八": "Laba", "尾牙": "Year-end party (Wei Ya)", "除夕": "Lunar New Year's Eve",
  "立春": "Start of Spring", "雨水": "Rain Water", "驚蟄": "Awakening of Insects", "春分": "Spring Equinox", "清明": "Qingming", "穀雨": "Grain Rain",
  "立夏": "Start of Summer", "小滿": "Grain Buds", "芒種": "Grain in Ear", "夏至": "Summer Solstice", "小暑": "Minor Heat", "大暑": "Major Heat",
  "立秋": "Start of Autumn", "處暑": "End of Heat", "白露": "White Dew", "秋分": "Autumn Equinox", "寒露": "Cold Dew", "霜降": "Frost's Descent",
  "立冬": "Start of Winter", "小雪": "Minor Snow", "大雪": "Major Snow", "冬至": "Winter Solstice", "小寒": "Minor Cold", "大寒": "Major Cold",

  // ===== 國定假日 =====
  "開國紀念日": "New Year's Day", "小年夜": "Day before Lunar New Year's Eve", "農曆除夕": "Lunar New Year's Eve", "補假": "Make-up holiday",
  "和平紀念日": "Peace Memorial Day", "兒童節": "Children's Day", "民族掃墓節": "Tomb Sweeping Day", "清明節": "Tomb Sweeping Day",
  "兒童節及民族掃墓節": "Children's Day & Tomb Sweeping Day", "勞動節": "Labor Day", "國慶日": "National Day",
  "孔子誕辰紀念日/教師節": "Teachers' Day", "教師節": "Teachers' Day", "臺灣光復暨金門古寧頭大捷紀念日": "Taiwan Retrocession Day",
  "臺灣光復節": "Taiwan Retrocession Day", "行憲紀念日": "Constitution Day", "放假": "Day off",
};

export const PATS = [
  // 使用者輸入的內容：前面的標題翻譯，後面照原文
  [/^事由：([\s\S]*)$/, m => `Reason: ${m[1]}`],
  [/^原因：([\s\S]*)$/, m => `Reason: ${m[1]}`],
  [/^代理人：(.*)$/, m => `Stand-in: ${m[1].replace(/（(.+?)）/, " ($1)")}`],
  [/^主管意見：([\s\S]*)$/, m => `Supervisor's note: ${m[1]}`],
  [/^管理員意見：([\s\S]*)$/, m => `Administrator's note: ${m[1]}`],
  [/^(主官|副主官|核定)(代核)?意見：([\s\S]*)$/, m => `${m[1] === "核定" ? "Approver" : ROLE[m[1]]}'s note: ${m[3]}`],
  [/^建立：(.*)$/, m => `Created by: ${m[1]}`],
  [/^距公司 (\d+) m$/, m => `${m[1]} m from office`],

  // 日期
  [/^(\d{4}) 年 (\d+) 月 (\d+) 日（(.)）$/, m => `${W7[m[4]]}, ${MON[m[2] - 1]} ${m[3]}, ${m[1]}`],
  [/^(\d{4}) 年 (\d+) 月$/, m => `${MONTH[m[2] - 1]} ${m[1]}`],
  [/^(\d{4})年(\d+)月$/, m => `${MONTH[m[2] - 1]} ${m[1]}`],
  // 農曆：格子裡的日子（英文版不顯示）、日期詳情的整行
  [/^(初[一二三四五六七八九十]|十[一二三四五六七八九]|二十|廿[一二三四五六七八九]|三十|閏?(正|二|三|四|五|六|七|八|九|十|十一|十二|冬|臘)月)$/, () => ""],
  [/^農曆(閏)?(正|二|三|四|五|六|七|八|九|十一|十二|十|冬|臘)月(初.|十.|二十|廿.|三十)$/, m => `Lunar ${m[1] ? "leap " : ""}${lunarMonth(m[2])}/${lunarDay(m[3])}`],
  [/^補班（(.+)）$/, (m, tr) => `Make-up workday (${tr(m[1])})`],

  // 打卡
  [/^(上班|下班)打卡成功：(\d\d:\d\d)（(內勤|外勤|補打卡)）$/, m => `Clocked ${m[1] === "上班" ? "in" : "out"} at ${m[2]} (${{ 內勤: "office", 外勤: "field", 補打卡: "correction" }[m[3]]})`],
  [/^你距離公司約 (\d+) 公尺，超出打卡範圍（(\d+) 公尺）。如果正在外勤，請切換到「外勤打卡」。$/, m => `You're about ${m[1]} m from the office, outside the clock-in range (${m[2]} m). If you're out in the field, switch to “Field”.`],
  [/^請假 ([\d.]+)h$/, m => `Leave ${m[1]}h`],
  [/^（請假 ([\d.]+)h）$/, m => `(leave ${m[1]}h)`],
  [/^(已更新|已登記)：(.+)$/, (m, tr) => `${m[1] === "已更新" ? "Updated" : "Registered"}: ${tr(m[2])}`],

  // 假別餘額
  [/^本年度 (\d+) 天，已用 (.+?)（含審核中）$/, (m, tr) => `This year: ${days(m[1])}, used ${tr(m[2])} (incl. pending)`],
  [/^本年度 (.+?)，(＋上年度遞延 (.+?)，)?已用 (.+?)（含審核中(、系統上線前 (.+?))?）$/, (m, tr) =>
    `This year: ${tr(m[1])}${m[2] ? `, + carried over ${tr(m[3])}` : ""}, used ${tr(m[4])} (incl. pending${m[5] ? `, ${tr(m[6])} before go-live` : ""})`],
  [/^年度期間 (\S+) ～ (\S+)$/, m => `Leave year ${m[1]} – ${m[2]}`],
  [/^加班換得 ([\d.]+) 小時，已用 ([\d.]+) 小時(.*)$/, (m, tr) => `Earned ${m[1]} h from overtime, used ${m[2]} h${m[3] ? tr(m[3]) : ""}`],
  [/^(\S+) 起可休(（兼職按工時比例）| 3 天)$/, m => `Available from ${m[1]}${m[2].includes("兼職") ? " (part-time, pro rata)" : ": 3 days"}`],
  [/^(\d{4}) 年已核准請假：(.*)$/, (m, tr) => `Approved leave in ${m[1]}: ${tr(m[2])}`],

  // 申請
  [/^共請假 (.+?)（([\d.]+) 小時，已扣除午休與假日）$/, (m, tr) => `Total leave: ${tr(m[1])} (${m[2]} h, excluding lunch breaks and holidays)`],
  [/^共加班 ([\d.]+) 小時（本月累計 ([\d.]+) 小時）$/, m => `Overtime: ${m[1]} h (${m[2]} h this month)`],
  [/^(.+)要以整天為單位（08:00 到 17:00）$/, (m, tr) => `${tr(m[1])} must be taken in whole days (08:00 to 17:00)`],
  [/^特休不足：剩餘 (.+?)，這次需要 (.+)$/, (m, tr) => `Not enough annual leave: ${tr(m[1])} left, this request needs ${tr(m[2])}`],
  [/^補休不足：到 (\S+) 還能用的補休不夠（.*），這次需要 (.+)$/, (m, tr) => `Not enough comp time usable on ${m[1]} (comp time must be used within 1 year and by the end of the annual-leave year). This request needs ${tr(m[2])}`],
  [/^和已申請的假單時間重疊（(.+?)：(.+)）$/, (m, tr) => `Overlaps an existing leave request (${tr(m[1])}: ${tr(m[2])})`],
  [/^和已申請的加班時間重疊（(.+)）$/, (m, tr) => `Overlaps an existing overtime request (${tr(m[1])})`],
  [/^當天加班將達 ([\d.]+) 小時，上班日正常工時加上加班不得超過 12 小時（加班最多 4 小時）$/, m => `Overtime that day would reach ${m[1]} h. On a workday, normal hours plus overtime can't exceed 12 h (max 4 h overtime)`],
  [/^當天加班將達 ([\d.]+) 小時，休息日或假日出勤一天最多 12 小時$/, m => `Overtime that day would reach ${m[1]} h. On a rest day or holiday, the maximum is 12 h`],
  [/^送出後本月加班將達 ([\d.]+) 小時，超過勞基法每月 (\d+) 小時的上限.*$/, m => `After this, overtime this month would reach ${m[1]} h, above the legal monthly limit of ${m[2]} h (up to 54 h a month and 138 h per 3 months with labor-management meeting approval)`],
  [/^注意：([\s\S]+)。超過法定天數的部分需要公司同意，確定要送出請再按一次。$/, (m, tr) => `Note: ${m[1].split("；").map(tr).join("; ")}. Days beyond the legal limit need company approval. Tap again to submit.`],
  [/^注意：([\s\S]+)。確定要送出請再按一次。$/, (m, tr) => `Note: ${m[1].split("；").map(tr).join("; ")}. Tap again to submit.`],
  [/^(.+?)(本月|今年)累計將達 (.+?)，超過法定的 (.+)$/, (m, tr) => `${tr(m[1])} ${m[2] === "本月" ? "this month" : "this year"} would reach ${tr(m[3])}, above the legal ${tr(m[4])}`],
  [/^事假＋家庭照顧假今年累計將達 (.+?)，超過法定的 14 天$/, (m, tr) => `Personal + family care leave this year would reach ${tr(m[1])}, above the legal 14 days`],
  [/^病假（含超過 3 日的生理假）今年累計將達 (.+?)，超過未住院 30 天$/, (m, tr) => `Sick leave (incl. menstrual leave beyond 3 days) this year would reach ${tr(m[1])}, above the 30-day non-hospital limit`],
  [/^加班（(.*)）$/, (m, tr) => `Overtime (${tr(m[1])})`],
  [/^(.+?)・(.+?)・([\d.]+) 小時$/, (m, tr) => `${tr(m[1])} · ${tr(m[2])} · ${m[3]} h`],
  [/^(.+?)・([\d.]+) 小時$/, (m, tr) => `${tr(m[1])} · ${m[2]} h`],
  [/^已送出，等待(主官|副主官)核定$/, m => `Sent — waiting for the ${ROLE[m[1]].toLowerCase()}'s approval`],

  // 簽核進度
  [/^(⏳ )?等待直屬主管 (.+) 審核$/, m => `${m[1] || ""}Waiting for supervisor ${m[2]}`],
  [/^(⏳ )?等待副主官 (.+) 核定（主官 (.+) 也可以核定）$/, m => `${m[1] || ""}Waiting for deputy chief ${m[2]} (chief ${m[3]} can also approve)`],
  [/^(⏳ )?等待(主官|副主官|管理員) (.+) 核定$/, m => `${m[1] || ""}Waiting for ${ROLE[m[2]].toLowerCase()} ${m[3]}`],
  [/^(.+?)\u3000送出申請$/, (m, tr) => `${tr(m[1])}  Submitted`],
  [/^(.+?)\u3000直屬主管 (.+) (核准|駁回)$/, (m, tr) => `${tr(m[1])}  ${m[3] === "核准" ? "Approved" : "Rejected"} by supervisor ${m[2]}`],
  [/^(.+?)\u3000(主官|副主官|管理員) (.+) (代為核准|核定|駁回)$/, (m, tr) => `${tr(m[1])}  ${m[4] === "駁回" ? "Rejected" : "Approved"} by ${ROLE[m[2]].toLowerCase()} ${m[3]}`],
  [/^(?:(.+?)\u3000)?管理員 (.+) 撤銷核准$/, (m, tr) => `${m[1] ? tr(m[1]) + "  " : ""}Approval revoked by administrator ${m[2]}`],
  [/^(.+?)\u3000員工自行取消$/, (m, tr) => `${tr(m[1])}  Cancelled by employee`],
  [/^(主官|副主官|管理員|直屬主管) (.+) (核准|核定|代為核准)$/, m => `Approved by ${ROLE[m[1]].toLowerCase()} ${m[2]}`],

  // 審核頁
  [/^🔔 有 (\d+) 張申請等你審核，點這裡處理$/, m => `🔔 ${m[1]} ${m[1] === "1" ? "request is" : "requests are"} waiting for your review — tap here`],
  [/^你是(主官|副主官|管理員)：超過 1 天的請假、加班會送到這裡給你核定。$/, m => `You're the ${ROLE[m[1]].toLowerCase()}: leave and overtime longer than 1 day come here for your final approval.`],
  [/^超過 1 天，你核准後會再送 (.+)$/, (m, tr) => `Longer than 1 day — after you approve, it goes to ${tr("等待" + m[1]).replace(/^Waiting for /, "")}`],
  [/^原本由副主官 (.+) 核定，你是主官也可以直接核定；核准後就生效$/, m => `Normally approved by deputy chief ${m[1]}; as chief you can approve it directly, and it takes effect`],
  [/^(.+)・補打卡・(上班|下班)$/, (m, tr) => `${tr(m[1])} · Correction · ${m[2] === "上班" ? "In" : "Out"}`],
  [/^已駁回 (.+) 的(.+)$/, (m, tr) => `Rejected ${m[1]}'s ${tr(m[2]).toLowerCase()}`],
  [/^已核准 (.+) 的(.+)，已經生效$/, (m, tr) => `Approved ${m[1]}'s ${tr(m[2]).toLowerCase()} — it's now in effect`],
  [/^已核准 (.+) 的(.+)，因為超過 1 天，已送(.+)$/, (m, tr) => `Approved ${m[1]}'s ${tr(m[2]).toLowerCase()}. As it's longer than 1 day, it has gone to ${tr("等待" + m[3]).replace(/^Waiting for /, "")}`],
  [/^請假中與接下來 30 天（(\d+)）$/, m => `On leave now and next 30 days (${m[1]})`],
  [/^過去 30 天（(\d+)）$/, m => `Past 30 days (${m[1]})`],

  // LINE 綁定
  [/^✅ 已綁定 LINE(（(.+)）)?。請假、加班、補打卡的審核通知會傳到你的 LINE。$/, m => `✅ LINE linked${m[2] ? ` (${m[2]})` : ""}. Approval notices for leave, overtime and corrections will be sent to your LINE.`],
  [/^暫時無法連線到通知服務（(.*)）$/, m => `Can't reach the notification service right now (${m[1]})`],
  [/^加入(出勤通知|簽核平台|WeiWork ?)?官方帳號好友（已加過可跳過）$/, () => "Add our LINE official account as a friend (skip if you already have)"],
  [/^把綁定碼傳給官方帳號：按下面按鈕會打開 LINE 並帶入文字，$/, () => "Send the code to the official account: the button below opens LINE with the text filled in —"],
  [/^記得再按「送出」$/, () => "remember to tap “Send”"],
  [/^綁定碼 10 分鐘內有效。也可以直接在「(.+)」的對話裡自己打「綁定 (\w+)」送出。$/, m => `The code is valid for 10 minutes. You can also type “綁定 ${m[2]}” yourself in the chat with “${m[1]}” and send it.`],
  [/^LINE 回覆「綁定成功」後，按這裡確認$/, () => "After LINE replies “綁定成功” (linked), tap here to check"],
  [/^步驟 (\d)$/, m => `Step ${m[1]}`],

  // 公司活動、行事曆
  [/^(\d{4}) 年 (\d+) 月$/, m => `${MONTH[m[2] - 1]} ${m[1]}`],
  [/^［(.+)］$/, (m, tr) => `[${tr(m[1])}]`],

  // 今日出勤
  [/^今天是(.+)，以下只列出有打卡的同仁。$/, (m, tr) => `Today is ${m[1] === "週末假日" ? "the weekend" : tr(m[1])}; only people who clocked in are listed.`],
  [/^⛈ 今天 (\d\d:\d\d)–(\d\d:\d\d) (.+)，停班時段不算遲到或早退。$/, (m, tr) => `⛈ Today ${m[1]}–${m[2]} ${tr(m[3])}; closed hours don't count as late or leaving early.`],
  [/^(.+?)・(\d\d:\d\d)$/, (m, tr) => `${tr(m[1])} · ${m[2]}`],
  [/^(\d\d:\d\d) 上班・(\d\d:\d\d) 下班$/, m => `In ${m[1]} · Out ${m[2]}`],
  [/^(\d\d:\d\d) 下班$/, m => `Out ${m[1]}`],
  [/^(\d\d:\d\d)? ?上班$/, m => m[1] ? `In ${m[1]}` : "In"],
  [/^請假 (.+)$/, (m, tr) => `Leave ${tr(m[1])}`],
  [/^(未到|預計上班)（(\d\d:\d\d)–(\d\d:\d\d)）$/, m => `${m[1] === "未到" ? "Not in" : "Scheduled"} (${m[2]}–${m[3]})`],
  [/^(未到|尚未打卡)?（請假 (.+)）$/, (m, tr) => `${m[1] ? tr(m[1]) + " " : ""}(leave ${tr(m[2])})`],
  [/^明天 (.+) 兼職預計上班：$/, (m, tr) => `Part-timers scheduled tomorrow ${tr(m[1])}:`],
  [/^(\d+) 人$/, m => `${m[1]}`],
  [/^即時連線・最後更新 (\S+)・(\S+) 後重新讀取$/, m => `Live · updated ${m[1]} · reload in ${m[2]}`],
  [/^・兼職$/, () => " · Part-time"],
  [/^(假日|國定假日|.+)出勤$/, (m, tr) => `Worked on ${tr(m[1]).toLowerCase()}`],

  [/^(\S+) (未到|上班|已上班|已下班|外勤|外勤中|請假|尚未打卡|已到)$/, (m, tr) => `${m[1]} ${tr(m[2])}`],
  // ===== LINE 通知 =====
  [/^意見：([\s\S]*)$/, m => `Note: ${m[1]}`],
  [/^請到 WeiWork「待我審核」處理：$/, () => "Please review it in WeiWork → “To review”:"],
  [/^尚未設定主官／副主官，請到管理後台代為核准：$/, () => "No chief / deputy chief is set. Please approve it in the admin console:"],
  [/^📝 待你核定(（直屬主管已核准）)?$/, m => `📝 Waiting for your final approval${m[1] ? " (supervisor approved)" : ""}`],
  [/^(\d{4}-\d\d-\d\d)(（(.)）)? ?(\d\d:\d\d) (上班|下班)$/, m => `${m[1]}${m[3] ? ` (${W7[m[3]]})` : ""} ${m[4]} clock-${m[5] === "上班" ? "in" : "out"}`],
  [/^✅ 綁定成功：(.+)$/, (m, tr) => `✅ Linked: ${tr(m[1])}`],
  [/^(.+) 您好：$/, m => `Hi ${m[1]},`],
  [/^・特休：(\d+) 天$/, m => `• Annual leave: ${days(m[1])}`],
  [/^・特休：(.+)（兼職依比例）$/, (m, tr) => `• Annual leave: ${tr(m[1])} (part-time, pro rata)`],
  [/^・上年度遞延：(.+)$/, (m, tr) => `• Carried over from last year: ${tr(m[1])}`],
  [/^・可休期間：(\S+) ～ (\S+)$/, m => `• Use between: ${m[1]} – ${m[2]}`],
  [/^您的特休年度在 (\S+) 結束（還有 (\d+) 天），目前還有 (.+) 特休沒休，請記得排休。$/, (m, tr) => `Your annual-leave year ends on ${m[1]} (${days(m[2])} left). You still have ${tr(m[3])} of annual leave unused — please plan your time off.`],
  [/^⏰ 審核提醒（第 (\d+) 次）$/, m => `⏰ Review reminder (#${m[1]})`],
  [/^已經等待您審核 (\d+) 小時，請盡快處理。$/, m => `It has been waiting for your review for ${m[1]} hours. Please handle it soon.`],
  [/^(\S+) 的(補打卡|特休|補休|事假|家庭照顧假|病假|生理假|婚假|喪假|公假|公傷病假|產假|產檢假|安胎休養|陪產檢及陪產假|育嬰留停|加班|請假)([\s\S]*)$/, (m, tr) => `${m[1]}'s ${tr(m[2] + m[3]).replace(/^./, c => c.toLowerCase())}`],
  [/^(請假|審核|WeiWork|完整行事曆)：(https?:\/\/\S+)$/, m => `${{ 請假: "Request leave", 審核: "Review", WeiWork: "WeiWork", 完整行事曆: "Full calendar" }[m[1]]}: ${m[2]}`],
  // 前面有圖示的句子：圖示保留，後面翻譯
  [/^(👉|⏳|📤|✅|❌|🚫|📍|👥) ?([\s\S]+)$/u, (m, tr) => `${m[1]} ${tr(m[2])}`],
  // 姓名（員工編號）
  [/^([^\s（）：]{1,20})（([A-Za-z0-9_-]{1,20})）$/, m => `${m[1]} (${m[2]})`],
];

// 句子裡的常用詞（上面都對不到時才用）
export const WORDS = {
  "颱風停班": "typhoon closure", "颱風假": "typhoon day off", "颱風": "typhoon", "停班停課": "office closed", "停班": "office closed", "公司休假": "company holiday", "公司旅遊": "company trip",
  "特休": "annual leave", "補休": "comp time", "事假": "personal leave", "病假": "sick leave", "請假": "leave", "加班": "overtime",
  "補打卡": "correction", "上班": "in", "下班": "out", "外勤": "field", "內勤": "office", "遲到": "late", "早退": "left early",
  "已核准": "approved", "審核中": "pending", "已駁回": "rejected", "已取消": "cancelled",
  "國定假日": "public holiday", "放假": "day off", "補假": "make-up holiday", "補班": "make-up workday", "紀念日": "Memorial Day",
  "唯修科技": "WEIXIU", "傳創機電": "Chuan Chuang", "唯校中心": "Smile Verification",
  "主官": "chief", "副主官": "deputy chief", "直屬主管": "supervisor", "管理員": "administrator",
};

// ===== 翻譯算法（網站和 LINE 通知服務共用）=====
// 順序：整句對照 → 有變數的句子 → 常用詞逐一替換，最後把全形標點換成英文標點
export function makeTr(onMissing) {
  const CJK = /[\u3400-\u9fff]/;
  const NEED = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;   // 中文字或全形標點
  const list = Object.keys(WORDS).sort((a, b) => b.length - a.length);
  const wordRe = new RegExp(list.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const punct = s => s
    .replace(/（(日|一|二|三|四|五|六)）/g, (_, w) => ` (${W7[w]}) `)
    .replace(/(\d+(?:\.\d+)?)\s*小時/g, (_, n) => `${n} h`)
    .replace(/(\d+(?:\.\d+)?)\s*天/g, (_, n) => days(n))
    .replace(/(\d+)\s*分(?:鐘)?/g, "$1 min")
    .replace(/，/g, ", ").replace(/。/g, ". ").replace(/：/g, ": ").replace(/；/g, "; ").replace(/、/g, ", ")
    .replace(/（/g, " (").replace(/）/g, ")").replace(/「/g, "“").replace(/」/g, "”").replace(/＋/g, "+").replace(/・/g, " · ").replace(/\u3000/g, "  ")
    .replace(/～/g, " ~ ").replace(/！/g, "! ").replace(/？/g, "? ").replace(/＠/g, " @ ")
    .replace(/ {2,}/g, " ").replace(/ ([,.:;)])/g, "$1").replace(/\( /g, "(");
  function core(s) {
    if (Object.prototype.hasOwnProperty.call(EXACT, s)) return EXACT[s];
    for (const [re, f] of PATS) {
      const m = s.match(re);
      if (m) return f(m, tr);
    }
    const out = punct(s.replace(wordRe, w => ` ${WORDS[w]} `)).replace(/ {2,}/g, " ").trim();
    if (CJK.test(out) && onMissing) onMissing(s);
    return out;
  }
  function tr(s) {
    if (s == null) return s;
    s = String(s);
    if (!NEED.test(s)) return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    return lead + core(s.trim()) + trail;
  }
  return tr;
}

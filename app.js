const root = document.querySelector("#app");
const config = window.FAMILY_DAYS_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabasePublishableKey);

const state = {
  date: startOfDay(new Date()),
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  entries: {},
  client: null,
  user: null,
  household: null,
  members: [],
  mode: "preview",
  authMode: "signup",
  error: "",
  loading: false,
  dialog: ""
};

const seed = {
  water: 1500,
  bedtime: "21:30",
  foods: ["蛋白质", "主食"],
  activities: ["跳舞"],
  homework: [{ id: "hw-seed", title: "数学练习册第 5 页" }],
  codingProblems: 3,
  internships: [{ id: "in-seed", title: "设计实习 · Example Studio" }]
};

function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function parseKey(key) { const [y,m,d] = key.split("-").map(Number); return new Date(y,m-1,d); }
function entryFor(date = state.date) { return state.entries[dateKey(date)] || { water: 0, bedtime: "", foods: [], activities: [], homework: [], codingProblems: 0, internships: [] }; }
function escapeHTML(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function monthLabel(date) { return date.toLocaleDateString("zh-CN", { year:"numeric", month:"long" }); }
function dateLabel(date) { return date.toLocaleDateString("zh-CN", { month:"long", day:"numeric", weekday:"long" }); }
function sameDay(a,b) { return dateKey(a) === dateKey(b); }
function isToday(date) { return sameDay(date, new Date()); }
function persistLocal() { localStorage.setItem("family-days-entries", JSON.stringify(state.entries)); }
function loadLocal() { try { return JSON.parse(localStorage.getItem("family-days-entries") || "{}"); } catch { return {}; } }
function setEntry(date, patch) {
  const key = dateKey(date);
  const current = entryFor(date);
  state.entries[key] = { ...current, ...patch };
  persistLocal();
  render();
  if (state.mode === "cloud" && state.household) saveCloudEntry(key, state.entries[key]);
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

async function initCloud() {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    state.client = createClient(config.supabaseUrl, config.supabasePublishableKey);
    const { data: { session }, error } = await state.client.auth.getSession();
    if (error) throw error;
    state.user = session?.user || null;
    state.mode = "cloud";
    if (state.user) await afterSignIn();
    else render();
    state.client.auth.onAuthStateChange((_event, sessionValue) => {
      state.user = sessionValue?.user || null;
      queueMicrotask(async () => {
        if (state.user) await afterSignIn();
        else { state.household = null; state.members = []; render(); }
      });
    });
  } catch (error) {
    state.error = "无法连接共享空间，请检查 Supabase 设置或网络。";
    console.error(error);
    render();
  }
}

async function afterSignIn() {
  state.loading = true; state.error = ""; render();
  try {
    const displayName = state.user.user_metadata?.display_name || state.user.email?.split("@")[0] || "家庭成员";
    const { error: profileError } = await state.client.from("profiles").upsert({ id: state.user.id, display_name: displayName });
    if (profileError) throw profileError;
    const { data, error } = await state.client.from("household_members").select("household_id, role, households(id, name)").eq("user_id", state.user.id).limit(1).maybeSingle();
    if (error) throw error;
    state.household = data?.households || null;
    if (state.household) {
      await loadCloudEntries();
      await loadMembers();
      subscribeToChanges();
    }
  } catch (error) {
    state.error = error.message || "加载家庭日历失败。";
  } finally { state.loading = false; render(); }
}

async function loadCloudEntries() {
  const { data, error } = await state.client.from("day_entries").select("day, payload").eq("household_id", state.household.id);
  if (error) throw error;
  const remote = Object.fromEntries((data || []).map(row => [row.day, row.payload]));
  state.entries = remote;
  persistLocal();
}

async function loadMembers() {
  const { data, error } = await state.client.from("household_members").select("role, profiles(display_name)").eq("household_id", state.household.id);
  if (error) throw error;
  state.members = (data || []).map(item => ({ role:item.role, name:item.profiles?.display_name || "家庭成员" }));
}

let channel;
function subscribeToChanges() {
  if (channel) state.client.removeChannel(channel);
  channel = state.client.channel(`household-${state.household.id}`).on("postgres_changes", {
    event:"*", schema:"public", table:"day_entries", filter:`household_id=eq.${state.household.id}`
  }, payload => {
    const row = payload.new;
    if (row?.day && row.payload) {
      state.entries[row.day] = row.payload; persistLocal(); render();
    }
  }).subscribe();
}

async function saveCloudEntry(day, payload) {
  const { error } = await state.client.from("day_entries").upsert({
    household_id: state.household.id, day, payload, updated_by: state.user.id, updated_at: new Date().toISOString()
  }, { onConflict:"household_id,day" });
  if (error) { state.error = `同步失败：${error.message}`; render(); }
}

function render() {
  if (!cloudEnabled) {
    state.entries = { ...seedEntries(), ...loadLocal() };
    renderApp();
  } else if (!state.user) renderAuth();
  else if (state.loading) root.innerHTML = `<div class="shell"><div class="loading">正在打开你们的家庭日历…</div></div>`;
  else if (!state.household) renderSetup();
  else renderApp();
  if (state.dialog) renderDialog();
  bindEvents();
}

function seedEntries() { return { [dateKey(new Date())]: seed }; }
function ownerHeader() {
  const name = state.mode === "preview" ? "家庭账号" : (state.members[0]?.name || "家庭账号");
  return `<span class="avatar" aria-label="${escapeHTML(name)}，家庭共用账号">👩‍👧</span><span class="owners-label">${state.mode === "preview" ? "妈妈和女儿 · 共用账号" : "家庭账号 · 多设备共用"}</span>`;
}

function renderApp() {
  const date = state.date;
  const e = entryFor(date);
  root.innerHTML = `<main class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">🌼</div><div><div class="brand-name">小小日常</div><div class="brand-sub">把每天的努力，都记下来</div></div></div>
      <div class="top-actions"><span class="sync-label"><i class="sync-dot ${state.mode === "cloud" ? "online" : ""}"></i>${state.mode === "cloud" ? "家庭空间已连接" : "本机预览"}</span><div class="owners">${ownerHeader()}</div>${state.mode === "cloud" ? `<button class="btn btn-outline" data-action="signout">退出</button>` : ""}</div>
    </header>
    ${state.error ? `<div class="error">${escapeHTML(state.error)}</div>` : ""}
    <div class="layout">
      ${renderSidebar()}
      <section class="content">
        <div class="day-toolbar"><div class="date-heading"><div><h1>${isToday(date)?"今天":date.toLocaleDateString("zh-CN",{month:"long",day:"numeric"})}</h1><p>${dateLabel(date)}</p></div><button class="today-btn" data-action="today">回到今天</button></div><div class="day-nav"><button data-action="prev-day" aria-label="前一天">‹</button><button data-action="next-day" aria-label="后一天">›</button></div></div>
        ${renderWeekStrip()}
        <section class="welcome"><div class="welcome-emoji">🌷</div><div class="welcome-copy"><strong>${isToday(date)?"今天也为自己做一点点吧":"给这一天留一份记录"}</strong><p>每一点小小的坚持，都会慢慢长大</p></div><span class="welcome-spark">✦</span></section>
        <div class="cards-grid">
          ${renderWater(e)}${renderSleep(e)}${renderFood(e)}${renderActivity(e)}${renderCoding(e)}${renderListCard("homework", "今天的作业", "一件一件完成就很棒", "📚", e.homework || [])}${renderListCard("internships", "实习投递", "记录今天想申请的机会", "➤", e.internships || [])}
        </div>
        <div class="footer-note">一点一点，照顾好自己 🌷</div>
      </section>
    </div>
  </main>`;
}

function renderSidebar() {
  const date = state.date;
  const monthStart = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
  const start = new Date(monthStart); start.setDate(1 - ((monthStart.getDay()+6)%7));
  const dayButtons = Array.from({length:42}, (_,index) => {
    const d = new Date(start); d.setDate(start.getDate()+index);
    const cls = ["month-day", d.getMonth()!==state.month.getMonth()?"muted":"", sameDay(d,date)?"selected":"", isToday(d)?"today":""].filter(Boolean).join(" ");
    return `<button class="${cls}" data-date="${dateKey(d)}" aria-label="${dateLabel(d)}">${d.getDate()}</button>`;
  }).join("");
  const members = state.mode === "preview" ? [{name:"家庭账号"}] : state.members;
  return `<aside class="side">
    <div class="side-head"><h2>日历</h2><button class="icon-btn" data-action="today" aria-label="跳到今天">⌂</button></div>
    <div class="month-nav"><span class="month-title">${monthLabel(state.month)}</span><div class="month-arrows"><button data-action="prev-month" aria-label="上个月">‹</button><button data-action="next-month" aria-label="下个月">›</button></div></div>
    <div class="month-grid">${["一","二","三","四","五","六","日"].map(day=>`<span class="weekday">${day}</span>`).join("")}${dayButtons}</div>
    <div class="side-divider"></div>
    <div class="side-label"><span>家庭账号</span><span>两台设备共用</span></div>
    ${members.map(member=>`<div class="member-card"><span class="member-face">👩‍👧</span><span class="member-copy"><strong>${escapeHTML(member.name)}</strong><small>${state.mode === "cloud" ? "同一账号登录的设备可同步" : "妈妈和女儿共用一个登录"}</small></span><span class="co-owner">共用账号</span></div>`).join("")}
    ${state.mode === "cloud" ? `<div class="invite-box"><strong>在另一台设备上查看</strong><p>打开同一个网站，用这个家庭账号登录即可同步日记。</p></div>` : `<div class="invite-box"><strong>在两台设备上同步记录</strong><p>连接云端后，用同一个账号登录就能查看和编辑日历。</p><button class="btn btn-subtle" data-action="connect">设置云端同步</button></div>`}
  </aside>`;
}

function renderWeekStrip() {
  const monday = new Date(state.date); monday.setDate(state.date.getDate()-((state.date.getDay()+6)%7));
  return `<div class="week-strip">${Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);const cls=["week-day",sameDay(d,state.date)?"active":"",state.entries[dateKey(d)]?"has-data":""].filter(Boolean).join(" ");return `<button class="${cls}" data-date="${dateKey(d)}"><small>${d.toLocaleDateString("zh-CN",{weekday:"short"})}</small><strong>${d.getDate()}</strong></button>`;}).join("")}</div>`;
}

const cardHeader = (icon,title,subtitle,iconColor) => `<div class="card-heading"><span class="card-icon" style="background:${iconColor}">${icon}</span><div><div class="card-title">${title}</div><div class="card-subtitle">${subtitle}</div></div></div>`;
function renderWater(e) {
  const values = [[500,"500ml"],[1000,"1000ml"],[1500,"1500ml"],[2000,"1500ml以上"]];
  return `<section class="entry-card wide">${cardHeader("💧","今天喝了多少水？","记得给身体补充水分","#edf6ff")}<div class="water-options">${values.map(([amount,label])=>`<button class="water-option ${e.water===amount?"selected":""}" data-action="water" data-value="${amount}" aria-pressed="${e.water===amount}"><span class="water-icon">${e.water===amount?"💧":"♧"}</span>${label}</button>`).join("")}</div></section>`;
}
function renderSleep(e) {
  return `<section class="entry-card">${cardHeader("☾","几点睡觉？","早点休息哦","#f1eff9")}<div class="sleep-row"><input class="sleep-time" type="time" aria-label="选择睡觉时间" value="${escapeHTML(e.bedtime || "")}" data-field="bedtime"><span class="sleep-note">${e.bedtime?`记录为 ${escapeHTML(e.bedtime)}`:"选择一个时间"}</span></div></section>`;
}
function renderFood(e) {
  const foods=["蛋白质","青菜","主食"];
  return `<section class="entry-card">${cardHeader("♧","吃得均衡吗？","今天吃了这些","#edf7f0")}<div class="check-list">${foods.map(food=>`<label class="check-item"><input type="checkbox" data-set="foods" value="${food}" ${e.foods.includes(food)?"checked":""}>${food}</label>`).join("")}</div></section>`;
}
function renderActivity(e) {
  const items=["跳舞","走路"];
  return `<section class="entry-card">${cardHeader("🏃","今天动起来了吗？","喜欢的运动都算数","#fff4e9")}<div class="activity-list">${items.map(activity=>`<label class="activity-option"><input type="checkbox" data-set="activities" value="${activity}" ${e.activities.includes(activity)?"checked":""}>${activity}</label>`).join("")}</div></section>`;
}
function renderCoding(e) {
  return `<section class="entry-card">${cardHeader("&lt;/&gt;","编程练习","今天刷了几道题？","#edf7f4")}<div class="coding-row"><div class="coding-number"><strong>${e.codingProblems||0}</strong><span>道题</span></div><div class="stepper"><button data-action="coding-minus" aria-label="减少一道题">−</button><button data-action="coding-plus" aria-label="增加一道题">+</button></div></div></section>`;
}
function renderListCard(kind,title,subtitle,icon,items) {
  const rows=items.map(item=>`<div class="list-row"><span class="bullet">${kind==="homework"?"○":"➤"}</span><span class="item-name">${escapeHTML(item.title)}</span><button class="remove" data-action="remove-item" data-kind="${kind}" data-id="${escapeHTML(item.id)}" aria-label="删除${escapeHTML(item.title)}">×</button></div>`).join("");
  const iconColor=kind==="homework"?"#f1eff9":"#fff1e8";
  return `<section class="entry-card wide ${kind}">${cardHeader(icon,title,subtitle,iconColor)}<div class="list-items">${rows}</div><form class="add-row" data-form="${kind}"><input type="text" name="title" aria-label="${kind==="homework"?"添加作业":"添加实习投递"}" placeholder="${kind==="homework"?"添加一项作业":"添加公司或岗位"}" maxlength="100"><button class="add-btn" type="submit" aria-label="添加">+</button></form></section>`;
}

function renderAuth() {
  root.innerHTML = `<main class="shell"><section class="auth-wrap"><div class="auth-card"><div class="brand"><div class="brand-mark">🌼</div><div><div class="brand-name">小小日常</div><div class="brand-sub">你和女儿的家庭日历</div></div></div><h2>${state.authMode==="signup"?"创建你们的账号":"欢迎回来"}</h2><p class="brand-sub">使用各自的账号登录，共同记录和查看每一天。</p><div class="auth-tabs"><button class="${state.authMode==="signup"?"active":""}" data-action="auth-signup">注册</button><button class="${state.authMode==="login"?"active":""}" data-action="auth-login">登录</button></div><form id="auth-form"><label class="field-label">称呼</label><input class="text-field" name="displayName" autocomplete="name" placeholder="例如：妈妈" ${state.authMode==="login"?"hidden":"required"}><label class="field-label">邮箱</label><input class="text-field" type="email" name="email" autocomplete="email" required placeholder="you@example.com"><label class="field-label">密码</label><input class="text-field" type="password" name="password" autocomplete="${state.authMode==="signup"?"new-password":"current-password"}" required minlength="8" placeholder="至少 8 位"><div class="error">${escapeHTML(state.error)}</div><button class="btn btn-primary" style="width:100%;margin-top:15px" type="submit">${state.authMode==="signup"?"创建账号":"登录"}</button></form></div></section></main>`;
}

function renderSetup() {
  root.innerHTML = `<main class="shell"><section class="auth-wrap"><div class="auth-card"><div class="brand"><div class="brand-mark">🌼</div><div><div class="brand-name">小小日常</div><div class="brand-sub">你和女儿的家庭日历</div></div></div><h2>创建你们的日历</h2><p class="brand-sub">创建一次家庭空间后，在另一台设备上用同一个账号登录即可同步，不需要邀请码。</p><button class="btn btn-primary" style="width:100%;margin-top:18px" data-action="create-house">创建家庭日历</button>${state.error?`<p class="error">${escapeHTML(state.error)}</p>`:""}<button class="btn btn-outline" style="width:100%;margin-top:10px" data-action="signout">退出账号</button></div></section></main>`;
}

function renderDialog() {
  const existing = document.querySelector(".overlay"); if (existing) existing.remove();
  let content="";
  if (state.dialog === "create") content=`<h2>创建家庭日历</h2><p>创建一次后，在你和女儿的设备上用同一个账号登录，就能同步记录。</p><form id="create-form"><label class="field-label">日历名称</label><input class="text-field" name="name" required maxlength="60" placeholder="例如：我们的日常" value="我们的日常"><div class="dialog-actions"><button type="button" class="btn btn-outline" data-action="close-dialog">取消</button><button class="btn btn-primary" type="submit">创建日历</button></div></form>`;
  else content=`<h2>连接云端同步</h2><p>此网站现在以本机预览模式运行。要让两台设备同步日记，需要先创建 Supabase 项目，并配置网站的连接信息。</p><div class="dialog-actions"><button type="button" class="btn btn-primary" data-action="close-dialog">知道了</button></div>`;
  root.insertAdjacentHTML("beforeend",`<div class="overlay" role="presentation"><section class="dialog" role="dialog" aria-modal="true">${content}</section></div>`);
}

function bindEvents() {
  root.querySelectorAll("[data-date]").forEach(button=>button.addEventListener("click",()=>{state.date=parseKey(button.dataset.date);state.month=new Date(state.date.getFullYear(),state.date.getMonth(),1);render();}));
  root.querySelectorAll("[data-action]").forEach(button=>button.addEventListener("click",()=>handleAction(button)));
  root.querySelectorAll("[data-set]").forEach(input=>input.addEventListener("change",()=>{
    const current=entryFor(); const values=new Set(current[input.dataset.set]||[]);
    input.checked?values.add(input.value):values.delete(input.value);
    setEntry(state.date,{[input.dataset.set]:[...values]});
  }));
  root.querySelectorAll("[data-field]").forEach(input=>input.addEventListener("change",()=>setEntry(state.date,{[input.dataset.field]:input.value})));
  root.querySelectorAll("[data-form]").forEach(form=>form.addEventListener("submit",event=>{
    event.preventDefault();const input=form.elements.title;const title=input.value.trim();if(!title)return;
    const key=form.dataset.form;const items=[...entryFor()[key],{id:uid(),title}];setEntry(state.date,{[key]:items});
  }));
  root.querySelector("#auth-form")?.addEventListener("submit",submitAuth);
  root.querySelector("#create-form")?.addEventListener("submit",createHousehold);
}

async function handleAction(button) {
  const action=button.dataset.action;
  if(action==="prev-day"||action==="next-day") {const d=new Date(state.date);d.setDate(d.getDate()+(action==="prev-day"?-1:1));state.date=d;state.month=new Date(d.getFullYear(),d.getMonth(),1);render();}
  else if(action==="prev-month"||action==="next-month") {state.month=new Date(state.month.getFullYear(),state.month.getMonth()+(action==="prev-month"?-1:1),1);render();}
  else if(action==="today") {state.date=startOfDay(new Date());state.month=new Date(state.date.getFullYear(),state.date.getMonth(),1);render();}
  else if(action==="water") setEntry(state.date,{water:Number(button.dataset.value)});
  else if(action==="coding-minus"||action==="coding-plus") setEntry(state.date,{codingProblems:Math.max(0,(entryFor().codingProblems||0)+(action==="coding-plus"?1:-1))});
  else if(action==="remove-item") {const key=button.dataset.kind;setEntry(state.date,{[key]:entryFor()[key].filter(item=>item.id!==button.dataset.id)});}
  else if(action==="connect") {state.dialog="connect";render();}
  else if(action==="create-house") {state.dialog="create";render();}
  else if(action==="close-dialog") {state.dialog="";render();}
  else if(action==="auth-signup"||action==="auth-login") {state.authMode=action==="auth-signup"?"signup":"login";state.error="";render();}
  else if(action==="signout") {await state.client?.auth.signOut();state.user=null;state.household=null;state.members=[];render();}
}

async function submitAuth(event) {
  event.preventDefault();state.error="";const form=new FormData(event.currentTarget);
  const email=String(form.get("email")).trim();const password=String(form.get("password"));const displayName=String(form.get("displayName")||"").trim();
  const result=state.authMode==="signup"?await state.client.auth.signUp({email,password,options:{data:{display_name:displayName||"家庭成员"}}}):await state.client.auth.signInWithPassword({email,password});
  if(result.error) {state.error=result.error.message;render();}
  else if(state.authMode==="signup"&&!result.data.session) {state.error="账号已创建。请先到邮箱确认注册，再回来登录。";render();}
}

async function createHousehold(event) {
  event.preventDefault();const name=String(new FormData(event.currentTarget).get("name")).trim();state.loading=true;render();
  const {data,error}=await state.client.rpc("create_household",{household_name:name});
  state.loading=false;
  if(error) {state.error=error.message;state.dialog="";render();return;}
  state.household={id:data,name};state.dialog="";await afterSignIn();
}

if(cloudEnabled) initCloud();
else { state.entries=loadLocal(); render(); }

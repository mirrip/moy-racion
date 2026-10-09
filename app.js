/* «Мой рацион» — MVP. Все данные хранятся в браузере. */
(() => {
'use strict';
const KEY = 'moy-racion-v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const r0 = n => Math.round(n), r1 = n => Math.round(n * 10) / 10;

/* ---------- Нормы (из отчёта) ---------- */
const PAL = [[1.4,'Очень низкая — сидячая работа'],[1.6,'Низкая — 2–3 тренировки в неделю'],[1.75,'Средняя — на ногах, 4–5 тренировок'],[1.9,'Высокая — физический труд'],[2.2,'Очень высокая — спорт дважды в день']];
const GOALS = {keep:['Поддержание',0,1.2],loss:['Снижение веса',-0.2,1.8],gain:['Набор мышц',0.1,1.8]};
const PATTERNS = {
  3:[['b','Завтрак',30,33.3],['l','Обед',40,33.4],['d','Ужин',30,33.3]],
  4:[['b','Завтрак',25,30],['l','Обед',35,30],['s','Перекус',10,10],['d','Ужин',30,30]],
  5:[['b','Завтрак',25,27],['s','Перекус',10,10],['l','Обед',30,26],['s','Перекус',10,10],['d','Ужин',25,27]]
};
const MICRO = {vc:['Витамин C','мг'],va:['Витамин A','мкг'],ca:['Кальций','мг'],fe:['Железо','мг'],mg:['Магний','мг'],k:['Калий','мг'],b12:['Витамин B12','мкг'],d:['Витамин D','мкг'],fol:['Фолаты','мкг'],n3:['Омега-3','г']};
function microNorm(p, profile) {
  const m = p.sex === 'm', old = p.age > 50, ru = profile === 'RU';
  return {
    vc: ru ? 100 : (m ? 90 : 75), va: ru ? (m ? 900 : 800) : (m ? 900 : 700),
    ca: (!m && old) || p.age > 70 ? 1200 : 1000,
    fe: ru ? (m ? 10 : (old ? 10 : 18)) : (m || old ? 8 : 18),
    mg: ru ? 420 : (m ? 410 : 315), k: ru ? 3500 : (m ? 3400 : 2600),
    b12: 2.4, d: p.age > 70 ? 20 : 15, fol: 400, n3: m ? 1.6 : 1.1
  };
}
function personTargets(p, goal) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const g = GOALS[p.goal || goal] || GOALS.keep;
  let E = bmr * (+p.activity || 1.6) * (1 + g[1]);
  E = Math.max(E, p.sex === 'm' ? 1500 : 1200);
  const bmi = p.weight / Math.pow(p.height / 100, 2);
  const W = bmi >= 30 ? 25 * Math.pow(p.height / 100, 2) : p.weight;
  let pk = g[2]; if (p.age >= 65 && pk < 1.3) pk = 1.3;
  let P = W * pk; if (P * 4 > 0.35 * E) P = 0.35 * E / 4;
  let F = 0.30 * E / 9, C = (E - 4 * P - 9 * F) / 4;
  if (C < 130) { F = 0.25 * E / 9; C = (E - 4 * P - 9 * F) / 4; }
  const fib = Math.max(25, 14 * E / 1000);
  return {E, P, F, C, fib, W, pk, sat: 0.1 * E / 9, sugar: 0.1 * E / 4};
}

/* ---------- Состояние ---------- */
const defaults = () => ({
  theme: 'dark', accent: 'gold', onboarded: false,
  people: [],
  settings: {meals: 4, mealsAuto: false, planLen: 7, maxRepeat: 2, norms: 'NASEM', diet: 'all', forbidden: [], medical: {}, apiKey: '', apiUrl: '', apiModel: ''},
  marks: {like: [], dislike: [], allergy: []},
  collect: {budget: 6000, desired: [], homeOn: false, home: [], diff: ['1-3','3-7'], maxTime: 0, cook2: false, cuisine: ''},
  plan: null, feed: null, lastWeek: null,
  shop: {checked: {}, group: false, range: 'all'},
  ui: {tab: 'plan', day: 0, open: {}, set: null}
});
let S;
try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = defaults(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

/* ---------- Даты ---------- */
const DOW = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const MON = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
function cycleStart(len) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  if (len === 3) return iso(t);
  const dow = t.getDay(); // 2 = вторник
  if (dow === 1) { t.setDate(t.getDate() + 1); return iso(t); }
  t.setDate(t.getDate() - ((dow - 2 + 7) % 7));
  return iso(t);
}
const todayIdx = () => S.plan ? Math.round((new Date(iso(new Date()) + 'T12:00:00') - new Date(S.plan.start + 'T12:00:00')) / 864e5) : 0;

/* ---------- Расчёт блюда ---------- */
function resolveDish(d) {
  return {id: d.id, name: d.name, types: d.types, time: d.time, diff: d.diff, cuisine: d.cuisine, rare: !!d.rare, steps: d.steps, salt: d.salt || 0, src: d.src || 'base',
    ing: d.ing.map(([id, g]) => Object.assign({}, ING[id], {g}))};
}
function nut(dish, factor = 1) {
  const t = {kcal:0,p:0,f:0,c:0,fib:0,na:0,g:0,price:0};
  Object.keys(MICRO).forEach(k => t[k] = 0);
  dish.ing.forEach(i => {
    const q = i.g * factor / 100;
    ['kcal','p','f','c','fib','na', ...Object.keys(MICRO)].forEach(k => t[k] += (i[k] || 0) * q);
    t.g += i.g * factor; t.price += (i.price || 0) * i.g * factor / 1000;
  });
  t.na += (dish.salt || 0) * factor * 390;
  return t;
}
const dishFlags = d => d.ing.map(i => i.flags || '').join('');
function allowedByDiet(d) {
  const fl = dishFlags(d), diet = S.settings.diet;
  if (diet === 'veg' && /[mf]/.test(fl)) return false;
  if (diet === 'vegan' && /[mfdeh]/.test(fl)) return false;
  if (diet === 'pesc' && /m/.test(fl)) return false;
  const bad = [...S.settings.forbidden, ...S.marks.allergy, ...S.marks.dislike].map(s => s.toLowerCase().trim()).filter(Boolean);
  if (bad.some(b => d.name.toLowerCase().includes(b) || d.ing.some(i => i.name.toLowerCase().includes(b)))) return false;
  if (S.marks.dislike.includes(d.name)) return false;
  return true;
}
const diffOk = d => { const r = S.collect.diff; if (!r.length) return true; return r.some(x => { const [a, b] = x.split('-').map(Number); return d.diff >= a && d.diff <= b; }); };

/* ---------- План и цели семьи ---------- */
function mealsCount() {
  if (!S.settings.mealsAuto) return S.settings.meals;
  const avg = S.people.reduce((s, p) => s + personTargets(p).pk, 0) / Math.max(1, S.people.length);
  return avg < 1.0 ? 3 : avg <= 1.5 ? 4 : 5;
}
const pattern = () => PATTERNS[S.plan ? S.plan.meals : mealsCount()];
function familyDay() {
  const t = {E:0,P:0,F:0,C:0,fib:0,sat:0,sugar:0};
  S.people.forEach(p => { const x = personTargets(p); Object.keys(t).forEach(k => t[k] += x[k]); });
  return t;
}
function portions(slotIdx) { // доля блюда на каждого человека
  const sh = pattern()[slotIdx][2] / 100;
  return S.people.map(p => ({id: p.id, name: p.name, kcal: personTargets(p).E * sh}));
}
function slotFactor(dish, slotIdx) { const base = nut(dish).kcal || 1; return portions(slotIdx).map(x => Math.min(2.5, Math.max(0.5, x.kcal / base))); }
const famFactor = (dish, slotIdx) => slotFactor(dish, slotIdx).reduce((a, b) => a + b, 0);

function newPlan() {
  const len = S.settings.planLen, meals = mealsCount();
  S.plan = {start: cycleStart(len), len, meals, days: Array.from({length: len}, () => ({slots: Array(meals).fill(null)}))};
  S.feed = null; S.shop.checked = {};
}
function rollWeek() {
  if (!S.plan) return;
  const end = addDays(S.plan.start, S.plan.len);
  if (iso(new Date()) >= end) { S.lastWeek = S.plan; S.plan = null; S.feed = null; save(); }
}

/* ---------- Подбор блюда ---------- */
function slotTarget(day, slotIdx) {
  const fam = familyDay(), pat = pattern(), dd = S.plan.days[day];
  let eatenP = 0, eatenF = 0, eatenFib = 0, eatenE = 0, remP = 0;
  pat.forEach((m, i) => { const sl = dd.slots[i];
    if (sl && i !== slotIdx) { const n = nut(sl.dish, famFactor(sl.dish, i)); eatenE += n.kcal; eatenP += n.p; eatenF += n.f; eatenFib += n.fib; }
    else remP += m[3]; });
  const sh = pat[slotIdx][2] / 100, remE = Math.max(1, fam.E - eatenE);
  const E = fam.E * sh;
  const P = Math.max(0, fam.P - eatenP) * (pat[slotIdx][3] / remP);
  const F = Math.max(0, fam.F - eatenF) * (E / remE);
  const fib = Math.max(0, fam.fib - eatenFib) * (E / remE);
  return {E, P, F, C: Math.max(0, (E - 4 * P - 9 * F) / 4), fib};
}
function countUses(name) { let n = 0; S.plan.days.forEach(d => d.slots.forEach(s => { if (s && s.dish.name === name) n++; })); return n; }
function scoreDish(d, tg) {
  const n = nut(d), k = n.kcal || 1, te = tg.E || 1;
  let s = Math.abs(n.p * 4 / k - tg.P * 4 / te) * 3 + Math.abs(n.f * 9 / k - tg.F * 9 / te) * 1.5 + Math.abs(n.fib / k - tg.fib / te) * 400;
  if (S.marks.like.includes(d.name)) s -= 0.08;
  if (S.collect.cuisine && d.cuisine !== S.collect.cuisine) s += 0.1;
  if (d.rare) s += 0.15;
  return s + Math.random() * 0.12;
}
function nearPenalty(name, day) { let s = 0; [[day, 2], [day - 1, 1], [day + 1, 1]].forEach(([d, w]) => { const dd = S.plan.days[d]; if (dd && dd.slots.some(x => x && x.dish.name === name)) s += w; }); return s; }
function candidates(day, slotIdx, seenNames) {
  const type = pattern()[slotIdx][0], maxT = +S.collect.maxTime || 0;
  return DISHES.map(resolveDish).filter(d => d.types.includes(type) && allowedByDiet(d) && diffOk(d) && (!maxT || d.time <= maxT)
    && countUses(d.name) < (d.rare ? 1 : S.settings.maxRepeat) && !seenNames.includes(d.name));
}
function desiredFor(slotIdx, seenNames) {
  const type = pattern()[slotIdx][0];
  for (const w of S.collect.desired) {
    const q = w.toLowerCase();
    if ([].concat(...S.plan.days.map(d => d.slots)).some(s => s && s.fromDesired && s.dish.name.toLowerCase().includes(q))) continue;
    const m = DISHES.map(resolveDish).find(d => d.name.toLowerCase().includes(q) && d.types.includes(type) && !seenNames.includes(d.name) && allowedByDiet(d));
    if (m) return m;
  }
  return null;
}
const SYSTEM_PROMPT = 'Ты подбираешь одно блюдо для семейного рациона. Отвечай только JSON без пояснений: {"name":str,"time":мин,"diff":1-10,"cuisine":str,"steps":[str],"ingredients":[{"name":str,"g":граммы на одну базовую порцию,"kcal":на100г,"p":,"f":,"c":,"fib":,"cat":"Овощи и фрукты|Крупы и хлеб|Мясо и рыба|Молочное и яйца|Бобовые и орехи|Масла и соусы","price":руб за кг}]}. Соблюдай целевые доли белка, жира, углеводов и клетчатки приёма, ограничения диеты и запреты. Добавленный сахар не более 10 г на приём, соль не более 2 г на порцию, без трансжиров и колбас.';
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
async function aiDish(day, slotIdx, tg, seenNames) {
  const st = S.settings; if (!st.apiKey) return null;
  const pat = pattern()[slotIdx];
  const ctx = {meal: pat[1], people: S.people.length, target_family: {kcal: r0(tg.E), protein_g: r0(tg.P), fat_g: r0(tg.F), carbs_g: r0(tg.C), fiber_g: r0(tg.fib)},
    diet: st.diet, forbidden: [...st.forbidden, ...S.marks.allergy], dislike: S.marks.dislike, liked: S.marks.like, not_these: seenNames, desired: S.collect.desired,
    difficulty: S.collect.diff, max_time_min: +S.collect.maxTime || null, cuisine: S.collect.cuisine || null, home_products: S.collect.homeOn ? S.collect.home : []};
  let lastErr;
  for (const model of GEMINI_MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(st.apiKey)}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({systemInstruction: {parts: [{text: SYSTEM_PROMPT}]}, contents: [{role: 'user', parts: [{text: JSON.stringify(ctx)}]}], generationConfig: {temperature: 0.9, responseMimeType: 'application/json'}})});
    if (res.status === 404) { lastErr = new Error('Модель не найдена'); continue; }
    if (!res.ok) throw new Error('Сервер ответил ' + res.status);
    const j = await res.json(); const txt = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map(p => p.text || '').join('');
    const o = JSON.parse(String(txt).replace(/^```json|```$/g, '').trim());
    if (!o.name || !Array.isArray(o.ingredients) || !o.ingredients.length) throw new Error('Неполный ответ');
    return {id: 'ai' + Date.now(), name: String(o.name), types: pat[0], time: +o.time || 30, diff: Math.min(10, Math.max(1, +o.diff || 3)), cuisine: o.cuisine || '', steps: (o.steps || []).map(String), salt: 1, src: 'ai',
      ing: o.ingredients.map((x, i) => ({id: 'ai' + i + '_' + String(x.name).toLowerCase(), name: String(x.name), cat: x.cat || 'Прочее', g: +x.g || 0, kcal: +x.kcal || 0, p: +x.p || 0, f: +x.f || 0, c: +x.c || 0, fib: +x.fib || 0, price: +x.price || 300, flags: '', unit: 'g'}))};
  }
  throw lastErr || new Error('Нет ответа');
}
async function nextCard() {
  const F = S.feed, key = F.day + '-' + F.slot;
  F.seen[key] = F.seen[key] || [];
  const seenNames = F.seen[key].map(d => d.name);
  const tg = slotTarget(F.day, F.slot);
  let dish = desiredFor(F.slot, seenNames), desired = !!dish;
  if (!dish) {
    try { dish = await aiDish(F.day, F.slot, tg, seenNames); } catch (e) { if (!F.aiWarned) { toast('Нейросеть недоступна: ' + e.message + '. Беру блюда из базы.'); F.aiWarned = true; } }
    if (!dish) { const c = candidates(F.day, F.slot, seenNames).map(d => [d, scoreDish(d, tg) + nearPenalty(d.name, F.day)]).sort((a, b) => a[1] - b[1]).map(x => x[0]); dish = c[0] || null; }
  }
  F.card = dish ? {dish, desired} : null;
  if (dish) F.seen[key].push(dish);
  save();
}

/* ---------- UI: общие ---------- */
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function sheet(html, onMount) {
  const el = $('#sheet'); $('#sheet-body').innerHTML = html; el.hidden = false; $('#sheet-body').scrollTop = 0; onMount && onMount($('#sheet-body'));
}
const closeSheet = () => { $('#sheet').hidden = true; };
function applyTheme() { const r = document.documentElement; if (S.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme); r.setAttribute('data-accent', S.accent || 'gold'); }
const IC = {
 plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5" fill="currentColor" fill-opacity=".14"/><path d="M3.5 10h17M8 3v4M16 3v4M8.5 14.5h3M8.5 17h6"/>',
 shop: '<path d="M5 8.5h14l-1.2 10.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" fill="currentColor" fill-opacity=".14"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
 collect: '<rect x="7" y="3.5" width="11" height="15" rx="2.6" fill="currentColor" fill-opacity=".14" transform="rotate(9 12.5 11)"/><rect x="5" y="5" width="11" height="15" rx="2.6"/><path d="M10.5 9.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z"/>',
 gear: '<path d="M12 2.8l1.6 2.3 2.7-.6.6 2.7 2.3 1.6-1.3 2.4 1.3 2.4-2.3 1.6-.6 2.7-2.7-.6L12 21.2l-1.6-2.3-2.7.6-.6-2.7-2.3-1.6L6.1 12 4.8 9.6l2.3-1.6.6-2.7 2.7.6z" fill="currentColor" fill-opacity=".14"/><circle cx="12" cy="12" r="3.2"/>',
 look: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.5-1-2.6 0-1 .8-1.7 1.9-1.7h2.1a3.7 3.7 0 0 0 3.7-3.7C20.5 6.7 16.7 3.5 12 3.5z" fill="currentColor" fill-opacity=".14"/><circle cx="8" cy="10.5" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/>',
 family: '<circle cx="9" cy="8.5" r="3.2" fill="currentColor" fill-opacity=".14"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3.5 19.5c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2M14.6 14.7a4.6 4.6 0 0 1 1.9-.4c2.2 0 3.7 1.6 4 4.4"/>',
 dish: '<circle cx="12" cy="12" r="8.5" fill="currentColor" fill-opacity=".14"/><circle cx="12" cy="12" r="5"/><path d="M12 9.5v5M9.5 12h5" stroke-opacity=".6"/>',
 heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" fill="currentColor" fill-opacity=".14"/>',
 shield: '<path d="M12 3l7 2.8v5.5c0 4.5-3 7.8-7 9.7-4-1.9-7-5.2-7-9.7V5.8z" fill="currentColor" fill-opacity=".14"/><path d="M12 9v6M9 12h6"/>',
 key: '<circle cx="8" cy="15.5" r="4" fill="currentColor" fill-opacity=".14"/><path d="M11 12.5L19.5 4M16 7.5l2.5 2.5M13.8 9.7l2 2"/>',
 history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9M12 8v4.5l3 2"/>',
 data: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8" fill="currentColor" fill-opacity=".14"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
 chev: '<path d="M9 5l7 7-7 7"/>', back: '<path d="M15 5l-7 7 7 7"/>',
 leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" fill="currentColor" fill-opacity=".14"/><path d="M5 19l8-8"/>'
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
function appbar(title, sub, opts = {}) {
  return `<header class="appbar">${opts.back ? `<button class="iconbtn" data-back aria-label="Назад">${ic('back')}</button>` : ''}<div class="ab-t"><p class="eyebrow">${sub || 'Мой рацион'}</p><h2 class="gt">${title}</h2></div>${opts.back ? '' : `<button class="iconbtn" data-gear aria-label="Настройки">${ic('gear')}</button>`}</header>`;
}
const kbju = n => `<span class="k"><b>${r0(n.kcal)}</b> ккал</span><span>Б ${r0(n.p)}</span><span>Ж ${r0(n.f)}</span><span>У ${r0(n.c)}</span>`;

let lastView = '';
function render() {
  applyTheme(); rollWeek();
  const vk = (S.feed && S.feed.active) ? 'feed' : S.ui.tab + (S.ui.set || ''); if (vk !== lastView) { window.scrollTo(0, 0); lastView = vk; }
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.ui.tab ? 'page' : 'false'));
  const v = $('#view');
  if (!S.onboarded || !S.people.length) { v.innerHTML = viewOnboard(); bindOnboard(); $('#nav').hidden = true; return; }
  $('#nav').hidden = false;
  if (S.feed && S.feed.active) { v.innerHTML = viewFeed(); bindFeed(); $('#nav').hidden = true; return; }
  if (S.ui.tab === 'settings') $('#nav').hidden = true;
  ({plan: viewPlan, collect: viewCollect, shop: viewShop, settings: viewSettings})[S.ui.tab]();
}

/* ---------- Онбординг / форма человека ---------- */
function personForm(p = {}) {
  return `<div class="form">
  <label>Имя<input id="pf-name" value="${esc(p.name || '')}" placeholder="Например, Ярослав"></label>
  <div class="row2"><label>Пол<select id="pf-sex"><option value="m"${p.sex === 'm' ? ' selected' : ''}>Мужской</option><option value="f"${p.sex === 'f' ? ' selected' : ''}>Женский</option></select></label>
  <label>Возраст<input id="pf-age" type="number" inputmode="numeric" min="18" max="100" value="${p.age || 30}"></label></div>
  <div class="row2"><label>Рост, см<input id="pf-height" type="number" inputmode="numeric" min="130" max="230" value="${p.height || 175}"></label>
  <label>Вес, кг<input id="pf-weight" type="number" inputmode="decimal" min="35" max="250" value="${p.weight || 75}"></label></div>
  <label>Образ жизни<select id="pf-act">${PAL.map(([v, t]) => `<option value="${v}"${+p.activity === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
  <label>Цель<select id="pf-goal">${Object.entries(GOALS).map(([k, g]) => `<option value="${k}"${p.goal === k ? ' selected' : ''}>${g[0]}</option>`).join('')}</select></label>
  <p class="hint">Приложение рассчитано на взрослых 18+. Детские нормы появятся позже.</p></div>`;
}
function readPerson(id) {
  const age = +$('#pf-age').value;
  if (!$('#pf-name').value.trim()) { toast('Введите имя'); return null; }
  if (age < 18) { toast('Пока поддерживаются только взрослые 18+'); return null; }
  return {id: id || 'p' + Date.now(), name: $('#pf-name').value.trim(), sex: $('#pf-sex').value, age, height: +$('#pf-height').value, weight: +$('#pf-weight').value, activity: +$('#pf-act').value, goal: $('#pf-goal').value};
}
function viewOnboard() {
  return `<section class="onb"><div class="crest">${ic('leaf')}</div><p class="eyebrow">Мой рацион</p><h1 class="gt">Рацион на неделю, собранный под вашу семью</h1>
  <p class="lead">Расскажите о себе — по этим данным приложение рассчитает калории, белки, жиры, углеводы, клетчатку, витамины и минералы. Семью добавите позже в настройках.</p>
  ${personForm({sex: 'm'})}<button class="btn primary wide" id="onb-go">Начать</button></section>`;
}
function bindOnboard() { $('#onb-go').onclick = () => { const p = readPerson(); if (!p) return; S.people = [p]; S.onboarded = true; save(); render(); }; }

/* ---------- Рацион ---------- */
function viewPlan() {
  const v = $('#view');
  if (!S.plan) { v.innerHTML = `${appbar('Рацион', 'Неделя со вторника')}<div class="empty"><p class="eyebrow">Рацион не собран</p><h3>Неделя начинается со вторника</h3><p>В понедельник закупаетесь, со вторника идёте по плану. Соберите рацион — блюда появятся здесь по дням.</p><button class="btn primary wide" id="go-collect">Собрать рацион</button></div>`; $('#go-collect').onclick = () => { S.ui.tab = 'collect'; save(); render(); }; return; }
  const day = Math.min(S.ui.day, S.plan.len - 1), ti = todayIdx();
  const strip = S.plan.days.map((d, i) => { const ds = addDays(S.plan.start, i), dt = new Date(ds + 'T12:00:00'), filled = d.slots.filter(Boolean).length;
    return `<button class="daychip${i === day ? ' on' : ''}${i === ti ? ' today' : ''}" data-day="${i}"><span>${DOW[dt.getDay()]}</span><b>${dt.getDate()}</b><i>${filled ? filled + '/' + d.slots.length : '—'}</i></button>`; }).join('');
  const dd = S.plan.days[day], pat = pattern();
  const filled = dd.slots.some(Boolean);
  const meals = filled ? pat.map((m, i) => mealCard(day, i, m)).join('') : `<div class="empty"><h3>На этот день блюд нет</h3><p>Соберите рацион, чтобы заполнить день.</p><button class="btn primary wide" id="go-collect">Собрать рацион</button></div>`;
  const dt = new Date(addDays(S.plan.start, day) + 'T12:00:00');
  v.innerHTML = `${appbar('Рацион', `${S.plan.len} дн. · с ${new Date(S.plan.start + 'T12:00:00').getDate()} ${MON[new Date(S.plan.start + 'T12:00:00').getMonth()]}`)}
  <nav class="strip" aria-label="Дни">${strip}</nav>
  <p class="dayhint">${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]} · нажмите на день ещё раз — откроется паспорт дня</p>
  <div class="meals">${meals}</div>`;
  v.querySelectorAll('.daychip').forEach(b => b.onclick = () => { const i = +b.dataset.day; if (i === S.ui.day) dayPassport(i); else { S.ui.day = i; save(); render(); } });
  const gc = $('#go-collect'); if (gc) gc.onclick = () => { S.ui.tab = 'collect'; save(); render(); };
  v.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const k = b.dataset.open; S.ui.open[k] = !S.ui.open[k]; save(); render(); });
  v.querySelectorAll('[data-status]').forEach(b => b.onclick = () => { const [d, i, st] = b.dataset.status.split(':'); const sl = S.plan.days[d].slots[i]; sl.status = sl.status === st ? null : st; save(); render(); });
  v.querySelectorAll('[data-replace]').forEach(b => b.onclick = () => { const [d, i] = b.dataset.replace.split(':').map(Number); startFeed(d, i, true); });
  v.querySelectorAll('[data-more]').forEach(b => b.onclick = () => { const [d, i] = b.dataset.more.split(':').map(Number); dishDetails(d, i); });
  v.querySelectorAll('[data-portions]').forEach(b => b.onclick = () => { const [d, i] = b.dataset.portions.split(':').map(Number); portionSheet(d, i); });
}
function mealCard(day, i, m) {
  const sl = S.plan.days[day].slots[i];
  if (!sl) return `<article class="meal empty-meal"><p class="mtype">${m[1]}</p><p>Не выбрано</p><button class="btn ghost" data-replace="${day}:${i}">Подобрать</button></article>`;
  const d = sl.dish, ff = famFactor(d, i), n = nut(d, ff), key = day + '-' + i, open = S.ui.open[key];
  const ti = todayIdx();
  return `<article class="meal${open ? ' open' : ''}${sl.status ? ' st-' + sl.status : ''}">
   <button class="mhead" data-open="${key}" aria-expanded="${!!open}">
     <span class="mtype">${m[1]}${sl.status === 'eaten' ? ' · съедено' : sl.status === 'skipped' ? ' · пропущено' : ''}</span>
     <span class="mname">${esc(d.name)}</span>
     <span class="macro">${kbju(n)}</span>
     <span class="meta"><span>${r0(n.g)} г на всех</span><span>${d.time} мин</span><span>сложность ${d.diff}/10</span></span>
   </button>
   ${open ? `<div class="mbody">
     <h4>Ингредиенты на всех</h4><ul class="ing">${d.ing.map(x => `<li><span>${esc(x.name)}</span><b>${fmtAmt(x, x.g * ff)}</b></li>`).join('')}${d.salt ? `<li><span>Соль йодированная</span><b>${r1(d.salt * ff)} г</b></li>` : ''}</ul>
     <h4>Как готовить</h4><ol class="steps">${(d.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
     <div class="actions">
       <button class="btn ghost" data-portions="${day}:${i}">Порции по людям</button>
       <button class="btn ghost" data-more="${day}:${i}">Подробнее</button>
       <button class="btn ghost" data-replace="${day}:${i}">Заменить</button>
     </div>
     ${day <= ti ? `<div class="actions two"><button class="btn${sl.status === 'eaten' ? ' primary' : ' ghost'}" data-status="${day}:${i}:eaten">Съедено</button><button class="btn${sl.status === 'skipped' ? ' primary' : ' ghost'}" data-status="${day}:${i}:skipped">Пропущено</button></div>` : ''}
   </div>` : ''}
  </article>`;
}
function fmtAmt(i, g) {
  if (i.unit === 'pcs') return Math.max(1, Math.round(g / 55)) + ' шт';
  if (i.unit === 'ml') return r0(g) + ' мл';
  return r0(g) + ' г';
}
function portionSheet(day, i) {
  const d = S.plan.days[day].slots[i].dish, fs = slotFactor(d, i), tot = fs.reduce((a, b) => a + b, 0), base = nut(d);
  sheet(`<h3>Порции: ${esc(d.name)}</h3><p class="hint">Блюдо одно на всех, порции рассчитаны по нормам каждого.</p>
  <ul class="ing">${S.people.map((p, k) => `<li><span>${esc(p.name)}</span><b>${r0(fs[k] / tot * 100)}% · ${r0(base.g * fs[k])} г · ${r0(base.kcal * fs[k])} ккал</b></li>`).join('')}</ul>`);
}
function dishDetails(day, i) {
  const d = S.plan.days[day].slots[i].dish, ff = famFactor(d, i), n = nut(d, ff), mn = familyMicro(), sh = pattern()[i][2] / 100;
  const tops = Object.keys(MICRO).filter(k => n[k] >= mn[k] * sh * 1.3).map(k => MICRO[k][0]);
  const flags = []; if (n.d < mn.d * sh * 0.5) flags.push('витамин D обычно трудно набрать едой — его стоит обсудить с врачом');
  if (S.settings.diet === 'vegan') flags.push('при веганском питании нужен B12 в виде добавки');
  sheet(`<h3>${esc(d.name)}</h3><p class="hint">${d.src === 'ai' ? 'Подобрано нейросетью' : 'Из базы блюд приложения'} · ${esc(d.cuisine || '')} · ≈ ${r0(n.price / 10) * 10} ₽ на всех</p>
  <div class="grid4"><div><b>${r0(n.kcal)}</b><span>ккал</span></div><div><b>${r0(n.p)}</b><span>белки, г</span></div><div><b>${r0(n.f)}</b><span>жиры, г</span></div><div><b>${r0(n.c)}</b><span>углеводы, г</span></div></div>
  <p>Клетчатка ${r1(n.fib)} г · натрий ${r0(n.na)} мг</p>
  ${tops.length ? `<p class="good">Богато: ${tops.join(', ')}</p>` : ''}
  ${flags.length ? `<p class="hint">${flags.join('; ')}.</p>` : ''}`);
}
function familyMicro() { const t = {}; Object.keys(MICRO).forEach(k => t[k] = 0); S.people.forEach(p => { const m = microNorm(p, S.settings.norms); Object.keys(t).forEach(k => t[k] += m[k]); }); return t; }
function dayTotals(day) {
  const t = nut({ing: [], salt: 0});
  S.plan.days[day].slots.forEach((sl, i) => { if (!sl || sl.status === 'skipped') return; const n = nut(sl.dish, famFactor(sl.dish, i)); Object.keys(t).forEach(k => t[k] += n[k]); });
  return t;
}
function dayPassport(day) {
  const t = dayTotals(day), fam = familyDay(), mn = familyMicro();
  const tops = Object.keys(MICRO).map(k => [k, t[k] / mn[k]]).filter(x => x[1] >= 1.1).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => MICRO[x[0]][0]);
  const filled = S.plan.days[day].slots.filter(Boolean).length, all = S.plan.days[day].slots.length;
  const ok = filled === all && Math.abs(t.kcal / fam.E - 1) <= 0.12 && t.p >= fam.P * 0.9 && t.na <= 2000 * S.people.length * 1.0;
  const own = [].concat(...S.plan.days.map(d => d.slots)).filter(Boolean), ownShare = own.filter(s => s.fromDesired || s.manual).length / Math.max(1, own.length);
  const dt = new Date(addDays(S.plan.start, day) + 'T12:00:00');
  sheet(`<p class="eyebrow">Паспорт дня</p><h3>${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}</h3>
  <div class="grid4"><div><b>${r0(t.kcal)}</b><span>ккал</span></div><div><b>${r0(t.p)}</b><span>белки, г</span></div><div><b>${r0(t.f)}</b><span>жиры, г</span></div><div><b>${r0(t.c)}</b><span>углеводы, г</span></div></div>
  <p>Клетчатка ${r0(t.fib)} г на всех</p>
  ${filled < all ? `<p class="warn">День собран не полностью: ${filled} из ${all} приёмов.</p>` : ok ? '<p class="good">Рацион дня сбалансирован</p>' : '<p class="hint">Небольшие отклонения от нормы выравниваются за неделю.</p>'}
  ${ownShare > 0.5 ? '<p class="warn">Больше половины блюд недели выбраны вручную — баланс может отличаться от нормы.</p>' : ''}
  ${tops.length ? `<p class="small">Сегодня особенно много: ${tops.join(', ')}</p>` : ''}
  <details><summary>По людям</summary><ul class="ing">${S.people.map(p => { const x = personTargets(p); const sh = x.E / fam.E; return `<li><span>${esc(p.name)}</span><b>${r0(t.kcal * sh)} ккал · Б ${r0(t.p * sh)} г</b></li>`; }).join('')}</ul></details>`);
}

/* ---------- Сбор рациона ---------- */
function viewCollect() {
  const c = S.collect, st = S.settings, med = Object.values(st.medical).some(Boolean);
  const per = st.planLen === 7 ? 'неделю' : '3 дня';
  const started = S.plan && S.plan.days.some(d => d.slots.some(Boolean));
  const chipsList = (arr, attr) => arr.length ? `<div class="chips">${arr.map((w, i) => `<button class="chip x" data-${attr}="${i}">${esc(w)}</button>`).join('')}</div>` : '';
  $('#view').innerHTML = `${appbar('Сбор рациона', st.planLen === 7 ? 'Неделя со вторника' : 'Рацион на 3 дня')}
  ${med ? '<div class="warn box">Отмечено состояние здоровья, при котором автоматический рацион не подходит. Составьте питание вместе с врачом.</div>' : ''}
  <div class="panel">
   <label class="field"><span><em>Бюджет на ${per}, ₽</em><input id="c-budget" type="number" inputmode="numeric" min="0" step="100" value="${c.budget}"></span></label>
   <details class="field col"${c.extraOpen ? ' open' : ''} id="c-extra"><summary>Дополнительно</summary>
     <div class="sub-block"><em>Сложность блюд</em><div class="chips">${[['1-3','Просто · 1–3'],['3-7','Средне · 3–7'],['7-10','Шедевр · 7–10']].map(([r, t]) => `<button class="chip${c.diff.includes(r) ? ' on' : ''}" data-diff="${r}">${t}</button>`).join('')}</div></div>
     <div class="sub-block"><em>Время готовки одного блюда</em><div class="chips">${[[0,'Любое'],[15,'До 15 мин'],[30,'До 30 мин'],[60,'До часа']].map(([v, t]) => `<button class="chip${+c.maxTime === v ? ' on' : ''}" data-time="${v}">${t}</button>`).join('')}</div></div>
   </details>
  </div>
  <div class="panel gap">
   <div class="field col"><em>Желаемые блюда</em><div class="chipin"><input id="c-desired" placeholder="Например, борщ" enterkeyhint="done"><button class="btn ghost sm" id="c-desired-add">Добавить</button></div>${chipsList(c.desired, 'rmdes')}</div>
   <div class="field switch">${ic('shop')}<span><em>Есть продукты дома</em><small>Их не будет в списке покупок</small></span><button class="tog${c.homeOn ? ' on' : ''}" id="c-home-tog" role="switch" aria-checked="${c.homeOn}" aria-label="Есть продукты дома"><i></i></button></div>
   ${c.homeOn ? `<div class="field col"><div class="chipin"><input id="c-home" placeholder="Например, гречка" enterkeyhint="done"><button class="btn ghost sm" id="c-home-add">Добавить</button></div>${chipsList(c.home, 'rmhome')}</div>` : ''}
   <div class="field switch">${ic('dish')}<span><em>Готовить на 2 дня</em><small>Обед и ужин — одной готовкой</small></span><button class="tog${c.cook2 ? ' on' : ''}" id="c-cook2" role="switch" aria-checked="${c.cook2}" aria-label="Готовить на 2 дня"><i></i></button></div>
   <details class="field col"${c.moreOpen || c.cuisine ? ' open' : ''} id="c-more"><summary>Ещё параметры</summary>
     <div class="sub-block"><em>Кухня</em><div class="chips">${['','Русская','Средиземноморская','Европейская','Азиатская','Восточная'].map(x => `<button class="chip${c.cuisine === x ? ' on' : ''}" data-cuisine="${x}">${x || 'Любая'}</button>`).join('')}</div></div>
   </details>
  </div>
  ${S.plan ? '<button class="btn ghost wide reset" id="c-reset">Начать неделю заново</button>' : ''}
  <div class="cta"><button class="btn primary wide big" id="c-go"${med ? ' disabled' : ''}>${ic('collect')}<span>${started ? 'Продолжить сбор' : 'Собрать рацион'}</span></button></div>`;
  const bindList = (inp, btn, arr) => { const add = () => { const x = $(inp).value.trim(); if (!x) return; arr.push(x); save(); render(); }; $(btn).onclick = add; $(inp).onkeydown = e => { if (e.key === 'Enter') add(); }; };
  bindList('#c-desired', '#c-desired-add', c.desired);
  document.querySelectorAll('[data-rmdes]').forEach(b => b.onclick = () => { c.desired.splice(+b.dataset.rmdes, 1); save(); render(); });
  $('#c-home-tog').onclick = () => { c.homeOn = !c.homeOn; save(); render(); };
  if (c.homeOn) { bindList('#c-home', '#c-home-add', c.home); document.querySelectorAll('[data-rmhome]').forEach(b => b.onclick = () => { c.home.splice(+b.dataset.rmhome, 1); save(); render(); }); }
  document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => { const r = b.dataset.diff, k = c.diff.indexOf(r); k < 0 ? c.diff.push(r) : c.diff.splice(k, 1); save(); render(); });
  document.querySelectorAll('[data-time]').forEach(b => b.onclick = () => { c.maxTime = +b.dataset.time; save(); render(); });
  document.querySelectorAll('[data-cuisine]').forEach(b => b.onclick = () => { c.cuisine = b.dataset.cuisine; save(); render(); });
  $('#c-extra').ontoggle = e => { c.extraOpen = e.target.open; save(); };
  $('#c-more').ontoggle = e => { c.moreOpen = e.target.open; save(); };
  $('#c-budget').onchange = e => { c.budget = +e.target.value || 0; save(); };
  $('#c-cook2').onclick = () => { c.cook2 = !c.cook2; save(); render(); };
  $('#c-go').onclick = () => {
    if (!S.plan) newPlan();
    const first = firstEmpty();
    if (!first) { S.ui.tab = 'plan'; save(); render(); toast('Рацион уже собран. Заменить блюдо можно в разделе «Рацион».'); return; }
    keyDialog(() => startFeed(first[0], first[1], false));
  };
  const rs = $('#c-reset'); if (rs) rs.onclick = () => sheet(`<h3>Начать неделю заново?</h3><p>Все выбранные блюда этой недели будут удалены.</p><div class="actions two"><button class="btn ghost" id="rs-no">Отмена</button><button class="btn primary" id="rs-yes">Удалить и начать</button></div>`, b => { $('#rs-no', b).onclick = closeSheet; $('#rs-yes', b).onclick = () => { S.plan = null; S.feed = null; save(); closeSheet(); render(); }; });
}
function keyDialog(go) {
  const st = S.settings;
  sheet(`<div class="keyhead"><span class="medal big">${ic('key')}</span><div><p class="eyebrow">Перед подбором</p><h3>Ключ доступа</h3></div></div>
   <p class="hint">Ключ подключает нейросеть, которая подбирает блюда под нормы вашей семьи. Без ключа приложение работает в демо-режиме на встроенной базе блюд.</p>
   <input id="k-key" type="password" autocomplete="off" value="${esc(st.apiKey)}" placeholder="Вставьте ключ">
   <div class="actions two"><button class="btn ghost" id="k-demo">Демо без ключа</button><button class="btn primary" id="k-go">Начать подбор</button></div>`, b => {
    $('#k-demo', b).onclick = () => { st.apiKey = ''; save(); closeSheet(); go(); };
    $('#k-go', b).onclick = () => { st.apiKey = $('#k-key', b).value.trim(); save(); closeSheet(); if (!st.apiKey) toast('Ключ не введён — включён демо-режим'); go(); };
  });
}
function firstEmpty() { for (let d = 0; d < S.plan.len; d++) for (let i = 0; i < S.plan.meals; i++) if (!S.plan.days[d].slots[i]) return [d, i]; return null; }
const POOL_PER_SLOT = 5;
async function startFeed(day, slot, manual) {
  const total = S.plan.len * S.plan.meals;
  S.feed = Object.assign({seen: {}, used: {}, pool: total * 3, poolUsed: 0}, S.feed || {}, {active: true, day, slot, manual, card: null, loading: true, exhausted: false});
  const cur = S.plan.days[day].slots[slot]; if (cur) { const k = day + '-' + slot; S.feed.seen[k] = S.feed.seen[k] || []; if (!S.feed.seen[k].some(d => d.name === cur.dish.name)) S.feed.seen[k].push(cur.dish); }
  render(); await nextCard(); S.feed.loading = false; render();
}

/* ---------- Лента карточек ---------- */
function viewFeed() {
  const F = S.feed, pat = pattern(), m = pat[F.slot], key = F.day + '-' + F.slot, used = F.used[key] || 0;
  const dt = new Date(addDays(S.plan.start, F.day) + 'T12:00:00');
  const taken = S.plan.days[F.day].slots;
  let card;
  if (F.loading) card = `<div class="card loading"><p class="mtype">${m[1]}</p><p>Подбираю блюдо под оставшиеся нормы дня…</p></div>`;
  else if (F.exhausted) card = `<div class="card"><p class="mtype">${m[1]}</p><h3>Лимит карточек для этого приёма исчерпан</h3><p class="hint">Выберите из уже показанных или потратьте карточку из общего лимита недели (осталось ${Math.max(0, F.pool - F.poolUsed)}).</p><div class="actions"><button class="btn primary" id="f-pick">Выбрать из показанных</button><button class="btn ghost" id="f-pool">Использовать общий лимит</button></div></div>`;
  else if (!F.card) card = `<div class="card"><h3>Подходящих блюд больше нет</h3><p class="hint">Ослабьте фильтры сложности или времени, уберите часть запретов либо выберите из показанных.</p><button class="btn ghost" id="f-pick">Выбрать из показанных</button></div>`;
  else { const d = F.card.dish, ff = famFactor(d, F.slot), n = nut(d, ff);
    card = `<div class="card" id="card"><div class="ctop"><span class="mtype">${m[1]}${F.card.desired ? ' · из желаемых' : ''}</span><span class="cnt">${d.src === 'ai' ? '' : (S.settings.apiKey ? 'база · ' : 'демо · ')}${used + 1} из ${POOL_PER_SLOT}</span></div>
      <h3 class="cname">${esc(d.name)}</h3>
      <div class="grid4"><div><b>${r0(n.kcal)}</b><span>ккал</span></div><div><b>${r0(n.p)}</b><span>белки</span></div><div><b>${r0(n.f)}</b><span>жиры</span></div><div><b>${r0(n.c)}</b><span>углеводы</span></div></div>
      <p class="meta"><span>${d.time} мин</span><span>сложность ${d.diff}/10</span><span>клетчатка ${r0(n.fib)} г</span></p>
      <p class="ingline">${d.ing.map(x => esc(x.name.toLowerCase())).join(', ')}</p>
      <span class="price">≈ ${r0(n.price / 10) * 10} ₽</span>
      <button class="btn mark" id="f-mark">Пометка</button></div>`; }
  return `<section class="feed">
   <header class="ftop"><button class="btn ghost sm" id="f-close">Готово</button><div class="fday"><button class="arrow" id="f-prev" aria-label="Предыдущий день">‹</button><span>${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}</span><button class="arrow" id="f-next" aria-label="Следующий день">›</button></div><span class="sm">${taken.filter(Boolean).length}/${taken.length}</span></header>
   <div class="slots">${pat.map((x, i) => `<button class="slot${i === F.slot ? ' on' : ''}${taken[i] ? ' done' : ''}" data-slot="${i}">${x[1]}</button>`).join('')}</div>
   <div class="stage" id="stage">${card}</div>
   <p class="gest">Вверх — поставить блюдо · вниз — следующее · влево и вправо — другой день</p>
   <div class="actions two"><button class="btn ghost" id="f-skip">Следующее ↓</button><button class="btn primary" id="f-take">Поставить ↑</button></div>
  </section>`;
}
function bindFeed() {
  const F = S.feed;
  $('#f-close').onclick = () => { F.active = false; S.ui.tab = 'plan'; save(); render(); };
  $('#f-prev').onclick = () => goDay(-1); $('#f-next').onclick = () => goDay(1);
  document.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => goSlot(F.day, +b.dataset.slot));
  const take = $('#f-take'), skip = $('#f-skip');
  take.disabled = skip.disabled = F.loading || !F.card || F.exhausted;
  take.onclick = takeCard; skip.onclick = skipCard;
  const mk = $('#f-mark'); if (mk) mk.onclick = markSheet;
  const pk = $('#f-pick'); if (pk) pk.onclick = pickSeen;
  const pl = $('#f-pool'); if (pl) pl.onclick = async () => { if (F.poolUsed >= F.pool) { toast('Общий лимит недели исчерпан'); return; } F.poolUsed++; F.exhausted = false; F.loading = true; render(); await nextCard(); F.loading = false; render(); };
  const card = $('#card'); if (!card) return;
  let x0, y0, dx = 0, dy = 0;
  card.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; x0 = e.clientX; y0 = e.clientY; card.setPointerCapture(e.pointerId); card.classList.add('drag'); });
  card.addEventListener('pointermove', e => { if (x0 == null) return; dx = e.clientX - x0; dy = e.clientY - y0; card.style.transform = `translate(${dx * 0.6}px, ${dy}px) rotate(${dx * 0.03}deg)`; card.dataset.hint = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : ''; });
  card.addEventListener('pointerup', () => { if (x0 == null) return; card.classList.remove('drag'); x0 = null;
    if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) dy < 0 ? takeCard() : skipCard();
    else if (Math.abs(dx) > 90) goDay(dx < 0 ? 1 : -1);
    else card.style.transform = ''; dx = dy = 0; });
}
function goDay(delta) { const F = S.feed; let d = (F.day + delta + S.plan.len) % S.plan.len; const slot = S.plan.days[d].slots.findIndex(s => !s); goSlot(d, slot < 0 ? 0 : slot); }
async function goSlot(day, slot) { const F = S.feed; F.day = day; F.slot = slot; F.card = null; F.exhausted = (F.used[day + '-' + slot] || 0) >= POOL_PER_SLOT; F.loading = !F.exhausted; render(); if (!F.exhausted) { await nextCard(); F.loading = false; } render(); }
function place(dish, desired) {
  const F = S.feed, pat = pattern(), dd = S.plan.days[F.day];
  dd.slots[F.slot] = {dish, status: null, fromDesired: desired, manual: F.manual};
  if (S.collect.cook2 && 'ld'.includes(pat[F.slot][0]) && F.day + 1 < S.plan.len && !S.plan.days[F.day + 1].slots[F.slot]) {
    S.plan.days[F.day + 1].slots[F.slot] = {dish, status: null, fromDesired: desired, manual: F.manual, leftover: true};
  }
  toast(`${pat[F.slot][1]}: «${dish.name}»`);
}
async function takeCard() {
  const F = S.feed; if (!F.card) return;
  place(F.card.dish, F.card.desired);
  const card = $('#card'); if (card) card.style.transform = 'translateY(-120%)';
  // следующий пустой слот этого дня, затем следующих
  let next = null;
  for (let d = F.day; d < S.plan.len && !next; d++) for (let i = 0; i < S.plan.meals; i++) if (!S.plan.days[d].slots[i]) { next = [d, i]; break; }
  if (!next) { F.active = false; S.ui.tab = 'plan'; save(); render(); toast('Рацион собран. Список покупок готов.'); return; }
  F.manual = false; save(); await goSlot(next[0], next[1]);
}
async function skipCard() {
  const F = S.feed, key = F.day + '-' + F.slot;
  F.used[key] = (F.used[key] || 0) + 1;
  if (F.used[key] >= POOL_PER_SLOT) { F.exhausted = true; F.card = null; save(); render(); return; }
  F.loading = true; F.card = null; render(); await nextCard(); F.loading = false; render();
}
function pickSeen() {
  const F = S.feed, list = (F.seen[F.day + '-' + F.slot] || []);
  if (!list.length) { toast('Ещё нет показанных блюд'); return; }
  sheet(`<h3>Показанные блюда</h3><div class="pick">${list.map((d, i) => { const n = nut(d, famFactor(d, F.slot)); return `<button class="pickrow" data-pick="${i}"><b>${esc(d.name)}</b><span>${kbju(n)}</span></button>`; }).join('')}</div>`, b => {
    b.querySelectorAll('[data-pick]').forEach(x => x.onclick = () => { F.card = {dish: list[+x.dataset.pick], desired: false}; F.exhausted = false; closeSheet(); takeCard(); });
  });
}
function markSheet() {
  const d = S.feed.card.dish;
  sheet(`<h3>Пометка: ${esc(d.name)}</h3><p class="hint">Пометки сохраняются в профиле, их можно изменить в настройках.</p>
  <div class="actions"><button class="btn ghost" data-m="like">Нравится</button><button class="btn ghost" data-m="dislike">Не нравится — не предлагать</button><button class="btn ghost" data-m="allergy">Аллергия на ингредиент</button></div>`, b => {
    b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => {
      const t = x.dataset.m;
      if (t === 'allergy') { sheet(`<h3>На что аллергия?</h3><div class="pick">${d.ing.map(i => `<button class="pickrow" data-a="${esc(i.name)}"><b>${esc(i.name)}</b></button>`).join('')}</div>`, bb => bb.querySelectorAll('[data-a]').forEach(y => y.onclick = () => { S.marks.allergy.push(y.dataset.a); save(); closeSheet(); toast('Аллерген сохранён'); skipCard(); })); return; }
      const arr = S.marks[t]; if (!arr.includes(d.name)) arr.push(d.name);
      save(); closeSheet(); toast(t === 'like' ? 'Отмечено: нравится' : 'Больше не предложу'); if (t === 'dislike') skipCard();
    });
  });
}

/* ---------- Продукты ---------- */
function roundAmt(i, g) {
  if (i.unit === 'pcs') { const n = Math.ceil(g / 55); return {q: n, t: n + ' шт', g: n * 55}; }
  const u = i.unit === 'ml' ? ['мл', 'л'] : ['г', 'кг'];
  let q;
  if (g < 300) q = Math.ceil(g / 50) * 50;
  else { const h = Math.ceil(g / 500) * 500; q = (h - g) / g <= 0.3 ? h : Math.ceil(g / 100) * 100; }
  return {q, g: q, t: q >= 1000 ? (q / 1000).toString().replace('.', ',') + ' ' + u[1] : q + ' ' + u[0]};
}
function shopList() {
  const r = S.shop.range, L = S.plan.len;
  const [a, b] = r === 'a' ? [0, Math.min(3, L)] : r === 'b' ? [3, L] : [0, L];
  const map = {}, home = S.collect.homeOn ? S.collect.home.map(x => x.toLowerCase()) : [];
  for (let d = a; d < b; d++) S.plan.days[d].slots.forEach((sl, i) => { if (!sl || sl.leftover) return; const ff = famFactor(sl.dish, i);
    sl.dish.ing.forEach(x => { const k = x.name; map[k] = map[k] || {i: x, g: 0}; map[k].g += x.g * ff; }); });
  return Object.values(map).map(o => { const rd = roundAmt(o.i, o.g); const has = home.some(h => o.i.name.toLowerCase().includes(h) || h.includes(o.i.name.toLowerCase()));
    return {name: o.i.name, cat: o.i.cat, need: o.g, amt: rd.t, price: has ? 0 : (o.i.price || 0) * rd.g / 1000, has}; }).sort((x, y) => x.name.localeCompare(y.name, 'ru'));
}
function viewShop() {
  const v = $('#view');
  if (!S.plan || !S.plan.days.some(d => d.slots.some(Boolean))) { v.innerHTML = `${appbar('Продукты', 'Список покупок')}<div class="empty"><h3>Список пуст</h3><p>Список покупок появится, когда вы соберёте рацион.</p></div>`; return; }
  const list = shopList(), total = list.reduce((s, x) => s + x.price, 0), budget = +S.collect.budget || 0;
  const filledDays = S.plan.days.filter(d => d.slots.every(Boolean)).length;
  const budgetPart = S.shop.range === 'all' ? budget : budget * (S.shop.range === 'a' ? 3 : S.plan.len - 3) / S.plan.len;
  const over = budgetPart && total > budgetPart;
  const ranges = S.plan.len === 7 ? [['all','Вся неделя'],['a','Дни 1–3'],['b','Дни 4–7']] : [['all','3 дня']];
  const row = x => `<li class="${S.shop.checked[x.name] ? 'done' : ''}${x.has ? ' has' : ''}"><button data-check="${esc(x.name)}"><span class="nm">${esc(x.name)}</span><span class="am">${x.has ? 'есть дома' : x.amt}</span><span class="pr">${x.has ? '' : '≈ ' + r0(x.price / 10) * 10 + ' ₽'}</span></button></li>`;
  let body;
  if (S.shop.group) { const cats = {}; list.forEach(x => (cats[x.cat] = cats[x.cat] || []).push(x)); body = Object.keys(cats).sort().map(k => `<h4 class="cat">${k}</h4><ul class="shop">${cats[k].map(row).join('')}</ul>`).join(''); }
  else body = `<ul class="shop">${list.map(row).join('')}</ul>`;
  v.innerHTML = `${appbar('Продукты', `Собрано дней: ${filledDays} из ${S.plan.len}`)}
  ${filledDays < S.plan.len ? `<div class="warn box">Рацион собран на ${filledDays} из ${S.plan.len} дней — продуктов хватит только на них.</div>` : ''}
  <div class="seg">${ranges.map(([k, t]) => `<button class="${S.shop.range === k ? 'on' : ''}" data-range="${k}">${t}</button>`).join('')}</div>
  <div class="total"><div><span class="small">Примерно</span><b>${r0(total / 10) * 10} ₽</b></div><div><span class="small">Бюджет</span><b>${r0(budgetPart)} ₽</b></div></div>
  ${over ? `<div class="warn box">Перерасход ≈ ${r0((total - budgetPart) / 10) * 10} ₽. <button class="btn ghost sm" id="s-cheap">Удешевить 5 самых дорогих блюд</button></div>` : ''}
  <div class="actions two"><button class="btn ghost" id="s-group">${S.shop.group ? 'Без групп' : 'Сгруппировать'}</button><button class="btn ghost" id="s-share">Поделиться</button></div>
  ${body}
  <button class="btn primary wide big" id="s-copy">Скопировать список</button>
  <p class="hint">Цены ориентировочные, по средним ценам сетевых магазинов. Нажмите на продукт, чтобы вычеркнуть.</p>`;
  v.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { S.shop.range = b.dataset.range; save(); render(); });
  v.querySelectorAll('[data-check]').forEach(b => b.onclick = () => { const k = b.dataset.check; S.shop.checked[k] = !S.shop.checked[k]; save(); render(); });
  $('#s-group').onclick = () => { S.shop.group = !S.shop.group; save(); render(); };
  const text = () => 'Список покупок — Мой рацион\n' + list.filter(x => !x.has).map(x => `${S.shop.checked[x.name] ? '✓' : '•'} ${x.name} — ${x.amt}`).join('\n') + `\nИтого ≈ ${r0(total / 10) * 10} ₽`;
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('Список скопирован'); } catch (e) { sheet(`<h3>Скопируйте текст</h3><textarea class="copybox" id="cb" readonly>${esc(text())}</textarea>`, b => { const t = $('#cb', b); t.focus(); t.select(); }); } };
  $('#s-copy').onclick = copy;
  $('#s-share').onclick = async () => { if (navigator.share) { try { await navigator.share({title: 'Список покупок', text: text()}); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const ch = $('#s-cheap'); if (ch) ch.onclick = cheapen;
}
function cheapen() {
  const slots = [];
  S.plan.days.forEach((d, di) => d.slots.forEach((sl, i) => { if (sl && !sl.fromDesired) slots.push({di, i, price: nut(sl.dish, famFactor(sl.dish, i)).price}); }));
  slots.sort((a, b) => b.price - a.price);
  let n = 0;
  slots.slice(0, 5).forEach(s => { const type = pattern()[s.i][0], cur = S.plan.days[s.di].slots[s.i];
    const alt = DISHES.map(resolveDish).filter(d => d.types.includes(type) && allowedByDiet(d) && d.name !== cur.dish.name && countUses(d.name) < S.settings.maxRepeat)
      .map(d => ({d, p: nut(d, famFactor(d, s.i)).price})).filter(x => x.p < s.price * 0.8).sort((a, b) => a.p - b.p)[0];
    if (alt) { S.plan.days[s.di].slots[s.i] = {dish: alt.d, status: null, fromDesired: false}; n++; } });
  save(); render(); toast(n ? `Заменено блюд: ${n}` : 'Дешевле подходящих блюд не нашлось');
}

/* ---------- Настройки ---------- */
const SET_PAGES = [['look','Оформление','Тема и акцент'],['family','Семья','Люди и их нормы'],['diet','Рацион и питание','Приёмы пищи, тип питания, запреты'],['marks','Пометки','Нравится, не нравится, аллергии'],['health','Здоровье','Важное предупреждение'],['key','Ключ доступа','Подписка'],['history','История','Прошлая неделя'],['data','Данные','Удаление с устройства']];
const SET_IC = {look:'look', family:'family', diet:'dish', marks:'heart', health:'shield', key:'key', history:'history', data:'data'};
function viewSettings() {
  const st = S.settings, M = S.marks, pg = S.ui.set, v = $('#view');
  if (!pg) {
    const me = S.people[0], t = personTargets(me);
    v.innerHTML = `${appbar('Настройки', 'Профиль и приложение', {back: true})}
    <button class="profile" data-person="${me.id}"><span class="mono">${esc(me.name.slice(0, 1).toUpperCase())}</span><span><b>${esc(me.name)}</b><small>${r0(t.E)} ккал · белок ${r0(t.P)} г в день</small></span>${ic('chev', 'sm')}</button>
    <nav class="rows">${SET_PAGES.map(([k, t, s]) => `<button class="row" data-set="${k}"><span class="medal">${ic(SET_IC[k])}</span><span><b>${t}</b><small>${s}</small></span>${ic('chev', 'sm')}</button>`).join('')}</nav>
    <p class="hint center">Мой рацион · MVP 0.2</p>`;
    v.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { S.ui.set = b.dataset.set; save(); render(); });
    v.querySelector('[data-person]').onclick = () => editPerson(me);
    return;
  }
  const title = SET_PAGES.find(x => x[0] === pg)[1];
  const meds = [['kidney','Болезни почек'],['diabetes','Диабет на инсулине или сульфонилмочевине'],['ed','Расстройство пищевого поведения'],['preg','Беременность или кормление'],['warfarin','Приём варфарина'],['gi','Целиакия, подагра, тяжёлые болезни печени или ЖКТ']];
  let body = '';
  if (pg === 'look') body = `<h4>Тема</h4><div class="themes">${[['dark','Тёмная','Графит и золото'],['light','Светлая','Жемчуг и золото'],['system','Как в системе','Меняется сама']].map(([k, t, s]) => `<button class="theme-card t-${k}${S.theme === k ? ' on' : ''}" data-theme-set="${k}"><i></i><b>${t}</b><small>${s}</small></button>`).join('')}</div>
    <h4>Акцент</h4><div class="accents">${[['gold','Классическое золото'],['champagne','Шампань'],['rose','Розовое золото']].map(([k, t]) => `<button class="accent a-${k}${(S.accent || 'gold') === k ? ' on' : ''}" data-accent="${k}"><i></i><span>${t}</span></button>`).join('')}</div>`;
  if (pg === 'family') body = `<ul class="people">${S.people.map(p => { const t = personTargets(p); return `<li><button data-person="${p.id}"><span class="mono">${esc(p.name.slice(0, 1).toUpperCase())}</span><span><b>${esc(p.name)}</b><small>${p.sex === 'm' ? 'М' : 'Ж'}, ${p.age} лет, ${p.weight} кг · ${r0(t.E)} ккал, белок ${r0(t.P)} г</small></span>${ic('chev', 'sm')}</button></li>`; }).join('')}</ul>
    ${S.people.length < 10 ? '<button class="btn ghost wide" id="st-add">Добавить человека</button>' : '<p class="hint">Максимум 10 человек.</p>'}
    <p class="hint">Блюда общие для всей семьи, порции считаются по нормам каждого.</p>`;
  if (pg === 'diet') body = `<div class="panel">
    <label class="field"><span><em>Приёмов пищи в день</em><select id="st-meals">${[3,4,5].map(n => `<option value="${n}"${st.meals === n && !st.mealsAuto ? ' selected' : ''}>${n}</option>`).join('')}<option value="auto"${st.mealsAuto ? ' selected' : ''}>Автоматически по норме белка</option></select></span></label>
    <div class="field col"><em>Длина рациона</em><div class="seg">${[[7,'7 дней'],[3,'3 дня']].map(([k, t]) => `<button class="${st.planLen === k ? 'on' : ''}" data-len="${k}">${t}</button>`).join('')}</div></div>
    <label class="field"><span><em>Одно блюдо за период — не чаще</em><select id="st-rep">${[1,2,3].map(n => `<option value="${n}"${st.maxRepeat === n ? ' selected' : ''}>${n} раз</option>`).join('')}</select></span></label>
    <label class="field"><span><em>Тип питания</em><select id="st-diet">${[['all','Обычное'],['pesc','Без мяса, с рыбой'],['veg','Вегетарианское'],['vegan','Веганское']].map(([k, t]) => `<option value="${k}"${st.diet === k ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <label class="field"><span><em>Нормы</em><select id="st-norms"><option value="NASEM"${st.norms === 'NASEM' ? ' selected' : ''}>Международные (NASEM)</option><option value="RU"${st.norms === 'RU' ? ' selected' : ''}>Российские (МР 2.3.1.0253-21)</option></select></span></label>
    <div class="field col"><em>Запрещённые продукты для всей семьи</em><div class="chipin"><input id="st-forb" placeholder="Например, грибы"><button class="btn ghost sm" id="st-forb-add">Добавить</button></div>${st.forbidden.length ? `<div class="chips">${st.forbidden.map((w, i) => `<button class="chip x" data-rmforb="${i}">${esc(w)}</button>`).join('')}</div>` : ''}</div></div>`;
  if (pg === 'marks') body = `<p class="hint">Пометки учитываются при подборе. Добавляйте свои или ставьте их кнопкой «Пометка» на карточке блюда.</p>` + [['like','Нравится','Например, сырники'],['dislike','Не нравится','Например, печень'],['allergy','Аллергии','Например, орехи']].map(([k, t, ph]) => `<h4>${t}</h4><div class="panel"><div class="field col"><div class="chipin"><input id="mk-${k}" placeholder="${ph}" enterkeyhint="done"><button class="btn ghost sm" data-addmark="${k}">Добавить</button></div>${M[k].length ? `<div class="chips">${M[k].map((w, i) => `<button class="chip x" data-rmmark="${k}:${i}">${esc(w)}</button>`).join('')}</div>` : ''}</div></div>`).join('');
  if (pg === 'health') body = `<div class="alert">${ic('shield')}<div><b>Важно</b><p>Приложение опирается на официальные нормы питания и подробный научный отчёт, но не заменяет врача и не гарантирует результат. При состояниях из списка ниже им лучше не пользоваться — посоветуйтесь с врачом или диетологом.</p></div></div>
    <h4>Состояния</h4><div class="panel">${meds.map(([k, t]) => `<label class="field check"><input type="checkbox" data-med="${k}"${st.medical[k] ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>
    <p class="hint">Если отметить хотя бы одно, автоматический сбор рациона отключится.</p>`;
  if (pg === 'key') body = `<div class="panel"><label class="field"><span><em>Ключ доступа</em><input id="st-key" type="password" autocomplete="off" value="${esc(st.apiKey)}" placeholder="Ключ из Telegram-бота"></span></label></div><p class="hint">Ключ также запрашивается при нажатии «Собрать рацион». Без ключа работает демо-режим.</p>`;
  if (pg === 'history') body = S.lastWeek ? historyHtml() : '<div class="empty"><h3>Истории пока нет</h3><p>Прошлая неделя появится здесь после окончания текущей.</p></div>';
  if (pg === 'data') body = `<p class="hint">Все данные хранятся только на этом устройстве.</p><button class="btn ghost wide danger" id="st-wipe">Удалить все данные</button>`;
  v.innerHTML = `${appbar(title, 'Настройки', {back: true})}${body}`;
  v.querySelectorAll('[data-theme-set]').forEach(b => b.onclick = () => { S.theme = b.dataset.themeSet; save(); render(); });
  v.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => { S.accent = b.dataset.accent; save(); render(); });
  v.querySelectorAll('[data-person]').forEach(b => b.onclick = () => editPerson(S.people.find(p => p.id === b.dataset.person)));
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };
  on('#st-add', 'onclick', () => editPerson(null));
  on('#st-meals', 'onchange', e => { if (e.target.value === 'auto') st.mealsAuto = true; else { st.mealsAuto = false; st.meals = +e.target.value; } planShapeChanged(); });
  v.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { st.planLen = +b.dataset.len; planShapeChanged(); });
  on('#st-rep', 'onchange', e => { st.maxRepeat = +e.target.value; save(); });
  on('#st-diet', 'onchange', e => { st.diet = e.target.value; save(); });
  on('#st-norms', 'onchange', e => { st.norms = e.target.value; save(); });
  const fa = () => { const x = $('#st-forb').value.trim(); if (x) { st.forbidden.push(x); save(); render(); } };
  on('#st-forb-add', 'onclick', fa); on('#st-forb', 'onkeydown', e => { if (e.key === 'Enter') fa(); });
  v.querySelectorAll('[data-rmforb]').forEach(b => b.onclick = () => { st.forbidden.splice(+b.dataset.rmforb, 1); save(); render(); });
  v.querySelectorAll('[data-rmmark]').forEach(b => b.onclick = () => { const [k, i] = b.dataset.rmmark.split(':'); S.marks[k].splice(+i, 1); save(); render(); });
  v.querySelectorAll('[data-med]').forEach(b => b.onchange = () => { st.medical[b.dataset.med] = b.checked; save(); });
  on('#st-key', 'onchange', e => { st.apiKey = e.target.value.trim(); save(); });
  v.querySelectorAll('[data-addmark]').forEach(b => { const k = b.dataset.addmark, inp = $('#mk-' + k); const add = () => { const x = inp.value.trim(); if (x && !S.marks[k].includes(x)) { S.marks[k].push(x); save(); render(); } }; b.onclick = add; inp.onkeydown = e => { if (e.key === 'Enter') add(); }; });
  on('#st-wipe', 'onclick', () => sheet(`<h3>Удалить все данные?</h3><p>Профили, рацион, пометки и ключ будут удалены с этого устройства.</p><div class="actions two"><button class="btn ghost" id="w-no">Отмена</button><button class="btn primary" id="w-yes">Удалить</button></div>`, b => { $('#w-no', b).onclick = closeSheet; $('#w-yes', b).onclick = () => { S = defaults(); save(); closeSheet(); render(); }; }));
}
function planShapeChanged() {
  save();
  if (S.plan && (S.plan.meals !== mealsCount() || S.plan.len !== S.settings.planLen) && S.plan.days.some(d => d.slots.some(Boolean)))
    sheet(`<h3>Изменить структуру рациона?</h3><p>Новое число приёмов или длина рациона применятся к следующему сбору. Начать текущий рацион заново сейчас?</p><div class="actions two"><button class="btn ghost" id="ps-no">Позже</button><button class="btn primary" id="ps-yes">Начать заново</button></div>`, b => { $('#ps-no', b).onclick = () => { closeSheet(); render(); }; $('#ps-yes', b).onclick = () => { S.plan = null; S.feed = null; save(); closeSheet(); render(); }; });
  else { if (S.plan && !S.plan.days.some(d => d.slots.some(Boolean))) S.plan = null; save(); render(); }
}
function editPerson(p) {
  sheet(`<h3>${p ? 'Изменить' : 'Новый человек'}</h3>${personForm(p || {sex: 'f', age: 30, height: 165, weight: 60})}
   <div class="actions two">${p && S.people.length > 1 ? '<button class="btn ghost danger" id="pp-del">Удалить</button>' : '<span></span>'}<button class="btn primary" id="pp-save">Сохранить</button></div>`, b => {
    $('#pp-save', b).onclick = () => { const np = readPerson(p && p.id); if (!np) return; if (p) S.people[S.people.findIndex(x => x.id === p.id)] = np; else S.people.push(np); save(); closeSheet(); render(); };
    const del = $('#pp-del', b); if (del) del.onclick = () => { S.people = S.people.filter(x => x.id !== p.id); save(); closeSheet(); render(); };
  });
}
function historyHtml() {
  const L = S.lastWeek, pat = PATTERNS[L.meals];
  return L.days.map((d, i) => { const dt = new Date(addDays(L.start, i) + 'T12:00:00'); return `<h4>${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}</h4><ul class="ing">${d.slots.map((s, k) => `<li><span>${pat[k][1]}</span><b>${s ? esc(s.dish.name) : '—'}</b></li>`).join('')}</ul>`; }).join('');
}

/* ---------- Запуск ---------- */
$('#nav div').innerHTML = [['plan','Рацион'],['shop','Продукты'],['collect','Сбор']].map(([k, t]) => `<button class="tab" data-tab="${k}"><span class="tab-ic">${ic(k)}</span>${t}</button>`).join('');
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { S.ui.tab = b.dataset.tab; S.ui.set = null; save(); render(); });
document.addEventListener('click', e => {
  if (e.target.closest('[data-gear]')) { S.ui.prevTab = S.ui.tab; S.ui.tab = 'settings'; S.ui.set = null; save(); render(); }
  else if (e.target.closest('[data-back]')) { if (S.ui.set) S.ui.set = null; else S.ui.tab = S.ui.prevTab || 'plan'; save(); render(); }
});
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.id === 'sheet-close') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
if (S.feed && S.feed.active) { S.feed.loading = false; if (!S.feed.card && !S.feed.exhausted) S.feed.active = false; }
render();
if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai') && !location.hostname.includes('claudeusercontent')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

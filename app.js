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
const lossOk = (h, w) => !(h > 0 && w > 0) || w / Math.pow(h / 100, 2) > 20; // защита цели: при ИМТ ≤ 20 снижение недоступно
const safeGoal = (p, g) => g === 'loss' && !lossOk(p.height, p.weight) ? 'keep' : g;
function personTargets(p, goal) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const g = GOALS[safeGoal(p, p.goal || goal)] || GOALS.keep;
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
  settings: {meals: 4, mealsAuto: false, planLen: 7, norms: 'NASEM', diet: 'all', forbidden: [], allergens: [], medical: {}, accessKey: '', serverUrl: '', botUrl: ''},
  marks: {like: [], notes: {}},
  collect: {budget: 6000, sections: [0, 1], homeOn: false, home: [], cook2: false, otherCuisines: false},
  lib: {}, banned: {ids: [], names: []}, cool: {}, seenEver: [], dishStore: {}, imports: [], taste: {w: {}, mode: 'self', done: false}, aiTimes: [], firstCollect: null,
  plan: null, feed: null, lastWeek: null, access: null, fbq: [], apiLog: null, pricesAt: 0, srvQueue: {},
  shop: {checked: {}, group: false, range: 'all', bought: {}, lastBought: null},
  ui: {tab: 'plan', day: 0, off: 0, open: {}, set: null}
});
let S;
try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = defaults(); }
(function migrate() { // переход со старых версий: недостающие поля, старые пометки
  const d = defaults();
  ['settings', 'collect', 'marks', 'banned', 'taste', 'shop', 'ui'].forEach(k => { S[k] = Object.assign({}, d[k], S[k] || {}); });
  if (Array.isArray(S.marks.allergy) && S.marks.allergy.length) { S.settings.forbidden = [...new Set([...S.settings.forbidden, ...S.marks.allergy])]; }
  delete S.marks.allergy; delete S.marks.dislike;
  (S.people || []).forEach(p => { p.goal = safeGoal(p, p.goal); });
  if (!Array.isArray(S.collect.sections) || !S.collect.sections.length) S.collect.sections = typeof S.collect.section === 'number' ? Array.from({length: S.collect.section + 1}, (_, i) => i) : [0, 1];
  delete S.collect.section; delete S.collect.cuisine;
  Object.keys(S.lib || {}).forEach(k => { if (!k.startsWith('any|')) delete S.lib[k]; }); // круги по кухням больше не нужны
  if (S.feed && S.feed.seen && !S.feed.v4) S.feed = null;
  delete S.settings.apiKey; delete S.lastSync;
})();
// при каждом открытии выбран сегодняшний день
S.ui.off = 0; if (S.plan) S.ui.day = Math.max(0, Math.min(S.plan.len - 1, Math.round((new Date(new Date().setHours(12, 0, 0, 0)) - new Date(S.plan.start + 'T12:00:00')) / 864e5)));
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

/* ---------- Даты ---------- */
const DOW = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const MON = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // локальная дата
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
function cycleStart(len) { // рацион начинается с сегодняшнего дня
  const t = new Date(); t.setHours(12, 0, 0, 0); return iso(t);
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
  return t;
}
/* ---------- Справочники v4: кухни, разделы сложности, аллергены ---------- */
const CUISINES = ['Русская', 'Средиземноморская', 'Европейская', 'Азиатская', 'Восточная'];
const SEC_TIME = [['15', 'минут'], ['30', 'минут'], ['60', 'минут'], ['∞', 'шедевр']]; // подписи на кнопках сложности
const SECTIONS = [['Простое', 'до 15 мин'], ['Среднее', 'до 30 мин'], ['Сложное', 'до часа'], ['Шедевр', 'любое время']];
const sectionOf = d => d.section != null ? d.section : d.time <= 15 && d.diff <= 2 ? 0 : d.time <= 30 && d.diff <= 5 ? 1 : d.time <= 60 && d.diff <= 7 ? 2 : 3;
const ALLERGENS = [['milk', 'Молоко (белок)'], ['lactose', 'Лактоза'], ['eggs', 'Яйца'], ['nuts', 'Орехи'], ['peanut', 'Арахис'], ['fish', 'Рыба'], ['seafood', 'Морепродукты'], ['gluten', 'Глютен'], ['soy', 'Соя'], ['sesame', 'Кунжут'], ['citrus', 'Цитрусы']];
const ALG_ING = {milk: ['cottage', 'yogurt', 'kefir', 'milk', 'cheese', 'sourcream', 'butter'], lactose: ['cottage', 'yogurt', 'kefir', 'milk', 'sourcream'], eggs: ['eggs'], nuts: ['walnuts', 'almonds'], fish: ['salmon', 'mackerel', 'cod', 'tuna'], gluten: ['oat', 'bulgur', 'pasta', 'bread', 'lavash'], soy: ['tofu'], citrus: ['lemon', 'orange']};
const ALG_RX = {milk: /молок|творог|йогурт|кефир|сыр|сметан|сливк|сливочн/i, lactose: /молок|творог|йогурт|кефир|сметан|сливк/i, eggs: /яйц|яич/i, nuts: /орех|миндал|фундук|кешью|фисташ|пекан/i, peanut: /арахис/i,
  fish: /рыб|лосос|сёмг|семг|скумбр|треск|тунец|судак|минтай|сельд|форел|горбуш/i, seafood: /кревет|кальмар|мидии|краб|морепрод|гребеш/i, gluten: /пшен|мука|хлеб|макарон|паста|булгур|лаваш|манк|ячмен|ржан|овсян|кускус/i,
  soy: /соя|соев|тофу/i, sesame: /кунжут|тахин/i, citrus: /лимон|апельсин|мандарин|грейпфрут|лайм/i};
const hasAllergen = (d, a) => Array.isArray(d.allergens) ? d.allergens.includes(a) || d.ing.some(i => (i.allergens || []).includes(a)) : d.ing.some(i => (ALG_ING[a] || []).includes(i.id) || ALG_RX[a].test(i.name));
const nameKey = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '');
const isBanned = d => S.banned.ids.includes(d.id) || S.banned.names.includes(nameKey(d.name));
const dishFlags = d => d.ing.map(i => i.flags || '').join('');
function allowedByDiet(d) {
  if (hasRisky(d)) return false;
  const fl = dishFlags(d), diet = S.settings.diet, txt = d.ing.map(i => i.name).join(' ');
  if (diet === 'veg' && (/[mf]/.test(fl) || /куриц|говяд|свин|индейк|рыб/i.test(txt))) return false;
  if (diet === 'vegan' && (/[mfdeh]/.test(fl) || /куриц|говяд|свин|индейк|рыб|молок|сыр|яйц|мёд/i.test(txt))) return false;
  if (diet === 'pesc' && (/m/.test(fl) || /куриц|говяд|свин|индейк/i.test(txt))) return false;
  if (diet === 'nopork' && (/p/.test(fl) || /свин|бекон|ветчин|сало/i.test(txt))) return false;
  if ((S.settings.allergens || []).some(a => hasAllergen(d, a))) return false;
  const bad = S.settings.forbidden.map(s => s.toLowerCase().trim()).filter(Boolean);
  if (bad.some(b => d.name.toLowerCase().includes(b) || d.ing.some(i => i.name.toLowerCase().includes(b)))) return false;
  return true;
}

/* ---------- Безопасность питания (docs/NUTRITION_SAFETY.md): всё считается по главному едоку ---------- */
const SAFE = {na_meal: {b: 400, l: 400, d: 400, s: 150}, na_day: 1000, na_day_big: 1300, ret_day: 3000, sugar_meal: 10, d_day: 100, fe_day: 45, vc_day: 2000}; // натрий — только из продуктов, соль по вкусу (14.10)
const RISKY_ING = ['liver']; // печень — убрана из подбора (С1.1)
const ANIMAL = /[mfde]/;
const caDay = () => S.people.some(p => p.age > 50) ? 2000 : 2500;
function mainEaterIdx() { let k = 0, e = -1; S.people.forEach((p, i) => { const x = personTargets(p).E; if (x > e) { e = x; k = i; } }); return k; }
const mainEater = () => S.people[mainEaterIdx()];
const naDay = () => personTargets(mainEater()).E > 3000 ? SAFE.na_day_big : SAFE.na_day;
const eaterFactor = (dish, slotIdx) => personTargets(mainEater()).E * pattern()[slotIdx][2] / 100 / (nut(dish).kcal || 1); // И1: порция = ккал приёма / ккал блюда
const stepsOf = d => { const st = (d.steps || []).slice(); if ((d.salt || d.saltOrig) && !st.some(t => /по вкусу/i.test(t))) st.push('Посолите по вкусу.'); return st; };
const hasRisky = d => d.ing.some(i => RISKY_ING.includes(i.id));
function perBase(d) { // вещества с пределом на одну базовую порцию (соль отдельно)
  if (d._pb && d._pb.salt === d.salt) return d._pb;
  const b = d.base || {}, t = {naIng: 0, ret: 0, sugar: 0, d: 0, ca: 0, fe: 0, vc: 0, noNa: false};
  d.ing.forEach(i => { const q = i.g / 100; if (i.na == null) t.noNa = true; t.naIng += (i.na || 0) * q; if (ANIMAL.test(i.flags || '')) t.ret += (i.va || 0) * q;
    if (i.id === 'honey' || /h/.test(i.flags || '')) t.sugar += (i.c || 0) * q; t.d += (i.d || 0) * q; t.ca += (i.ca || 0) * q; t.fe += (i.fe || 0) * q; t.vc += (i.vc || 0) * q; });
  if (b.na != null) { t.naIng = b.na; t.noNa = false; } // данные сервера — главнее (соль = 0, по вкусу)
  if (b.ret != null) t.ret = b.ret; if (b.sugar_add != null) t.sugar = b.sugar_add;
  Object.defineProperty(d, '_pb', {value: Object.assign(t, {salt: d.salt}), enumerable: false, configurable: true, writable: true});
  return t;
}
function eaterIntake(d, slotIdx) { const f = eaterFactor(d, slotIdx), b = perBase(d), n = nut(d); return {na: b.naIng * f, ret: b.ret * f, sugar: b.sugar * f, d: b.d * f, ca: b.ca * f, fe: b.fe * f, vc: b.vc * f, p: n.p * f, fib: n.fib * f}; }
function eaterDay(day, except) { // что главный едок уже получает за день (пропущенные приёмы не вычитаются — запас)
  const t = {na: 0, ret: 0, sugar: 0, d: 0, ca: 0, fe: 0, vc: 0, p: 0, fib: 0};
  S.plan.days[day].slots.forEach((sl, i) => { if (!sl || i === except || sl.unsafe) return; const x = eaterIntake(sl.dish, i); Object.keys(t).forEach(k => t[k] += x[k]); });
  return t;
}
function safeFit(dish, day, slotIdx) { // Р5: можно ли поставить блюдо в этот приём; соль уменьшается до предела
  if (!dish || !S.plan || !S.plan.days[day]) return {ok: false, why: 'nodata'};
  if (hasRisky(dish)) return {ok: false, why: 'risky'};
  const b = perBase(dish); if (b.noNa) return {ok: false, why: 'nodata'};
  const type = pattern()[slotIdx][0], f = eaterFactor(dish, slotIdx), u = eaterDay(day, slotIdx);
  const naIng = b.naIng * f;
  if (naIng > (SAFE.na_meal[type] || 400) + 1e-6 || u.na + naIng > naDay() + 1e-6) return {ok: false, why: 'na'};
  if (u.ret + b.ret * f > SAFE.ret_day) return {ok: false, why: 'ret'};
  if (b.sugar * f > SAFE.sugar_meal) return {ok: false, why: 'sugar'};
  if (u.d + b.d * f > SAFE.d_day) return {ok: false, why: 'd'};
  if (u.ca + b.ca * f > caDay()) return {ok: false, why: 'ca'};
  if (u.fe + b.fe * f > SAFE.fe_day) return {ok: false, why: 'fe'};
  if (u.vc + b.vc * f > SAFE.vc_day) return {ok: false, why: 'vc'};
  return {ok: true};
}
function withSalt(d) { // соль по вкусу: старые копии с уменьшенной солью возвращаются к исходному блюду
  if (d.saltOrig == null) return d; const c = Object.assign({}, d, {salt: d.saltOrig}); delete c.saltOrig; return c;
}
function safePlace(day, slotIdx, dish, extra) { // ставит блюдо только после проверки; возвращает false и причину, если нельзя
  const r = safeFit(dish, day, slotIdx); if (!r.ok) return r;
  S.plan.days[day].slots[slotIdx] = Object.assign({dish: withSalt(dish), status: null}, extra || {});
  return r;
}
function auditPlanSafety() { // при открытии: пересчитать соль и пометить небезопасные блюда рациона
  if (!S.plan) return;
  S.plan.days.forEach((dd, day) => dd.slots.forEach((sl, i) => { if (sl) delete sl.unsafe; }));
  S.plan.days.forEach((dd, day) => dd.slots.forEach((sl, i) => {
    if (!sl) return; sl.dish = withSalt(sl.dish);
    const r = safeFit(sl.dish, day, i); if (!r.ok) sl.unsafe = r.why;
  }));
}

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
function rollWeek() { // лента: рацион всегда на 7 дней с сегодняшнего, прошедшие дни уходят в историю
  if (!S.plan) return;
  const off = todayIdx(); if (!off) return;
  const m = S.plan.meals, empty = () => ({slots: Array(m).fill(null)});
  if (off < 0) { // рацион начинался позже сегодняшнего (старый цикл со вторника) — добавляем дни с сегодняшнего
    const add = Math.min(-off, S.plan.len); S.plan.days = Array.from({length: add}, empty).concat(S.plan.days).slice(0, S.plan.len);
    S.plan.start = iso(new Date(new Date().setHours(12, 0, 0, 0))); S.feed = null; S.ui.day = 0; S.ui.off = 0; save(); return; }
  const past = S.plan.days.slice(0, Math.min(off, S.plan.len));
  let H = S.lastWeek;
  if (!H || H.meals !== m || !Array.isArray(H.days)) H = {start: S.plan.start, len: 0, meals: m, days: []};
  else { const gap = Math.round((new Date(S.plan.start + 'T12:00:00') - new Date(addDays(H.start, H.days.length) + 'T12:00:00')) / 864e5);
    if (gap < 0 || gap > 7) H = {start: S.plan.start, len: 0, meals: m, days: []}; else for (let k = 0; k < gap; k++) H.days.push(empty()); }
  past.forEach(d => H.days.push(d));
  const extra = Math.max(0, H.days.length - 7); if (extra) { H.days = H.days.slice(extra); H.start = addDays(H.start, extra); }
  H.len = H.days.length; S.lastWeek = H;
  const keep = S.plan.days.slice(off); while (keep.length < S.plan.len) keep.push(empty());
  S.plan.days = keep; S.plan.start = iso(new Date(new Date().setHours(12, 0, 0, 0)));
  S.feed = null; S.ui.day = 0; S.ui.off = 0;
  const b = S.shop.bought || {}; Object.keys(b).forEach(k => { if (k < S.plan.start) delete b[k]; }); S.shop.bought = b;
  save();
}

/* ---------- Подбор блюда: цели приёма и здоровье ---------- */
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
const allSlots = () => S.plan ? [].concat(...S.plan.days.map(d => d.slots)).filter(Boolean) : [];
const usedInPlan = id => allSlots().some(s => s.dish.id === id && !s.leftover);
function scoreDish(d, tg) {
  const n = nut(d), k = n.kcal || 1, te = tg.E || 1;
  let s = Math.abs(n.p * 4 / k - tg.P * 4 / te) * 3 + Math.abs(n.f * 9 / k - tg.F * 9 / te) * 1.5 + Math.abs(n.fib / k - tg.fib / te) * 400;
  if (!noTaste) s -= (S.taste.w[d.cuisine] || 0) * 0.2;
  if (S.marks.like.includes(d.name)) s -= 0.08;
  if (d.rare) s += 0.15;
  return s + Math.random() * 0.1;
}
/* Норма приёма (уровень 1 фильтра здоровья): натрий и белок на всю семью после подгонки порций */
function healthOk(d, slotIdx, tg) {
  const type = pattern()[slotIdx][0], n = nut(d, famFactor(d, slotIdx)), ppl = S.people.length;
  if (type !== 's' && n.p < tg.P * 0.45) return false;
  return true;
}
/* ---------- Бюджет (ARCHITECTURE §5) ---------- */
const BUDGET_SHARE = {3: {b: 28, l: 44, d: 28}, 4: {b: 25, l: 40, s: 10, d: 25}, 5: {b: 25, l: 40, s: 5, d: 25}};
const famK = () => Math.max(0.5, S.people.reduce((s, p) => s + personTargets(p).E, 0) / 2000); // число «базовых людей»
const dishCost = d => d.cost != null ? d.cost : nut(d).price; // цена базовой порции, ₽
const famCost = d => dishCost(d) * famK(); // стоимость на семью
const baseBudget = () => (+S.collect.budget || 0) / famK(); // бюджет на базового человека на период рациона
function budgetLeft() { // остаток на базового человека: бюджет минус cost всех взятых блюд рациона
  if (!S.plan) return baseBudget();
  return baseBudget() - allSlots().reduce((s, sl) => s + dishCost(sl.dish), 0);
}
function mealsLeft() { const out = {}; if (!S.plan) return out; const pat = pattern(); S.plan.days.forEach(d => d.slots.forEach((sl, i) => { if (!sl) { const t = pat[i][0]; out[t] = (out[t] || 0) + 1; } })); return out; }
const lowBudget = () => +S.collect.budget > 0 && baseBudget() / (S.settings.planLen || 7) * 7 < 2000;
function slotBudget(slotIdx) { const t = pattern()[slotIdx][0]; return (+S.collect.budget || 0) / S.plan.len * (BUDGET_SHARE[S.plan.meals][t] || 10) / 100; }
function budgetPenalty(d, slotIdx) {
  const lim = slotBudget(slotIdx); if (!lim) return 0;
  const p = famCost(d);
  return p > lim * 1.6 ? 99 : p > lim * 1.15 ? 0.25 : 0;
}

/* ---------- Круги: свои для каждого раздела сложности ---------- */
const secs = () => (S.collect.sections && S.collect.sections.length ? [...S.collect.sections].sort() : [1]);
const sysKey = sec => 'any|' + sec;
const curSystems = () => secs().map(sysKey);
const secLabel = () => secs().map(i => SECTIONS[i][0].toLowerCase()).join(', ');
function libMerged(type, which) { // круги выбранных разделов, перемешанные по очереди
  const lists = curSystems().map(k => lib(k, type)[which]), out = [];
  for (let i = 0; lists.some(l => i < l.length); i++) lists.forEach(l => { if (i < l.length) out.push(l[i]); });
  return out;
}
function lib(sys, type) { S.lib[sys] = S.lib[sys] || {}; return (S.lib[sys][type] = S.lib[sys][type] || {main: [], sec: []}); }
function capacity(type) { const pat = pattern(); return pat.filter(m => m[0] === type).length * (S.plan ? S.plan.len : S.settings.planLen) * 4; }
const SEC_CAP = 10;
const DBMAP = {}; DISHES.forEach(d => { DBMAP[d.id] = resolveDish(d); });
const getDish = id => DBMAP[id] || S.dishStore[id] || null;
function rememberDish(d) { if (!DBMAP[d.id]) S.dishStore[d.id] = d; }
function libTake(d, type) {
  Object.values(S.lib).forEach(sys => { const L = sys[type]; if (L) { L.main = L.main.filter(x => x !== d.id); L.sec = L.sec.filter(x => x !== d.id); } });
  const L = lib(sysKey(sectionOf(d)), type); L.main.push(d.id); while (L.main.length > capacity(type)) L.main.shift();
  rememberDish(d);
}
function libRefuse(d, type) { // первый отказ: основной круг → вторичный; второй — удаление навсегда
  const all = Object.values(S.lib).map(sys => sys[type]).filter(Boolean);
  if (all.some(L => L.main.includes(d.id))) { // во всех системах, где блюдо в основном круге, — во вторичный
    all.forEach(L => { if (L.main.includes(d.id)) { L.main = L.main.filter(x => x !== d.id); L.sec.push(d.id); while (L.sec.length > SEC_CAP) L.sec.shift(); } });
    return 'sec';
  }
  if (all.some(L => L.sec.includes(d.id))) { ban(d); return 'ban'; }
  S.cool[d.id] = Date.now() + 28 * 864e5; return 'cool';
}
function ban(d) {
  if (!S.banned.ids.includes(d.id)) feedback(d, 'dislike');
  if (!S.banned.ids.includes(d.id)) S.banned.ids.push(d.id);
  const k = nameKey(d.name); if (!S.banned.names.includes(k)) S.banned.names.push(k);
  Object.values(S.lib).forEach(sys => Object.values(sys).forEach(L => { L.main = L.main.filter(x => x !== d.id); L.sec = L.sec.filter(x => x !== d.id); }));
  rememberDish(d);
}
function unban(id) { const d = getDish(id); feedback(d, 'undislike'); S.banned.ids = S.banned.ids.filter(x => x !== id); if (d) S.banned.names = S.banned.names.filter(x => x !== nameKey(d.name)); }

/* ---------- Подбор одной карточки ---------- */
function fitsSlot(d, ctx, relaxed) {
  if (!d || !d.types.includes(ctx.type) || isBanned(d) || !allowedByDiet(d)) return false;
  if (ctx.seen.has(d.id) || (relaxed !== 'repeat' && usedInPlan(d.id))) return false; // И2: в крайнем случае повтор блюда недели лучше пустого приёма
  if (relaxed !== 'section' && relaxed !== 'repeat' && !secs().includes(sectionOf(d))) return false;
  if (d.src !== 'server' && budgetPenalty(d, ctx.slot) >= 99) return false; // цену новых блюд подбирает сервер по budget_left
  if (!safeFit(d, ctx.day, ctx.slot).ok) return false;
  return healthOk(d, ctx.slot, ctx.tg);
}
function homeBonus(d, day) {
  if (!S.collect.homeOn || !S.collect.home.length || day > 1) return 0;
  const h = S.collect.home.map(x => x.toLowerCase());
  return d.ing.some(i => h.some(x => i.name.toLowerCase().includes(x) || x.includes(i.name.toLowerCase()))) ? -0.4 : 0;
}
const rank = (list, ctx) => list.map(d => [d, scoreDish(d, ctx.tg) + budgetPenalty(d, ctx.slot) + homeBonus(d, ctx.day)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
function pickCircle(which, ctx) { for (const id of libMerged(ctx.type, which)) { const d = getDish(id); if (fitsSlot(d, ctx)) return d; } return null; }
function myCuisine(d) { // «моя» кухня: вес теста ≥ среднего (меняет только тест вкусов); «не моих» нет (веса равны) — все не «мои»
  const lv = d.lvl != null && Array.isArray(S.taste.lvl), w = lv ? S.taste.lvl : S.taste.w, keys = lv ? [0, 1, 2] : [...new Set([...CUISINES, ...Object.keys(S.taste.w)])];
  const vals = keys.map(k => w[k] || 0), m = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (!vals.some(v => v < m)) return false;
  return (w[lv ? d.lvl : d.cuisine] || 0) >= m;
}
let noTaste = false; // «Другие кухни»: среди «не моих» — с равными весами
function pickNewLocal(ctx, relaxed) {
  const now = Date.now(), seenEver = new Set(S.seenEver), inLib = new Set([...libMerged(ctx.type, 'main'), ...libMerged(ctx.type, 'sec')]);
  const imp = S.imports.filter(x => x.share > 0);
  if (imp.length && Math.random() * 100 < imp[0].share) {
    const c = rank(imp[0].ids.map(getDish).filter(d => d && !inLib.has(d.id) && fitsSlot(d, ctx, true)), ctx); if (c[0]) return c[0];
  }
  const pool = [...Object.values(DBMAP), ...Object.values(S.dishStore).filter(d => d.src === 'server')].filter(d => !inLib.has(d.id) && !(S.cool[d.id] > now) && (relaxed || !seenEver.has(d.id)) && !(S.collect.otherCuisines && !relaxed && myCuisine(d)) && fitsSlot(d, ctx, relaxed));
  noTaste = !!(S.collect.otherCuisines && !relaxed); try { return rank(pool, ctx)[0] || null; } finally { noTaste = false; }
}
async function pickNew(ctx) {
  if (Server.on()) { const d = await serverNew(ctx); if (d) return d; }
  return pickNewLocal(ctx) || pickNewLocal(ctx, true) || pickNewLocal(ctx, 'section') || pickNewLocal(ctx, 'repeat');
}
async function nextCard() {
  const F = S.feed, key = F.day + '-' + F.slot, t0 = performance.now();
  F.seen[key] = F.seen[key] || [];
  const ctx = {day: F.day, slot: F.slot, type: pattern()[F.slot][0], tg: slotTarget(F.day, F.slot), seen: new Set(F.seen[key])};
  F.counter = (F.counter || 0) + 1;
  let dish = null, src = 'new';
  const hq = (F.homeQueue || []).findIndex(x => x.types.includes(ctx.type) && F.day <= 1 && !ctx.seen.has(x.id));
  if (hq >= 0) { dish = F.homeQueue.splice(hq, 1)[0]; src = 'home'; }
  else if (F.counter % 5 === 0) { dish = await pickNew(ctx); src = 'new'; }
  else {
    const full = libMerged(ctx.type, 'main').length >= capacity(ctx.type);
    const order = full ? ['main', 'main', 'main', 'sec'] : ['main', 'sec', 'new'];
    const start = (F.rr = (F.rr || 0) + 1) % order.length;
    const seq = [...order.slice(start), ...order.slice(0, start), 'main', 'sec', 'new'];
    for (const s of seq) { dish = s === 'new' ? await pickNew(ctx) : pickCircle(s, ctx); if (dish) { src = s; break; } }
  }
  if (!dish && Server.on()) { dish = await serverLast(ctx); src = 'new'; } // пустой приём недопустим: последний шанс — сервер
  await uniformDelay(t0);
  F.card = dish ? {dish, src} : null;
  if (dish) { F.seen[key].push(dish.id); rememberDish(dish); }
  save();
}

/* ---------- Одинаковая скорость карточек ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function cardDelay() { const a = (S.aiTimes || []).slice(-20).sort((x, y) => x - y); const m = a.length ? a[a.length >> 1] : 1500; return Math.min(5000, Math.max(700, m)); }
async function uniformDelay(t0) { const w = cardDelay() + (Math.random() - 0.5) * 500 - (performance.now() - t0); if (w > 0) await sleep(w); }

/* ---------- Сервер /v1 (API.md, с правками §9) ---------- */
const DEV_KEY = 'moy-racion-device';
function deviceId() { // id устройства: создаётся один раз и хранится отдельно от данных приложения
  let id = null; try { id = localStorage.getItem(DEV_KEY); } catch (e) {}
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2)); try { localStorage.setItem(DEV_KEY, id); } catch (e) {} }
  return id;
}
const API_MSG = {
  no_key: 'Введите ключ доступа из Telegram-бота.',
  key_not_found: 'Ключ не найден. Проверьте его или получите новый в Telegram-боте.',
  expired: 'Подписка закончилась. Продлите её в Telegram-боте — собранный рацион остаётся с вами.',
  device_mismatch: 'Ключ привязан к другому устройству. Отвяжите его в Telegram-боте командой /device и повторите.',
  blocked: 'Ключ заблокирован. Напишите в Telegram-бот.',
  exhausted: 'Подходящие блюда закончились — добавьте другое время готовки или смягчите запреты.',
  ai_invalid: 'Не удалось составить блюдо. Попробуйте сформулировать иначе.',
  ai_limit: 'Лимит нейросети на сегодня исчерпан. Новые блюда — из базы, завтра лимит обновится.',
  rate_limited: 'Слишком много запросов. Подождите немного.',
  ai_unavailable: 'Нейросеть сейчас недоступна, попробуйте позже.',
  server_error: 'Ошибка сервера. Попробуйте позже.',
  bad_request: 'Ошибка приложения: сервер не понял запрос.',
  not_found: 'Ошибка приложения: неизвестный запрос.',
  net: 'Нет связи с сервером. Проверьте интернет.'
};
const KEY_ERRORS = ['no_key', 'key_not_found', 'expired', 'device_mismatch', 'blocked'];
class ApiError extends Error { constructor(code, msg, data) { super(msg || API_MSG[code] || API_MSG.server_error); this.code = code; this.data = data || {}; } }
const Server = {
  on: () => !!S.settings.serverUrl,
  base: () => S.settings.serverUrl.trim().replace(/\/$/, ''),
  async call(path, body, opts = {}) {
    const keyed = opts.keyed !== false, t0 = performance.now();
    if (keyed && path !== '/v1/feedback') await flushFeedback();
    const req = keyed ? Object.assign({key: S.settings.accessKey, device: deviceId()}, body || {}) : body;
    let res, j;
    try {
      res = await fetch(this.base() + path, opts.get ? {method: 'GET'} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(req)});
      j = await res.json().catch(() => ({ok: false, error: 'server_error'}));
    } catch (e) { logApi(path, req, {ok: false, error: 'net', message: e.message}, t0); throw new ApiError('net'); }
    logApi(path, req, j, t0, res.status);
    if (j && j.ok) return j;
    const code = (j && j.error) || 'server_error';
    if (code === 'rate_limited' && !opts.retried) { await sleep(Math.min(10, +j.retry_after || 2) * 1000); return this.call(path, body, Object.assign({}, opts, {retried: true})); }
    if (KEY_ERRORS.includes(code)) S.access = Object.assign({}, S.access || {}, {error: code, until: j.until || (S.access && S.access.until), checkedAt: Date.now()});
    throw new ApiError(code, (code in API_MSG && !['bad_request', 'not_found', 'server_error'].includes(code)) ? API_MSG[code] : (j && j.message) || API_MSG[code], j);
  }
};
function logApi(path, req, res, t0, status) { // последний запрос и ответ — для страницы «Системный» (без ключа)
  const r = Object.assign({}, req || {}); if (r.key) r.key = '••••' + String(r.key).slice(-4);
  const cut = JSON.stringify(res || {}); S.apiLog = {at: Date.now(), path, status: status || 0, ms: r0(performance.now() - t0), req: r, res: cut.length > 6000 ? JSON.parse(JSON.stringify(res, (k, v) => Array.isArray(v) && v.length > 3 ? v.slice(0, 3).concat(['…']) : v)) : res};
}
async function flushFeedback() { // отзывы копятся и уходят пачкой перед следующим запросом
  if (!Server.on() || !S.settings.accessKey || !S.fbq.length || flushFeedback.busy) return;
  flushFeedback.busy = true; const items = S.fbq.slice(0, 50);
  try { await Server.call('/v1/feedback', {items}); S.fbq.splice(0, items.length); save(); } catch (e) {} finally { flushFeedback.busy = false; }
}
function feedback(d, action) { // только блюда общей базы сервера
  if (!d || DBMAP[d.id] || d.src !== 'server') return;
  S.fbq.push({dish: d.id, action}); if (S.fbq.length > 500) S.fbq.splice(0, S.fbq.length - 500);
}
async function checkKey(silent) { // POST /v1/key — при вводе ключа и перед сбором
  if (!S.settings.accessKey) { S.access = {error: 'no_key', checkedAt: Date.now()}; save(); throw new ApiError('no_key'); }
  const j = await Server.call('/v1/key', {});
  S.access = {plan: j.plan, until: j.until, days_left: j.days_left, ai_left: j.ai_left_today, bound_now: !!j.bound_now, checkedAt: Date.now()};
  if (j.tastes && Array.isArray(j.tastes.w)) S.taste.lvl = j.tastes.w;
  save(); if (!silent && j.bound_now) toast('Ключ привязан к этому устройству');
  return j;
}
const LEVELS = ['Классика', 'Необычное', 'Экзотика'];
const DIET_API = {all: 'all', nopork: 'no_pork', pesc: 'pescatarian', veg: 'vegetarian', vegan: 'vegan'};
const MICRO_KEYS = ['vc', 'va', 'ca', 'fe', 'mg', 'k', 'b12', 'd', 'fol', 'n3', 'na'];
function fromApi(o) { // блюдо API.md §4 → внутренний формат (хранится в кэше целиком)
  if (!o || !o.id || !o.name || !Array.isArray(o.ing) || !o.ing.length) throw new ApiError('bad_request', 'Неполное блюдо от сервера');
  return {id: String(o.id), num: o.num, section: o.section, cuisine: LEVELS[o.cuisine] || '', lvl: o.cuisine, name: String(o.name), types: o.types || '', time: +o.time || 30, diff: +o.diff || 3, salt: +o.salt || 0,
    steps: (o.steps || []).map(String), allergens: o.allergens || [], flags: o.flags || '', cost: o.base ? +o.base.cost : undefined, pclass: o.pclass, base: o.base, src: 'server', priceAt: Date.now(),
    ing: o.ing.map(x => { const m = Array.isArray(x.micro) ? x.micro : []; const r = {id: x.id, name: x.name, cat: x.cat, unit: x.unit || 'g', pcs_g: x.pcs_g, price: +x.price || 0, kcal: +x.kcal || 0, p: +x.p || 0, f: +x.f || 0, c: +x.c || 0, fib: +x.fib || 0, flags: x.flags || '', allergens: x.allergens || [], g: +x.g || 0};
      MICRO_KEYS.forEach((k, i) => r[k] = +m[i] || 0); return r; })};
}
function eaterReq(day, slot) { // API §3 `eater`: главный едок — цели дня и что уже съел сегодня (без веса, возраста, пола, имён)
  const p = mainEater(), t = personTargets(p), cl = (v, a, b) => Math.max(a, Math.min(b, v)), u = S.plan && S.plan.days[day] ? eaterDay(day, slot) : {};
  const kcal = r0(cl(t.E, 1200, 4500)), used = {};
  [['na', 'na'], ['ret', 'ret'], ['sugar_add', 'sugar'], ['d', 'd'], ['ca', 'ca'], ['fe', 'fe'], ['vc', 'vc'], ['p', 'p'], ['fib', 'fib']].forEach(([k, x]) => used[k] = r1(u[x] || 0));
  return {f: cl(Math.ceil(kcal / 2 + 0.5) / 1000, 0.6, 2.5), kcal, p: r0(cl(t.P, 40, 250)), fat: r0(cl(t.F, 30, 180)), c: r0(cl(t.C, 130, 700)), fib: r0(cl(t.fib, 20, 60)),
    p_max: r0(cl(0.6 * p.weight, 20, 80)), used, ca2000: S.people.some(x => x.age > 50), pregnant: false};
}
function dishRequest(ctx, extra = {}) { // тело /v1/dish: только нормы и параметры, без имён и личных данных
  const pat = pattern(), st = S.settings, ex = new Set();
  allSlots().forEach(sl => ex.add(sl.dish.id)); (ctx.seen || []).forEach(id => ex.add(id));
  return Object.assign({meal: pat[ctx.slot][0], sections: secs(), count: 1, eater: eaterReq(ctx.day, ctx.slot),
    meal_share: pat[ctx.slot][2] / 100, budget_left: Math.max(0, r0(budgetLeft())), meals_left: mealsLeft(), meals_per_day: S.plan.meals,
    allergies: st.allergens || [], diet: DIET_API[st.diet] || 'all', forbid: st.forbidden, exclude: [...ex].filter(id => !DBMAP[id]).slice(-300), other_cuisines: !!S.collect.otherCuisines}, extra);
}
async function fetchDishes(ctx, extra) {
  const t0 = performance.now(), j = await Server.call('/v1/dish', dishRequest(ctx, extra));
  if ((j.source || []).includes('ai')) { S.aiTimes.push(performance.now() - t0); S.aiTimes = S.aiTimes.slice(-20); }
  if (S.access && j.ai_left_today != null) S.access.ai_left = j.ai_left_today;
  const list = (j.dishes || []).map(fromApi); list.forEach(rememberDish);
  if (j.short && S.feed && !S.feed.shortWarned) { S.feed.shortWarned = true; if (j.short === 'ai_limit') toast(API_MSG.ai_limit); }
  return list;
}
async function serverNew(ctx) { // каждая 5-я карточка: новое блюдо с сервера; берём по 3 за запрос
  const qk = ctx.type + '|' + secs().join('') + (S.collect.otherCuisines ? '|o' : ''), Q = S.srvQueue[qk] = (S.srvQueue[qk] || []).filter(id => getDish(id));
  const fromQ = () => { while (Q.length) { const d = getDish(Q.shift()); if (fitsSlot(d, ctx, true)) return d; } return null; };
  let d = fromQ(); if (d) return d;
  try { (await fetchDishes(ctx, {count: 3})).forEach(x => Q.push(x.id)); d = fromQ(); }
  catch (e) { noteServerError(e); }
  return d;
}
async function serverLast(ctx) { // в кругах и базе пусто: одно блюдо прямо с сервера (он закрывает приём нейросетью)
  try { const l = await fetchDishes(ctx, {count: 1}); return l.find(d => allowedByDiet(d) && !isBanned(d) && !ctx.seen.has(d.id)) || null; }
  catch (e) { noteServerError(e); return null; }
}
function noteServerError(e) {
  const F = S.feed; if (F && F.errWarned === e.code) return; if (F) F.errWarned = e.code;
  toast(String(e.message || '').replace(/[.!]?\s*$/, '.') + (KEY_ERRORS.includes(e.code) ? '' : ' Беру блюда из ваших кругов.'));
}
async function refreshPrices() { // раз в неделю: актуальные cost для блюд кругов
  if (!Server.on() || !S.settings.accessKey || Date.now() - (S.pricesAt || 0) < 7 * 864e5) return;
  const ids = [...new Set(Object.values(S.lib).flatMap(sys => Object.values(sys).flatMap(L => [...L.main, ...L.sec])))].filter(id => S.dishStore[id] && S.dishStore[id].src === 'server').slice(0, 300);
  if (!ids.length) { S.pricesAt = Date.now(); save(); return; }
  try {
    const j = await Server.call('/v1/prices', {ids});
    const upd = d => { const c = j.cost && j.cost[d.id]; if (c == null || !d.cost) return; const k = c / d.cost; d.ing.forEach(i => i.price = r1(i.price * k)); d.cost = c; d.priceAt = Date.now(); };
    ids.forEach(id => upd(S.dishStore[id])); allSlots().forEach(sl => upd(sl.dish));
    S.pricesAt = Date.now(); save();
  } catch (e) {}
}

/* ---------- UI: общие ---------- */
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function sheet(html, onMount, opts = {}) {
  const el = $('#sheet'); el.classList.toggle('full', !!opts.full); el.classList.remove('pulling'); $('.sheet-card').style.transform = '';
  $('#sheet-body').innerHTML = html; el.hidden = false; $('#sheet-body').scrollTop = 0; document.body.classList.add('sheeted'); onMount && onMount($('#sheet-body'));
}
const closeSheet = () => { $('#sheet').hidden = true; document.body.classList.remove('sheeted'); };
(function pullToClose() { // полноэкранное окно: потянуть вниз от верха — закрыть
  const body = $('#sheet-body'), card = $('.sheet-card'); let y0 = null, dy = 0;
  body.addEventListener('touchstart', e => { y0 = body.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
  body.addEventListener('touchmove', e => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) { card.style.transform = ''; return; } card.style.transition = 'none'; card.style.transform = `translateY(${110 * (1 - Math.exp(-dy / 110))}px)`; }, {passive: true});
  body.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; card.style.transition = ''; card.style.transform = ''; if (dy > 90) closeSheet(); });
})();
function applyTheme() { const r = document.documentElement; if (S.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme); r.setAttribute('data-accent', S.accent || 'gold'); }
const IC = {
  plus: '<path d="M12 5v14M5 12h14"/>', down: '<path d="M6 9.5l6 6 6-6"/>',
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
 code: '<rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="currentColor" fill-opacity=".14"/><path d="M9 10l-2.5 2.5L9 15M15 10l2.5 2.5L15 15M12.8 9l-1.6 7"/>',
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
  const vk = (S.feed && S.feed.active) ? 'feed' : S.ui.tab + (S.ui.set || ''); if (vk !== lastView) { const sc = $('#scroller'); if (sc) sc.scrollTop = 0; window.scrollTo(0, 0); lastView = vk; }
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.ui.tab ? 'page' : 'false'));
  const v = $('#view');
  if (!S.onboarded || !S.people.length) { v.innerHTML = viewOnboard(); bindOnboard(); $('#nav').hidden = true; return; }
  $('#nav').hidden = false;
  const feeding = !!(S.feed && S.feed.active); document.body.classList.toggle('feeding', feeding);
  if (feeding) { const old = $('#feedwrap');
    if (old) { const t = document.createElement('div'); t.innerHTML = viewFeed(); const nw = t.firstElementChild; ['.ftop', '.slots', '.deck', '.fbtns'].forEach(q => { const a = old.querySelector(q), b = nw.querySelector(q); if (a && b) a.replaceWith(b); }); }
    else v.innerHTML = viewFeed();
    bindFeed(); $('#nav').hidden = true; return; }
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
  <label>Цель<select id="pf-goal">${Object.entries(GOALS).map(([k, g]) => `<option value="${k}"${safeGoal({height: p.height || 175, weight: p.weight || 75}, p.goal) === k ? ' selected' : ''}${k === 'loss' && !lossOk(p.height || 175, p.weight || 75) ? ' disabled' : ''}>${g[0]}</option>`).join('')}</select></label>
  <p class="hint">Приложение рассчитано на взрослых 18+. Детские нормы появятся позже.</p></div>`;
}
function readPerson(id) {
  const age = +$('#pf-age').value;
  if (!$('#pf-name').value.trim()) { toast('Введите имя'); return null; }
  if (age < 18) { toast('Пока поддерживаются только взрослые 18+'); return null; }
  return {id: id || 'p' + Date.now(), name: $('#pf-name').value.trim(), sex: $('#pf-sex').value, age, height: +$('#pf-height').value, weight: +$('#pf-weight').value, activity: +$('#pf-act').value, goal: safeGoal({height: +$('#pf-height').value, weight: +$('#pf-weight').value}, $('#pf-goal').value)};
}
function viewOnboard() {
  return `<section class="onb"><div class="crest">${ic('leaf')}</div><p class="eyebrow">Мой рацион</p><h1 class="gt">Рацион на неделю, собранный под вашу семью</h1>
  <p class="lead">Расскажите о себе — по этим данным приложение рассчитает калории, белки, жиры, углеводы и клетчатку. Семью добавите позже в настройках.</p>
  ${personForm({sex: 'm'})}<button class="btn primary wide" id="onb-go">Начать</button></section>`;
}
function bindOnboard() { $('#onb-go').onclick = () => { const p = readPerson(); if (!p) return; S.people = [p]; S.onboarded = true; save(); render(); offerTasteTest(); }; }
function offerTasteTest() { // после онбординга: тест вкусов, можно пропустить
  sheet(`<p class="eyebrow">Тест вкусов</p><h3>Что вам по вкусу?</h3><p class="hint">1–2 минуты: выберите из пар блюд то, что больше нравится. Пройти позже можно в настройках, «Мои вкусы».</p><div class="actions two"><button class="btn ghost" id="tt-skip">Пропустить</button><button class="btn primary" id="tt-go">Пройти</button></div>`, b => { $('#tt-skip', b).onclick = closeSheet; $('#tt-go', b).onclick = () => tasteTest('self'); });
}

/* ---------- Рацион ---------- */
function pastDay(j) { // j < 0: прошедший день из истории (до 7 дней назад)
  const H = S.lastWeek; if (!H || !H.days) return null;
  const ds = addDays(iso(new Date()), j), k = Math.round((new Date(ds + 'T12:00:00') - new Date(H.start + 'T12:00:00')) / 864e5);
  return k >= 0 && k < H.days.length ? {d: H.days[k], pat: PATTERNS[H.meals] || pattern()} : null;
}
let stripKeep = null; // положение ленты дней между перерисовками
function viewPlan() {
  const v = $('#view'), ti = todayIdx(), off = Math.max(-7, Math.min(6, S.ui.off || 0));
  const inPlan = k => S.plan && k >= 0 && k < S.plan.len;
  const past = []; for (let j = -7; j < 0; j++) { const p = pastDay(j); if (p && p.d.slots.some(Boolean)) { past.push(j); } else if (past.length) past.push(j); }
  const chip = j => { const ds = addDays(iso(new Date()), j), dt = new Date(ds + 'T12:00:00');
    const d = j < 0 ? (pastDay(j) || {}).d : inPlan(ti + j) ? S.plan.days[ti + j] : null, filled = d ? d.slots.filter(Boolean).length : 0;
    const cls = (j === off ? ' on' : '') + (j === 0 ? ' today' : '') + (j < 0 ? ' past' : '') + (d && filled === d.slots.length ? '' : ' blank');
    return `<button class="daychip${cls}" data-off="${j}"><span>${DOW[dt.getDay()]}</span><b>${dt.getDate()}</b><i>${filled ? filled + '/' + d.slots.length : '—'}</i></button>`; };
  const strip = past.concat([0, 1, 2, 3, 4, 5, 6]).map(chip).join('');
  const placeStrip = () => { const st = v.querySelector('.strip'); if (!st) return;
    if (stripKeep != null) st.scrollLeft = stripKeep; else { const t = st.querySelector('.daychip.today'); if (t) st.scrollLeft = t.offsetLeft - st.offsetLeft - 3; }
    stripKeep = null; };
  const bindStrip = () => { placeStrip(); v.querySelectorAll('.daychip').forEach(b => b.onclick = () => { const j = +b.dataset.off, k = ti + j;
    if (j >= 0 && j === off && inPlan(k) && S.plan.days[k].slots.some(Boolean)) return dayPassport(k);
    stripKeep = v.querySelector('.strip').scrollLeft; S.ui.off = j; if (inPlan(k)) S.ui.day = k; save(); render(); }); };
  const sdt = new Date(addDays(iso(new Date()), off) + 'T12:00:00'), dlabel = `${DOW[sdt.getDay()]}, ${sdt.getDate()} ${MON[sdt.getMonth()]}`;
  const goCollect = () => { S.ui.tab = 'collect'; save(); render(); };
  if (off < 0) { // прошедший день — только просмотр
    const p = pastDay(off), d = p && p.d;
    const meals = d && d.slots.some(Boolean) ? p.pat.map((m, i) => { const sl = d.slots[i]; if (!sl) return `<article class="meal empty-meal past"><p class="mtype">${m[1]}</p><p>Не выбрано</p></article>`;
      const n = nut(sl.dish); return `<article class="meal past"><div class="mhead"><span class="mtype">${m[1]}${sl.status === 'eaten' ? ' · съедено' : sl.status === 'skipped' ? ' · пропущено' : ''}</span><span class="mname">${esc(sl.dish.name)}</span><span class="macro">${kbju(n)}</span></div></article>`; }).join('')
      : `<div class="empty"><h3>В этот день блюд не было</h3><p>Прошедшие дни показываются только для просмотра.</p></div>`;
    v.innerHTML = `${appbar('Рацион', 'Прошедший день')}<nav class="strip" aria-label="Дни">${strip}</nav><p class="dayhint">${dlabel} · прошедший день, только просмотр</p><div class="meals">${meals}</div>`;
    bindStrip(); return; }
  if (!S.plan) { v.innerHTML = `${appbar('Рацион', 'С сегодняшнего дня')}<nav class="strip" aria-label="Дни">${strip}</nav><div class="empty"><p class="eyebrow">Рацион не собран</p><h3>Рацион на 7 дней с сегодняшнего</h3><p>Соберите рацион — блюда появятся здесь по дням, а список покупок — в «Продуктах».</p><button class="btn primary wide" id="go-collect">Собрать рацион</button></div>`; bindStrip(); $('#go-collect').onclick = goCollect; return; }
  const day = ti + off, has = inPlan(day), pat = pattern();
  const filled = has && S.plan.days[day].slots.some(Boolean);
  const meals = filled ? pat.map((m, i) => mealCard(day, i, m)).join('') : `<div class="empty"><h3>На этот день блюд нет</h3><p>${has ? 'Соберите рацион, чтобы заполнить день.' : 'Этот день не входит в текущий рацион — он появится в следующем сборе.'}</p><button class="btn primary wide" id="go-collect">Собрать рацион</button></div>`;
  const end = new Date(addDays(S.plan.start, S.plan.len - 1) + 'T12:00:00');
  v.innerHTML = `${appbar('Рацион', `${S.plan.len} дн. · по ${end.getDate()} ${MON[end.getMonth()]}`)}
  <nav class="strip" aria-label="Дни">${strip}</nav>
  <p class="dayhint">${dlabel}${off === 0 ? ' · сегодня' : ''}${filled ? ' · нажмите на день ещё раз — откроется паспорт дня' : ''}</p>
  <div class="meals">${meals}</div>`;
  bindStrip();
  const gc = $('#go-collect'); if (gc) gc.onclick = goCollect;
  v.querySelectorAll('[data-meal]').forEach(b => b.onclick = () => { const [d, i] = b.dataset.meal.split(':').map(Number); mealPage(d, i); });
  v.querySelectorAll('[data-replace]').forEach(b => b.onclick = () => { const [d, i] = b.dataset.replace.split(':').map(Number); replaceSlot(d, i); });
}
function mealCard(day, i, m) {
  const sl = S.plan.days[day].slots[i];
  if (!sl) return `<article class="meal empty-meal"><p class="mtype">${m[1]}</p><p>Не выбрано</p><button class="btn ghost" data-replace="${day}:${i}">Подобрать</button></article>`;
  const d = sl.dish, ff = famFactor(d, i), n = nut(d, ff);
  if (sl.unsafe) return `<article class="meal unsafe"><p class="mtype">${m[1]}</p><p class="mname">${esc(d.name)}</p><p class="hint">Это блюдо нужно заменить</p><button class="btn primary" data-replace="${day}:${i}">Заменить блюдо</button></article>`;
  return `<article class="meal${sl.status ? ' st-' + sl.status : ''}">
   <button class="mhead" data-meal="${day}:${i}" aria-haspopup="dialog"><span class="mgo" aria-hidden="true">›</span>
     <span class="mtype">${m[1]}${sl.status === 'eaten' ? ' · съедено' : sl.status === 'skipped' ? ' · пропущено' : ''}</span>
     <span class="mname">${esc(d.name)}</span>
     <span class="macro">${kbju(n)}</span>
     <span class="meta"><span>${r0(n.g)} г на всех</span><span>${d.time} мин</span><span>сложность ${d.diff}/10</span></span>
   </button>
  </article>`;
}
function replaceSlot(day, i) {
  const sl = S.plan.days[day].slots[i];
  if (!sl) { startFeed(day, i, true); return; }
  const d = sl.dish, type = pattern()[i][0];
  sheet(`<p class="eyebrow">Замена блюда</p><h3>${esc(d.name)}</h3><p class="hint">Почему меняем? От этого зависит, вернётся ли блюдо в ваши круги.</p>
   <div class="actions"><button class="btn ghost" id="rp-today">Не сегодня</button><button class="btn ghost" id="rp-dis">Не нравится — убрать навсегда</button></div>`, b => {
    const go = hard => { if (hard) ban(d); else { feedback(d, 'skip'); libRefuse(d, type); } S.plan.days[day].slots[i] = null; if (sl.leftover === undefined && S.plan.days[day + 1] && S.plan.days[day + 1].slots[i] && S.plan.days[day + 1].slots[i].leftover && S.plan.days[day + 1].slots[i].dish.id === d.id) S.plan.days[day + 1].slots[i] = null; save(); closeSheet(); startFeed(day, i, true); };
    $('#rp-today', b).onclick = () => go(false); $('#rp-dis', b).onclick = () => go(true);
  });
}
function fmtAmt(i, g) {
  if (i.unit === 'pcs') return Math.max(1, Math.round(g / (i.pcs_g || 55))) + ' шт';
  if (i.unit === 'ml') return r0(g) + ' мл';
  return r0(g) + ' г';
}
function portionSheet(day, i) {
  const d = S.plan.days[day].slots[i].dish, fs = slotFactor(d, i), tot = fs.reduce((a, b) => a + b, 0), base = nut(d);
  sheet(`<h3>Порции: ${esc(d.name)}</h3><p class="hint">Блюдо одно на всех, порции рассчитаны по нормам каждого.</p>
  <ul class="ing">${S.people.map((p, k) => `<li><span>${esc(p.name)}</span><b>${r0(fs[k] / tot * 100)}% · ${r0(base.g * fs[k])} г · ${r0(base.kcal * fs[k])} ккал</b></li>`).join('')}</ul>`);
}
function mealPage(day, i) { // блюдо — отдельное полноэкранное окно
  const sl = S.plan.days[day].slots[i]; if (!sl) return;
  const d = sl.dish, m = pattern()[i], ff = famFactor(d, i), n = nut(d, ff), ti = todayIdx();
  const dt = new Date(addDays(S.plan.start, day) + 'T12:00:00'), fs = slotFactor(d, i), tot = fs.reduce((a, b) => a + b, 0), base = nut(d);
  sheet(`<p class="eyebrow">${m[1]} · ${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}${sl.status === 'eaten' ? ' · съедено' : sl.status === 'skipped' ? ' · пропущено' : ''}</p>
   <h2 class="pg-title">${esc(d.name)}</h2>
   <div class="grid4"><div><b>${r0(n.kcal)}</b><span>ккал</span></div><div><b>${r0(n.p)}</b><span>белки, г</span></div><div><b>${r0(n.f)}</b><span>жиры, г</span></div><div><b>${r0(n.c)}</b><span>углеводы, г</span></div></div>
   <div class="facts"><div><em>Готовка</em><b>${d.time} мин</b></div><div><em>Сложность</em><b>${d.diff} из 10</b></div><div><em>Клетчатка</em><b>${r1(n.fib)} г</b></div><div><em>Стоимость</em><b>≈ ${r0(famCost(d) / 10) * 10} ₽</b></div></div>
   ${S.marks.notes[d.id] ? `<p class="note">${ic('heart', 'sm')} ${esc(S.marks.notes[d.id])}</p>` : ''}
   <h4>Ингредиенты на всех · ${r0(n.g)} г</h4><ul class="ing">${d.ing.map(x => `<li><span>${esc(x.name)}</span><b>${fmtAmt(x, x.g * ff)}</b></li>`).join('')}${d.salt || d.saltOrig ? '<li><span>Соль</span><b>по вкусу</b></li>' : ''}</ul>
   ${stepsOf(d).length ? `<h4>Как готовить</h4><ol class="steps">${stepsOf(d).map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
   ${S.people.length > 1 ? `<h4>Порции по людям</h4><ul class="ing">${S.people.map((p, k) => `<li><span>${esc(p.name)}</span><b>${r0(base.g * fs[k])} г · ${r0(base.kcal * fs[k])} ккал</b></li>`).join('')}</ul>` : ''}
   ${day <= ti ? `<div class="actions two"><button class="btn${sl.status === 'eaten' ? ' primary' : ' ghost'}" data-st="eaten">Съедено</button><button class="btn${sl.status === 'skipped' ? ' primary' : ' ghost'}" data-st="skipped">Пропущено</button></div>` : ''}
   <button class="btn ghost wide" id="mp-replace">Заменить блюдо</button>`, b => {
    b.querySelectorAll('[data-st]').forEach(x => x.onclick = () => { sl.status = sl.status === x.dataset.st ? null : x.dataset.st; save(); render(); mealPage(day, i); });
    $('#mp-replace', b).onclick = () => replaceSlot(day, i);
  }, {full: true});
}
function familyMicro() { const t = {}; Object.keys(MICRO).forEach(k => t[k] = 0); S.people.forEach(p => { const m = microNorm(p, S.settings.norms); Object.keys(t).forEach(k => t[k] += m[k]); }); return t; }
function dayTotals(day) {
  const t = nut({ing: [], salt: 0});
  S.plan.days[day].slots.forEach((sl, i) => { if (!sl || sl.status === 'skipped') return; const n = nut(sl.dish, famFactor(sl.dish, i)); Object.keys(t).forEach(k => t[k] += n[k]); });
  return t;
}
function dayPassport(day) { // только калории, БЖУ и клетчатка (решения 14.10: всё о питании — под капотом)
  const t = dayTotals(day), fam = familyDay();
  const filled = S.plan.days[day].slots.filter(Boolean).length, all = S.plan.days[day].slots.length;
  const dt = new Date(addDays(S.plan.start, day) + 'T12:00:00');
  sheet(`<p class="eyebrow">Паспорт дня</p><h2 class="pg-title">${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}</h2>
  <div class="grid4"><div><b>${r0(t.kcal)}</b><span>ккал</span></div><div><b>${r0(t.p)}</b><span>белки, г</span></div><div><b>${r0(t.f)}</b><span>жиры, г</span></div><div><b>${r0(t.c)}</b><span>углеводы, г</span></div></div>
  <p>Клетчатка ${r0(t.fib)} г на всех</p>
  ${filled < all ? `<p class="hint">Собрано ${filled} из ${all} приёмов.</p>` : ''}
  <h4>Приёмы дня</h4><ul class="ing">${pattern().map((m, i) => { const sl = S.plan.days[day].slots[i]; return `<li><span>${m[1]}${sl ? ' · ' + esc(sl.dish.name) : ''}</span><b>${sl ? r0(nut(sl.dish, famFactor(sl.dish, i)).kcal) + ' ккал' : '—'}</b></li>`; }).join('')}</ul>
  ${S.people.length > 1 ? `<h4>По людям</h4><ul class="ing">${S.people.map(p => { const sh = personTargets(p).E / fam.E; return `<li><span>${esc(p.name)}</span><b>${r0(t.kcal * sh)} ккал · Б ${r0(t.p * sh)} · Ж ${r0(t.f * sh)} · У ${r0(t.c * sh)}</b></li>`; }).join('')}</ul>` : ''}`, null, {full: true});
}

/* ---------- Сбор рациона ---------- */
function viewCollect() {
  const c = S.collect, st = S.settings, med = Object.values(st.medical).some(Boolean);
  const per = st.planLen === 7 ? '7 дней' : '3 дня';
  const started = S.plan && S.plan.days.some(d => d.slots.some(Boolean));
  const chipsList = (arr, attr) => arr.length ? `<div class="chips">${arr.map((w, i) => `<button class="chip x" data-${attr}="${i}">${esc(w)}</button>`).join('')}</div>` : '';
  const pat = PATTERNS[S.plan ? S.plan.meals : mealsCount()], len = S.plan ? S.plan.len : st.planLen, start = S.plan ? S.plan.start : cycleStart(len);
  const wishes = allSlots().filter(s => s.fromDesired && !s.leftover);
  const sys = S.plan ? libSummary() : '';
  $('#view').innerHTML = `${appbar('Сбор рациона', st.planLen === 7 ? '7 дней с сегодняшнего' : '3 дня с сегодняшнего')}
  ${med ? '<div class="warn box">Отмечено состояние здоровья, при котором автоматический рацион не подходит. Составьте питание вместе с врачом.</div>' : ''}
  <div class="panel">
   <label class="field"><span><em>Бюджет семьи на ${per}, ₽</em><input id="c-budget" type="number" inputmode="numeric" min="0" step="100" value="${c.budget}"></span></label>
   <p class="budgetnote${lowBudget() ? ' low' : ''}">${lowBudget() ? `≈ ${r0(baseBudget() / (st.planLen || 7) * 7 / 10) * 10} ₽ в неделю на взрослого — полноценный рацион в такой бюджет не уложится. Подберу самые экономные блюда.` : `≈ ${r0(baseBudget() / (st.planLen || 7) * 7 / 10) * 10} ₽ в неделю на взрослого${S.plan ? ` · осталось ≈ ${r0(Math.max(0, budgetLeft()) * famK() / 10) * 10} ₽` : ''}`}</p>
   <div class="field col"><em>Время готовки · можно несколько</em><div class="secgrid">${SECTIONS.map(([t], i) => `<button class="secbtn${c.sections.includes(i) ? ' on' : ''}" data-sec="${i}" aria-pressed="${c.sections.includes(i)}" aria-label="${t}, ${SEC_TIME[i][1]}"><b>${SEC_TIME[i][0]}</b><small>${SEC_TIME[i][1]}</small></button>`).join('')}</div><small class="secnote">${c.sections.length ? c.sections.slice().sort().map(i => SECTIONS[i][0]).join(' · ') : 'Выберите хотя бы одно'}</small></div>
  </div>
  <div class="panel gap">
   <div class="field col"><em>Желаемое блюдо</em>
     <div class="wishrow"><input id="c-wish" placeholder="Борщ, плов…" enterkeyhint="done" aria-label="Название блюда"><select id="c-wish-slot" aria-label="Приём пищи">${[...new Set(pat.map(m => m[0]))].map(t => `<option value="${t}">${pat.find(m => m[0] === t)[1].replace(/ \d$/, '')}</option>`).join('')}</select><button class="addbtn" id="c-wish-add" aria-label="Поставить в рацион">${ic('plus')}</button></div>
     ${wishes.length ? `<div class="chips">${wishes.map(s => `<span class="chip">${esc(s.dish.name)}</span>`).join('')}</div>` : ''}
     <small>Встанет на ближайший свободный день. Если блюда нет в базе, его составит нейросеть.</small></div>
   <div class="field switch">${ic('shop')}<span><em>Есть продукты дома</em><small>Блюда из них — в ближайшие дни, в покупках их не будет</small></span><button class="tog${c.homeOn ? ' on' : ''}" id="c-home-tog" role="switch" aria-checked="${c.homeOn}" aria-label="Есть продукты дома"><i></i></button></div>
   ${c.homeOn ? `<div class="field col"><div class="chipin"><input id="c-home" placeholder="Например, гречка" enterkeyhint="done"><button class="btn ghost sm" id="c-home-add">Добавить</button></div>${chipsList(c.home, 'rmhome')}</div>` : ''}
   <div class="field switch">${ic('dish')}<span><em>Готовить на 2 дня</em><small>Обед и ужин — одной готовкой</small></span><button class="tog${c.cook2 ? ' on' : ''}" id="c-cook2" role="switch" aria-checked="${c.cook2}" aria-label="Готовить на 2 дня"><i></i></button></div>
   <div class="field switch">${ic('leaf')}<span><em>Другие кухни</em><small>Новые блюда — из кухонь, которые вы выбираете реже</small></span><button class="tog${c.otherCuisines ? ' on' : ''}" id="c-other" role="switch" aria-checked="${!!c.otherCuisines}" aria-label="Другие кухни"><i></i></button></div>
  </div>
  ${sys}
  ${S.plan ? '<button class="btn ghost wide reset" id="c-reset">Начать рацион заново</button>' : ''}
  <div class="cta"><button class="btn primary wide big" id="c-go"${med ? ' disabled' : ''}>${ic('collect')}<span>${started ? 'Продолжить сбор' : 'Собрать рацион'}</span></button></div>`;
  const bindList = (inp, btn, arr) => { const add = () => { const x = $(inp).value.trim(); if (!x) return; arr.push(x); save(); render(); }; $(btn).onclick = add; $(inp).onkeydown = e => { if (e.key === 'Enter') add(); }; };
  $('#c-home-tog').onclick = () => { c.homeOn = !c.homeOn; save(); render(); };
  if (c.homeOn) { bindList('#c-home', '#c-home-add', c.home); document.querySelectorAll('[data-rmhome]').forEach(b => b.onclick = () => { c.home.splice(+b.dataset.rmhome, 1); save(); render(); }); }
  document.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { const i = +b.dataset.sec, a = c.sections;
    if (a.includes(i)) { if (a.length === 1) { toast('Нужна хотя бы одна сложность'); return; } a.splice(a.indexOf(i), 1); } else a.push(i);
    a.sort(); save(); render(); });
  $('#c-budget').onchange = e => { c.budget = +e.target.value || 0; save(); render(); };
  $('#c-cook2').onclick = () => { c.cook2 = !c.cook2; save(); render(); };
  $('#c-other').onclick = () => { c.otherCuisines = !c.otherCuisines; S.srvQueue = {}; save(); render(); };
  const wish = () => addDesired($('#c-wish').value.trim(), $('#c-wish-slot').value);
  $('#c-wish-add').onclick = wish; $('#c-wish').onkeydown = e => { if (e.key === 'Enter') wish(); };
  $('#c-go').onclick = startCollect;
  const rs = $('#c-reset'); if (rs) rs.onclick = () => sheet(`<h3>Начать рацион заново?</h3><p>Все выбранные блюда на эти дни будут удалены. Ваши круги блюд сохранятся.</p><div class="actions two"><button class="btn ghost" id="rs-no">Отмена</button><button class="btn primary" id="rs-yes">Удалить и начать</button></div>`, b => { $('#rs-no', b).onclick = closeSheet; $('#rs-yes', b).onclick = () => { S.plan = null; S.feed = null; save(); closeSheet(); render(); }; });
}
function libSummary() {
  const pat = pattern(), types = [...new Set(pat.map(m => m[0]))], names = {b: 'Завтраки', l: 'Обеды', d: 'Ужины', s: 'Перекусы'};
  return `<details class="panel libsum"><summary>Ваши круги · ${secLabel()}</summary><ul class="ing">${types.map(t => `<li><span>${names[t]}</span><b>${libMerged(t, 'main').length} из ${capacity(t)} · вторичный ${libMerged(t, 'sec').length}</b></li>`).join('')}</ul><p class="hint">Основной круг — блюда за 4 недели. Отказ переносит блюдо во вторичный круг, второй отказ удаляет навсегда.</p></details>`;
}
async function addDesired(name, type) {
  if (!name) { toast('Впишите название блюда'); return; }
  if (!S.plan) newPlan();
  const pat = pattern(), from = Math.max(0, Math.min(todayIdx(), S.plan.len - 1)); let day = -1, slot = -1;
  for (let k = 0; k < S.plan.len && day < 0; k++) { const dd = (from + k) % S.plan.len; const i = pat.findIndex((m, j) => m[0] === type && !S.plan.days[dd].slots[j]); if (i >= 0) { day = dd; slot = i; } }
  if (day < 0) { toast('Все приёмы этого типа уже заняты — замените блюдо в разделе «Рацион»'); return; }
  const ctx = {day, slot, type: pattern()[slot][0], tg: slotTarget(day, slot), seen: new Set()};
  const q = nameKey(name);
  let d = null;
  if (Server.on()) {
    toast('Ищу блюдо…');
    try { d = (await fetchDishes(ctx, {wish: name, count: 1}))[0] || null; } catch (e) { toast(e.message); if (KEY_ERRORS.includes(e.code)) accessSheet(e.code, () => addDesired(name, type)); return; }
  } else d = Object.values(DBMAP).find(x => nameKey(x.name).includes(q) && allowedByDiet(x) && !isBanned(x));
  if (!d) { toast(Server.on() ? 'Не удалось подобрать такое блюдо.' : 'Такого блюда нет во встроенной базе. Новые блюда — с сервером и ключом доступа.'); return; }
  if (!allowedByDiet(d)) { toast('В блюде есть то, что в семье исключено'); return; }
  const sf = safePlace(day, slot, d, {fromDesired: true});
  if (!sf.ok) { toast(`«${d.name}» не подходит для этого дня — выберите другое`); return; }
  libTake(d, ctx.type); S.seenEver.push(d.id); save(); render();
  const dt = new Date(addDays(S.plan.start, day) + 'T12:00:00'), when = `${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}`;
  toast(healthOk(d, slot, ctx.tg) ? `«${d.name}» — ${when}` : `«${d.name}» — ${when}. Блюдо выше нормы приёма, остальные приёмы дня подстроятся.`);
}
async function startCollect() {
  if (!S.plan) newPlan();
  const first = firstEmpty();
  if (!first) { S.ui.tab = 'plan'; save(); render(); toast('Рацион уже собран. Заменить блюдо можно в разделе «Рацион».'); return; }
  if (Server.on()) {
    try { await checkKey(); }
    catch (e) { if (e.code === 'net') toast('Нет связи с сервером — подбираю из ваших кругов.'); else { accessSheet(e.code, () => startCollect(), e.message); return; } }
  }
  S.firstCollect = S.firstCollect || iso(new Date());
  startFeed(first[0], first[1], false);
}
function accessSheet(code, retry, msg) {
  const st = S.settings, bot = st.botUrl || 'https://t.me/';
  const title = {no_key: 'Ключ доступа', key_not_found: 'Ключ не найден', expired: 'Подписка закончилась', device_mismatch: 'Ключ на другом устройстве', blocked: 'Ключ заблокирован', net: 'Нет связи'}[code] || 'Нет доступа';
  const showInput = ['no_key', 'key_not_found', 'blocked'].includes(code);
  sheet(`<div class="keyhead"><span class="medal big">${ic('key')}</span><div><p class="eyebrow">Перед сбором</p><h3>${title}</h3></div></div><p class="hint">${esc(msg || API_MSG[code] || '')}</p>
   ${code === 'device_mismatch' ? '<div class="box">Откройте Telegram-бота → отправьте команду /device (можно раз в сутки) → вернитесь и нажмите «Повторить».</div>' : ''}
   ${showInput ? `<input id="k-key" type="password" autocomplete="off" value="${esc(st.accessKey)}" placeholder="Ключ из Telegram-бота" aria-label="Ключ доступа">` : ''}
   <div class="actions two"><a class="btn ghost" href="${esc(bot)}" target="_blank" rel="noopener">Telegram-бот</a><button class="btn primary" id="k-go">${showInput ? 'Проверить' : 'Повторить'}</button></div>`, b => {
    $('#k-go', b).onclick = () => { const k = $('#k-key', b); if (k) st.accessKey = k.value.trim(); save(); closeSheet(); retry(); };
  });
}
function firstEmpty(fromDay = 0) {
  for (let k = 0; k < S.plan.len; k++) { const d = (fromDay + k) % S.plan.len; for (let i = 0; i < S.plan.meals; i++) if (!S.plan.days[d].slots[i]) return [d, i]; }
  return null;
}
const CARD_LIMIT = 15;
async function startFeed(day, slot, manual) {
  S.feed = Object.assign({v4: true, seen: {}, used: {}, counter: 0, homeQueue: []}, S.feed && S.feed.v4 ? S.feed : {}, {active: true, day, slot, manual, card: null, loading: true, exhausted: false, aiWarned: false});
  render();
  if (S.collect.homeOn && S.collect.home.length && Server.on() && S.plan.homeFor !== S.collect.home.join('|')) {
    S.plan.homeFor = S.collect.home.join('|');
    for (const si of pattern().map((m, i) => i).filter(i => 'ld'.includes(pattern()[i][0])).slice(0, 2)) {
      try { const ctx = {day: 0, slot: si, type: pattern()[si][0], tg: slotTarget(0, si), seen: S.feed.homeQueue.map(x => x.id)}; (await fetchDishes(ctx, {home: S.collect.home, count: 1})).forEach(d => { if (allowedByDiet(d)) S.feed.homeQueue.push(d); }); } catch (e) { noteServerError(e); break; }
    }
  }
  await nextCard(); S.feed.loading = false; render();
}

/* ---------- Лента карточек (как в знакомствах) ---------- */
const FIC = {
  take: '<path d="M5 12.5l4.2 4.2L19 7"/>', skip: '<path d="M6 6l12 12M18 6L6 18"/>',
  dis: '<path d="M10 14.5v4.2a2.3 2.3 0 0 0 4.4.9l2.6-6.1V4.5H8.6a2 2 0 0 0-2 1.7l-1.1 6.2a2 2 0 0 0 2 2.3z" fill="currentColor" fill-opacity=".14"/><path d="M17 4.5h2.5v9H17"/>',
  mark: '<path d="M5 19l1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L9.2 18 5 19z" fill="currentColor" fill-opacity=".14"/><path d="M14 7l3 3"/>'
};
const fic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FIC[n]}</svg>`;
function cardHtml(d, m, slot) {
  const ff = famFactor(d, slot), n = nut(d, ff), sec = SECTIONS[sectionOf(d)][0];
  const ing = d.ing.map(x => `<li><span>${esc(x.name)}</span><i></i><b>${fmtAmt(x, x.g * ff)}</b></li>`).join('');
  return `<article class="dcard" id="card" tabindex="0" aria-label="${esc(d.name)}">
   <span class="stamp st-take">Взять</span><span class="stamp st-skip">Пропуск</span><span class="stamp st-mark">Пометка</span><span class="stamp st-close">Свернуть</span>
   <div class="dc-hero"><div class="plate"><i></i><b>${esc((d.name.trim()[0] || '·').toUpperCase())}</b></div>
    <div class="dc-head"><div class="dc-tags"><span>${m[1]}</span><span>${sec}</span></div><h3 class="cname">${esc(d.name)}</h3></div></div>
   <div class="dc-body">
    <div class="grid4 kb"><div><b>${r0(n.kcal)}</b><span>ккал</span></div><div><b>${r0(n.p)}</b><span>белки, г</span></div><div><b>${r0(n.f)}</b><span>жиры, г</span></div><div><b>${r0(n.c)}</b><span>углев., г</span></div></div>
    <div class="facts"><div><em>Готовка</em><b>${d.time} мин</b></div><div><em>Сложность</em><b>${d.diff} из 10</b></div><div><em>Клетчатка</em><b>${r1(n.fib)} г</b></div><div><em>Стоимость</em><b>≈ ${r0(famCost(d) / 10) * 10} ₽</b></div></div>
    ${S.marks.notes[d.id] ? `<p class="note">${ic('heart', 'sm')} ${esc(S.marks.notes[d.id])}</p>` : ''}
    <div class="ingbox" id="ingbox"><p class="ingh">Ингредиенты · на ${S.people.length > 1 ? 'всю семью' : 'вас'}</p><ul class="ings">${ing}</ul>
     ${stepsOf(d).length ? `<p class="ingh">Как готовить</p><ol class="csteps">${stepsOf(d).map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}</div>
    <button class="ingmore" id="ingmore" hidden>Читать полностью</button>
   </div></article>`;
}
function viewFeed() {
  const F = S.feed, pat = pattern(), m = pat[F.slot];
  const dt = new Date(addDays(S.plan.start, F.day) + 'T12:00:00'), taken = S.plan.days[F.day].slots;
  const total = S.plan.len * S.plan.meals, done = allSlots().length;
  let card;
  if (F.loading) card = `<article class="dcard skel"><div class="dc-hero"><div class="plate"><i></i></div><div class="dc-head"><div class="dc-tags"><span>${m[1]}</span></div><span class="sk w70"></span></div></div><div class="dc-body"><span class="sk w90"></span><span class="sk w40"></span><span class="sk w90"></span><span class="sk w70"></span><p class="hint">Подбираю блюдо под нормы дня…</p></div></article>`;
  else if (F.exhausted || !F.card) card = `<article class="dcard end"><div class="dc-body"><p class="eyebrow">${m[1]}</p><h3>${F.exhausted ? 'Карточки для этого приёма закончились' : 'Подходящих блюд больше нет'}</h3><p class="hint">Выберите из показанных или добавьте сложность и бюджет в разделе «Сбор».</p><div class="actions"><button class="btn primary" id="f-pick">Выбрать из показанных</button></div></div></article>`;
  else card = cardHtml(F.card.dish, m, F.slot);
  return `<section class="feedwrap" id="feedwrap"><div class="feed">
   <header class="ftop"><button class="iconbtn" id="f-close" aria-label="Свернуть подбор">${ic('down')}</button><div class="fday"><button class="arrow" id="f-prev" aria-label="Предыдущий день">‹</button><span>${DOW[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}</span><button class="arrow" id="f-next" aria-label="Следующий день">›</button></div><span class="fcount">${done}<small>/${total}</small></span></header>
   <div class="slots">${pat.map((x, i) => `<button class="slot${i === F.slot ? ' on' : ''}${taken[i] ? ' done' : ''}" data-slot="${i}">${x[1]}</button>`).join('')}</div>
   <div class="deck" id="deck"><div class="ghostcard g2"></div><div class="ghostcard g1"></div>${card}</div>
   <div class="fbtns">
    <button class="fb fb-skip" id="f-skip" aria-label="Пропустить">${fic('skip')}<span>Пропуск</span></button>
    <button class="fb fb-dis" id="f-dis" aria-label="Не нравится">${fic('dis')}<span>Не нравится</span></button>
    <button class="fb fb-mark" id="f-mark" aria-label="Пометка">${fic('mark')}<span>Пометка</span></button>
    <button class="fb fb-take" id="f-take" aria-label="Взять">${fic('take')}<span>Взять</span></button>
   </div>
   <p class="gest"><span>← взять</span><span>пропуск →</span><span>↑ пометка</span><span>↓ свернуть</span></p>
  </div></section>`;
}
function closeFeed() {
  const F = S.feed, w = $('#feedwrap'); if (!F) return;
  const fin = () => { F.active = false; S.ui.tab = 'plan'; save(); render(); };
  if (w) { w.classList.add('closing'); setTimeout(fin, 230); } else fin();
}
function ingFull() {
  const F = S.feed; if (!F || !F.card) return; const d = F.card.dish, ff = famFactor(d, F.slot);
  sheet(`<p class="eyebrow">${pattern()[F.slot][1]}</p><h3>${esc(d.name)}</h3>
   <ul class="ings big">${d.ing.map(x => `<li><span>${esc(x.name)}</span><i></i><b>${fmtAmt(x, x.g * ff)}</b></li>`).join('')}</ul>
   ${stepsOf(d).length ? `<h4>Как готовить</h4><ol class="steps">${stepsOf(d).map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}`);
}
const rubber = (v, lim) => Math.sign(v) * lim * (1 - Math.exp(-Math.abs(v) / lim)); // тянется, но не дальше предела
function bindFeed() {
  const F = S.feed;
  $('#f-close').onclick = closeFeed;
  $('#f-prev').onclick = () => goDay(-1); $('#f-next').onclick = () => goDay(1);
  document.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => goSlot(F.day, +b.dataset.slot));
  const live = !F.loading && F.card && !F.exhausted;
  ['#f-take', '#f-skip', '#f-dis', '#f-mark'].forEach(s => $(s).disabled = !live);
  $('#f-take').onclick = () => fling('left'); $('#f-skip').onclick = () => fling('right'); $('#f-dis').onclick = () => fling('dis'); $('#f-mark').onclick = markSheet;
  const pk = $('#f-pick'); if (pk) pk.onclick = pickSeen;
  const card = $('#card'); if (!card || !live) return;
  const box = $('#ingbox'), more = $('#ingmore');
  if (box.scrollHeight > box.clientHeight + 2) { box.classList.add('ovf'); more.hidden = false; }
  more.onclick = ingFull; more.addEventListener('pointerdown', e => e.stopPropagation());
  let g = null; // жест: старт, ось, смещение
  const set = (k, v) => card.style.setProperty('--' + k, v);
  const paint = () => { const {axis, rx, ry} = g;
    set('take', axis === 'x' && rx < 0 ? Math.min(1, -rx / 90) : 0); set('skip', axis === 'x' && rx > 0 ? Math.min(1, rx / 90) : 0);
    set('mark', axis === 'y' && ry < 0 ? Math.min(1, -ry / 70) : 0); set('close', axis === 'y' && ry > 0 ? Math.min(1, ry / 80) : 0); };
  const reset = () => { card.classList.remove('drag'); card.style.transform = ''; ['take', 'skip', 'mark', 'close'].forEach(k => set(k, 0)); };
  card.addEventListener('pointerdown', e => { if (e.button > 0) return; g = {x0: e.clientX, y0: e.clientY, axis: null, rx: 0, ry: 0, w: card.offsetWidth}; card.setPointerCapture(e.pointerId); });
  card.addEventListener('pointermove', e => { if (!g) return;
    g.rx = e.clientX - g.x0; g.ry = e.clientY - g.y0;
    if (!g.axis) { if (Math.hypot(g.rx, g.ry) < 8) return; g.axis = Math.abs(g.rx) > Math.abs(g.ry) ? 'x' : 'y'; card.classList.add('drag'); }
    if (g.axis === 'x') { const x = rubber(g.rx, g.w * 0.42); card.style.transform = `translateX(${x}px) rotate(${x * 0.035}deg)`; }
    else { const y = rubber(g.ry, 80); card.style.transform = `translateY(${y}px) scale(${1 - Math.abs(y) / 2400})`; }
    paint(); });
  const end = () => { if (!g) return; const {axis, rx, ry} = g; g = null;
    if (axis === 'x' && Math.abs(rx) > 90) return fling(rx < 0 ? 'left' : 'right');
    reset();
    if (axis === 'y' && ry > 80) return closeFeed();
    if (axis === 'y' && ry < -70) return markSheet(); };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', () => { g = null; reset(); });
}
let flinging = false;
async function fling(dir) {
  const F = S.feed; if (flinging || !F.card || F.loading) return; flinging = true;
  const card = $('#card');
  if (card) { card.classList.remove('drag'); if (dir !== 'dis') card.style.setProperty('--' + ({left: 'take', right: 'skip'})[dir], 1);
    card.style.transform = {left: 'translateX(-120%) rotate(-12deg)', right: 'translateX(120%) rotate(12deg)', dis: 'scale(.82)'}[dir]; card.style.opacity = '0'; if (dir === 'dis') card.classList.add('disliked'); await sleep(240); }
  flinging = false;
  if (dir === 'left') return takeCard();
  if (dir === 'right') return refuseCard(false);
  return refuseCard(true);
}
document.addEventListener('keydown', e => {
  if (!S.feed || !S.feed.active || !$('#sheet').hidden) return;
  if (e.key === 'Escape' || e.key === 'ArrowDown') { e.preventDefault(); return closeFeed(); }
  if (!$('#card')) return;
  const k = {ArrowLeft: 'left', ArrowRight: 'right', Delete: 'dis'}[e.key];
  if (k) { e.preventDefault(); fling(k); } else if (e.key === 'ArrowUp') { e.preventDefault(); markSheet(); }
});
function goDay(delta) { const F = S.feed; const d = (F.day + delta + S.plan.len) % S.plan.len; const slot = S.plan.days[d].slots.findIndex(s => !s); goSlot(d, slot < 0 ? 0 : slot); }
async function goSlot(day, slot) { const F = S.feed; F.day = day; F.slot = slot; F.card = null; F.exhausted = (F.used[day + '-' + slot] || 0) >= CARD_LIMIT; F.loading = !F.exhausted; render(); if (!F.exhausted) { await nextCard(); F.loading = false; } render(); }
function place(dish) {
  const F = S.feed, pat = pattern();
  const r = safePlace(F.day, F.slot, dish, {manual: F.manual});
  if (!r.ok) { toast(`«${dish.name}» не подходит для этого дня`); return false; }
  if (S.collect.cook2 && 'ld'.includes(pat[F.slot][0]) && F.day + 1 < S.plan.len && !S.plan.days[F.day + 1].slots[F.slot] && !safePlace(F.day + 1, F.slot, dish, {leftover: true}).ok) toast('На завтра это блюдо не повторяю');
  libTake(dish, pat[F.slot][0]); feedback(dish, 'take');
  if (!S.seenEver.includes(dish.id)) S.seenEver.push(dish.id);
  toast(`${pat[F.slot][1]}: «${dish.name}»`);
}
async function takeCard() {
  const F = S.feed; if (!F.card) return;
  if (place(F.card.dish) === false) { F.loading = true; F.card = null; save(); render(); await nextCard(); F.loading = false; render(); return; }
  const next = firstEmpty(F.day);
  if (!next) { F.active = false; S.ui.tab = 'plan'; save(); render(); toast('Рацион собран. Список покупок готов.'); return; }
  F.manual = false; save(); await goSlot(next[0], next[1]);
}
async function refuseCard(hard) {
  const F = S.feed, key = F.day + '-' + F.slot, d = F.card.dish, type = pattern()[F.slot][0];
  if (!S.seenEver.includes(d.id)) S.seenEver.push(d.id);
  if (hard) { ban(d); toast('Больше не предложу'); }
  else { feedback(d, 'skip'); const r = libRefuse(d, type); if (r === 'ban') toast('Второй отказ — блюдо удалено из ваших'); }
  F.used[key] = (F.used[key] || 0) + 1;
  if (F.used[key] >= CARD_LIMIT) { F.exhausted = true; F.card = null; save(); render(); return; }
  F.loading = true; F.card = null; save(); render(); await nextCard(); F.loading = false; render();
}
function pickSeen() {
  const F = S.feed, list = (F.seen[F.day + '-' + F.slot] || []).map(getDish).filter(d => d && !isBanned(d) && allowedByDiet(d) && safeFit(d, F.day, F.slot).ok);
  if (!list.length) { toast('Ещё нет показанных блюд'); return; }
  sheet(`<h3>Показанные блюда</h3><div class="pick">${list.map((d, i) => { const n = nut(d, famFactor(d, F.slot)); return `<button class="pickrow" data-pick="${i}"><b>${esc(d.name)}</b><span>${kbju(n)}</span></button>`; }).join('')}</div>`, b => {
    b.querySelectorAll('[data-pick]').forEach(x => x.onclick = () => { F.card = {dish: list[+x.dataset.pick], src: 'seen'}; F.exhausted = false; closeSheet(); takeCard(); });
  });
}
function markSheet() {
  const F = S.feed; if (!F || !F.card) return; const d = F.card.dish, liked = S.marks.like.includes(d.name);
  sheet(`<p class="eyebrow">Пометка</p><h3>${esc(d.name)}</h3>
  <div class="actions"><button class="btn ghost" id="mk-like">${liked ? 'Убрать «нравится»' : 'Нравится'}</button></div>
  <label class="sublabel">Своя пометка<textarea id="mk-note" rows="3" placeholder="Например: делать без лука, детям меньше острого">${esc(S.marks.notes[d.id] || '')}</textarea></label>
  <div class="actions"><button class="btn primary" id="mk-save">Сохранить пометку</button></div>
  <details><summary>Аллергия на ингредиент</summary><div class="pick">${d.ing.map(i => `<button class="pickrow" data-a="${esc(i.name)}"><b>${esc(i.name)}</b></button>`).join('')}</div></details>`, b => {
    $('#mk-like', b).onclick = () => { const a = S.marks.like; liked ? a.splice(a.indexOf(d.name), 1) : a.push(d.name); save(); closeSheet(); render(); toast(liked ? 'Пометка снята' : 'Отмечено: нравится'); };
    $('#mk-save', b).onclick = () => { const t = $('#mk-note', b).value.trim(); if (t) S.marks.notes[d.id] = t; else delete S.marks.notes[d.id]; rememberDish(d); save(); closeSheet(); render(); toast('Пометка сохранена'); };
    b.querySelectorAll('[data-a]').forEach(y => y.onclick = () => { if (!S.settings.forbidden.includes(y.dataset.a)) S.settings.forbidden.push(y.dataset.a); save(); closeSheet(); toast('Исключено для всей семьи'); refuseCard(false); });
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
const MONG = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const dayDate = d => addDays(S.plan.start, d);
const ruDays = n => n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней';
function fmtDates(idx, short) { // 12–14 октября · 30 сентября — 2 октября · 12, 13 и 15 октября
  const ds = idx.map(d => new Date(dayDate(d) + 'T12:00:00')), M = short ? MON : MONG;
  const run = idx.every((d, k) => !k || d === idx[k - 1] + 1);
  const a = ds[0], z = ds[ds.length - 1];
  if (ds.length === 1) return `${a.getDate()} ${M[a.getMonth()]}`;
  if (run) return a.getMonth() === z.getMonth() ? `${a.getDate()}–${z.getDate()} ${M[z.getMonth()]}` : `${a.getDate()} ${M[a.getMonth()]} — ${z.getDate()} ${M[z.getMonth()]}`;
  const sameM = ds.every(x => x.getMonth() === a.getMonth()), part = x => sameM ? x.getDate() : `${x.getDate()} ${M[x.getMonth()]}`;
  return ds.slice(0, -1).map(part).join(', ') + ' и ' + part(z) + (sameM ? ' ' + M[a.getMonth()] : '');
}
function shopDays() { // собранные, но ещё не закупленные дни; при выборе половины — только она
  const pend = S.plan.days.map((d, i) => i).filter(i => !S.shop.bought[dayDate(i)] && S.plan.days[i].slots.some(s => s && !s.leftover));
  const split = pend.length > 4, r = split ? S.shop.range : 'all';
  return {pend, split, sel: r === 'a' ? pend.slice(0, 3) : r === 'b' ? pend.slice(3) : pend};
}
function shopList(days) {
  const map = {}, home = S.collect.homeOn ? S.collect.home.map(x => x.toLowerCase()) : [];
  days.forEach(d => S.plan.days[d].slots.forEach((sl, i) => { if (!sl) return; const ff = famFactor(sl.dish, i);
    sl.dish.ing.forEach(x => { const k = x.name; map[k] = map[k] || {i: x, g: 0}; map[k].g += x.g * ff; }); }));
  return Object.values(map).map(o => { const rd = roundAmt(o.i, o.g); const has = home.some(h => o.i.name.toLowerCase().includes(h) || h.includes(o.i.name.toLowerCase()));
    return {name: o.i.name, cat: o.i.cat, need: o.g, amt: rd.t, price: has ? 0 : (o.i.price || 0) * rd.g / 1000, has}; }).sort((x, y) => x.name.localeCompare(y.name, 'ru'));
}
function buyHead(sel) {
  const run = sel.every((d, k) => !k || d === sel[k - 1] + 1), n = sel.length;
  const title = n === 1 ? `Закупка на ${fmtDates(sel)}` : run ? `Закупка ${fmtDates(sel)}` : `Закупка на ${n} ${ruDays(n)}`;
  const part = sel.filter(d => !S.plan.days[d].slots.every(Boolean));
  const sub = [run || n === 1 ? (n === S.plan.len ? 'вся неделя' : `${n} ${ruDays(n)}`) : fmtDates(sel)];
  if (part.length) sub.push(part.length === 1 ? `${fmtDates(part, true)} собран не полностью` : `не полностью: ${fmtDates(part, true)}`);
  return `<section class="buycard"><h2 class="gt">${title}</h2><p class="buysub">${sub.join(' · ')}</p></section>`;
}
function viewShop() {
  const v = $('#view');
  const goCollect = () => { S.ui.tab = 'collect'; save(); render(); };
  const undo = S.shop.lastBought && S.shop.lastBought.some(k => S.shop.bought[k]) ? `<p class="buyundo">Закупка отмечена. <button class="linkbtn" id="s-undo">Вернуть</button></p>` : '';
  const bindUndo = () => { const u = $('#s-undo'); if (u) u.onclick = () => { S.shop.lastBought.forEach(k => delete S.shop.bought[k]); S.shop.lastBought = null; save(); render(); }; };
  if (!S.plan || !S.plan.days.some(d => d.slots.some(Boolean))) { v.innerHTML = `${appbar('Продукты', 'Список покупок')}<section class="buycard"><h2 class="gt">Закупка пока не собрана</h2><p class="buysub">Соберите рацион — здесь появится список продуктов на собранные дни</p><button class="btn primary" id="s-go">Собрать рацион</button></section>`; $('#s-go').onclick = goCollect; return; }
  const {pend, split, sel} = shopDays();
  if (!pend.length) { const bd = S.plan.days.map((d, i) => i).filter(i => S.shop.bought[dayDate(i)]);
    v.innerHTML = `${appbar('Продукты', 'Список покупок')}<section class="buycard"><h2 class="gt">Всё собранное закуплено</h2><p class="buysub">${bd.length ? `Закуплено: ${fmtDates(bd)}. ` : ''}Соберите следующие дни — список появится здесь</p><button class="btn primary" id="s-go">Собрать рацион</button></section>${undo}`;
    $('#s-go').onclick = goCollect; bindUndo(); return; }
  const list = shopList(sel), total = sel.reduce((s, di) => s + S.plan.days[di].slots.reduce((a, sl) => a + (sl ? famCost(sl.dish) : 0), 0), 0), budget = +S.collect.budget || 0;
  const budgetPart = budget * sel.length / S.plan.len;
  const over = budgetPart && total > budgetPart;
  const ranges = split ? [['all', 'Всё сразу'], ['a', fmtDates(pend.slice(0, 3), true)], ['b', fmtDates(pend.slice(3), true)]] : [];
  const row = x => `<li class="${S.shop.checked[x.name] ? 'done' : ''}${x.has ? ' has' : ''}"><button data-check="${esc(x.name)}"><span class="nm">${esc(x.name)}</span><span class="am">${x.has ? 'есть дома' : x.amt}</span><span class="pr">${x.has ? '' : '≈ ' + r0(x.price / 10) * 10 + ' ₽'}</span></button></li>`;
  let body;
  if (S.shop.group) { const cats = {}; list.forEach(x => (cats[x.cat] = cats[x.cat] || []).push(x)); body = Object.keys(cats).sort().map(k => `<h4 class="cat">${k}</h4><ul class="shop">${cats[k].map(row).join('')}</ul>`).join(''); }
  else body = `<ul class="shop">${list.map(row).join('')}</ul>`;
  v.innerHTML = `${appbar('Продукты', 'Список покупок')}
  <div class="total"><div><span class="small">Примерно</span><b>${r0(total / 10) * 10} ₽</b></div><div><span class="small">Бюджет</span><b>${r0(budgetPart)} ₽</b></div></div>
  ${over ? `<div class="warn box">Перерасход ≈ ${r0((total - budgetPart) / 10) * 10} ₽. <button class="btn ghost sm" id="s-cheap">Удешевить 5 самых дорогих блюд</button></div>` : ''}
  ${buyHead(sel)}
  ${split ? `<div class="seg">${ranges.map(([k, t]) => `<button class="${(S.shop.range || 'all') === k ? 'on' : ''}" data-range="${k}">${t}</button>`).join('')}</div>` : ''}
  <div class="actions two"><button class="btn ghost" id="s-group">${S.shop.group ? 'Без групп' : 'Сгруппировать'}</button><button class="btn ghost" id="s-share">Поделиться</button></div>
  ${body}
  <button class="btn primary wide big" id="s-copy">Скопировать список</button>
  <button class="btn ghost wide" id="s-bought">Закуплено · ${fmtDates(sel, true)}</button>
  ${undo}
  <p class="hint">Цены ориентировочные, по средним ценам сетевых магазинов. Нажмите на продукт, чтобы вычеркнуть.</p>`;
  v.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { S.shop.range = b.dataset.range; save(); render(); });
  v.querySelectorAll('[data-check]').forEach(b => b.onclick = () => { const k = b.dataset.check; S.shop.checked[k] = !S.shop.checked[k]; save(); render(); });
  $('#s-group').onclick = () => { S.shop.group = !S.shop.group; save(); render(); };
  const text = () => 'Список покупок — Мой рацион\n' + list.filter(x => !x.has).map(x => `${S.shop.checked[x.name] ? '✓' : '•'} ${x.name} — ${x.amt}`).join('\n') + `\nИтого ≈ ${r0(total / 10) * 10} ₽`;
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('Список скопирован'); } catch (e) { sheet(`<h3>Скопируйте текст</h3><textarea class="copybox" id="cb" readonly>${esc(text())}</textarea>`, b => { const t = $('#cb', b); t.focus(); t.select(); }); } };
  $('#s-copy').onclick = copy;
  $('#s-share').onclick = async () => { if (navigator.share) { try { await navigator.share({title: 'Список покупок', text: text()}); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const ch = $('#s-cheap'); if (ch) ch.onclick = cheapen;
  $('#s-bought').onclick = () => { const ks = sel.map(dayDate); ks.forEach(k => S.shop.bought[k] = true); S.shop.lastBought = ks; S.shop.checked = {}; S.shop.range = 'all'; save(); render(); const sc = $('#scroller'); if (sc) sc.scrollTop = 0; toast(`Закуплено: ${fmtDates(sel, true)}`); };
  bindUndo();
}
function cheapen() {
  const slots = [];
  const sel = shopDays().sel;
  sel.forEach(di => S.plan.days[di].slots.forEach((sl, i) => { if (sl && !sl.fromDesired && !sl.leftover) slots.push({di, i, price: famCost(sl.dish)}); }));
  slots.sort((a, b) => b.price - a.price);
  let n = 0;
  slots.slice(0, 5).forEach(s => { const type = pattern()[s.i][0], cur = S.plan.days[s.di].slots[s.i];
    const alt = (Server.on() ? Object.values(S.dishStore).filter(x => x.src === 'server') : Object.values(DBMAP)).filter(d => d.types.includes(type) && allowedByDiet(d) && !isBanned(d) && d.id !== cur.dish.id && !usedInPlan(d.id))
      .map(d => ({d, p: famCost(d)})).filter(x => x.p < s.price * 0.8 && safeFit(x.d, s.di, s.i).ok).sort((a, b) => a.p - b.p)[0];
    if (alt) { const nx = S.plan.days[s.di + 1], lo = nx && nx.slots[s.i];
      if (lo && lo.leftover && lo.dish.id === cur.dish.id) nx.slots[s.i] = {dish: alt.d, status: null, leftover: true};
      S.plan.days[s.di].slots[s.i] = {dish: withSalt(alt.d), status: null, fromDesired: false}; n++; } });
  save(); render(); toast(n ? `Заменено блюд: ${n}` : 'Дешевле подходящих блюд не нашлось');
}

/* ---------- Настройки ---------- */
const SET_PAGES = [['look','Оформление','Тема и акцент'],['family','Семья','Люди и их нормы'],['tastes','Мои вкусы','Тест, круги блюд, пометки, обмен'],['diet','Рацион и питание','Приёмы, тип питания, аллергии'],['health','Здоровье','Важное предупреждение'],['key','Ключ доступа','Подписка'],['history','История','Прошедшие 7 дней'],['data','Данные','Удаление с устройства'],['system','Системный','Последний запрос к серверу']];
const SET_IC = {look:'look', family:'family', diet:'dish', tastes:'heart', health:'shield', key:'key', history:'history', data:'data', system:'code'};
function viewSettings() {
  const st = S.settings, M = S.marks, pg = S.ui.set, v = $('#view');
  if (!pg) {
    const me = S.people[0], t = personTargets(me);
    v.innerHTML = `${appbar('Настройки', 'Профиль и приложение', {back: true})}
    <button class="profile" data-person="${me.id}"><span class="mono">${esc(me.name.slice(0, 1).toUpperCase())}</span><span><b>${esc(me.name)}</b><small>${r0(t.E)} ккал · белок ${r0(t.P)} г в день</small></span>${ic('chev', 'sm')}</button>
    <nav class="rows">${SET_PAGES.map(([k, t, s]) => `<button class="row" data-set="${k}"><span class="medal">${ic(SET_IC[k])}</span><span><b>${t}</b><small>${s}</small></span>${ic('chev', 'sm')}</button>`).join('')}</nav>
    <p class="hint center">Мой рацион · версия 0.8.3</p>`;
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
    <label class="field"><span><em>Тип питания</em><select id="st-diet">${[['all','Обычное'],['nopork','Без свинины'],['pesc','Без мяса, с рыбой'],['veg','Вегетарианское'],['vegan','Веганское']].map(([k, t]) => `<option value="${k}"${st.diet === k ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
    <div class="field col"><em>Запрещённые продукты для всей семьи</em><div class="chipin"><input id="st-forb" placeholder="Например, грибы"><button class="btn ghost sm" id="st-forb-add">Добавить</button></div>${st.forbidden.length ? `<div class="chips">${st.forbidden.map((w, i) => `<button class="chip x" data-rmforb="${i}">${esc(w)}</button>`).join('')}</div>` : ''}</div></div>
    <h4>Аллергии в семье</h4><p class="hint">Отмеченное убирается из блюд у всех членов семьи.</p><div class="panel">${ALLERGENS.map(([k, t]) => `<label class="field check"><input type="checkbox" data-alg="${k}"${(st.allergens || []).includes(k) ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
  if (pg === 'tastes') body = tastesHtml();
  if (pg === 'health') body = `<div class="alert">${ic('shield')}<div><b>Важно</b><p>Приложение опирается на официальные нормы питания и подробный научный отчёт, но не заменяет врача и не гарантирует результат. При состояниях из списка ниже им лучше не пользоваться — посоветуйтесь с врачом или диетологом.</p></div></div>
    <h4>Состояния</h4><div class="panel">${meds.map(([k, t]) => `<label class="field check"><input type="checkbox" data-med="${k}"${st.medical[k] ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>
    <p class="hint">Если отметить хотя бы одно, автоматический сбор рациона отключится.</p>`;
  if (pg === 'key') body = keyPageHtml();
  if (pg === 'history') body = S.lastWeek ? historyHtml() : '<div class="empty"><h3>Истории пока нет</h3><p>Прошедшие дни рациона появятся здесь — за последние 7 дней.</p></div>';
  if (pg === 'system') {
    const L = S.apiLog;
    body = `<div class="alert">${ic('code')}<div><b>Только для разработчика</b><p>Подбор новых блюд, нейросеть и цены — на сервере. Здесь видно последний запрос к серверу и его ответ. Ключ скрыт.</p></div></div>
    <h4>Состояние</h4><div class="panel"><div class="field col"><em>Сервер</em><code class="mono-t">${st.serverUrl ? esc(st.serverUrl) : 'не задан — сбор из кругов и встроенных демо-блюд'}</code></div>
    <div class="field col"><em>Устройство</em><code class="mono-t">${esc(deviceId())}</code></div>
    <div class="field col"><em>Отзывы в очереди</em><code class="mono-t">${S.fbq.length}</code></div>
    <div class="field col"><em>Задержка карточки</em><code class="mono-t">${cardDelay()} мс · одинаковая для всех карточек</code></div>
    <div class="field col"><em>Кэш блюд</em><code class="mono-t">встроенных ${Object.keys(DBMAP).length} · с сервера ${Object.values(S.dishStore).filter(d => d.src === 'server').length} · цены обновлены ${S.pricesAt ? new Date(S.pricesAt).toLocaleDateString('ru-RU') : 'ещё нет'}</code></div>
    <div class="field col"><em>Бюджет</em><code class="mono-t">K = ${r1(famK())} · на базового человека ${r0(baseBudget())} ₽ · остаток ${r0(budgetLeft())} ₽</code></div></div>
    ${L ? `<h4>Запрос · ${esc(L.path)} · ${new Date(L.at).toLocaleTimeString('ru-RU')} · ${L.status || 'нет связи'} · ${L.ms} мс</h4><pre class="code">${esc(JSON.stringify(L.req, null, 2))}</pre><h4>Ответ</h4><pre class="code">${esc(JSON.stringify(L.res, null, 2))}</pre>
    <button class="btn ghost wide" id="sys-copy">Скопировать запрос и ответ</button>` : '<div class="empty"><h3>Запросов ещё не было</h3><p>Они появятся после проверки ключа или подбора нового блюда.</p></div>'}`;
  }
  if (pg === 'data') body = `<p class="hint">Все данные хранятся только на этом устройстве.</p><button class="btn ghost wide danger" id="st-wipe">Удалить все данные</button>`;
  v.innerHTML = `${appbar(title, 'Настройки', {back: true})}${body}`;
  v.querySelectorAll('[data-theme-set]').forEach(b => b.onclick = () => { S.theme = b.dataset.themeSet; save(); render(); });
  v.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => { S.accent = b.dataset.accent; save(); render(); });
  v.querySelectorAll('[data-person]').forEach(b => b.onclick = () => editPerson(S.people.find(p => p.id === b.dataset.person)));
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };
  on('#st-add', 'onclick', () => editPerson(null));
  on('#st-meals', 'onchange', e => { if (e.target.value === 'auto') st.mealsAuto = true; else { st.mealsAuto = false; st.meals = +e.target.value; } planShapeChanged(); });
  v.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { st.planLen = +b.dataset.len; planShapeChanged(); });
  v.querySelectorAll('[data-alg]').forEach(b => b.onchange = () => { const k = b.dataset.alg, a = st.allergens = st.allergens || []; b.checked ? a.includes(k) || a.push(k) : a.splice(a.indexOf(k), 1); save(); });
  on('#st-acc-check', 'onclick', async () => { st.accessKey = $('#st-acc').value.trim(); save(); if (!Server.on()) { toast('Ключ сохранён. Проверка — когда будет подключён сервер.'); render(); return; } try { await checkKey(); toast('Ключ действует'); } catch (e) { toast(e.message); } render(); });
  on('#st-srv', 'onchange', e => { st.serverUrl = e.target.value.trim(); S.access = null; save(); render(); });
  on('#st-bot', 'onchange', e => { st.botUrl = e.target.value.trim(); save(); });
  if (pg === 'tastes') bindTastes(v);
  on('#st-diet', 'onchange', e => { st.diet = e.target.value; save(); });
  const fa = () => { const x = $('#st-forb').value.trim(); if (x) { st.forbidden.push(x); save(); render(); } };
  on('#st-forb-add', 'onclick', fa); on('#st-forb', 'onkeydown', e => { if (e.key === 'Enter') fa(); });
  v.querySelectorAll('[data-rmforb]').forEach(b => b.onclick = () => { st.forbidden.splice(+b.dataset.rmforb, 1); save(); render(); });
  v.querySelectorAll('[data-med]').forEach(b => b.onchange = () => { st.medical[b.dataset.med] = b.checked; save(); });
  on('#sys-copy', 'onclick', async () => { const t = Array.from(v.querySelectorAll('pre.code')).map(x => x.textContent).join('\n\n'); try { await navigator.clipboard.writeText(t); toast('Скопировано'); } catch (e) { toast('Не удалось скопировать'); } });
  on('#st-wipe', 'onclick', () => sheet(`<h3>Удалить все данные?</h3><p>Профили, рацион, пометки и ключ будут удалены с этого устройства.</p><div class="actions two"><button class="btn ghost" id="w-no">Отмена</button><button class="btn primary" id="w-yes">Удалить</button></div>`, b => { $('#w-no', b).onclick = closeSheet; $('#w-yes', b).onclick = () => { S = defaults(); save(); closeSheet(); render(); }; }));
}
function keyPageHtml() {
  const st = S.settings, A = S.access, fmtD = s => { if (!s) return ''; const d = new Date(s + 'T12:00:00'); return `${d.getDate()} ${MONG[d.getMonth()]}`; };
  let card;
  if (!Server.on()) card = `<div class="keycard"><p class="eyebrow">Сервер не подключён</p><h3>Работает без подписки</h3><p class="hint">Рацион, круги и продукты доступны. Новые блюда появятся, когда будет подключён сервер.</p></div>`;
  else if (!A) card = `<div class="keycard"><p class="eyebrow">Ключ ещё не проверен</p><h3>${st.accessKey ? 'Нажмите «Проверить»' : 'Введите ключ'}</h3><p class="hint">Ключ выдаёт Telegram-бот: команда /start — пробный доступ на 7 дней.</p></div>`;
  else if (A.error) card = `<div class="keycard bad"><p class="eyebrow">Доступ не активен</p><h3>${{no_key: 'Нет ключа', key_not_found: 'Ключ не найден', expired: 'Подписка закончилась', device_mismatch: 'Ключ на другом устройстве', blocked: 'Ключ заблокирован'}[A.error] || 'Ошибка'}</h3><p class="hint">${esc(API_MSG[A.error] || '')}</p></div>`;
  else card = `<div class="keycard ok"><p class="eyebrow">${A.plan === 'trial' ? 'Пробный доступ' : 'Подписка'}</p><h3 class="gt">до ${fmtD(A.until)}</h3><p class="hint">Осталось ${A.days_left} ${ruDays(+A.days_left || 0)}${A.ai_left != null ? ` · новых блюд от нейросети сегодня: ${A.ai_left}` : ''}</p></div>`;
  return `${card}
    <div class="panel"><label class="field"><span><em>Ключ доступа</em><input id="st-acc" type="password" autocomplete="off" value="${esc(st.accessKey)}" placeholder="MR-XXXXXXXX"></span></label><button class="btn primary wide" id="st-acc-check">Проверить ключ</button></div>
    <p class="hint">Ключ привязывается к этому устройству. Сменили телефон или очистили данные браузера — отвяжите старое устройство в боте командой /device.</p>
    ${st.botUrl ? `<a class="btn ghost wide" href="${esc(st.botUrl)}" target="_blank" rel="noopener">Открыть Telegram-бота</a>` : ''}
    <h4>Для разработчика</h4><div class="panel"><label class="field"><span><em>Адрес сервера</em><input id="st-srv" autocomplete="off" value="${esc(st.serverUrl)}" placeholder="https://….workers.dev"></span></label>
    <label class="field"><span><em>Ссылка на Telegram-бота</em><input id="st-bot" autocomplete="off" value="${esc(st.botUrl)}" placeholder="https://t.me/…"></span></label></div>`;
}
/* ---------- Мои вкусы: тест, круги, пометки, обмен ---------- */
function tastesHtml() {
  const T = S.taste, w = T.w, pat = pattern(), types = [...new Set(pat.map(m => m[0]))], names = {b: 'Завтраки', l: 'Обеды', d: 'Ужины', s: 'Перекусы'};
  const wl = v => v > 0.1 ? 'like' : v < -0.1 ? 'dis' : '';
  const banned = S.banned.ids.map(getDish).filter(Boolean);
  const notes = Object.entries(S.marks.notes).map(([id, t]) => [getDish(id), t]).filter(x => x[0]);
  return `<div class="alert">${ic('heart')}<div><b>${T.done ? 'Тест пройден' : 'Тест вкусов'}</b><p>${T.done ? 'Вкусы учитываются при подборе. Пройти заново можно в любой момент.' : '1–2 минуты: выберите из пар блюд то, что больше нравится. Выбранное сразу попадёт в ваши круги.'}</p></div></div>
  ${Array.isArray(T.lvl) ? `<div class="lvlbar">${LEVELS.map((n, k) => { const sum = T.lvl.reduce((a, b) => a + b, 0) || 1; return `<div><b>${r0(T.lvl[k] / sum * 100)}%</b><span>${n}</span></div>`; }).join('')}</div>` : ''}
  <div class="actions two"><button class="btn primary" data-test="self">Пройти самостоятельно</button><button class="btn ghost" data-test="family">Пройти с семьёй</button></div>
  <h4>Круги блюд · ${secLabel()}</h4>
  <div class="panel"><ul class="ing">${types.map(t => `<li><span>${names[t]}</span><b>${libMerged(t, 'main').length} из ${capacity(t)} · вторичный ${libMerged(t, 'sec').length}</b></li>`).join('')}</ul></div>
  <p class="hint">Круги формируются 2 недели, полный цикл — 4 недели. Для каждого раздела сложности — свои круги.</p>
  ${notes.length || S.marks.like.length ? `<h4>Пометки</h4><div class="panel">${S.marks.like.length ? `<div class="field col"><em>Нравится</em><div class="chips">${S.marks.like.map((n, i) => `<button class="chip x" data-unlike="${i}">${esc(n)}</button>`).join('')}</div></div>` : ''}${notes.map(([d, t]) => `<div class="field col"><em>${esc(d.name)}</em><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
  <h4>Обмен вкусами</h4>
  <div class="actions two"><button class="btn ghost" id="tx-exp">Поделиться вкусами</button><button class="btn ghost" id="tx-imp">Добавить чужие вкусы</button></div>
  ${S.imports.map((im, i) => `<div class="box"><span><b>${esc(im.label)}</b> · ${im.ids.length} блюд</span><div class="seg">${[0, 25, 50, 75].map(v => `<button class="${im.share === v ? 'on' : ''}" data-share="${i}:${v}">${v ? v + '%' : 'Выкл'}</button>`).join('')}</div><button class="btn ghost sm" data-rmimp="${i}">Удалить</button></div>`).join('')}
  <p class="hint">Код содержит только рецепты за последние 3 дня — без веса, здоровья и имён. Его может прочитать только это приложение.</p>
  ${banned.length ? `<h4>Удалены навсегда · ${banned.length}</h4><div class="chips">${banned.map(d => `<button class="chip x" data-unban="${esc(d.id)}" title="Вернуть">${esc(d.name)}</button>`).join('')}</div><p class="hint">Нажмите на блюдо, чтобы вернуть его.</p>` : ''}
  <button class="btn ghost wide danger" id="tx-reset">Очистить круги блюд</button>`;
}
function bindTastes(v) {
  v.querySelectorAll('[data-test]').forEach(b => b.onclick = () => tasteTest(b.dataset.test));
  v.querySelectorAll('[data-unlike]').forEach(b => b.onclick = () => { S.marks.like.splice(+b.dataset.unlike, 1); save(); render(); });
  v.querySelectorAll('[data-unban]').forEach(b => b.onclick = () => { unban(b.dataset.unban); save(); render(); toast('Блюдо вернётся в подбор'); });
  v.querySelectorAll('[data-share]').forEach(b => b.onclick = () => { const [i, s] = b.dataset.share.split(':').map(Number); S.imports[i].share = s; save(); render(); });
  v.querySelectorAll('[data-rmimp]').forEach(b => b.onclick = () => { S.imports.splice(+b.dataset.rmimp, 1); save(); render(); });
  $('#tx-exp').onclick = exportTastes; $('#tx-imp').onclick = importTastes;
  $('#tx-reset').onclick = () => sheet(`<h3>Очистить круги?</h3><p>Основные и вторичные круги всех кухонь будут пустыми и начнут формироваться заново. Удалённые навсегда блюда останутся удалёнными.</p><div class="actions two"><button class="btn ghost" id="cr-no">Отмена</button><button class="btn primary" id="cr-yes">Очистить</button></div>`, b => { $('#cr-no', b).onclick = closeSheet; $('#cr-yes', b).onclick = () => { S.lib = {}; save(); closeSheet(); render(); }; });
}
async function tasteTest(mode) {
  S.taste.mode = mode;
  const TYPES = ['b', 'l', 'd', 'b', 'l', 'd', 's', 'l'];
  let pairs = [], server = false;
  if (Server.on() && S.settings.accessKey) {
    sheet(`<p class="eyebrow">Тест вкусов</p><h3>Подбираю пары блюд…</h3><p class="hint">Это займёт пару секунд.</p>`);
    try { const st = S.settings, j = await Server.call('/v1/taste-test', {allergies: st.allergens || [], diet: DIET_API[st.diet] || 'all', forbid: st.forbidden});
      pairs = (j.pairs || []).map((p, i) => { const a = fromApi(p[0]), b = fromApi(p[1]); rememberDish(a); rememberDish(b); return [a, b, TYPES[i] || a.types[0]]; }); server = pairs.length > 0; }
    catch (e) { closeSheet(); toast(e.message + (KEY_ERRORS.includes(e.code) ? '' : ' Пройду тест на встроенных блюдах.')); if (KEY_ERRORS.includes(e.code)) return; }
  }
  if (!server) { const pool = Object.values(DBMAP).filter(d => allowedByDiet(d) && !isBanned(d));
    TYPES.forEach(t => { const c = pool.filter(d => d.types.includes(t) && !pairs.flat().includes(d)).sort(() => Math.random() - 0.5); const a = c[0], b = c.find(x => x !== a && x.cuisine !== a.cuisine) || c[1]; if (a && b) pairs.push([a, b, t]); }); }
  const lvl = [34, 33, 33], w = {}; let i = 0; // веса считаются заново: прошлые результаты и выборы блюд не учитываются
  const finish = async () => {
    S.taste.done = true; S.taste.w = w; closeSheet();
    if (server) { const w = lvl.map(v => Math.max(5, Math.min(90, r0(v)))); S.taste.lvl = w; try { await Server.call('/v1/tastes', {set: {w}}); } catch (e) { toast('Вкусы сохранены в телефоне, на сервер отправлю позже'); S.taste.pendingLvl = w; } }
    save(); render(); toast('Готово: вкусы учтены');
  };
  const step = () => {
    if (i >= pairs.length) { finish(); return; }
    const [a, b] = pairs[i];
    sheet(`<p class="eyebrow">${mode === 'family' ? 'Выбирайте вместе' : 'Тест вкусов'} · ${i + 1} из ${pairs.length}</p><h3>Что больше по душе?</h3>
     <div class="pair">${[a, b].map((d, k) => `<button class="pcard" data-p="${k}"><b>${esc(d.name)}</b><small>${d.time} мин · ${r0(nut(d).kcal)} ккал</small></button>`).join('')}</div>
     <div class="actions two"><button class="btn ghost" data-p="both">Оба</button><button class="btn ghost" data-p="none">Ни одно</button></div>`, el => el.querySelectorAll('[data-p]').forEach(x => x.onclick = () => {
        if (i >= pairs.length || pairs[i][0] !== a) return; // повторное нажатие во время закрытия
        const p = x.dataset.p, t = pairs[i][2], pick = p === 'both' ? [a, b] : p === 'none' ? [] : [[a, b][+p]];
        pick.forEach(d => { libTake(d, d.types.includes(t) ? t : d.types[0]); if (d.lvl != null) lvl[d.lvl] += 12; else w[d.cuisine] = Math.min(0.6, (w[d.cuisine] || 0) + 0.12); });
        if (p === 'none') [a, b].forEach(d => { if (d.lvl != null) lvl[d.lvl] -= 5; else w[d.cuisine] = Math.max(-0.6, (w[d.cuisine] || 0) - 0.05); });
        i++; save(); step(); }));
  };
  if (!pairs.length) { closeSheet(); toast('Не хватает блюд для теста'); return; }
  step();
}
const XKEY = 'moy-racion · обмен вкусами · v1';
async function xKey() { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(XKEY)); return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']); }
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function gz(str, back) { const st = new Blob([str]).stream().pipeThrough(back ? new DecompressionStream('gzip') : new CompressionStream('gzip')); return back ? new Response(st).text() : new Uint8Array(await new Response(st).arrayBuffer()); }
function recentDishes() { // блюда за 3 последних дня: сегодня и прошедшие (из истории), иначе — ближайшие собранные
  const seq = [];
  if (S.plan && S.plan.days[0]) seq.push(S.plan.days[0]);
  if (S.lastWeek && S.lastWeek.days) for (let d = S.lastWeek.days.length - 1; d >= 0; d--) seq.push(S.lastWeek.days[d]);
  let days = seq.filter(d => d.slots.some(Boolean)).slice(0, 3);
  if (!days.length && S.plan) days = S.plan.days.filter(d => d.slots.some(Boolean)).slice(0, 3);
  const out = {}; days.forEach(d => d.slots.forEach(s => { if (s && !s.leftover) out[s.dish.id] = s.dish; }));
  return Object.values(out);
}
async function exportTastes() {
  const list = recentDishes(); if (!list.length) { toast('Пока нечем делиться: соберите рацион'); return; }
  const data = {v: 1, label: S.people[0] ? 'Вкусы ' + S.people[0].name : 'Вкусы', dishes: list.map(d => ({name: d.name, types: d.types, time: d.time, diff: d.diff, cuisine: d.cuisine, steps: d.steps, salt: d.salt, ing: d.ing.map(i => ({id: i.id, name: i.name, g: i.g, kcal: i.kcal, p: i.p, f: i.f, c: i.c, fib: i.fib, price: i.price, cat: i.cat, unit: i.unit, flags: i.flags, na: i.na}))}))};
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12)), ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await xKey(), await gz(JSON.stringify(data)));
    const code = 'MR1-' + b64u(iv) + '.' + b64u(ct);
    sheet(`<h3>Код ваших вкусов</h3><p class="hint">${list.length} блюд за последние дни. Отправьте код — его откроет только «Мой рацион».</p><textarea class="copybox" id="xc" readonly>${code}</textarea><button class="btn primary wide" id="xc-copy">Скопировать</button>`, b => { $('#xc-copy', b).onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Код скопирован'); } catch (e) { $('#xc', b).select(); } }; });
  } catch (e) { toast('Браузер не поддерживает шифрование: ' + e.message); }
}
function importTastes() {
  sheet(`<h3>Чужие вкусы</h3><p class="hint">Вставьте код «MR1-…». Блюда пройдут ваши запреты и фильтр здоровья.</p><textarea id="xi" rows="4" placeholder="MR1-…"></textarea><button class="btn primary wide" id="xi-go">Добавить</button>`, b => {
    $('#xi-go', b).onclick = async () => {
      try {
        const raw = $('#xi', b).value.trim(); if (!raw.startsWith('MR1-')) throw new Error('не тот формат');
        const [iv, ct] = raw.slice(4).split('.').map(unb64u);
        const data = JSON.parse(await gz(new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv}, await xKey(), ct)), true));
        const all = (data.dishes || []).map((o, k) => Object.assign({}, o, {id: 'im' + Date.now().toString(36) + k, src: 'import'}));
        const ok = all.filter(d => d.name && Array.isArray(d.ing) && allowedByDiet(d) && !isBanned(d));
        ok.forEach(rememberDish);
        S.imports.unshift({label: String(data.label || 'Чужие вкусы').slice(0, 40), ids: ok.map(d => d.id), share: 25}); S.imports = S.imports.slice(0, 3);
        save(); closeSheet(); render(); toast(`Добавлено блюд: ${ok.length}${all.length > ok.length ? `, убрано из-за ваших запретов: ${all.length - ok.length}` : ''}`);
      } catch (e) { toast('Код не подошёл: ' + e.message); }
    };
  });
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
    $('#pp-save', b).onclick = () => { const np = readPerson(p && p.id); if (!np) return; if (p) S.people[S.people.findIndex(x => x.id === p.id)] = np; else S.people.push(np); save(); closeSheet(); render();
      if (!p) sheet(`<p class="eyebrow">Новый человек в семье</p><h3>Пройти тест вкусов?</h3><p class="hint">Ответы ${esc(np.name)} добавятся к общему профилю семьи.</p><div class="actions"><button class="btn primary" id="nt-self">Пройти самостоятельно</button><button class="btn ghost" id="nt-fam">Пройти с семьёй</button><button class="btn ghost" id="nt-later">Позже</button></div>`, bb => { $('#nt-self', bb).onclick = () => tasteTest('self'); $('#nt-fam', bb).onclick = () => tasteTest('family'); $('#nt-later', bb).onclick = closeSheet; }); };
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
document.addEventListener('input', e => { if (e.target.id !== 'pf-height' && e.target.id !== 'pf-weight') return;
  const g = $('#pf-goal'), o = g && g.querySelector('option[value="loss"]'); if (!o) return;
  o.disabled = !lossOk(+$('#pf-height').value, +$('#pf-weight').value); if (o.disabled && g.value === 'loss') g.value = 'keep'; });
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.id === 'sheet-close') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
if (S.feed && S.feed.active) { S.feed.loading = false; if (!S.feed.card && !S.feed.exhausted) S.feed.active = false; }
auditPlanSafety(); save();
render();
setTimeout(() => { refreshPrices(); flushFeedback(); if (S.taste.pendingLvl && Server.on() && S.settings.accessKey) Server.call('/v1/tastes', {set: {w: S.taste.pendingLvl}}).then(() => { delete S.taste.pendingLvl; save(); }).catch(() => {}); }, 3000);
if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai') && !location.hostname.includes('claudeusercontent')) { // новая версия сайта: сервис-воркер обновляется при каждом открытии, страница один раз перезагружается на свежие файлы
  const had = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(r => r.update()).catch(() => {}); }
})();

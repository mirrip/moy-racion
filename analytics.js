/* Long-term daily aggregates; no recipes, keys or network requests in this module. */
const RacionAnalytics = (() => {
  'use strict';
  const PAIRS = {met_cys: ['met', 'cys'], phe_tyr: ['phe', 'tyr']};
  const data = {...NUTRITION_DATA, nutrients: [...NUTRITION_DATA.nutrients,
    {id: 'met_cys', name: 'Метионин + цистеин', unit: 'g', group: 'amino'},
    {id: 'phe_tyr', name: 'Фенилаланин + тирозин', unit: 'g', group: 'amino'}]};
  const map = {vd: 'd'};
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  function dish(d) {
    const values = {}, known = {};
    for (const n of data.nutrients) {
      if (PAIRS[n.id]) continue;
      if (finite(d.nutr?.[n.id])) { values[n.id] = d.nutr[n.id]; known[n.id] = true; continue; }
      let total = 0, complete = !!d.ing?.length;
      for (const i of d.ing || []) {
        const k = map[n.id] || n.id;
        const v = finite(i[k]) ? i[k] : (i.nutrients?.[n.id] ?? data.products[i.id]?.[n.id]);
        if (!finite(v) || !finite(i.g)) complete = false;
        else total += v * i.g / 100;
      }
      values[n.id] = total; known[n.id] = complete;
    }
    for (const [id, keys] of Object.entries(PAIRS)) {
      values[id] = keys.reduce((s, k) => s + (values[k] || 0), 0);
      known[id] = keys.every(k => known[k]);
    }
    // Server-computed base values are newer/more specific than the bundled catalogue snapshot.
    for (const k of ['ret', 'sfa', 'sugar_add', 'na', 'iod']) if (!finite(d.nutr?.[k]) && finite(d.base?.[k])) {
      values[k] = d.base[k]; known[k] = true;
    }
    return {values, known};
  }
  function targets(p, energy, micro, profile = 'NASEM') {
    const t = Object.fromEntries(data.nutrients.map(n => [n.id, n.target]));
    const m = p.sex === 'm', old = p.age > 50, ru = profile === 'RU';
    Object.assign(t, {ve: 15, vk: ru || m ? 120 : 90, b1: ru ? 1.5 : m ? 1.2 : 1.1,
      b2: ru ? 1.8 : m ? 1.3 : 1.1, b3: ru ? 20 : m ? 16 : 14, b5: 5,
      b6: ru ? 2 : old ? (m ? 1.7 : 1.5) : 1.3, b7: ru ? 50 : 30, choline: m ? 550 : 425,
      ph: 700, zn: ru ? 12 : m ? 11 : 8, cu: ru ? 1 : .9, mn: ru ? 2 : m ? 2.3 : 1.8,
      se: ru && m ? 70 : 55, iod: 150, fl: (m ? 4 : 3) * 1000,
      cr: old ? (m ? 30 : 20) : m ? 35 : 25, mo: ru ? 70 : 45,
      cl: (p.age > 70 ? 1.8 : old ? 2 : 2.3) * 1000});
    Object.assign(t, {kcal: energy.E, p: energy.P, f: energy.F, c: energy.C, fib: energy.fib,
      ...micro, vd: micro.d, sugar_add: energy.sugar, sfa: energy.sat, na: Math.max(1000, .5 * energy.E)});
    delete t.d;
    // FULL_REPORT: NASEM mg/kg; two requirements refer to sums, not to each constituent.
    const w = energy.W || p.weight;
    for (const n of data.nutrients.filter(n => n.group === 'amino')) t[n.id] = null;
    for (const [k, mg] of Object.entries({his: 14, ile: 19, leu: 42, lys: 38, thr: 20, trp: 5, val: 24, met_cys: 19, phe_tyr: 33})) t[k] = mg * w / 1000;
    // Retinol and carotene are constituents of total A, not separate intake goals.
    t.ret = null; t.car = null;
    return t;
  }
  // Food-only analytics. NASEM/report upper limits for supplements are not applied to food.
  const FOOD_UL = {ret: 3000, vd: 100, vc: 2000, b6: 100, choline: 3500,
    zn: 40, cu: 10, mn: 11, se: 400, iod: 1100, mo: 2000, fl: 10000, cl: 3600};
  const ONLY_UPPER = new Set(['ret', 'na', 'sfa', 'sugar_add', 'trans', 'chol', 'salt']);
  const NOTES = {
    va: 'Нижний ориентир — для всего витамина A. Верхний предел относится только к ретинолу; он показан отдельной строкой.',
    ret: 'Предел относится к ретинолу, а не к бета-каротину. Отдельного минимума ретинола нет.',
    car: 'Отдельная обязательная норма и верхний предел бета-каротина из пищи не установлены.',
    mg: 'Предел 350 мг относится к добавкам и лекарствам, а не к магнию из обычной пищи.',
    fol: 'Предел 1 000 мкг относится к синтетической фолиевой кислоте. Для пищевых фолатов этот предел не применяется.',
    b3: 'Предел 35 мг относится к добавленному синтетическому ниацину, а не к естественному ниацину продуктов.',
    ve: 'Предел для дополнительного альфа-токоферола не применяется к естественному витамину E в еде.',
    b6: 'Верхний предел 100 мг — система NASEM из отчёта проекта. У EFSA другой предел: 12 мг/сутки; здесь системы не смешиваются.',
    na: 'Здесь натрий только из продуктов. Верхняя граница — внутренний предел проекта с учётом фоновой досолки; минимальная общая потребность к этой части не применяется.',
    salt: 'Соль из состава продуктов. Досаливание и добавки не учтены; для всей соли в отчёте задан предел 5 г в сутки.',
    water: 'Учтена вода в продуктах, без выпитых напитков. Сравнивать её с общей потребностью в воде некорректно.',
    met: 'Нормируется общая сумма метионина и цистеина, а не каждое вещество по отдельности. См. объединённую строку.',
    cys: 'Нормируется общая сумма метионина и цистеина. См. объединённую строку.',
    phe: 'Нормируется общая сумма фенилаланина и тирозина. См. объединённую строку.',
    tyr: 'Нормируется общая сумма фенилаланина и тирозина. См. объединённую строку.'
  };
  function limits(p, energy, micro, profile = 'NASEM') {
    const t = targets(p, energy, micro, profile), ranges = {};
    for (const n of data.nutrients) ranges[n.id] = {min: ONLY_UPPER.has(n.id) ? null : t[n.id] || null,
      max: FOOD_UL[n.id] || null, note: NOTES[n.id] || '', source: 'Отчёты проекта · NASEM'};
    const set = (id, min, max, note) => Object.assign(ranges[id], {min, max}, note ? {note} : {});
    const E = energy.E, w = energy.W || p.weight;
    set('kcal', .97 * E, 1.03 * E, 'Рабочий коридор средней энергии ±3% из отчёта; это не токсикологический предел.');
    set('p', .8 * w, Math.min(2 * w, .35 * E / 4), 'Коридор белка из отчёта: минимум 0,8 г/кг; максимум 2 г/кг и 35% энергии.');
    set('f', .20 * E / 9, .35 * E / 9, 'Коридор жиров: 20–35% энергии.');
    set('c', 130, .65 * E / 4, 'Минимум 130 г; верхняя граница — 65% энергии.');
    set('fib', energy.fib, 1.5 * energy.fib, 'Верхняя граница — мягкий ориентир переносимости 1,5 нормы из правил проекта, не UL.');
    set('ca', t.ca, p.age > 50 ? 2000 : 2500);
    set('ph', t.ph, p.age > 70 ? 3000 : 4000);
    set('fe', t.fe, Math.max(45, 15 * E / 1000), 'Верхняя граница по правилам проекта растёт с энергией человека.');
    set('na', null, Math.max(1000, .5 * E));
    set('sfa', null, .1 * E / 9); set('sugar_add', null, .1 * E / 4);
    set('trans', null, .01 * E / 9); set('salt', null, 5);
    set('chol', null, profile === 'RU' ? 300 : null, profile === 'RU' ? 'Предел 300 мг — профиль МР РФ из отчёта.' : 'В выбранной системе NASEM отдельный числовой предел не установлен.');
    set('pufa', .06 * E / 9, .10 * E / 9, 'Рабочий коридор полиненасыщенных жиров из отчёта: 6–10% энергии.');
    set('water', null, null);
    // 18 is supported by the app, but NASEM's 19+ UL table does not apply yet.
    if (p.age === 18) {
      for (const [id, max] of Object.entries({ret: 2800, vc: 1800, b6: 80, choline: 3000, zn: 34, cu: 8, mn: 9, iod: 900, mo: 1700, ca: 3000})) {
        ranges[id].max = max;
        ranges[id].note = (ranges[id].note || '').replace('100 мг', '80 мг') + ' Верхняя граница для 18 лет — по возрастной таблице NASEM/NIH.';
      }
    }
    return ranges;
  }
  function legacyLimits(t) {
    const result = {};
    for (const n of data.nutrients) result[n.id] = {min: ONLY_UPPER.has(n.id) ? null : t[n.id] || null,
      max: FOOD_UL[n.id] || null, note: NOTES[n.id] || '', source: 'Сохранённый ориентир прежней версии'};
    // Person's age/weight were not stored in 0.10.0: no guessed age-dependent UL.
    for (const k of ['na', 'sfa', 'sugar_add']) result[k].max = t[k] || null;
    result.fe.max = finite(t.kcal) ? Math.max(45, 15 * t.kcal / 1000) : null;
    for (const k of ['ca', 'ph']) result[k].note = 'Для старого снимка возраст не сохранён; верхняя граница неизвестна.';
    for (const k of ['met', 'cys', 'phe', 'tyr']) result[k].min = null;
    return result;
  }
  function assess(value, range, unknown = false) {
    const min = finite(range?.min) && range.min > 0 ? range.min : null;
    const max = finite(range?.max) && range.max > 0 ? range.max : null;
    if (unknown) return {state: 'unknown', label: 'Неполные данные', position: null, min, max};
    if (min == null && max == null) return {state: 'unrated', label: 'Без отдельной нормы', position: null, min, max};
    let state = min != null && value < min - 1e-8 ? 'low' : max != null && value > max + 1e-8 ? 'high' : 'normal';
    let pos;
    if (state === 'low') pos = 100 / 3 * Math.max(0, value / min);
    else if (state === 'high') pos = 200 / 3 + 100 / 3 * Math.min(1, (value - max) / max);
    else if (max != null) pos = 100 / 3 + 100 / 3 * (value - (min || 0)) / (max - (min || 0) || 1);
    else { const x = (value - min) / min; pos = 100 / 3 + 100 / 3 * x / (1 + x); }
    return {state, label: {low: 'Недостаток', normal: 'Норма', high: 'Избыток'}[state], position: Math.min(98, Math.max(2, pos)), min, max};
  }
  function makeDay(day, date, people, hooks, meals) {
    const result = {date, meals, people: {}};
    for (let j = 0; j < people.length; j++) {
      const p = people[j], row = {name: p.name, values: {}, missing: {}, targets: hooks.targets(p),
        limits: hooks.limits ? hooks.limits(p) : null, filled: 0};
      day.slots.forEach((sl, i) => {
        if (!sl || sl.unsafe || sl.status === 'skipped') return;
        const f = hooks.factors(sl.dish, i)[j], n = dish(sl.dish); row.filled++;
        for (const k of Object.keys(n.values)) {
          row.values[k] = (row.values[k] || 0) + n.values[k] * f;
          if (!n.known[k]) row.missing[k] = true;
        }
      });
      for (const a of hooks.addons || []) if (a.pid === p.id) {
        const n = dish({ing: [{...a.ing, g: a.g}]});
        for (const k of Object.keys(n.values)) {
          row.values[k] = (row.values[k] || 0) + n.values[k];
          if (!n.known[k]) row.missing[k] = true;
        }
      }
      result.people[p.id] = row;
    }
    return result;
  }
  function aggregate(days, from, until, pid = 'all') {
    const rows = Object.entries(days).filter(([date]) => date >= from && date <= until).sort(([a], [b]) => a.localeCompare(b));
    const values = {}, targets = {}, missing = {}, referenceDays = {}, people = {}, dates = new Set(), ranges = {}, excursions = {};
    for (const [date, day] of rows) for (const [id, p] of Object.entries(day.people || {})) {
      if (pid !== 'all' && id !== pid) continue;
      dates.add(date); people[id] = p.name;
      const own = p.limits || legacyLimits(p.targets || {});
      for (const n of data.nutrients) {
        const k = n.id;
        const value = PAIRS[k] ? PAIRS[k].reduce((s, id) => s + (p.values[id] || 0), 0) : p.values[k] || 0;
        const incomplete = p.missing?.[k] || (p.filled !== 0 && (PAIRS[k]
          ? PAIRS[k].some(id => p.missing?.[id] || !finite(p.values[id])) : !finite(p.values[k])));
        values[k] = (values[k] || 0) + value;
        if (finite(p.targets[k]) && p.targets[k] > 0) { targets[k] = (targets[k] || 0) + p.targets[k]; referenceDays[k] = (referenceDays[k] || 0) + 1; }
        if (incomplete) missing[k] = true;
        const r = own[k] || {}, sum = ranges[k] || (ranges[k] = {min: 0, max: 0, minKnown: true, maxKnown: true, note: r.note || '', source: r.source || ''});
        if (finite(r.min) && r.min > 0) sum.min += r.min; else sum.minKnown = false;
        if (finite(r.max) && r.max > 0) sum.max += r.max; else sum.maxKnown = false;
        const individual = assess(value, r, incomplete);
        const alarm = excursions[k] || (excursions[k] = {highDays: 0, people: {}, dates: {}});
        if (individual.state === 'high') { alarm.highDays++; alarm.people[id] = p.name; alarm.dates[date] = true; }
      }
    }
    for (const r of Object.values(ranges)) { if (!r.minKnown) r.min = null; if (!r.maxKnown) r.max = null; }
    return {values, targets, missing, referenceDays, people, ranges, excursions, days: dates.size, first: rows[0]?.[0] || null};
  }
  return {data, dish, targets, limits, legacyLimits, assess, makeDay, aggregate};
})();

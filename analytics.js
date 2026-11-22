/* Long-term daily aggregates; no recipes, keys or network requests in this module. */
const RacionAnalytics = (() => {
  'use strict';
  const data = NUTRITION_DATA;
  const map = {vd: 'd'};
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  function dish(d) {
    const values = {}, known = {};
    for (const n of data.nutrients) {
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
    return {values, known};
  }
  function targets(p, energy, micro) {
    const t = Object.fromEntries(data.nutrients.map(n => [n.id, n.target]));
    Object.assign(t, {kcal: energy.E, p: energy.P, f: energy.F, c: energy.C, fib: energy.fib,
      ...micro, vd: micro.d, sugar_add: energy.sugar, sfa: energy.sat, na: Math.max(1000, .5 * energy.E)});
    delete t.d;
    // The catalogue supplies reference values at 70 kg; scale indispensable amino acids by weight.
    for (const n of data.nutrients.filter(n => n.group === 'amino' && n.target)) t[n.id] = n.target * p.weight / 70;
    // Retinol and carotene are constituents of total A, not separate intake goals.
    t.ret = null; t.car = null;
    return t;
  }
  function makeDay(day, date, people, hooks, meals) {
    const result = {date, meals, people: {}};
    for (let j = 0; j < people.length; j++) {
      const p = people[j], row = {name: p.name, values: {}, missing: {}, targets: hooks.targets(p), filled: 0};
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
    const values = {}, targets = {}, missing = {}, referenceDays = {}, people = {}, dates = new Set();
    for (const [date, day] of rows) for (const [id, p] of Object.entries(day.people || {})) {
      if (pid !== 'all' && id !== pid) continue;
      dates.add(date); people[id] = p.name;
      for (const n of data.nutrients) {
        const k = n.id;
        values[k] = (values[k] || 0) + (p.values[k] || 0);
        if (finite(p.targets[k]) && p.targets[k] > 0) { targets[k] = (targets[k] || 0) + p.targets[k]; referenceDays[k] = (referenceDays[k] || 0) + 1; }
        if (p.missing[k]) missing[k] = true;
      }
    }
    return {values, targets, missing, referenceDays, people, days: dates.size, first: rows[0]?.[0] || null};
  }
  return {data, dish, targets, makeDay, aggregate};
})();

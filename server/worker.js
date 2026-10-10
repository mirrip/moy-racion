/* «Мой рацион» — сервер на Cloudflare Workers + D1.
   Привязки: DB (D1). Секреты (вписывает владелец сам): GEMINI_KEY, TG_TOKEN, ADMIN_KEY.
   Точки входа: POST /verify, POST /dish/find, POST /dish/generate, GET /sync?since=, POST /tg (вебхук бота). */
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'};
const json = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {'Content-Type': 'application/json; charset=utf-8', ...CORS}});
const nameKey = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '');
const ALG_RX = {milk: /молок|творог|йогурт|кефир|сыр|сметан|сливк|сливочн/i, lactose: /молок|творог|йогурт|кефир|сметан|сливк/i, eggs: /яйц|яич/i, nuts: /орех|миндал|фундук|кешью|фисташ|пекан/i, peanut: /арахис/i,
  fish: /рыб|лосос|сёмг|семг|скумбр|треск|тунец|судак|минтай|сельд|форел|горбуш/i, seafood: /кревет|кальмар|мидии|краб|морепрод|гребеш/i, gluten: /пшен|мука|хлеб|макарон|паста|булгур|лаваш|манк|ячмен|ржан|овсян|кускус/i,
  soy: /соя|соев|тофу/i, sesame: /кунжут|тахин/i, citrus: /лимон|апельсин|мандарин|грейпфрут|лайм/i};
const allergensOf = d => Object.keys(ALG_RX).filter(a => d.ingredients.some(i => ALG_RX[a].test(i.name)));
const sectionOf = d => d.time <= 15 && d.diff <= 2 ? 0 : d.time <= 30 && d.diff <= 5 ? 1 : d.time <= 60 && d.diff <= 7 ? 2 : 3;
const SEC_IDX = s => /Прост/.test(s) ? 0 : /Средн/.test(s) ? 1 : /Сложн/.test(s) ? 2 : 3;

async function keyActive(env, key) {
  if (!key) return null;
  const r = await env.DB.prepare('SELECT key, until FROM keys WHERE key = ?').bind(key).first();
  if (!r) return {active: false, reason: 'notfound'};
  return r.until >= new Date().toISOString().slice(0, 10) ? {active: true, until: r.until} : {active: false, reason: 'expired', until: r.until};
}
// Проверка блюда на сервере: соль, сахар-ограничения нейросети + разумные граммы
function validDish(d) {
  if (!d || !d.name || !Array.isArray(d.ingredients) || d.ingredients.length < 2 || d.ingredients.length > 18) return false;
  const kcal = d.ingredients.reduce((s, i) => s + (+i.kcal || 0) * (+i.g || 0) / 100, 0);
  if (kcal < 80 || kcal > 1400) return false;
  if (d.ingredients.some(i => /колбас|сосис|сардельк|бекон|майонез/i.test(i.name))) return false;
  return true;
}
async function saveDish(env, d, type) {
  const id = 'srv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key = nameKey(d.name);
  const row = {name: d.name, types: d.types || type, time: +d.time || 30, diff: +d.diff || 3, cuisine: d.cuisine || '', steps: d.steps || [], ingredients: d.ingredients};
  await env.DB.prepare('INSERT OR IGNORE INTO dishes (id, name, name_key, types, cuisine, section, allergens, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, row.name, key, row.types, row.cuisine, sectionOf(row), allergensOf(row).join(','), JSON.stringify(row)).run();
  return row;
}
async function gemini(env, system, req) {
  for (const model of ['gemini-flash-latest', 'gemini-2.5-flash']) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({systemInstruction: {parts: [{text: system}]}, contents: [{role: 'user', parts: [{text: JSON.stringify(req)}]}], generationConfig: {temperature: 0.9, responseMimeType: 'application/json'}})});
    if (r.status === 404) continue;
    if (!r.ok) throw new Error('gemini ' + r.status);
    const j = await r.json(); const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return JSON.parse(txt.replace(/^```json|```$/g, '').trim());
  }
  throw new Error('gemini: модель не найдена');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {headers: CORS});
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path === '/' ) return json({ok: true, service: 'moy-racion'});
      if (path === '/verify' && request.method === 'POST') { const {key} = await request.json(); return json(await keyActive(env, key) || {active: false, reason: 'nokey'}); }
      if (path === '/sync') {
        const since = url.searchParams.get('since') || '1970-01-01';
        const {results} = await env.DB.prepare('SELECT id, data, created FROM dishes WHERE hidden = 0 AND created > ? ORDER BY created LIMIT 500').bind(since).all();
        return json({dishes: results.map(r => Object.assign({id: r.id}, JSON.parse(r.data))), until: results.length ? results[results.length - 1].created : since});
      }
      if (path.startsWith('/dish/') && request.method === 'POST') {
        const body = await request.json(), acc = await keyActive(env, body.key);
        if (!acc || !acc.active) return json({error: 'no_access', reason: acc ? acc.reason : 'nokey'}, 403);
        const req = body.req || {}, type = req.type || 'l', sec = SEC_IDX(req.section || ''), seen = new Set(body.seen || []), banned = new Set(body.banned || []);
        const alg = (body.allergens || []);
        if (path === '/dish/find') {
          const {results} = await env.DB.prepare("SELECT id, name_key, allergens, data FROM dishes WHERE hidden = 0 AND section <= ? AND instr(types, ?) > 0 AND (? = '' OR cuisine = ?) ORDER BY RANDOM() LIMIT 40")
            .bind(sec, type, req.cuisine || '', req.cuisine || '').all();
          const hit = results.find(r => !seen.has(r.id) && !banned.has(r.name_key) && !alg.some(a => r.allergens.split(',').includes(a)));
          if (hit) await env.DB.prepare('UPDATE dishes SET shown = shown + 1 WHERE id = ?').bind(hit.id).run();
          return json({dish: hit ? Object.assign({id: hit.id}, JSON.parse(hit.data)) : null});
        }
        if (path === '/dish/generate') {
          if (!env.GEMINI_KEY) return json({error: 'no_gemini_key'}, 500);
          let d = await gemini(env, body.system || '', req);
          if (!validDish(d)) d = await gemini(env, (body.system || '') + ' Предыдущий ответ не прошёл проверку: проверь граммы и калорийность.', req);
          if (!validDish(d)) return json({dish: null});
          await env.DB.prepare('UPDATE keys SET ai_calls = ai_calls + 1 WHERE key = ?').bind(body.key).run();
          return json({dish: await saveDish(env, d, type)});
        }
      }
      if (path === '/tg' && request.method === 'POST') { // вебхук Telegram-бота: /start выдаёт тестовый ключ на 7 дней (оплата — позже)
        const u = await request.json(), msg = u.message; if (!msg || !msg.text) return json({ok: true});
        const chat = msg.chat.id; let text = 'Напишите /start, чтобы получить ключ.';
        if (msg.text.startsWith('/start') || msg.text.startsWith('/key')) {
          let r = await env.DB.prepare('SELECT key, until FROM keys WHERE tg_user = ?').bind(String(chat)).first();
          if (!r) { const key = 'MR-' + crypto.randomUUID().slice(0, 8).toUpperCase(); const until = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
            await env.DB.prepare('INSERT INTO keys (key, tg_user, until) VALUES (?, ?, ?)').bind(key, String(chat), until).run(); r = {key, until}; }
          text = `Ваш ключ для «Мой рацион»: ${r.key}\nДействует до ${r.until}.\nВставьте его в приложении: Настройки → Ключ доступа.`;
        }
        await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: chat, text})});
        return json({ok: true});
      }
      return json({error: 'not_found'}, 404);
    } catch (e) { return json({error: String(e.message || e)}, 500); }
  }
};

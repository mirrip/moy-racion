/* Personal stock and package arithmetic. All quantities use ingredient g/ml bases. */
const RacionPantry = (() => {
  const norm = s => String(s || '').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
  const dimension = i => i.unit === 'ml' ? 'volume' : 'mass';
  const key = i => (i.id ? 'id:'+i.id : norm(i.name)) + '|' + dimension(i);
  const valid = n => Number.isFinite(n) && n >= 0 && n <= 1e9;
  const clean = n => Math.round(n * 1e6) / 1e6;
  // Bundled catalog, loaded once with the app. Never fetch package metadata at runtime.
  const catalog = typeof RacionPackaging === 'undefined' ? [] : RacionPackaging.products;
  const catalogIds = new Map(), catalogNames = new Map();
  for (const product of catalog) {
    catalogIds.set(String(product.id), product);
    if (product.legacyId) catalogIds.set(String(product.legacyId), product);
    const name = norm(product.name);
    catalogNames.set(name, catalogNames.has(name) ? null : product);
  }
  function catalogProduct(i) {
    // A known ID takes precedence over a display name; names match only exactly.
    return (i.id && catalogIds.get(String(i.id))) || catalogNames.get(norm(i.name)) || null;
  }
  function catalogPacks(i) {
    const product = catalogProduct(i);
    if (!product || (i.unit === 'ml' && !(product.density > 0))) return [];
    return product.packs.map(([grams, observations]) => {
      let size = grams;
      if (i.unit === 'ml') size = grams / product.density;
      else if (i.unit === 'pcs' && product.unit === 'pcs') {
        const pieces = grams / product.pcs_g;
        // A true count pack (e.g. ten eggs) follows this ingredient's piece weight.
        if (Math.abs(pieces - Math.round(pieces)) < 1e-6) size = Math.round(pieces) * (+i.pcs_g || 55);
      }
      return {size:clean(size),price:null,source:'catalog',catalogId:product.id,observations};
    });
  }
  const find = (state, i) => state.items.find(x => dimension(x) === dimension(i) &&
    ((i.id && x.id && String(x.id) === String(i.id)) || norm(x.name) === norm(i.name)));
  function create(raw, legacy = [], catalog = []) {
    if (raw?.v === 2 && Array.isArray(raw.items)) {
      return {v:2, items:raw.items.filter(x => x && x.name && (x.amount === null || valid(x.amount))), packs:Object.fromEntries(Object.entries(raw.packs || {}).filter(([,p])=>p&&(p.loose===true||(valid(p.size)&&p.size>0&&(p.price==null||valid(p.price)))))), receipts:Array.isArray(raw.receipts)?raw.receipts:[], revision:raw.revision || 0};
    }
    const items = [];
    for (const name of legacy) {
      if (!String(name).trim() || items.some(x => norm(x.name) === norm(name))) continue;
      const i = catalog.find(x => norm(x.name) === norm(name)) || {name,unit:'g'};
      items.push({...meta(i),amount:null});
    }
    return {v:2,items,packs:{},receipts:[],revision:0};
  }
  function meta(i) { return {id:i.id || null,name:String(i.name),unit:i.unit || 'g',pcs_g:+i.pcs_g || 55,price:+i.price || 0}; }
  function put(state, i, amount) {
    if (!i.name?.trim() || !valid(amount)) throw new Error('Укажите корректный остаток');
    const item = find(state,i);
    if (item) { const oldKey=key(item),newKey=key({...item,...i}); if(oldKey!==newKey&&state.packs[oldKey]&&!state.packs[newKey])state.packs[newKey]=state.packs[oldKey]; Object.assign(item,meta({...item,...i}),{amount:clean(amount)}); }
    else state.items.push({...meta(i),amount:clean(amount)});
    state.revision++;
  }
  function remove(state,i) { const item=find(state,i); if(item){state.items.splice(state.items.indexOf(item),1);state.revision++;} }
  function setPack(state, i, pack) {
    if (!pack) { state.packs[key(i)]={loose:true}; return; }
    if (!valid(pack.size) || pack.size <= 0 || (pack.price != null && !valid(pack.price))) throw new Error('Проверьте размер и цену упаковки');
    state.packs[key(i)] = {size:clean(pack.size),price:pack.price == null ? null : +pack.price};
  }
  function defaultPack(i) {
    const actual = catalogPacks(i)[0];
    if (actual) return actual;
    if(i.unit==='ml' && /молок|кефир|ряженк/i.test(i.name))return {size:1000,price:null};
    if((!i.unit || i.unit==='g') && /греч|(?:^|\s)рис(?:$|\s)|пшено|перлов|булгур|фасоль сух|сухая фасоль/i.test(i.name))return {size:1000,price:null};
    return null;
  }
  function quote(state, i, need, useStock, round) {
    if (!valid(need)) throw new Error('Некорректная потребность');
    const item=find(state,i), available=+item?.amount || 0;
    const used=useStock ? Math.min(available,need) : 0, missing=clean(Math.max(0,need-used));
    const preference=state.packs[key(i)] || (item && state.packs[key(item)]);
    const pack=preference?.loose?null:preference||defaultPack(i);
    const count=pack && missing>1e-6 ? Math.ceil((missing-1e-7)/pack.size) : 0;
    const buy=missing<=1e-6 ? 0 : pack ? clean(count*pack.size) : round(i,missing).g;
    const price=pack?.price != null ? count*pack.price : buy*(i.storePriceKnown ? +i.price : (+i.price || +item?.price || 0))/1000;
    return {i:meta(i),key:key(i),need:clean(need),available,used:clean(used),missing,buy:clean(buy),count,pack,price,
      priceKnown:buy===0 || pack?.price != null || i.storePriceKnown || (+i.price || +item?.price || 0)>0,
      after:clean(available+buy-need),useStock:!!useStock};
  }
  function purchase(state, rows, signature, dates) {
    const duplicate=state.receipts.find(r=>r.signature===signature && !r.undone);
    if(duplicate) return {receipt:duplicate,duplicate:true};
    // Revalidate against current stock before changing anything; no partially applied transaction.
    const seen=[];
    for(const row of rows){
      if(find({items:seen},row.i)) throw new Error('Повторяющийся продукт в закупке');
      seen.push(row.i);
      const current=+find(state,row.i)?.amount || 0;
      if(!valid(row.buy) || !valid(row.need) || Math.abs(current-row.available)>1e-5 || current+row.buy-row.need < -1e-5)
        throw new Error('Остатки изменились. Обновите список покупок.');
    }
    const lines=rows.map(row=>({i:row.i,before:find(state,row.i) ? {...find(state,row.i)} : null,after:clean(row.available+row.buy-row.need),buy:row.buy,need:row.need,price:row.price}));
    for(const line of lines){const item=find(state,line.i);if(item) { const oldKey=key(item),newKey=key(line.i);if(oldKey!==newKey&&state.packs[oldKey]&&!state.packs[newKey])state.packs[newKey]=state.packs[oldKey];Object.assign(item,line.i,{amount:line.after});}else state.items.push({...line.i,amount:line.after});}
    state.revision++;
    const receipt={id:signature+'@'+(state.receipts.length+1),signature,dates:[...dates],lines,total:rows.reduce((s,r)=>s+r.price,0),revision:state.revision,at:Date.now(),undone:false};
    state.receipts.push(receipt);
    return {receipt,duplicate:false};
  }
  const canUndo=(state,id)=>{const r=state.receipts.find(r=>r.id===id);return !!r&&!r.undone&&r.revision===state.revision;};
  function undo(state,id){
    if(!canUndo(state,id)) throw new Error('Остатки уже изменились. Исправьте их в холодильнике.');
    const r=state.receipts.find(r=>r.id===id);
    for(const line of r.lines){const item=find(state,line.i);if(item)state.items.splice(state.items.indexOf(item),1);if(line.before)state.items.push({...line.before});}
    r.undone=true;state.revision++;return r;
  }
  const names=state=>state.items.filter(x=>x.amount>1e-6).map(x=>x.name);
  function coverage(state,dish){let total=0,covered=0;for(const i of dish.ing){total+=i.g;covered+=Math.min(+find(state,i)?.amount||0,i.g);}return total?covered/total:0;}
  function toBase(value,unit,i){
    const n=+String(value).replace(',','.'); if(!valid(n))throw new Error('Проверьте количество');
    return clean(n*(unit==='kg'||unit==='l'?1000:unit==='pcs'?(+i.pcs_g||55):1));
  }
  return {norm,key,find,create,put,remove,setPack,quote,purchase,canUndo,undo,names,coverage,toBase,defaultPack,catalogPacks};
})();

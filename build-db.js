const fs = require('fs');
const TYPE_KO = {1:'노말',2:'격투',3:'비행',4:'독',5:'땅',6:'바위',7:'벌레',8:'고스트',9:'강철',10:'불꽃',11:'물',12:'풀',13:'전기',14:'에스퍼',15:'얼음',16:'드래곤',17:'악',18:'페어리'};
const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
function parseCSV(text) {
  return text.trim().split(/\r?\n/).slice(1).map(line => line.split(','));
}
async function buildDatabase() {
  if (fs.existsSync('./pokemon_db.json')) {
    try {
      const ex = JSON.parse(fs.readFileSync('./pokemon_db.json','utf-8'));
      if (Array.isArray(ex) && ex.length > 500) { console.log('✅ 기존 DB 확인 완료:', ex.length); return; }
    } catch(e) {}
  }
  console.log('공식 GitHub 데이터에서 전 세대 포켓몬 한글 DB 생성 중...');
  const [spTxt, nmTxt, pkTxt, tpTxt] = await Promise.all([
    fetch(BASE + '/pokemon_species.csv').then(r => r.text()),
    fetch(BASE + '/pokemon_species_names.csv').then(r => r.text()),
    fetch(BASE + '/pokemon.csv').then(r => r.text()),
    fetch(BASE + '/pokemon_types.csv').then(r => r.text())
  ]);
  const speciesMap = new Map();
  for (const r of parseCSV(spTxt)) {
    speciesMap.set(Number(r[0]), { gen: Number(r[2]) || 1, is_legendary: r[8] === '1' || r[9] === '1' });
  }
  const koNameMap = new Map();
  for (const r of parseCSV(nmTxt)) {
    if (r[1] === '3') koNameMap.set(Number(r[0]), r[2]);
  }
  const typeMap = new Map();
  for (const r of parseCSV(tpTxt)) {
    const pid = Number(r[0]), tid = Number(r[1]);
    if (!TYPE_KO[tid]) continue;
    if (!typeMap.has(pid)) typeMap.set(pid, []);
    typeMap.get(pid).push(TYPE_KO[tid]);
  }
  const finalDB = [];
  for (const r of parseCSV(pkTxt)) {
    const id = Number(r[0]), identifier = r[1], specId = Number(r[2]), isDef = r[7] === '1';
    const sp = speciesMap.get(specId), baseKo = koNameMap.get(specId), types = typeMap.get(id);
    if (!sp || !baseKo || !types || !types.length) continue;
    const isMega = /-mega|-primal/.test(identifier);
    const isRegional = /-alola|-galar|-hisui|-paldea/.test(identifier);
    if (!isDef && !isMega && !isRegional) continue;
    let displayName = baseKo;
    if (isMega) {
      const suffix = identifier.endsWith('-x') ? 'X' : identifier.endsWith('-y') ? 'Y' : '';
      displayName = (identifier.includes('-primal') ? '원시' : '메가') + baseKo + suffix;
    } else if (isRegional) {
      const pfx = identifier.includes('-alola') ? '알로라 ' : identifier.includes('-galar') ? '가라르 ' : identifier.includes('-hisui') ? '히스이 ' : '팔데아 ';
      displayName = pfx + baseKo;
    }
    const cleanAns = displayName.replace(/\s+/g, ''), cleanBase = baseKo.replace(/\s+/g, '');
    finalDB.push({
      id, dex: specId, name_ko: displayName,
      accepted_answers: Array.from(new Set([cleanAns, cleanBase])),
      types, is_single: types.length === 1,
      gen: sp.gen, is_mega: isMega, is_regional: isRegional,
      is_legendary: sp.is_legendary, name_len: cleanBase.length,
      img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png'
    });
  }
  fs.writeFileSync('./pokemon_db.json', JSON.stringify(finalDB, null, 2), 'utf-8');
  console.log('🎉 완료! 총 ' + finalDB.length + '마리의 포켓몬 데이터가 pokemon_db.json에 저장되었습니다!');
}
buildDatabase();
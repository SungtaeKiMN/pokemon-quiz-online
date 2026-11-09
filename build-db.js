// build-db.js
const fs = require('fs');

const TYPE_KO = {
  normal: '노말', fighting: '격투', flying: '비행', poison: '독', ground: '땅',
  rock: '바위', bug: '벌레', ghost: '고스트', steel: '강철', fire: '불꽃',
  water: '물', grass: '풀', electric: '전기', psychic: '에스퍼', ice: '얼음',
  dragon: '드래곤', dark: '악', fairy: '페어리'
};

const GEN_MAP = {
  'generation-i': 1, 'generation-ii': 2, 'generation-iii': 3,
  'generation-iv': 4, 'generation-v': 5, 'generation-vi': 6,
  'generation-vii': 7, 'generation-viii': 8, 'generation-ix': 9
};

async function buildDatabase() {
  console.log('PokeAPI에서 전 세대 포켓몬 한글 데이터를 가져오는 중...');

  const query = `
  query {
    pokemon_v2_pokemonforms(where: {is_battle_only: {_eq: false}}) {
      form_name
      pokemon_v2_pokemon {
        id
        is_default
        pokemon_v2_pokemontypes {
          pokemon_v2_type { name }
        }
        pokemon_v2_pokemonspecy {
          id
          is_legendary
          is_mythical
          pokemon_v2_generation { name }
          pokemon_v2_pokemonspeciesnames(where: {language_id: {_eq: 3}}) {
            name
          }
        }
      }
      pokemon_v2_pokemonformnames(where: {language_id: {_eq: 3}}) {
        name
        pokemon_name
      }
    }
    mega_forms: pokemon_v2_pokemonforms(where: {form_name: {_iregex: "mega|primal"}}) {
      form_name
      pokemon_v2_pokemon {
        id
        pokemon_v2_pokemontypes {
          pokemon_v2_type { name }
        }
        pokemon_v2_pokemonspecy {
          id
          is_legendary
          is_mythical
          pokemon_v2_generation { name }
          pokemon_v2_pokemonspeciesnames(where: {language_id: {_eq: 3}}) {
            name
          }
        }
      }
      pokemon_v2_pokemonformnames(where: {language_id: {_eq: 3}}) {
        name
        pokemon_name
      }
    }
  }`;

  const res = await fetch('https://beta.pokeapi.co/graphql/v1beta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const json = await res.json();
  const rawList = [...json.data.pokemon_v2_pokemonforms, ...json.data.mega_forms];
  const dbMap = new Map();

  for (const item of rawList) {
    const poke = item.pokemon_v2_pokemon;
    const specy = poke.pokemon_v2_pokemonspecy;
    if (!specy || !specy.pokemon_v2_pokemonspeciesnames.length) continue;

    const baseNameKo = specy.pokemon_v2_pokemonspeciesnames[0].name.trim();
    const formNameObj = item.pokemon_v2_pokemonformnames?.[0];
    const formNameKo = formNameObj?.pokemon_name || formNameObj?.name || baseNameKo;
    const formTag = item.form_name || '';

    const isMega = /mega|primal/.test(formTag);
    const isRegional = /alola|galar|hisui|paldea/.test(formTag);

    // 기본 폼도 아니고 메가/리전폼도 아닌 단순 외형 차이(모자 피카츄 등)는 중복 방지를 위해 제외
    if (!poke.is_default && !isMega && !isRegional) continue;

    const types = poke.pokemon_v2_pokemontypes.map(t => TYPE_KO[t.pokemon_v2_type.name]).filter(Boolean);
    if (types.length === 0) continue;

    let displayName = baseNameKo;
    if (isMega) displayName = formNameKo.includes('메가') || formNameKo.includes('원시') ? formNameKo : `메가${baseNameKo}`;
    if (isRegional) {
      const prefix = formTag.includes('alola') ? '알로라 ' : formTag.includes('galar') ? '가라르 ' : formTag.includes('hisui') ? '히스이 ' : '팔데아 ';
      displayName = formNameKo !== baseNameKo ? formNameKo : `${prefix}${baseNameKo}`;
    }

    const cleanAnswer = displayName.replace(/\s+/g, '');
    const cleanBase = baseNameKo.replace(/\s+/g, '');

    const key = `${poke.id}_${formTag}`;
    dbMap.set(key, {
      id: poke.id,
      dex: specy.id,
      name_ko: displayName,
      accepted_answers: Array.from(new Set([cleanAnswer, cleanBase])), // '메가리자몽X'와 '리자몽' 둘 다 정답 인정
      types,
      is_single: types.length === 1,
      gen: GEN_MAP[specy.pokemon_v2_generation.name] || 1,
      is_mega: isMega,
      is_regional: isRegional,
      is_legendary: specy.is_legendary || specy.is_mythical,
      name_len: cleanBase.length,
      img: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${poke.id}.png`
    });
  }

  const finalDB = Array.from(dbMap.values());
  fs.writeFileSync('./pokemon_db.json', JSON.stringify(finalDB, null, 2), 'utf-8');
  console.log(`완료! 총 ${finalDB.length}마리의 포켓몬 데이터가 pokemon_db.json에 저장되었습니다.`);
}

buildDatabase();
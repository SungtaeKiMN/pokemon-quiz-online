// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

const POKEMON_DB = JSON.parse(fs.readFileSync('./pokemon_db.json', 'utf-8'));
const ALL_TYPES = ['노말','불꽃','물','풀','전기','얼음','격투','독','땅','비행','에스퍼','벌레','바위','고스트','드래곤','악','강철','페어리'];
const MAX_PLAYERS = 10;

// 방 상태 관리 메모리
const rooms = new Map();

// 스페셜 조건 후보군 생성 함수
const SPECIAL_CANDIDATES = [
  { id: 'mega', label: '🔥 메가진화 / 원시회귀 가능 포켓몬만!', check: p => p.is_mega },
  { id: 'regional', label: '🌴 리전폼(알로라·가라르·히스이·팔데아) 포켓몬만!', check: p => p.is_regional },
  { id: 'legendary', label: '⚡ 전설 / 환상의 포켓몬만!', check: p => p.is_legendary },
  { id: 'len2', label: '🔤 기본 한글 이름이 2글자인 포켓몬만!', check: p => p.name_len === 2 },
  { id: 'len3', label: '🔤 기본 한글 이름이 3글자인 포켓몬만!', check: p => p.name_len === 3 },
  { id: 'gen1_3', label: '📼 1~3세대(관동·성도·호연) 포켓몬만!', check: p => p.gen >= 1 && p.gen <= 3 },
  { id: 'gen4_6', label: '💿 4~6세대(신오·하나·칼로스) 포켓몬만!', check: p => p.gen >= 4 && p.gen <= 6 },
  { id: 'gen7_9', label: '🚀 7~9세대(알로라·가라르·팔데아) 포켓몬만!', check: p => p.gen >= 7 && p.gen <= 9 }
];

function filterByTypes(typeA, typeB) {
  const isSingle = typeA === typeB;
  return POKEMON_DB.filter(p => {
    if (isSingle) return p.is_single && p.types[0] === typeA;
    return !p.is_single && p.types.includes(typeA) && p.types.includes(typeB);
  });
}

function getPublicRoomList() {
  const list = [];
  rooms.forEach((r, code) => {
    list.push({
      code,
      title: r.title,
      playerCount: r.players.length,
      maxPlayers: MAX_PLAYERS,
      maxRounds: r.maxRounds,
      state: r.state
    });
  });
  return list;
}

function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit('room_update', {
    code: room.code,
    title: room.title,
    hostId: room.hostId,
    maxRounds: room.maxRounds,
    currentRound: room.currentRound,
    state: room.state,
    players: room.players,
    pickers: room.pickers,
    selectedTypes: room.selectedTypes,
    specialCondition: room.specialCondition ? room.specialCondition.label : null
  });
}

function startNextRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  clearTimeout(room.timer);

  if (room.currentRound >= room.maxRounds) {
    room.state = 'FINISHED';
    const sorted = [...room.players].sort((a, b) => b.score - a.score);
    io.to(roomCode).emit('game_over', { rankings: sorted });
    broadcastRoomState(roomCode);
    return;
  }

  room.currentRound += 1;
  room.state = 'PICKING';
  room.selectedTypes = {};
  room.specialCondition = null;
  room.validPool = [];

  // 참가자 중 랜덤 2명 추첨 (1명뿐이면 혼자 2개 선택)
  const shuffled = [...room.players].sort(() => Math.random() - 0.5);
  if (shuffled.length >= 2) {
    room.pickers = [shuffled[0].id, shuffled[1].id];
  } else {
    room.pickers = [shuffled[0].id, shuffled[0].id];
  }

  broadcastRoomState(roomCode);
  io.to(roomCode).emit('system_msg', `📢 [라운드 ${room.currentRound}/${room.maxRounds}] 타입 지목자 2명이 선정되었습니다! (15초 내 선택)`);

  // 15초 내 안 고르면 자동 랜덤 선택
  room.timer = setTimeout(() => {
    room.pickers.forEach((pickerId, idx) => {
      const slot = idx === 0 ? 'A' : 'B';
      if (!room.selectedTypes[slot]) {
        room.selectedTypes[slot] = ALL_TYPES[Math.floor(Math.random() * ALL_TYPES.length)];
      }
    });
    evaluateTypesAndStartQuiz(roomCode);
  }, 15000);
}

function evaluateTypesAndStartQuiz(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  clearTimeout(room.timer);

  const typeA = room.selectedTypes.A;
  const typeB = room.selectedTypes.B;
  const basePool = filterByTypes(typeA, typeB);

  // 해당 타입 조합의 포켓몬이 0마리인 경우 다시 지목
  if (basePool.length === 0) {
    io.to(roomCode).emit('system_msg', `⚠️ [${typeA} + ${typeB}] 조합을 가진 포켓몬이 존재하지 않습니다! 지목자를 다시 추첨합니다.`);
    room.currentRound -= 1; // 라운드 유지하고 재추첨
    setTimeout(() => startNextRound(roomCode), 2000);
    return;
  }

  // 20% 확률로 스페셜 조건 발동 (단, 정답이 최소 1마리 이상 존재하는 조건 중에서만 선택)
  let chosenSpecial = null;
  if (Math.random() < 0.20) {
    const possibleSpecials = SPECIAL_CANDIDATES.filter(cond => basePool.some(cond.check));
    if (possibleSpecials.length > 0) {
      chosenSpecial = possibleSpecials[Math.floor(Math.random() * possibleSpecials.length)];
    }
  }

  room.specialCondition = chosenSpecial;
  room.validPool = chosenSpecial ? basePool.filter(chosenSpecial.check) : basePool;
  room.state = 'BATTLING';

  broadcastRoomState(roomCode);
  io.to(roomCode).emit('quiz_start', {
    round: room.currentRound,
    typeA,
    typeB,
    isSingle: typeA === typeB,
    specialLabel: chosenSpecial ? chosenSpecial.label : null,
    totalCount: room.validPool.length
  });

  // 25초 제한시간 타이머 (12초 경과 시 초성/이미지 힌트 전송)
  room.hintTimer = setTimeout(() => {
    if (room.state !== 'BATTLING') return;
    const sample = room.validPool[Math.floor(Math.random() * room.validPool.length)];
    io.to(roomCode).emit('quiz_hint', {
      lengthHint: `글자 수 힌트: ${sample.name_ko.length}글자 (예시 개체 중 하나)`,
      silhouetteImg: sample.img
    });
  }, 12000);

  room.timer = setTimeout(() => {
    if (room.state !== 'BATTLING') return;
    endRound(roomCode, null, null);
  }, 25000);
}

function endRound(roomCode, winnerPlayer, matchedPokemon) {
  const room = rooms.get(roomCode);
  if (!room || room.state === 'ROUND_END') return;
  clearTimeout(room.timer);
  clearTimeout(room.hintTimer);

  room.state = 'ROUND_END';
  const points = room.specialCondition ? 2 : 1;

  if (winnerPlayer) {
    winnerPlayer.score += points;
  }

  io.to(roomCode).emit('round_result', {
    winnerName: winnerPlayer ? winnerPlayer.nickname : null,
    pointsEarned: winnerPlayer ? points : 0,
    matchedPokemon,
    allAnswers: room.validPool.slice(0, 24).map(p => ({ name: p.name_ko, img: p.img })),
    totalAnswerCount: room.validPool.length
  });

  broadcastRoomState(roomCode);
  room.timer = setTimeout(() => startNextRound(roomCode), 5000);
}

io.on('connection', (socket) => {
  socket.nickname = '트레이너';
  socket.currentRoom = null;

  socket.emit('room_list', getPublicRoomList());

  socket.on('set_nickname', (name) => {
    socket.nickname = (name || '트레이너').trim().slice(0, 12);
    socket.emit('nickname_ok', socket.nickname);
  });

  socket.on('create_room', ({ title, maxRounds }) => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const rounds = Math.min(Math.max(parseInt(maxRounds) || 10, 3), 50);

    const newRoom = {
      code,
      title: (title || `${socket.nickname}의 포켓몬방`).slice(0, 20),
      hostId: socket.id,
      maxRounds: rounds,
      currentRound: 0,
      state: 'WAITING', // WAITING, PICKING, BATTLING, ROUND_END, FINISHED
      players: [{ id: socket.id, nickname: socket.nickname, score: 0 }],
      pickers: [],
      selectedTypes: {},
      specialCondition: null,
      validPool: [],
      timer: null,
      hintTimer: null
    };

    rooms.set(code, newRoom);
    socket.join(code);
    socket.currentRoom = code;

    broadcastRoomState(code);
    io.emit('room_list', getPublicRoomList());
  });

  socket.on('join_room', (code) => {
    const cleanCode = (code || '').toUpperCase().trim();
    const room = rooms.get(cleanCode);

    if (!room) return socket.emit('error_msg', '존재하지 않는 방 코드입니다.');
    if (room.players.length >= MAX_PLAYERS) return socket.emit('error_msg', '방 인원이 가득 찼습니다 (최대 10명).');
    if (room.state !== 'WAITING' && room.state !== 'FINISHED') return socket.emit('error_msg', '이미 게임이 진행 중인 방입니다.');

    room.players.push({ id: socket.id, nickname: socket.nickname, score: 0 });
    socket.join(cleanCode);
    socket.currentRoom = cleanCode;

    broadcastRoomState(cleanCode);
    io.to(cleanCode).emit('system_msg', `👋 ${socket.nickname}님이 입장했습니다. (${room.players.length}/${MAX_PLAYERS})`);
    io.emit('room_list', getPublicRoomList());
  });

  socket.on('start_game', () => {
    const room = rooms.get(socket.currentRoom);
    if (!room || room.hostId !== socket.id) return;
    room.players.forEach(p => p.score = 0);
    room.currentRound = 0;
    io.emit('room_list', getPublicRoomList());
    startNextRound(room.code);
  });

  socket.on('pick_type', ({ slot, type }) => {
    const room = rooms.get(socket.currentRoom);
    if (!room || room.state !== 'PICKING') return;
    if (!ALL_TYPES.includes(type)) return;

    const expectedPickerId = slot === 'A' ? room.pickers[0] : room.pickers[1];
    if (socket.id !== expectedPickerId) return;

    room.selectedTypes[slot] = type;
    broadcastRoomState(room.code);

    if (room.selectedTypes.A && room.selectedTypes.B) {
      evaluateTypesAndStartQuiz(room.code);
    }
  });

  // 실시간 채팅 및 정답 입력 처리
  socket.on('chat_or_answer', (rawText) => {
    const room = rooms.get(socket.currentRoom);
    if (!room) return;
    const text = (rawText || '').trim();
    if (!text) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // 1. 먼저 일반 채팅 브로드캐스트
    io.to(room.code).emit('chat_msg', { nickname: player.nickname, text });

    // 2. 배틀 페이즈일 경우 정답 여부 판정
    if (room.state === 'BATTLING') {
      const normalizedInput = text.replace(/\s+/g, '');
      const matched = room.validPool.find(p => p.accepted_answers.includes(normalizedInput));
      if (matched) {
        endRound(room.code, player, matched);
      }
    }
  });

  socket.on('disconnect', () => {
    const code = socket.currentRoom;
    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      clearTimeout(room.timer);
      clearTimeout(room.hintTimer);
      rooms.delete(code);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
        io.to(code).emit('system_msg', `👑 방장이 ${room.players[0].nickname}님으로 변경되었습니다.`);
      }
      broadcastRoomState(code);
    }
    io.emit('room_list', getPublicRoomList());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 포켓몬 멀티플레이 퀴즈 서버 가동 중: http://localhost:${PORT}`);
});
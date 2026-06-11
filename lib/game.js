// lib/game.js — منطق اللعبة الكامل
const crypto = require('crypto');
const { saveRoom, loadAllRooms, addLog } = require('./db');

// كل الغرف محمّلة في الذاكرة، وتُحفَظ في SQLite عند كل تعديل
const rooms = new Map();

function bootFromDb() {
  for (const room of loadAllRooms()) {
    // عند إعادة تشغيل الخادم: الجميع يعتبر غير متصل حتى يعيد الاتصال
    for (const p of Object.values(room.players)) p.connected = false;
    rooms.set(room.code, room);
  }
  return rooms.size;
}

const uid = () => crypto.randomBytes(8).toString('hex');
const token = () => crypto.randomBytes(16).toString('hex');

function genRoomCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function shuffledDeck() {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createRoom(defaultHearts = 3) {
  const room = {
    code: genRoomCode(),
    hostToken: token(),
    createdAt: new Date().toISOString(),
    defaultHearts: clampHearts(defaultHearts),
    phase: 'lobby', // lobby | blue | red | results
    roundActive: false,
    roundGroup: null,      // اسم المجموعة للجولة الحالية (null = الجميع)
    roundNumber: 0,
    currentTurn: null,     // اللاعب الذي يختار حالياً
    groups: [],            // أسماء المجموعات
    reveals: { blueAll: false, redAll: false, perPlayer: {} }, // perPlayer[id] = {blue, redA, redB}
    winnerIds: [],
    players: {},           // id -> player
  };
  rooms.set(room.code, room);
  saveRoom(room);
  addLog(room.code, 'إنشاء الغرفة', null, null, null, `قلوب افتراضية: ${room.defaultHearts}`);
  return room;
}

function clampHearts(v) {
  v = parseInt(v, 10);
  if (isNaN(v)) v = 3;
  return Math.max(0, Math.min(99, v));
}

function getRoom(code) {
  return rooms.get(String(code || '').trim()) || null;
}

function addPlayer(room, name, { pending = true } = {}) {
  const player = {
    id: uid(),
    token: token(),
    name: String(name || '').trim().slice(0, 30) || 'لاعب',
    group: null,
    hearts: room.defaultHearts,
    cups: 0,
    status: pending ? 'pending' : 'active', // pending | active | eliminated | removed
    connected: true,
    inRound: false,
    roundAction: null, // challenge | withdraw | null
    cards: emptyCards(),
  };
  room.players[player.id] = player;
  addLog(room.code, pending ? 'طلب انضمام' : 'انضمام لاعب', player.name, null, null, null);
  saveRoom(room);
  return player;
}

function emptyCards() {
  return {
    blue: null, redA: null, redB: null,          // المجموعات العشر (تُوزَّع عند بدء الجولة)
    bluePick: null, redAPick: null, redBPick: null, // مؤشر البطاقة المختارة
  };
}

function findByToken(room, t) {
  return Object.values(room.players).find((p) => p.token === t) || null;
}

// ---------- إدارة الجولة ----------

function startRound(room, groupName = null) {
  room.roundNumber += 1;
  room.roundActive = true;
  room.roundGroup = groupName || null;
  room.phase = 'blue';
  room.currentTurn = null;
  room.reveals = { blueAll: false, redAll: false, perPlayer: {} };
  room.winnerIds = [];
  for (const p of Object.values(room.players)) {
    const inGroup = !groupName || p.group === groupName;
    p.inRound = p.status === 'active' && inGroup;
    p.roundAction = null;
    p.cards = emptyCards();
    if (p.inRound) {
      p.cards.blue = shuffledDeck();
      p.cards.redA = shuffledDeck();
      p.cards.redB = shuffledDeck();
    }
  }
  addLog(room.code, 'بدء جولة', null, null, String(room.roundNumber), groupName ? `مجموعة: ${groupName}` : 'كل اللاعبين');
  saveRoom(room);
}

function resetRound(room) {
  room.roundActive = false;
  room.phase = 'lobby';
  room.currentTurn = null;
  room.roundGroup = null;
  room.reveals = { blueAll: false, redAll: false, perPlayer: {} };
  room.winnerIds = [];
  for (const p of Object.values(room.players)) {
    p.inRound = false;
    p.roundAction = null;
    p.cards = emptyCards();
  }
  addLog(room.code, 'إعادة تعيين الجولة', null, null, null, null);
  saveRoom(room);
}

function endRound(room) {
  room.roundActive = false;
  room.phase = 'lobby';
  room.currentTurn = null;
  addLog(room.code, 'إنهاء الجولة', null, null, null, null);
  saveRoom(room);
}

function resetGame(room) {
  room.phase = 'lobby';
  room.roundActive = false;
  room.roundGroup = null;
  room.roundNumber = 0;
  room.currentTurn = null;
  room.reveals = { blueAll: false, redAll: false, perPlayer: {} };
  room.winnerIds = [];
  for (const p of Object.values(room.players)) {
    if (p.status === 'eliminated') p.status = 'active';
    p.hearts = room.defaultHearts;
    p.cups = 0;
    p.inRound = false;
    p.roundAction = null;
    p.cards = emptyCards();
  }
  addLog(room.code, 'إعادة تعيين اللعبة', null, null, null, 'تصفير القلوب والكؤوس والجولات');
  saveRoom(room);
}

// ---------- الاختيارات ----------

function setTurn(room, playerId) {
  const p = room.players[playerId];
  if (!p || !p.inRound) return { error: 'اللاعب غير مشارك في الجولة' };
  room.currentTurn = playerId;
  saveRoom(room);
  return {};
}

function pickCard(room, player, row, index) {
  if (!room.roundActive || !player.inRound) return { error: 'لا توجد جولة نشطة' };
  if (room.currentTurn !== player.id) return { error: 'ليس دورك الآن' };
  index = parseInt(index, 10);
  if (isNaN(index) || index < 0 || index > 9) return { error: 'بطاقة غير صالحة' };

  const c = player.cards;
  if (room.phase === 'blue') {
    if (row !== 'blue' || c.bluePick != null) return { error: 'اختيار غير متاح' };
    c.bluePick = index;
    addLog(room.code, 'اختيار بطاقة زرقاء', player.name, null, String(c.blue[index]), null);
  } else if (room.phase === 'red') {
    if (row === 'redA') {
      if (c.redAPick != null) return { error: 'تم الاختيار مسبقاً' };
      c.redAPick = index;
      addLog(room.code, 'اختيار بطاقة حمراء A', player.name, null, String(c.redA[index]), null);
    } else if (row === 'redB') {
      if (c.redAPick == null) return { error: 'اختر بطاقة الصف A أولاً' };
      if (c.redBPick != null) return { error: 'تم الاختيار مسبقاً' };
      c.redBPick = index;
      addLog(room.code, 'اختيار بطاقة حمراء B', player.name, null, String(c.redB[index]), null);
    } else return { error: 'صف غير صالح' };
  } else return { error: 'المرحلة الحالية لا تسمح بالاختيار' };

  // عند اكتمال اختيار اللاعب الحالي يُلغى الدور تلقائياً
  const done =
    room.phase === 'blue' ? c.bluePick != null : c.redAPick != null && c.redBPick != null;
  if (done) room.currentTurn = null;
  saveRoom(room);
  return {};
}

function startRedPhase(room) {
  if (room.phase !== 'blue') return { error: 'المرحلة الزرقاء غير نشطة' };
  room.phase = 'red';
  room.currentTurn = null;
  addLog(room.code, 'بدء المرحلة الحمراء', null, null, null, null);
  saveRoom(room);
  return {};
}

function setRoundAction(room, player, action) {
  if (!room.roundActive || !player.inRound) return { error: 'لا توجد جولة نشطة' };
  if (room.phase === 'results') return { error: 'انتهت الجولة' };
  if (!['challenge', 'withdraw'].includes(action)) return { error: 'إجراء غير صالح' };
  const prev = player.roundAction;
  player.roundAction = action;
  addLog(room.code, action === 'challenge' ? 'تحدّي' : 'انسحاب', player.name, prev, action, null);
  saveRoom(room);
  return {};
}

// ---------- الكشف والنتائج ----------

function score(p) {
  const c = p.cards;
  const b = c.bluePick != null ? c.blue[c.bluePick] : 0;
  const a = c.redAPick != null ? c.redA[c.redAPick] : 0;
  const r = c.redBPick != null ? c.redB[c.redBPick] : 0;
  return b + a + r;
}

function revealBlueAll(room) {
  room.reveals.blueAll = true;
  addLog(room.code, 'كشف كل البطاقات الزرقاء', null, null, null, null);
  saveRoom(room);
}
function revealRedAll(room) {
  room.reveals.redAll = true;
  addLog(room.code, 'كشف كل البطاقات الحمراء', null, null, null, null);
  saveRoom(room);
}
function revealPlayer(room, playerId, which) {
  const p = room.players[playerId];
  if (!p) return { error: 'لاعب غير موجود' };
  const r = room.reveals.perPlayer[playerId] || { blue: false, redA: false, redB: false };
  if (which.blue) r.blue = true;
  if (which.redA) r.redA = true;
  if (which.redB) r.redB = true;
  room.reveals.perPlayer[playerId] = r;
  addLog(room.code, 'كشف بطاقات لاعب', p.name, null, null,
    [which.blue && 'زرقاء', which.redA && 'حمراء A', which.redB && 'حمراء B'].filter(Boolean).join('، '));
  saveRoom(room);
  return {};
}

function calculateWinner(room) {
  if (!room.roundActive) return { error: 'لا توجد جولة نشطة' };
  const challengers = Object.values(room.players).filter(
    (p) => p.inRound && p.status === 'active' && p.roundAction === 'challenge'
  );
  if (challengers.length === 0) return { error: 'لا يوجد متحدّون في هذه الجولة' };

  const scores = challengers.map((p) => ({ p, s: score(p) }));
  const max = Math.max(...scores.map((x) => x.s));
  const winners = scores.filter((x) => x.s === max).map((x) => x.p);
  const losers = scores.filter((x) => x.s < max).map((x) => x.p);

  room.winnerIds = winners.map((p) => p.id);
  for (const w of winners) {
    w.cups += 1;
    addLog(room.code, 'فوز بكأس 🏆', w.name, String(w.cups - 1), String(w.cups), `النقاط: ${max}`);
  }
  for (const l of losers) {
    const prev = l.hearts;
    l.hearts = Math.max(0, l.hearts - 1);
    addLog(room.code, 'خسارة قلب 💔', l.name, String(prev), String(l.hearts), `النقاط: ${score(l)}`);
    if (l.hearts === 0 && l.status === 'active') {
      l.status = 'eliminated';
      l.inRound = false;
      addLog(room.code, 'إقصاء لاعب', l.name, 'نشط', 'مُقصى', null);
    }
  }
  room.phase = 'results';
  room.roundActive = false;
  room.currentTurn = null;
  saveRoom(room);
  return {};
}

function revealAllAndWinner(room) {
  room.reveals.blueAll = true;
  room.reveals.redAll = true;
  return calculateWinner(room);
}

// ---------- إدارة اللاعبين (المقدم) ----------

function hostEditPlayer(room, playerId, patch) {
  const p = room.players[playerId];
  if (!p) return { error: 'لاعب غير موجود' };

  if (patch.name != null) {
    const prev = p.name;
    p.name = String(patch.name).trim().slice(0, 30) || p.name;
    addLog(room.code, 'تعديل الاسم', p.name, prev, p.name, null);
  }
  if (patch.group !== undefined) {
    const prev = p.group;
    p.group = patch.group || null;
    if (p.group && !room.groups.includes(p.group)) room.groups.push(p.group);
    addLog(room.code, 'نقل مجموعة', p.name, prev || '—', p.group || '—', null);
  }
  if (patch.cups != null) {
    const prev = p.cups;
    p.cups = Math.max(0, Math.min(999, parseInt(patch.cups, 10) || 0));
    addLog(room.code, 'تعديل الكؤوس', p.name, String(prev), String(p.cups), null);
  }
  saveRoom(room);
  return {};
}

function hostHearts(room, playerId, op, value) {
  const p = room.players[playerId];
  if (!p) return { error: 'لاعب غير موجود' };
  const prev = p.hearts;
  value = parseInt(value, 10) || 0;
  if (op === 'add') p.hearts = clampHearts(p.hearts + value);
  else if (op === 'remove') p.hearts = clampHearts(p.hearts - value);
  else if (op === 'set') p.hearts = clampHearts(value);
  else return { error: 'عملية غير صالحة' };

  let extra = null;
  if (p.hearts === 0 && p.status === 'active') {
    p.status = 'eliminated';
    p.inRound = false;
    extra = 'تم إقصاء اللاعب (0 قلوب)';
  } else if (p.hearts > 0 && p.status === 'eliminated') {
    p.status = 'active';
    extra = 'تمت استعادة اللاعب';
  }
  const labels = { add: `إضافة ${value} قلب`, remove: `خصم ${value} قلب`, set: `تحديد القلوب = ${p.hearts}` };
  addLog(room.code, labels[op], p.name, String(prev), String(p.hearts), extra);
  saveRoom(room);
  return {};
}

function hostHeartsAll(room, op, value) {
  value = parseInt(value, 10) || 0;
  for (const p of Object.values(room.players)) {
    if (p.status === 'removed' || p.status === 'pending') continue;
    hostHearts(room, p.id, op, value);
  }
  return {};
}

function setDefaultHearts(room, value) {
  const prev = room.defaultHearts;
  room.defaultHearts = clampHearts(value);
  addLog(room.code, 'تغيير القلوب الافتراضية', null, String(prev), String(room.defaultHearts), null);
  saveRoom(room);
  return {};
}

function removePlayer(room, playerId) {
  const p = room.players[playerId];
  if (!p) return { error: 'لاعب غير موجود' };
  p.status = 'removed';
  p.inRound = false;
  if (room.currentTurn === playerId) room.currentTurn = null;
  addLog(room.code, 'حذف لاعب', p.name, null, null, 'يمكن استعادته لاحقاً (بدون حظر)');
  saveRoom(room);
  return {};
}

function restorePlayer(room, playerId) {
  const p = room.players[playerId];
  if (!p) return { error: 'لاعب غير موجود' };
  p.status = p.hearts > 0 ? 'active' : 'eliminated';
  if (p.status === 'eliminated' && p.hearts === 0) {
    p.hearts = 1; // استعادة بحد أدنى قلب واحد
    p.status = 'active';
  }
  addLog(room.code, 'استعادة لاعب', p.name, null, null, null);
  saveRoom(room);
  return {};
}

function approvePlayer(room, playerId, approve) {
  const p = room.players[playerId];
  if (!p || p.status !== 'pending') return { error: 'لا يوجد طلب معلق لهذا اللاعب' };
  if (approve) {
    p.status = 'active';
    addLog(room.code, 'قبول لاعب', p.name, null, null, null);
  } else {
    p.status = 'removed';
    addLog(room.code, 'رفض لاعب', p.name, null, null, null);
  }
  saveRoom(room);
  return {};
}

function createGroup(room, name) {
  name = String(name || '').trim().slice(0, 30);
  if (!name) return { error: 'اسم المجموعة مطلوب' };
  if (!room.groups.includes(name)) room.groups.push(name);
  addLog(room.code, 'إنشاء مجموعة', null, null, name, null);
  saveRoom(room);
  return {};
}

function deleteGroup(room, name) {
  room.groups = room.groups.filter((g) => g !== name);
  for (const p of Object.values(room.players)) if (p.group === name) p.group = null;
  if (room.roundGroup === name) room.roundGroup = null;
  addLog(room.code, 'حذف مجموعة', null, name, null, null);
  saveRoom(room);
  return {};
}

// ---------- تصدير / استيراد ----------

function exportState(room) {
  return JSON.parse(JSON.stringify(room));
}

function importState(room, data) {
  try {
    if (!data || typeof data !== 'object' || !data.players) return { error: 'ملف غير صالح' };
    const keep = { code: room.code, hostToken: room.hostToken };
    Object.assign(room, data, keep);
    for (const p of Object.values(room.players)) p.connected = false;
    addLog(room.code, 'استيراد حالة اللعبة', null, null, null, null);
    saveRoom(room);
    return {};
  } catch {
    return { error: 'تعذّر قراءة الملف' };
  }
}

// ---------- العرض حسب الصلاحية (Serialization) ----------

function canSee(room, viewerId, ownerId, kind) {
  // kind: blue | redA | redB
  const r = room.reveals;
  const per = r.perPlayer[ownerId] || {};
  if (kind === 'blue') {
    if (viewerId !== ownerId) return true;            // البطاقة الزرقاء مرئية للجميع عدا صاحبها
    return r.blueAll || !!per.blue;                   // صاحبها يراها فقط بعد الكشف
  }
  // الحمراء: يراها صاحبها فقط، أو الجميع بعد الكشف
  if (viewerId === ownerId) return true;
  return r.redAll || !!per[kind];
}

function publicPlayer(room, p, viewerId) {
  const c = p.cards;
  const view = {
    id: p.id,
    name: p.name,
    group: p.group,
    hearts: p.hearts,
    cups: p.cups,
    status: p.status,
    connected: p.connected,
    inRound: p.inRound,
    roundAction: p.roundAction,
    isTurn: room.currentTurn === p.id,
    picked: {
      blue: c.bluePick != null,
      redA: c.redAPick != null,
      redB: c.redBPick != null,
    },
    values: {
      blue: c.bluePick != null && canSee(room, viewerId, p.id, 'blue') ? c.blue[c.bluePick] : null,
      redA: c.redAPick != null && canSee(room, viewerId, p.id, 'redA') ? c.redA[c.redAPick] : null,
      redB: c.redBPick != null && canSee(room, viewerId, p.id, 'redB') ? c.redB[c.redBPick] : null,
    },
    isWinner: room.winnerIds.includes(p.id),
  };
  return view;
}

function playerState(room, player) {
  const visible = Object.values(room.players).filter((p) => !['removed'].includes(p.status) && p.status !== 'pending');
  return {
    room: {
      code: room.code,
      phase: room.phase,
      roundActive: room.roundActive,
      roundNumber: room.roundNumber,
      roundGroup: room.roundGroup,
      winnerIds: room.winnerIds,
      reveals: room.reveals,
    },
    me: {
      ...publicPlayer(room, player, player.id),
      token: player.token,
      myTurn: room.currentTurn === player.id,
      // أوراق الاختيار تُرسَل فقط عندما يكون دوره (بدون قيم — الاختيار أعمى)
      needsPick:
        room.currentTurn === player.id
          ? room.phase === 'blue'
            ? player.cards.bluePick == null ? 'blue' : null
            : room.phase === 'red'
              ? player.cards.redAPick == null ? 'redA' : player.cards.redBPick == null ? 'redB' : null
              : null
          : null,
    },
    players: visible.map((p) => publicPlayer(room, p, player.id)),
  };
}

function hostState(room) {
  const players = Object.values(room.players);
  const totals = {};
  for (const p of players) totals[p.id] = score(p);
  return {
    room: {
      code: room.code,
      phase: room.phase,
      roundActive: room.roundActive,
      roundNumber: room.roundNumber,
      roundGroup: room.roundGroup,
      currentTurn: room.currentTurn,
      defaultHearts: room.defaultHearts,
      groups: room.groups,
      reveals: room.reveals,
      winnerIds: room.winnerIds,
    },
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      group: p.group,
      hearts: p.hearts,
      cups: p.cups,
      status: p.status,
      connected: p.connected,
      inRound: p.inRound,
      roundAction: p.roundAction,
      picked: {
        blue: p.cards.bluePick != null,
        redA: p.cards.redAPick != null,
        redB: p.cards.redBPick != null,
      },
      values: {
        blue: p.cards.bluePick != null ? p.cards.blue[p.cards.bluePick] : null,
        redA: p.cards.redAPick != null ? p.cards.redA[p.cards.redAPick] : null,
        redB: p.cards.redBPick != null ? p.cards.redB[p.cards.redBPick] : null,
      },
      total: totals[p.id],
      isWinner: room.winnerIds.includes(p.id),
    })),
    stats: {
      total: players.filter((p) => p.status !== 'removed').length,
      active: players.filter((p) => p.status === 'active').length,
      eliminated: players.filter((p) => p.status === 'eliminated').length,
      pending: players.filter((p) => p.status === 'pending').length,
      cups: players.reduce((s, p) => s + p.cups, 0),
      hearts: players.filter((p) => p.status !== 'removed').reduce((s, p) => s + p.hearts, 0),
    },
  };
}

module.exports = {
  rooms, bootFromDb, createRoom, getRoom, addPlayer, findByToken,
  startRound, resetRound, endRound, resetGame,
  setTurn, pickCard, startRedPhase, setRoundAction,
  revealBlueAll, revealRedAll, revealPlayer, calculateWinner, revealAllAndWinner,
  hostEditPlayer, hostHearts, hostHeartsAll, setDefaultHearts,
  removePlayer, restorePlayer, approvePlayer, createGroup, deleteGroup,
  exportState, importState, playerState, hostState, score,
};

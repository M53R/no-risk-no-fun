// lib/game.js — منطق اللعبة الكامل (نسخة الجولات العشر والبطاقة المعروضة)
const crypto = require('crypto');
const { saveRoom, loadAllRooms, addLog } = require('./db');

const MAX_ROUNDS = 10;

// كل الغرف محمّلة في الذاكرة، وتُحفَظ في SQLite عند كل تعديل
const rooms = new Map();

function bootFromDb() {
  for (const room of loadAllRooms()) {
    // ترقية الغرف القديمة + اعتبار الجميع غير متصل حتى يعيد الاتصال
    if (room.showRedsToPlayers === undefined) room.showRedsToPlayers = true;
    if (room.lastActionPlayerId === undefined) room.lastActionPlayerId = null;
    for (const p of Object.values(room.players)) {
      p.connected = false;
      if (!p.decks) p.decks = freshDecks();
      if (!p.cards || p.cards.blueValue === undefined) p.cards = emptyPicks();
    }
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

// كل لاعب يملك 3 مجموعات تُستهلك على مدى 10 جولات (لا تتكرر البطاقة)
const freshDecks = () => ({ blue: shuffledDeck(), redA: shuffledDeck(), redB: shuffledDeck() });

// اختيارات الجولة الحالية
const emptyPicks = () => ({ blueValue: null, redAValue: null, redBValue: null, shownRed: null });

function createRoom(defaultHearts = 3) {
  const room = {
    code: genRoomCode(),
    hostToken: token(),
    createdAt: new Date().toISOString(),
    defaultHearts: clampHearts(defaultHearts),
    phase: 'lobby', // lobby | blue | red | results
    roundActive: false,
    roundGroup: null,
    roundNumber: 0,            // من أصل MAX_ROUNDS
    currentTurn: null,
    groups: [],
    showRedsToPlayers: true,   // خيار المقدم: هل تظهر الحمراء بشاشات اللاعبين؟
    lastActionPlayerId: null,  // آخر لاعب أكّد قراره (لاختصار F9)
    reveals: { blueAll: false, redAll: false, perPlayer: {} },
    winnerIds: [],
    players: {},
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
    status: pending ? 'pending' : 'active',
    connected: true,
    inRound: false,
    roundAction: null, // challenge | withdraw | null
    decks: freshDecks(),
    cards: emptyPicks(),
  };
  room.players[player.id] = player;
  addLog(room.code, pending ? 'طلب انضمام' : 'انضمام لاعب', player.name, null, null, null);
  saveRoom(room);
  return player;
}

function findByToken(room, t) {
  return Object.values(room.players).find((p) => p.token === t) || null;
}

// ---------- إدارة الجولة ----------

function startRound(room, groupName = null) {
  if (room.roundActive) return { error: 'توجد جولة نشطة بالفعل' };

  const eligible = Object.values(room.players).filter(
    (p) => p.status === 'active' && (!groupName || p.group === groupName)
  );
  if (eligible.length === 0) return { error: 'لا يوجد لاعبون نشطون' + (groupName ? ' في هذه المجموعة' : '') };

  const withCards = eligible.filter((p) => p.decks.blue.length > 0 && p.decks.redA.length > 0 && p.decks.redB.length > 0);
  if (withCards.length === 0) {
    return { error: `انتهت البطاقات (اكتملت ${MAX_ROUNDS} جولات) — أعد البطاقات 🃏 أو أعد اللعبة كاملة` };
  }

  room.roundNumber += 1;
  room.roundActive = true;
  room.roundGroup = groupName || null;
  room.phase = 'blue';
  room.currentTurn = null;
  room.reveals = { blueAll: false, redAll: false, perPlayer: {} };
  room.winnerIds = [];
  for (const p of Object.values(room.players)) {
    p.inRound = withCards.includes(p);
    p.roundAction = null;
    p.cards = emptyPicks();
  }
  addLog(room.code, 'بدء جولة', null, null, `${room.roundNumber}/${MAX_ROUNDS}`, groupName ? `مجموعة: ${groupName}` : 'كل اللاعبين');
  saveRoom(room);
  return {};
}

// إعادة البطاقات المختارة في الجولة الحالية إلى مجموعات أصحابها
function returnPicksToDecks(room) {
  for (const p of Object.values(room.players)) {
    const c = p.cards;
    if (c.blueValue != null) p.decks.blue.push(c.blueValue);
    if (c.redAValue != null) p.decks.redA.push(c.redAValue);
    if (c.redBValue != null) p.decks.redB.push(c.redBValue);
    p.cards = emptyPicks();
    p.roundAction = null;
    p.inRound = false;
  }
}

function resetRound(room) {
  // إذا كانت الجولة جارية: تُعاد البطاقات لأصحابها ولا تُحتسب الجولة
  if (room.roundActive) {
    returnPicksToDecks(room);
    room.roundNumber = Math.max(0, room.roundNumber - 1);
    addLog(room.code, 'إعادة تعيين الجولة', null, null, null, 'أُعيدت البطاقات المختارة لأصحابها');
  } else {
    for (const p of Object.values(room.players)) {
      p.cards = emptyPicks();
      p.roundAction = null;
      p.inRound = false;
    }
    addLog(room.code, 'إعادة تعيين الجولة', null, null, null, null);
  }
  room.roundActive = false;
  room.phase = 'lobby';
  room.currentTurn = null;
  room.roundGroup = null;
  room.reveals = { blueAll: false, redAll: false, perPlayer: {} };
  room.winnerIds = [];
  saveRoom(room);
  return {};
}

function endRound(room) {
  room.roundActive = false;
  room.phase = 'lobby';
  room.currentTurn = null;
  addLog(room.code, 'إنهاء الجولة', null, null, null, 'البطاقات المختارة تُعتبر مستهلكة');
  saveRoom(room);
  return {};
}

// إعادة البطاقات فقط: مجموعات جديدة 10/10/10 لكل لاعب — القلوب والكؤوس تبقى
function resetDecks(room) {
  room.roundNumber = 0;
  room.roundActive = false;
  room.phase = 'lobby';
  room.currentTurn = null;
  room.roundGroup = null;
  room.reveals = { blueAll: false, redAll: false, perPlayer: {} };
  room.winnerIds = [];
  for (const p of Object.values(room.players)) {
    p.decks = freshDecks();
    p.cards = emptyPicks();
    p.roundAction = null;
    p.inRound = false;
  }
  addLog(room.code, 'إعادة البطاقات 🃏', null, null, null, 'مجموعات جديدة للجميع — القلوب والكؤوس كما هي');
  saveRoom(room);
  return {};
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
    p.decks = freshDecks();
    p.cards = emptyPicks();
  }
  addLog(room.code, 'إعادة تعيين اللعبة', null, null, null, 'تصفير القلوب والكؤوس والجولات والبطاقات');
  saveRoom(room);
  return {};
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

  const c = player.cards;
  const d = player.decks;

  const take = (deck) => {
    if (isNaN(index) || index < 0 || index >= deck.length) return null;
    return deck.splice(index, 1)[0]; // تُسحب نهائياً — لن تتكرر في الجولات القادمة
  };

  if (room.phase === 'blue') {
    if (row !== 'blue' || c.blueValue != null) return { error: 'اختيار غير متاح' };
    const v = take(d.blue);
    if (v == null) return { error: 'بطاقة غير صالحة' };
    c.blueValue = v;
    addLog(room.code, 'اختيار بطاقة زرقاء', player.name, null, String(v), `متبقي ${d.blue.length}`);
  } else if (room.phase === 'red') {
    if (row === 'redA') {
      if (c.redAValue != null) return { error: 'تم الاختيار مسبقاً' };
      const v = take(d.redA);
      if (v == null) return { error: 'بطاقة غير صالحة' };
      c.redAValue = v;
      addLog(room.code, 'اختيار بطاقة حمراء A', player.name, null, String(v), `متبقي ${d.redA.length}`);
    } else if (row === 'redB') {
      if (c.redAValue == null) return { error: 'اختر بطاقة الصف A أولاً' };
      if (c.redBValue != null) return { error: 'تم الاختيار مسبقاً' };
      const v = take(d.redB);
      if (v == null) return { error: 'بطاقة غير صالحة' };
      c.redBValue = v;
      addLog(room.code, 'اختيار بطاقة حمراء B', player.name, null, String(v), `متبقي ${d.redB.length}`);
    } else return { error: 'صف غير صالح' };
  } else return { error: 'المرحلة الحالية لا تسمح بالاختيار' };

  // عند اكتمال اختيار اللاعب الحالي يُلغى الدور تلقائياً
  const done = room.phase === 'blue' ? c.blueValue != null : c.redAValue != null && c.redBValue != null;
  if (done) room.currentTurn = null;
  saveRoom(room);
  return {};
}

// اللاعب يختار أيّ بطاقة حمراء يعرضها للمنافسين (والأخرى تبقى سرّه)
function setShownRed(room, player, which) {
  if (!room.roundActive || !player.inRound) return { error: 'لا توجد جولة نشطة' };
  if (room.phase === 'results') return { error: 'انتهت الجولة' };
  if (!['redA', 'redB'].includes(which)) return { error: 'اختيار غير صالح' };
  const c = player.cards;
  if (c.redAValue == null || c.redBValue == null) return { error: 'اختر بطاقتيك الحمراوين أولاً' };
  if (c.shownRed != null) return { error: 'لا يمكن تغيير البطاقة المعروضة بعد اختيارها' };
  c.shownRed = which;
  addLog(room.code, 'عرض بطاقة حمراء 👁', player.name, null, which === 'redA' ? 'A' : 'B', null);
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
  if (player.roundAction != null) return { error: 'لا يمكن تغيير قرارك بعد التأكيد — اطلب من المقدم إلغاءه' };
  player.roundAction = action;
  room.lastActionPlayerId = player.id;
  addLog(room.code, action === 'challenge' ? 'تحدّي' : 'انسحاب', player.name, null, action, 'قرار مؤكد — يُلغى من المقدم فقط');
  saveRoom(room);
  return {};
}

// المقدم يلغي قرار لاعب — بدون معرف: يُلغى آخر قرار مؤكد (اختصار F9)
function cancelRoundAction(room, playerId) {
  const id = playerId || room.lastActionPlayerId;
  const p = id && room.players[id];
  if (!p) return { error: 'لا يوجد قرار لإلغائه' };
  if (p.roundAction == null) return { error: `لا يوجد قرار مؤكد لـ ${p.name}` };
  const prev = p.roundAction;
  p.roundAction = null;
  if (room.lastActionPlayerId === id) room.lastActionPlayerId = null;
  addLog(room.code, 'إلغاء قرار (من المقدم)', p.name, prev, null, null);
  saveRoom(room);
  return {};
}

// خيار المقدم (فوق اليمين): إظهار/إخفاء الحمراء المعروضة بشاشات اللاعبين
function setShowReds(room, on) {
  room.showRedsToPlayers = !!on;
  addLog(room.code, 'خيار الحمراء المعروضة', null, null, on ? 'ظاهرة للاعبين' : 'مخفية عن اللاعبين', null);
  saveRoom(room);
  return {};
}

// ---------- الكشف والنتائج ----------

function score(p) {
  const c = p.cards;
  return (c.blueValue || 0) + (c.redAValue || 0) + (c.redBValue || 0);
}

function revealBlueAll(room) {
  room.reveals.blueAll = true;
  addLog(room.code, 'كشف كل البطاقات الزرقاء', null, null, null, null);
  saveRoom(room);
  return {};
}
function revealRedAll(room) {
  room.reveals.redAll = true;
  addLog(room.code, 'كشف كل البطاقات الحمراء', null, null, null, null);
  saveRoom(room);
  return {};
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

  // إعلان الجولة = مرحلة النتائج: تنكشف كل البطاقات والمجاميع تلقائياً
  room.phase = 'results';
  room.roundActive = false;
  room.currentTurn = null;
  saveRoom(room);
  return {};
}

function revealAllAndWinner(room) {
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
    p.hearts = 1;
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
    if (room.showRedsToPlayers === undefined) room.showRedsToPlayers = true;
    if (room.lastActionPlayerId === undefined) room.lastActionPlayerId = null;
    for (const p of Object.values(room.players)) {
      p.connected = false;
      if (!p.decks) p.decks = freshDecks();
      if (!p.cards || p.cards.blueValue === undefined) p.cards = emptyPicks();
    }
    addLog(room.code, 'استيراد حالة اللعبة', null, null, null, null);
    saveRoom(room);
    return {};
  } catch {
    return { error: 'تعذّر قراءة الملف' };
  }
}

// ---------- الرؤية (من يرى ماذا؟) ----------
// زرقاء: يراها كل اللاعبين عدا صاحبها — وصاحبها وشاشة المقدم بعد الكشف فقط
// حمراء: يراها صاحبها — والمنافسون يرون "المعروضة" فقط (إذا فعّل المقدم الخيار) — والكل بعد الكشف

// زرقاء: صاحبها لا يراها أبداً على جهازه — البقية يرونها بعد "كشف البطاقة الزرقاء" (F8) أو عند إعلان الجولة
// حمراء: صاحبها يراها دائماً — البقية يرون "المعروضة" فقط، وخيار 👁 يحجب كل الحمراء عن اللاعبين
// شاشة المقدم (للعرض): لا تكشف الزرقاء ولا الحمراء المخفية ولا المجاميع إلا بعد إعلان الجولة
function playerCanSee(room, viewerId, owner, kind) {
  const r = room.reveals;
  const per = r.perPlayer[owner.id] || {};
  const results = room.phase === 'results';
  if (kind === 'blue') {
    if (viewerId === owner.id) return false;                    // صاحبها لا يراها أبداً
    return r.blueAll || results || !!per.blue;
  }
  if (viewerId === owner.id) return true;
  if (!room.showRedsToPlayers) return false;                    // الخيار يحجب كل الحمراء عن اللاعبين
  if (r.redAll || results || per[kind]) return true;
  return owner.cards.shownRed === kind;
}

function hostCanSee(room, owner, kind) {
  const per = room.reveals.perPlayer[owner.id] || {};
  const results = room.phase === 'results';
  if (kind === 'blue') return results || !!per.blue;
  if (results || per[kind]) return true;
  return owner.cards.shownRed === kind;
}

function publicPlayer(room, p, viewerId) {
  const c = p.cards;
  return {
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
    shownRed: c.shownRed,
    picked: {
      blue: c.blueValue != null,
      redA: c.redAValue != null,
      redB: c.redBValue != null,
    },
    values: {
      blue: c.blueValue != null && playerCanSee(room, viewerId, p, 'blue') ? c.blueValue : null,
      redA: c.redAValue != null && playerCanSee(room, viewerId, p, 'redA') ? c.redAValue : null,
      redB: c.redBValue != null && playerCanSee(room, viewerId, p, 'redB') ? c.redBValue : null,
    },
    isWinner: room.winnerIds.includes(p.id),
  };
}

function playerState(room, player) {
  const visible = Object.values(room.players).filter((p) => p.status !== 'removed' && p.status !== 'pending');
  const c = player.cards;
  const needsPick =
    room.currentTurn === player.id
      ? room.phase === 'blue'
        ? c.blueValue == null ? 'blue' : null
        : room.phase === 'red'
          ? c.redAValue == null ? 'redA' : c.redBValue == null ? 'redB' : null
          : null
      : null;
  const needsShow =
    room.roundActive && player.inRound && room.phase === 'red' &&
    c.redAValue != null && c.redBValue != null && c.shownRed == null;

  return {
    room: {
      code: room.code,
      phase: room.phase,
      roundActive: room.roundActive,
      roundNumber: room.roundNumber,
      maxRounds: MAX_ROUNDS,
      roundGroup: room.roundGroup,
      winnerIds: room.winnerIds,
      showRedsToPlayers: room.showRedsToPlayers,
    },
    me: {
      ...publicPlayer(room, player, player.id),
      token: player.token,
      myTurn: room.currentTurn === player.id,
      needsPick,
      needsShow,
      deckCounts: {
        blue: player.decks.blue.length,
        redA: player.decks.redA.length,
        redB: player.decks.redB.length,
      },
    },
    players: visible.map((p) => publicPlayer(room, p, player.id)),
  };
}

function hostState(room) {
  const players = Object.values(room.players);
  return {
    room: {
      code: room.code,
      phase: room.phase,
      roundActive: room.roundActive,
      roundNumber: room.roundNumber,
      maxRounds: MAX_ROUNDS,
      roundGroup: room.roundGroup,
      currentTurn: room.currentTurn,
      defaultHearts: room.defaultHearts,
      groups: room.groups,
      reveals: room.reveals,
      winnerIds: room.winnerIds,
      showRedsToPlayers: room.showRedsToPlayers,
    },
    players: players.map((p) => {
      const c = p.cards;
      const vBlue = c.blueValue != null && hostCanSee(room, p, 'blue') ? c.blueValue : null;
      const vRedA = c.redAValue != null && hostCanSee(room, p, 'redA') ? c.redAValue : null;
      const vRedB = c.redBValue != null && hostCanSee(room, p, 'redB') ? c.redBValue : null;
      const allVisible = vBlue != null && vRedA != null && vRedB != null;
      return {
        id: p.id,
        name: p.name,
        group: p.group,
        hearts: p.hearts,
        cups: p.cups,
        status: p.status,
        connected: p.connected,
        inRound: p.inRound,
        roundAction: p.roundAction,
        shownRed: c.shownRed,
        picked: {
          blue: c.blueValue != null,
          redA: c.redAValue != null,
          redB: c.redBValue != null,
        },
        values: { blue: vBlue, redA: vRedA, redB: vRedB },
        shownRedValue: c.shownRed ? (c.shownRed === 'redA' ? vRedA : vRedB) : null,
        total: allVisible ? score(p) : null, // المجموع يظهر فقط بعد كشف كل شيء (شاشة عرض)
        deckCounts: {
          blue: p.decks.blue.length,
          redA: p.decks.redA.length,
          redB: p.decks.redB.length,
        },
        isWinner: room.winnerIds.includes(p.id),
      };
    }),
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
  startRound, resetRound, endRound, resetDecks, resetGame,
  setTurn, pickCard, setShownRed, startRedPhase, setRoundAction, cancelRoundAction, setShowReds,
  revealBlueAll, revealRedAll, revealPlayer, calculateWinner, revealAllAndWinner,
  hostEditPlayer, hostHearts, hostHeartsAll, setDefaultHearts,
  removePlayer, restorePlayer, approvePlayer, createGroup, deleteGroup,
  exportState, importState, playerState, hostState, score, MAX_ROUNDS,
};

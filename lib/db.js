// lib/db.js — طبقة قاعدة البيانات (SQLite المدمج في Node.js — بدون أي حزم native)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'game.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  state TEXT NOT NULL,            -- حالة الغرفة كاملة بصيغة JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  time TEXT NOT NULL,             -- ISO timestamp
  action TEXT NOT NULL,           -- نوع الإجراء
  player_name TEXT,               -- اللاعب المتأثر
  prev_value TEXT,                -- القيمة السابقة
  new_value TEXT,                 -- القيمة الجديدة
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_room ON logs(room_code, id);
`);

const stmts = {
  saveRoom: db.prepare(`INSERT INTO rooms (code, state, updated_at) VALUES (?, ?, ?)
                        ON CONFLICT(code) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`),
  getRoom: db.prepare(`SELECT state FROM rooms WHERE code = ?`),
  getAllRooms: db.prepare(`SELECT code, state FROM rooms`),
  deleteRoom: db.prepare(`DELETE FROM rooms WHERE code = ?`),
  addLog: db.prepare(`INSERT INTO logs (room_code, time, action, player_name, prev_value, new_value, details)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getLogs: db.prepare(`SELECT * FROM logs WHERE room_code = ? ORDER BY id DESC LIMIT 200`),
  clearLogs: db.prepare(`DELETE FROM logs WHERE room_code = ?`),
};

function saveRoom(room) {
  stmts.saveRoom.run(room.code, JSON.stringify(room), new Date().toISOString());
}

function loadRoom(code) {
  const row = stmts.getRoom.get(code);
  return row ? JSON.parse(row.state) : null;
}

function loadAllRooms() {
  return stmts.getAllRooms.all().map((r) => JSON.parse(r.state));
}

function deleteRoom(code) {
  stmts.deleteRoom.run(code);
  stmts.clearLogs.run(code);
}

function addLog(roomCode, action, playerName, prevValue, newValue, details) {
  stmts.addLog.run(
    roomCode,
    new Date().toISOString(),
    action,
    playerName ?? null,
    prevValue != null ? String(prevValue) : null,
    newValue != null ? String(newValue) : null,
    details ?? null
  );
}

function getLogs(roomCode) {
  return stmts.getLogs.all(roomCode);
}

function clearLogs(roomCode) {
  stmts.clearLogs.run(roomCode);
}

module.exports = { db, saveRoom, loadRoom, loadAllRooms, deleteRoom, addLog, getLogs, clearLogs };

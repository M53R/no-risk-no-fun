// server.js — خادم مخصص: Next.js + Express + Socket.IO
const express = require('express');
const http = require('http');
const next = require('next');
const { Server } = require('socket.io');
const G = require('./lib/game');
const { getLogs } = require('./lib/db');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();
  const httpServer = http.createServer(server);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  const restored = G.bootFromDb();
  console.log(`✅ تم استرجاع ${restored} غرفة من قاعدة البيانات`);

  // ---------- البث ----------
  function broadcast(room) {
    // للمقدم: الحالة الكاملة
    io.to(`host:${room.code}`).emit('host_state', G.hostState(room));
    // لكل لاعب حالته الخاصة (الرؤية تختلف من لاعب لآخر)
    for (const p of Object.values(room.players)) {
      if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit('player_state', G.playerState(room, p));
      }
    }
  }

  function sendLogs(room) {
    io.to(`host:${room.code}`).emit('logs', getLogs(room.code));
  }

  io.on('connection', (socket) => {
    let ctx = { roomCode: null, role: null, playerId: null };

    const room = () => G.getRoom(ctx.roomCode);
    const ok = (cb, extra) => typeof cb === 'function' && cb({ ok: true, ...extra });
    const fail = (cb, error) => typeof cb === 'function' && cb({ ok: false, error });

    // ---------- المقدم ----------
    socket.on('host_create_room', ({ defaultHearts } = {}, cb) => {
      const r = G.createRoom(defaultHearts ?? 3);
      ctx = { roomCode: r.code, role: 'host', playerId: null };
      socket.join(`host:${r.code}`);
      ok(cb, { code: r.code, hostToken: r.hostToken });
      broadcast(r); sendLogs(r);
    });

    socket.on('host_rejoin', ({ code, hostToken } = {}, cb) => {
      const r = G.getRoom(code);
      if (!r || r.hostToken !== hostToken) return fail(cb, 'الغرفة غير موجودة أو الرمز غير صحيح');
      ctx = { roomCode: r.code, role: 'host', playerId: null };
      socket.join(`host:${r.code}`);
      ok(cb, { code: r.code });
      broadcast(r); sendLogs(r);
    });

    // أي إجراء من المقدم يتطلب أن يكون قد انضم كمقدم
    function hostAction(handler) {
      return (payload, cb) => {
        const r = room();
        if (!r || ctx.role !== 'host') return fail(cb, 'غير مصرح');
        const res = handler(r, payload || {}) || {};
        if (res.error) return fail(cb, res.error);
        ok(cb, res.data ? { data: res.data } : undefined);
        broadcast(r); sendLogs(r);
      };
    }

    socket.on('host_start_round', hostAction((r, { group }) => G.startRound(r, group || null)));
    socket.on('host_end_round', hostAction((r) => { G.endRound(r); }));
    socket.on('host_reset_round', hostAction((r) => { G.resetRound(r); }));
    socket.on('host_reset_game', hostAction((r) => { G.resetGame(r); }));
    socket.on('host_reset_decks', hostAction((r) => G.resetDecks(r)));
    socket.on('host_toggle_show_reds', hostAction((r, { on }) => G.setShowReds(r, on)));
    socket.on('host_set_name', hostAction((r, { name }) => G.setHostName(r, name)));
    socket.on('host_set_turn', hostAction((r, { playerId }) => G.setTurn(r, playerId)));
    socket.on('host_clear_turn', hostAction((r) => { r.currentTurn = null; }));
    socket.on('host_start_red_phase', hostAction((r) => G.startRedPhase(r)));
    socket.on('host_reveal_blue_all', hostAction((r) => G.revealBlueAll(r)));
    socket.on('host_reveal_red_all', hostAction((r) => G.revealRedAll(r)));
    socket.on('host_reveal_player', hostAction((r, { playerId, which }) => G.revealPlayer(r, playerId, which || {})));
    socket.on('host_calc_winner', hostAction((r) => G.calculateWinner(r)));
    socket.on('host_cancel_action', hostAction((r, { playerId }) => G.cancelRoundAction(r, playerId || null)));
    socket.on('host_edit_player', hostAction((r, { playerId, patch }) => G.hostEditPlayer(r, playerId, patch || {})));
    socket.on('host_hearts', hostAction((r, { playerId, op, value }) => G.hostHearts(r, playerId, op, value)));
    socket.on('host_hearts_all', hostAction((r, { op, value }) => G.hostHeartsAll(r, op, value)));
    socket.on('host_set_default_hearts', hostAction((r, { value }) => G.setDefaultHearts(r, value)));
    socket.on('host_remove_player', hostAction((r, { playerId }) => G.removePlayer(r, playerId)));
    socket.on('host_restore_player', hostAction((r, { playerId }) => G.restorePlayer(r, playerId)));
    socket.on('host_approve_player', hostAction((r, { playerId, approve }) => G.approvePlayer(r, playerId, approve)));
    socket.on('host_create_group', hostAction((r, { name }) => G.createGroup(r, name)));
    socket.on('host_delete_group', hostAction((r, { name }) => G.deleteGroup(r, name)));
    socket.on('host_export', hostAction((r) => ({ data: G.exportState(r) })));
    socket.on('host_import', hostAction((r, { state }) => G.importState(r, state)));
    socket.on('host_get_logs', (payload, cb) => {
      const r = room();
      if (!r || ctx.role !== 'host') return fail(cb, 'غير مصرح');
      ok(cb, { data: getLogs(r.code) });
    });

    // ---------- اللاعب ----------
    socket.on('player_join', ({ code, name } = {}, cb) => {
      const r = G.getRoom(code);
      if (!r) return fail(cb, 'رمز الغرفة غير صحيح');
      const p = G.addPlayer(r, name, { pending: true });
      p.socketId = socket.id;
      p.connected = true;
      ctx = { roomCode: r.code, role: 'player', playerId: p.id };
      socket.join(`room:${r.code}`);
      io.to(`host:${r.code}`).emit('new_player_request', { id: p.id, name: p.name });
      ok(cb, { token: p.token, playerId: p.id, code: r.code });
      broadcast(r); sendLogs(r);
    });

    socket.on('player_rejoin', ({ code, token } = {}, cb) => {
      const r = G.getRoom(code);
      if (!r) return fail(cb, 'الغرفة غير موجودة');
      const p = G.findByToken(r, token);
      if (!p) return fail(cb, 'جلسة غير صالحة');
      if (p.status === 'removed') return fail(cb, 'تمت إزالتك من اللعبة');
      p.socketId = socket.id;
      p.connected = true;
      ctx = { roomCode: r.code, role: 'player', playerId: p.id };
      socket.join(`room:${r.code}`);
      ok(cb, { playerId: p.id, code: r.code, name: p.name });
      broadcast(r);
    });

    function playerAction(handler) {
      return (payload, cb) => {
        const r = room();
        const p = r && r.players[ctx.playerId];
        if (!r || !p) return fail(cb, 'غير متصل بغرفة');
        if (p.status === 'removed') return fail(cb, 'تمت إزالتك من اللعبة');
        const res = handler(r, p, payload || {}) || {};
        if (res.error) return fail(cb, res.error);
        ok(cb);
        broadcast(r); sendLogs(r);
      };
    }

    socket.on('player_pick', playerAction((r, p, { row, index }) => G.pickCard(r, p, row, index)));
    socket.on('player_round_action', playerAction((r, p, { action }) => G.setRoundAction(r, p, action)));
    socket.on('player_show_red', playerAction((r, p, { which }) => G.setShownRed(r, p, which)));

    socket.on('disconnect', () => {
      const r = room();
      if (r && ctx.role === 'player') {
        const p = r.players[ctx.playerId];
        if (p && p.socketId === socket.id) {
          p.connected = false;
          p.socketId = null;
          broadcast(r);
        }
      }
    });
  });

  // كل المسارات الأخرى إلى Next.js
  server.all(/.*/, (req, res) => handle(req, res));

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`🎮 No Risk No Fun يعمل على http://localhost:${port}`);
    console.log(`   واجهة اللاعبين:  http://localhost:${port}/`);
    console.log(`   لوحة المقدم:     http://localhost:${port}/host`);
  });
});

// pages/host.js — لوحة تحكم المقدم
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const LS_KEY = 'nrnf_host_session';

export default function HostPage() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState('loading'); // loading | landing | dashboard
  const [state, setState] = useState(null);
  const [logs, setLogs] = useState([]);
  const [defaultHearts, setDefaultHearts] = useState(3);
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null); // {type, player?}
  const fileRef = useRef(null);

  const toast = useCallback((msg, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const emit = useCallback((event, payload = {}, cb) => {
    socketRef.current?.emit(event, payload, (res) => {
      if (!res?.ok) toast(res?.error || 'حدث خطأ', true);
      cb?.(res);
    });
  }, [toast]);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      const saved = readSession();
      if (saved) {
        s.emit('host_rejoin', saved, (res) => {
          if (res?.ok) setScreen('dashboard');
          else { clearSession(); setScreen('landing'); }
        });
      } else setScreen('landing');
    });
    s.on('disconnect', () => setConnected(false));
    s.on('host_state', (st) => { setState(st); setScreen('dashboard'); });
    s.on('logs', setLogs);
    s.on('new_player_request', ({ name }) => toast(`🔔 لاعب جديد انضم: ${name} — بانتظار موافقتك`));

    return () => s.disconnect();
  }, [toast]);

  function readSession() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
  }
  function clearSession() { localStorage.removeItem(LS_KEY); }

  function createRoom() {
    emit('host_create_room', { defaultHearts }, (res) => {
      if (res?.ok) {
        localStorage.setItem(LS_KEY, JSON.stringify({ code: res.code, hostToken: res.hostToken }));
        toast(`تم إنشاء الغرفة ${res.code} 🎉`);
      }
    });
  }

  function exportState() {
    emit('host_export', {}, (res) => {
      if (!res?.ok) return;
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nrnf-room-${state?.room.code || 'export'}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('تم تصدير حالة اللعبة 📦');
    });
  }

  function importState(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        emit('host_import', { state: data }, (res) => res?.ok && toast('تم استيراد الحالة بنجاح ✅'));
      } catch { toast('ملف غير صالح', true); }
    };
    reader.readAsText(file);
  }

  // ============================================================
  return (
    <div className="page">
      {!connected && screen !== 'loading' && (
        <div className="conn-banner">⚠️ انقطع الاتصال... جاري إعادة المحاولة</div>
      )}

      {screen === 'loading' && (
        <div className="waiting"><div className="spinner" /><div className="muted">جاري التحميل...</div></div>
      )}

      {screen === 'landing' && (
        <div className="page--narrow" style={{ margin: '0 auto' }}>
          <div className="hero">
            <div className="hero__logo"><span className="l1">No Risk</span> <span className="l2">No Fun</span></div>
            <div className="hero__tag">لوحة تحكم المقدم 🎛️</div>
          </div>
          <div className="panel">
            <div className="panel__title">إنشاء غرفة جديدة</div>
            <div className="field">
              <label>القلوب الافتراضية لكل لاعب (1 - 99)</label>
              <input className="input" type="number" min={1} max={99} value={defaultHearts}
                onChange={(e) => setDefaultHearts(e.target.value)} />
            </div>
            <button className="btn btn--gold btn--block" onClick={createRoom}>إنشاء الغرفة 🚀</button>
          </div>
        </div>
      )}

      {screen === 'dashboard' && state && (
        <Dashboard
          state={state} logs={logs} emit={emit} toast={toast}
          setModal={setModal} exportState={exportState}
          onImportClick={() => fileRef.current?.click()}
          endSession={() => { clearSession(); setState(null); setScreen('landing'); }}
        />
      )}

      <input ref={fileRef} type="file" accept="application/json" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importState(f); e.target.value = ''; }} />

      {modal && <Modal modal={modal} close={() => setModal(null)} emit={emit} state={state} />}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'toast--err' : ''}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
function Dashboard({ state, logs, emit, toast, setModal, exportState, onImportClick, endSession }) {
  const { room, players, stats } = state;
  const [groupForRound, setGroupForRound] = useState('');
  const pending = players.filter((p) => p.status === 'pending');
  const inRound = players.filter((p) => p.inRound);
  const visible = players.filter((p) => p.status !== 'removed' && p.status !== 'pending');
  const removed = players.filter((p) => p.status === 'removed');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const copy = (text, label) => {
    navigator.clipboard?.writeText(text).then(() => toast(`تم نسخ ${label} 📋`));
  };

  const allBluePicked = inRound.length > 0 && inRound.every((p) => p.picked.blue);
  const allRedPicked = inRound.length > 0 && inRound.every((p) => p.picked.redA && p.picked.redB);

  const phaseLabel = {
    lobby: ['الاستراحة — لا توجد جولة', 'phase-lobby'],
    blue: ['المرحلة الزرقاء 🔵', 'phase-blue'],
    red: ['المرحلة الحمراء 🔴', 'phase-red'],
    results: ['النتائج 🏆', 'phase-results'],
  }[room.phase];

  return (
    <div>
      {/* الشريط العلوي */}
      <div className="topbar">
        <div className="brand">
          <span className="brand__title">No Risk No Fun</span>
          <span className="brand__sub">لوحة المقدم</span>
        </div>
        <div className="row">
          <div className="roomcode"><span>رمز الغرفة</span><b>{room.code}</b></div>
          <button className="btn btn--sm" onClick={() => copy(origin + '/', 'رابط اللاعبين')}>🔗 رابط اللاعبين</button>
          <button className="btn btn--sm" onClick={() => copy(origin + '/host', 'رابط المقدم')}>🔗 رابط المقدم</button>
        </div>
      </div>

      {/* طلبات الانضمام */}
      {pending.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--gold)' }}>
          <div className="panel__title">🔔 طلبات انضمام جديدة ({pending.length})</div>
          {pending.map((p) => (
            <div className="row mb" key={p.id} style={{ justifyContent: 'space-between' }}>
              <b>{p.name}</b>
              <span className="row">
                <button className="btn btn--sm btn--green" onClick={() => emit('host_approve_player', { playerId: p.id, approve: true })}>قبول ✅</button>
                <button className="btn btn--sm btn--red" onClick={() => emit('host_approve_player', { playerId: p.id, approve: false })}>رفض ❌</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* الإحصائيات */}
      <div className="panel">
        <div className="stats">
          <div className="stat"><b>{stats.total}</b><span>إجمالي اللاعبين</span></div>
          <div className="stat"><b>{stats.active}</b><span>نشطون</span></div>
          <div className="stat"><b>{stats.eliminated}</b><span>مُقصَون</span></div>
          <div className="stat"><b>{room.groups.length}</b><span>مجموعات</span></div>
          <div className="stat"><b>{stats.cups}</b><span>🏆 كؤوس</span></div>
          <div className="stat"><b>{stats.hearts}</b><span>❤️ قلوب</span></div>
        </div>
      </div>

      {/* التحكم بالجولة */}
      <div className="panel">
        <div className="panel__title">
          <span>التحكم بالجولة</span>
          <span className={`phase-pill ${phaseLabel[1]}`}>{phaseLabel[0]}{room.roundNumber > 0 ? ` — جولة ${room.roundNumber}` : ''}</span>
        </div>

        {!room.roundActive && (
          <div className="row mb">
            <select className="input grow" value={groupForRound} onChange={(e) => setGroupForRound(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="">كل اللاعبين النشطين</option>
              {room.groups.map((g) => <option key={g} value={g}>مجموعة: {g}</option>)}
            </select>
            <button className="btn btn--gold" onClick={() => emit('host_start_round', { group: groupForRound || null })}>
              ▶️ بدء جولة جديدة
            </button>
          </div>
        )}

        {room.roundActive && (
          <>
            {/* إعطاء الدور */}
            <p className="muted mb">
              {room.phase === 'blue' && 'اضغط على اسم اللاعب ليختار بطاقة جبينه الزرقاء:'}
              {room.phase === 'red' && 'اضغط على اسم اللاعب ليختار بطاقتيه الحمراوين (A ثم B):'}
            </p>
            <div className="row mb">
              {inRound.map((p) => {
                const done = room.phase === 'blue' ? p.picked.blue : p.picked.redA && p.picked.redB;
                const isTurn = room.currentTurn === p.id;
                return (
                  <button key={p.id}
                    className={`btn btn--sm ${isTurn ? 'btn--gold' : done ? 'btn--green' : ''}`}
                    disabled={done}
                    onClick={() => emit('host_set_turn', { playerId: p.id })}>
                    {done ? '✔ ' : isTurn ? '⏳ ' : ''}{p.name}
                  </button>
                );
              })}
              {room.currentTurn && (
                <button className="btn btn--sm btn--ghost" onClick={() => emit('host_clear_turn')}>إلغاء الدور الحالي</button>
              )}
            </div>

            {room.phase === 'blue' && (
              <button className="btn btn--red btn--block mb" disabled={!allBluePicked}
                onClick={() => emit('host_start_red_phase')}>
                🔴 بدء المرحلة الحمراء {allBluePicked ? '' : '(بانتظار اكتمال الاختيارات الزرقاء)'}
              </button>
            )}

            {room.phase === 'red' && !allRedPicked && (
              <p className="muted mb">بانتظار اكتمال اختيارات البطاقات الحمراء...</p>
            )}
          </>
        )}

        {/* الكشف والفائز */}
        <div className="btn-row mb">
          <button className="btn btn--blue" onClick={() => emit('host_reveal_blue_all')}>🔵 كشف كل الزرقاء</button>
          <button className="btn btn--red" onClick={() => emit('host_reveal_red_all')}>🔴 كشف كل الحمراء</button>
          <button className="btn" onClick={() => setModal({ type: 'revealPlayer' })}>👤 كشف لاعب واحد</button>
        </div>
        <div className="btn-row mb">
          <button className="btn btn--gold" disabled={!room.roundActive} onClick={() => emit('host_calc_winner')}>🧮 احتساب الفائز</button>
          <button className="btn btn--gold" disabled={!room.roundActive} onClick={() => emit('host_reveal_and_winner')}>⚡ كشف الكل + تحديد الفائز</button>
        </div>

        <div className="btn-row">
          <button className="btn btn--sm" disabled={!room.roundActive} onClick={() => emit('host_end_round')}>⏹️ إنهاء الجولة</button>
          <button className="btn btn--sm" onClick={() => confirm('إعادة تعيين الجولة الحالية؟') && emit('host_reset_round')}>🔄 إعادة تعيين الجولة</button>
          <button className="btn btn--sm btn--red" onClick={() => confirm('سيتم تصفير القلوب والكؤوس وكل الجولات. متأكد؟') && emit('host_reset_game')}>🗑️ إعادة تعيين اللعبة</button>
        </div>
      </div>

      {/* جدول اللاعبين */}
      <div className="panel">
        <div className="panel__title"><span>اللاعبون ({visible.length})</span></div>
        <div className="table-wrap">
          <table className="htable">
            <thead>
              <tr>
                <th>اللاعب</th><th>المجموعة</th><th>❤️ القلوب</th><th>🏆</th>
                <th>🔵</th><th>🔴A</th><th>🔴B</th><th>المجموع</th><th>الموقف</th><th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <PlayerRow key={p.id} p={p} room={room} emit={emit} setModal={setModal} />
              ))}
            </tbody>
          </table>
        </div>
        {removed.length > 0 && (
          <>
            <div className="divider" />
            <p className="muted mb">محذوفون ({removed.length}):</p>
            <div className="row">
              {removed.map((p) => (
                <span key={p.id} className="row" style={{ gap: 4 }}>
                  <span className="badge">{p.name}</span>
                  <button className="btn btn--xs btn--green" onClick={() => emit('host_restore_player', { playerId: p.id })}>استعادة</button>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* القلوب الجماعية والمجموعات */}
      <div className="row" style={{ alignItems: 'stretch' }}>
        <HeartsPanel room={room} emit={emit} />
        <GroupsPanel room={room} players={visible} emit={emit} />
      </div>

      {/* السجل + أدوات */}
      <div className="panel">
        <div className="panel__title">
          <span>📜 سجل اللعبة</span>
          <span className="row">
            <button className="btn btn--xs" onClick={exportState}>📦 تصدير الحالة</button>
            <button className="btn btn--xs" onClick={onImportClick}>📥 استيراد الحالة</button>
            <button className="btn btn--xs btn--ghost" onClick={() => confirm('الخروج من جلسة المقدم على هذا الجهاز؟') && endSession()}>خروج</button>
          </span>
        </div>
        <div className="log">
          {logs.length === 0 && <p className="muted">لا توجد أحداث بعد</p>}
          {logs.map((l) => (
            <div className="log__item" key={l.id}>
              <span className="log__time">{new Date(l.time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span>
                <span className="log__action">{l.action}</span>
                {l.player_name && <span> — {l.player_name}</span>}
                {(l.prev_value != null || l.new_value != null) && (
                  <span className="log__detail"> ({l.prev_value ?? '—'} ← {l.new_value ?? '—'})</span>
                )}
                {l.details && <span className="log__detail"> · {l.details}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
function PlayerRow({ p, room, emit, setModal }) {
  const statusBadge =
    p.status === 'eliminated' ? <span className="badge badge--red">مُقصى</span> :
    p.roundAction === 'challenge' ? <span className="badge badge--red">متحدٍّ 🔥</span> :
    p.roundAction === 'withdraw' ? <span className="badge badge--green">منسحب 🛡️</span> :
    p.inRound ? <span className="badge badge--blue">في الجولة</span> :
    <span className="badge">نشط</span>;

  const cardCell = (picked, val) =>
    !picked ? <span className="muted">—</span> : <b className="num">{val ?? '✔'}</b>;

  return (
    <tr className={p.isWinner ? 'row--winner' : ''}>
      <td>
        <span className={`dot ${p.connected ? 'dot--on' : 'dot--off'}`} /> <b>{p.name}</b>
        {p.isWinner && ' 👑'}
        {room.currentTurn === p.id && ' ⏳'}
      </td>
      <td>{p.group || <span className="muted">—</span>}</td>
      <td>
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn btn--xs" onClick={() => emit('host_hearts', { playerId: p.id, op: 'remove', value: 1 })}>−</button>
          <b className="num" style={{ minWidth: 26, textAlign: 'center' }}>{p.hearts}</b>
          <button className="btn btn--xs" onClick={() => emit('host_hearts', { playerId: p.id, op: 'add', value: 1 })}>+</button>
        </span>
      </td>
      <td>
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn btn--xs" onClick={() => emit('host_edit_player', { playerId: p.id, patch: { cups: Math.max(0, p.cups - 1) } })}>−</button>
          <b className="num" style={{ minWidth: 22, textAlign: 'center' }}>{p.cups}</b>
          <button className="btn btn--xs" onClick={() => emit('host_edit_player', { playerId: p.id, patch: { cups: p.cups + 1 } })}>+</button>
        </span>
      </td>
      <td>{cardCell(p.picked.blue, p.values.blue)}</td>
      <td>{cardCell(p.picked.redA, p.values.redA)}</td>
      <td>{cardCell(p.picked.redB, p.values.redB)}</td>
      <td><b className="num" style={{ color: 'var(--gold)' }}>{p.total}</b></td>
      <td>{statusBadge}</td>
      <td>
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn btn--xs" title="تعديل" onClick={() => setModal({ type: 'editPlayer', player: p })}>✏️</button>
          {p.status === 'eliminated'
            ? <button className="btn btn--xs btn--green" title="استعادة" onClick={() => emit('host_restore_player', { playerId: p.id })}>♻️</button>
            : <button className="btn btn--xs btn--red" title="حذف" onClick={() => confirm(`حذف ${p.name}؟ (بدون حظر — يمكن استعادته)`) && emit('host_remove_player', { playerId: p.id })}>🗑️</button>}
        </span>
      </td>
    </tr>
  );
}

// ============================================================
function HeartsPanel({ room, emit }) {
  const [val, setVal] = useState(1);
  const [def, setDef] = useState(room.defaultHearts);
  useEffect(() => setDef(room.defaultHearts), [room.defaultHearts]);

  return (
    <div className="panel grow" style={{ minWidth: 280 }}>
      <div className="panel__title">❤️ إدارة القلوب الجماعية</div>
      <div className="field">
        <label>القلوب الافتراضية للاعبين الجدد (1 - 99)</label>
        <div className="row">
          <input className="input grow" type="number" min={1} max={99} value={def} onChange={(e) => setDef(e.target.value)} />
          <button className="btn btn--sm" onClick={() => emit('host_set_default_hearts', { value: def })}>حفظ</button>
        </div>
      </div>
      <div className="field">
        <label>تطبيق على كل اللاعبين دفعة واحدة</label>
        <div className="row mb">
          <input className="input" style={{ width: 90 }} type="number" min={0} max={99} value={val} onChange={(e) => setVal(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn--sm btn--green" onClick={() => emit('host_hearts_all', { op: 'add', value: val })}>+ إضافة للجميع</button>
          <button className="btn btn--sm btn--red" onClick={() => emit('host_hearts_all', { op: 'remove', value: val })}>− خصم من الجميع</button>
          <button className="btn btn--sm btn--gold" onClick={() => confirm(`تحديد قلوب الجميع = ${val}؟`) && emit('host_hearts_all', { op: 'set', value: val })}>= تحديد للجميع</button>
        </div>
      </div>
    </div>
  );
}

function GroupsPanel({ room, players, emit }) {
  const [name, setName] = useState('');
  return (
    <div className="panel grow" style={{ minWidth: 280 }}>
      <div className="panel__title">👥 المجموعات</div>
      <div className="row mb">
        <input className="input grow" placeholder="اسم مجموعة جديدة (مثال: A)" value={name} maxLength={30}
          onChange={(e) => setName(e.target.value)} />
        <button className="btn btn--sm btn--gold" onClick={() => { if (name.trim()) { emit('host_create_group', { name: name.trim() }); setName(''); } }}>إنشاء</button>
      </div>
      {room.groups.length === 0 && <p className="muted">لا توجد مجموعات — اللعب الجماعي للكل</p>}
      {room.groups.map((g) => (
        <div className="row mb" key={g} style={{ justifyContent: 'space-between' }}>
          <span><b>{g}</b> <span className="muted">({players.filter((p) => p.group === g).length} لاعب)</span></span>
          <button className="btn btn--xs btn--red" onClick={() => confirm(`حذف مجموعة ${g}؟`) && emit('host_delete_group', { name: g })}>حذف</button>
        </div>
      ))}
      <p className="muted">لنقل لاعب إلى مجموعة: زر ✏️ بجانب اسمه في الجدول.</p>
    </div>
  );
}

// ============================================================
function Modal({ modal, close, emit, state }) {
  if (modal.type === 'editPlayer') return <EditPlayerModal modal={modal} close={close} emit={emit} state={state} />;
  if (modal.type === 'revealPlayer') return <RevealPlayerModal close={close} emit={emit} state={state} />;
  return null;
}

function EditPlayerModal({ modal, close, emit, state }) {
  const p = state.players.find((x) => x.id === modal.player.id) || modal.player;
  const [name, setName] = useState(p.name);
  const [group, setGroup] = useState(p.group || '');
  const [hearts, setHearts] = useState(p.hearts);
  const [addVal, setAddVal] = useState(1);

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>✏️ تعديل اللاعب: {p.name}</h3>

        <div className="field">
          <label>الاسم</label>
          <div className="row">
            <input className="input grow" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn--sm" onClick={() => emit('host_edit_player', { playerId: p.id, patch: { name } })}>حفظ</button>
          </div>
        </div>

        <div className="field">
          <label>المجموعة</label>
          <div className="row">
            <select className="input grow" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">بدون مجموعة</option>
              {state.room.groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button className="btn btn--sm" onClick={() => emit('host_edit_player', { playerId: p.id, patch: { group: group || null } })}>نقل</button>
          </div>
        </div>

        <div className="divider" />

        <div className="field">
          <label>القلوب الحالية: <b style={{ color: 'var(--gold)' }}>{p.hearts}</b></label>
          <div className="row mb">
            <input className="input" style={{ width: 80 }} type="number" min={0} max={99} value={addVal} onChange={(e) => setAddVal(e.target.value)} />
            <button className="btn btn--sm btn--green" onClick={() => emit('host_hearts', { playerId: p.id, op: 'add', value: addVal })}>+ إضافة</button>
            <button className="btn btn--sm btn--red" onClick={() => emit('host_hearts', { playerId: p.id, op: 'remove', value: addVal })}>− خصم</button>
          </div>
          <div className="row">
            <input className="input" style={{ width: 80 }} type="number" min={0} max={99} value={hearts} onChange={(e) => setHearts(e.target.value)} />
            <button className="btn btn--sm btn--gold" onClick={() => emit('host_hearts', { playerId: p.id, op: 'set', value: hearts })}>= تحديد القلوب</button>
          </div>
          <p className="muted mt">القلوب = 0 تعني إقصاء اللاعب فوراً، وإعطاؤه قلوباً يستعيده.</p>
        </div>

        <button className="btn btn--block mt" onClick={close}>إغلاق</button>
      </div>
    </div>
  );
}

function RevealPlayerModal({ close, emit, state }) {
  const candidates = state.players.filter((p) => p.status !== 'removed' && p.status !== 'pending');
  const [pid, setPid] = useState(candidates[0]?.id || '');
  const [which, setWhich] = useState({ blue: true, redA: true, redB: true });
  const p = candidates.find((x) => x.id === pid);

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>👤 كشف بطاقات لاعب واحد</h3>
        <div className="field">
          <label>اختر اللاعب</label>
          <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>البطاقات المراد كشفها</label>
          {[['blue', '🔵 الزرقاء (بطاقة الجبين)'], ['redA', '🔴 الحمراء A'], ['redB', '🔴 الحمراء B']].map(([k, label]) => (
            <label key={k} className="row mb" style={{ cursor: 'pointer', fontSize: 15 }}>
              <input type="checkbox" checked={which[k]} onChange={(e) => setWhich({ ...which, [k]: e.target.checked })}
                style={{ width: 20, height: 20 }} />
              {label}
            </label>
          ))}
        </div>
        {p && (
          <p className="muted mb">
            قيم {p.name}: 🔵 {p.values.blue ?? '—'} · 🔴A {p.values.redA ?? '—'} · 🔴B {p.values.redB ?? '—'} · المجموع {p.total}
          </p>
        )}
        <div className="btn-row">
          <button className="btn btn--gold" onClick={() => { emit('host_reveal_player', { playerId: pid, which }); close(); }}>كشف الآن ⚡</button>
          <button className="btn" onClick={close}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

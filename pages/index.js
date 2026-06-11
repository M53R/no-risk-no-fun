// pages/index.js — واجهة اللاعب
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const LS_KEY = 'nrnf_player_session';

export default function PlayerPage() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState('loading'); // loading | join | pending | game | removed
  const [state, setState] = useState(null); // player_state من الخادم
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [flash, setFlash] = useState(null); // {type, emoji, text}
  const prevRef = useRef({ hearts: null, cups: null, status: null });

  const toast = useCallback((msg, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // ---------- الاتصال ----------
  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      const saved = readSession();
      if (saved) {
        s.emit('player_rejoin', saved, (res) => {
          if (res?.ok) {
            setScreen('game');
          } else {
            clearSession();
            setScreen('join');
            if (res?.error === 'تمت إزالتك من اللعبة') setScreen('removed');
          }
        });
      } else {
        setScreen('join');
      }
    });

    s.on('disconnect', () => setConnected(false));

    s.on('player_state', (st) => {
      setState(st);
      const me = st.me;
      if (me.status === 'pending') setScreen('pending');
      else if (me.status === 'removed') setScreen('removed');
      else setScreen('game');

      // تنبيهات الفلاش عند تغيّر القلوب/الكؤوس/الحالة
      const prev = prevRef.current;
      if (prev.hearts != null && me.hearts < prev.hearts) {
        setFlash({ type: 'heart', emoji: '💔', text: 'خسرت قلباً!' });
        setTimeout(() => setFlash(null), 2300);
      }
      if (prev.cups != null && me.cups > prev.cups) {
        setFlash({ type: 'cup', emoji: '🏆', text: 'مبروك! فزت بكأس' });
        setTimeout(() => setFlash(null), 2300);
      }
      if (prev.status === 'active' && me.status === 'eliminated') {
        setTimeout(() => {
          setFlash({ type: 'elim', emoji: '☠️', text: 'تم إقصاؤك من اللعبة' });
          setTimeout(() => setFlash(null), 2300);
        }, 2400);
      }
      prevRef.current = { hearts: me.hearts, cups: me.cups, status: me.status };
    });

    return () => s.disconnect();
  }, []);

  // ---------- الجلسة ----------
  function readSession() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function saveSession(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }
  function clearSession() {
    localStorage.removeItem(LS_KEY);
  }

  // ---------- الانضمام ----------
  function doJoin(e) {
    e?.preventDefault();
    const name = joinName.trim();
    const code = joinCode.trim();
    if (!name) return toast('اكتب اسمك أولاً', true);
    if (!/^\d{6}$/.test(code)) return toast('رمز الغرفة 6 أرقام', true);
    setBusy(true);
    socketRef.current.emit('player_join', { name, code }, (res) => {
      setBusy(false);
      if (!res?.ok) return toast(res?.error || 'تعذّر الانضمام', true);
      saveSession({ code: res.code, token: res.token });
      setScreen('pending');
    });
  }

  function leaveGame() {
    if (!confirm('هل تريد الخروج ومسح جلستك من هذا الجهاز؟')) return;
    clearSession();
    setState(null);
    prevRef.current = { hearts: null, cups: null, status: null };
    setScreen('join');
  }

  function pick(row, index) {
    socketRef.current.emit('player_pick', { row, index }, (res) => {
      if (!res?.ok) toast(res?.error || 'تعذّر الاختيار', true);
    });
  }

  function showRed(which) {
    socketRef.current.emit('player_show_red', { which }, (res) => {
      if (!res?.ok) toast(res?.error || 'تعذّر العرض', true);
      else toast('تم عرض البطاقة للمنافسين 👁');
    });
  }

  function roundAction(action) {
    const label = action === 'challenge' ? 'التحدّي 🔥' : 'الانسحاب الآمن 🛡️';
    if (!confirm(`تأكيد ${label}؟\nلا يمكنك تغيير قرارك بعد التأكيد — فقط المقدم يستطيع إلغاءه.`)) return;
    socketRef.current.emit('player_round_action', { action }, (res) => {
      if (!res?.ok) toast(res?.error || 'تعذّر تنفيذ الإجراء', true);
      else toast(action === 'challenge' ? 'تم تأكيد التحدّي 🔥' : 'تم تأكيد الانسحاب الآمن 🛡️');
    });
  }

  // ============================================================
  return (
    <div className="page page--narrow">
      {!connected && screen !== 'loading' && (
        <div className="conn-banner">⚠️ انقطع الاتصال... جاري إعادة المحاولة</div>
      )}

      {screen === 'loading' && (
        <div className="waiting"><div className="spinner" /><div className="muted">جاري التحميل...</div></div>
      )}

      {screen === 'join' && (
        <JoinScreen
          name={joinName} setName={setJoinName}
          code={joinCode} setCode={setJoinCode}
          onSubmit={doJoin} busy={busy}
        />
      )}

      {screen === 'pending' && (
        <div className="waiting">
          <div className="hero__logo"><span className="l1">No Risk</span> <span className="l2">No Fun</span></div>
          <div className="spinner" />
          <h2>بانتظار موافقة المقدم...</h2>
          <p className="muted">تم إرسال طلبك. ابقَ في هذه الصفحة وسيتم إدخالك فور الموافقة.</p>
          <button className="btn btn--ghost btn--sm" onClick={leaveGame}>إلغاء والخروج</button>
        </div>
      )}

      {screen === 'removed' && (
        <div className="waiting">
          <div style={{ fontSize: 60 }}>🚪</div>
          <h2>تمت إزالتك من اللعبة</h2>
          <p className="muted">تواصل مع المقدم إذا كان ذلك خطأ — يستطيع استعادتك في أي وقت.</p>
          <button className="btn btn--gold" onClick={() => { clearSession(); setScreen('join'); }}>
            انضمام من جديد
          </button>
        </div>
      )}

      {screen === 'game' && state && (
        <GameScreen state={state} pick={pick} roundAction={roundAction} showRed={showRed} leaveGame={leaveGame} />
      )}

      {flash && (
        <div className={`flash flash--${flash.type}`}>
          <div className="flash__emoji">{flash.emoji}</div>
          <div className="flash__text">{flash.text}</div>
        </div>
      )}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'toast--err' : ''}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
function JoinScreen({ name, setName, code, setCode, onSubmit, busy }) {
  return (
    <div>
      <div className="hero">
        <div className="hero__cards">
          <div className="card card--sm card--back card--blue">✦</div>
          <div className="card card--sm card--face card--blue" data-v="؟">؟</div>
          <div className="card card--sm card--back card--red">✦</div>
        </div>
        <div className="hero__logo"><span className="l1">No Risk</span> <span className="l2">No Fun</span></div>
        <div className="hero__tag">بطاقتك الزرقاء... الجميع يراها إلا أنت 👀</div>
      </div>

      <div className="panel">
        <div className="panel__title">الانضمام إلى اللعبة</div>
        <div className="field">
          <label>اسمك</label>
          <input className="input" value={name} maxLength={30}
            onChange={(e) => setName(e.target.value)} placeholder="مثال: محمد" />
        </div>
        <div className="field">
          <label>رمز الغرفة (6 أرقام)</label>
          <input className="input input--code" value={code} inputMode="numeric" maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
        </div>
        <button className="btn btn--gold btn--block" onClick={onSubmit} disabled={busy}>
          {busy ? '...جاري الانضمام' : 'انضم الآن 🎮'}
        </button>
        <p className="muted mt center">إذا انقطع اتصالك سابقاً، افتح نفس الرابط من نفس الجهاز وستعود تلقائياً.</p>
      </div>
    </div>
  );
}

// ============================================================
function GameScreen({ state, pick, roundAction, showRed, leaveGame }) {
  const { room, me, players } = state;
  const others = players.filter((p) => p.id !== me.id);

  const phaseLabel = {
    lobby: ['بانتظار بدء الجولة', 'phase-lobby'],
    blue: ['المرحلة الزرقاء 🔵', 'phase-blue'],
    red: ['المرحلة الحمراء 🔴', 'phase-red'],
    results: ['النتائج 🏆', 'phase-results'],
  }[room.phase] || ['', 'phase-lobby'];

  const canAct = room.roundActive && me.inRound && room.phase !== 'results';

  return (
    <div>
      <div className="topbar">
        <div className="brand">
          <span className="brand__title">No Risk No Fun</span>
        </div>
        <div className="roomcode"><span>الغرفة</span><b>{room.code}</b></div>
      </div>

      <div className="row mb" style={{ justifyContent: 'space-between' }}>
        <span className={`phase-pill ${phaseLabel[1]}`}>{phaseLabel[0]}</span>
        {room.roundNumber > 0 && <span className="badge">الجولة {room.roundNumber} من {room.maxRounds}</span>}
      </div>

      {/* بطاقتي */}
      <MyPanel me={me} room={room} canAct={canAct} roundAction={roundAction} showRed={showRed} />

      {/* شاشة الاختيار */}
      {me.needsPick && <PickOverlay me={me} needs={me.needsPick} pick={pick} />}

      {/* اختيار البطاقة الحمراء المعروضة للمنافسين */}
      {!me.needsPick && me.needsShow && <ShowRedOverlay me={me} showRed={showRed} />}

      {/* بقية اللاعبين */}
      <div className="panel">
        <div className="panel__title">
          بطاقات المنافسين
          <small>الزرقاء تنكشف عندما يقرر المقدم</small>
        </div>
        {others.length === 0 && <p className="muted center">لا يوجد لاعبون آخرون بعد</p>}
        <div className="players-grid">
          {others.map((p) => <OtherPlayerCard key={p.id} p={p} />)}
        </div>
      </div>

      <div className="center mt">
        <button className="btn btn--ghost btn--sm" onClick={leaveGame}>تسجيل الخروج من هذا الجهاز</button>
      </div>
    </div>
  );
}

function Hearts({ n }) {
  if (n <= 5) return <span className="hearts">{'❤️'.repeat(Math.max(0, n)) || '🖤'}</span>;
  return <span className="hearts">❤️ ×{n}</span>;
}

function MyPanel({ me, room, canAct, roundAction, showRed }) {
  return (
    <div className="panel">
      <div className="panel__title">
        <span>{me.name} {me.isWinner && '👑'}</span>
        <span className="row" style={{ gap: 10 }}>
          <Hearts n={me.hearts} />
          <span className="cups">🏆 {me.cups}</span>
        </span>
      </div>

      {me.status === 'eliminated' && (
        <p className="badge badge--red mb">☠️ مُقصى — بانتظار قرار المقدم</p>
      )}

      {!me.inRound && room.roundActive && me.status === 'active' && (
        <p className="muted mb">هذه الجولة لمجموعة أخرى — أنت خارجها.</p>
      )}

      {(me.inRound || room.phase === 'results') && (
        <div className="row" style={{ justifyContent: 'center', gap: 18, alignItems: 'flex-end' }}>
          {/* بطاقتي الزرقاء — لا تظهر لصاحبها أبداً */}
          <div className="forehead">
            {me.picked.blue ? (
              <div className="card card--lg card--back card--blue">؟</div>
            ) : (
              <div className="card card--lg card--back card--blue" style={{ opacity: 0.35 }}>—</div>
            )}
            <div className="forehead__hint">
              البطاقة الزرقاء 🔵<br />
              {me.picked.blue ? 'يراها الجميع إلا أنت!' : 'لم تُختَر بعد'}
            </div>
          </div>

          {/* الحمراء A */}
          <div className="forehead">
            {me.picked.redA ? (
              <div className="card card--face card--red flip-in" data-v={me.values.redA}>{me.values.redA}</div>
            ) : (
              <div className="card card--back card--red" style={{ opacity: 0.35 }}>—</div>
            )}
            <div className="forehead__hint">حمراء A 🔴<br />{me.shownRed === 'redA' ? '👁 معروضة للمنافسين' : 'سرّية لك'}</div>
          </div>

          {/* الحمراء B */}
          <div className="forehead">
            {me.picked.redB ? (
              <div className="card card--face card--red flip-in" data-v={me.values.redB}>{me.values.redB}</div>
            ) : (
              <div className="card card--back card--red" style={{ opacity: 0.35 }}>—</div>
            )}
            <div className="forehead__hint">حمراء B 🔴<br />{me.shownRed === 'redB' ? '👁 معروضة للمنافسين' : 'سرّية لك'}</div>
          </div>
        </div>
      )}

      {/* إجراءات الجولة */}
      {canAct && (
        <>
          <div className="divider" />
          <p className="muted mb center">
            {me.roundAction === 'challenge' && '🔥 أنت متحدٍّ في هذه الجولة (مؤكد)'}
            {me.roundAction === 'withdraw' && '🛡️ انسحبت بأمان — لن تخسر قلباً ولن تفوز (مؤكد)'}
            {!me.roundAction && 'قرّر موقفك: تتحدّى أم تنسحب بأمان؟ القرار نهائي بعد التأكيد.'}
          </p>
          <div className="btn-row">
            <button
              className={`btn ${me.roundAction === 'challenge' ? 'btn--red' : ''}`}
              disabled={me.roundAction != null}
              onClick={() => roundAction('challenge')}>
              🔥 تحدّي
            </button>
            <button
              className={`btn ${me.roundAction === 'withdraw' ? 'btn--green' : ''}`}
              disabled={me.roundAction != null}
              onClick={() => roundAction('withdraw')}>
              🛡️ انسحاب آمن
            </button>
          </div>
          {me.roundAction != null && (
            <p className="muted center mt" style={{ fontSize: 12 }}>قرارك مؤكد — التغيير عن طريق المقدم فقط</p>
          )}
        </>
      )}

      {me.isWinner && (
        <p className="badge badge--gold mt" style={{ fontSize: 14 }}>👑 فائز الجولة!</p>
      )}
    </div>
  );
}

function PickOverlay({ me, needs, pick }) {
  const isBlue = needs === 'blue';
  const row = needs;
  const count = me.deckCounts?.[needs] ?? 10;
  const titles = {
    blue: ['اختر بطاقتك الزرقاء 🔵', 'بطاقة عمياء: لن ترى قيمتها أبداً — لكن الجميع سيراها!'],
    redA: ['اختر بطاقتك الحمراء A 🔴', 'قيمتها ستظهر لك وحدك'],
    redB: ['الآن بطاقتك الحمراء B 🔴', 'قيمتها ستظهر لك وحدك'],
  };
  return (
    <div className="pick-overlay">
      <div className="pick-overlay__box">
        <div className="pick-overlay__title">{titles[needs][0]}</div>
        <div className="pick-overlay__sub">{titles[needs][1]}</div>
        <div className="pick-grid">
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              className={`card card--back ${isBlue ? 'card--blue' : 'card--red'}`}
              onClick={() => pick(row, i)}
              aria-label={`بطاقة ${i + 1}`}>
              ✦
            </button>
          ))}
        </div>
        <p className="muted">متبقي لك {count} بطاقات — كل بطاقة تختارها لا تعود! 🍀</p>
      </div>
    </div>
  );
}

function ShowRedOverlay({ me, showRed }) {
  return (
    <div className="pick-overlay">
      <div className="pick-overlay__box">
        <div className="pick-overlay__title">أي بطاقة تعرضها للمنافسين؟ 👁</div>
        <div className="pick-overlay__sub">المعروضة يراها الجميع... والأخرى تبقى سرّك. خادعهم!</div>
        <div className="row mt" style={{ justifyContent: 'center', gap: 22 }}>
          <button className="forehead" style={{ background: 'none', border: 'none' }} onClick={() => showRed('redA')}>
            <span className="card card--lg card--face card--red" data-v={me.values.redA}>{me.values.redA}</span>
            <span className="forehead__hint">عرض بطاقة A</span>
          </button>
          <button className="forehead" style={{ background: 'none', border: 'none' }} onClick={() => showRed('redB')}>
            <span className="card card--lg card--face card--red" data-v={me.values.redB}>{me.values.redB}</span>
            <span className="forehead__hint">عرض بطاقة B</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function OtherPlayerCard({ p }) {
  const statusBadge =
    p.status === 'eliminated' ? <span className="badge badge--red">مُقصى</span> :
    p.roundAction === 'withdraw' ? <span className="badge badge--green">منسحب</span> :
    p.roundAction === 'challenge' ? <span className="badge badge--red">متحدٍّ</span> :
    p.isTurn ? <span className="badge badge--gold">يختار الآن...</span> : null;

  return (
    <div className={`pcard ${p.isTurn ? 'pcard--turn' : ''} ${p.isWinner ? 'pcard--winner' : ''} ${p.status === 'eliminated' ? 'pcard--eliminated' : ''}`}>
      <div className="pcard__name">
        <span className={`dot ${p.connected ? 'dot--on' : 'dot--off'}`} />
        {p.name} {p.isWinner && '👑'}
      </div>
      <div className="pcard__meta">
        <Hearts n={p.hearts} />
        <span className="cups">🏆{p.cups}</span>
        {p.group && <span className="badge">{p.group}</span>}
      </div>
      <div className="pcard__cards">
        {/* الزرقاء: مرئية لي دائماً بعد اختيارها */}
        {p.picked.blue ? (
          p.values.blue != null
            ? <div className="card card--sm card--face card--blue flip-in">{p.values.blue}</div>
            : <div className="card card--sm card--back card--blue">؟</div>
        ) : <div className="card card--sm card--back card--blue" style={{ opacity: 0.3 }}>—</div>}

        {/* الحمراء: بعد الكشف الشامل تظهر الاثنتان — وقبله المعروضة فقط */}
        {p.values.redA != null && p.values.redB != null ? (
          <>
            <div className="card card--sm card--face card--red flip-in">{p.values.redA}</div>
            <div className="card card--sm card--face card--red flip-in">{p.values.redB}</div>
          </>
        ) : p.shownRed && (p.shownRed === 'redA' ? p.values.redA : p.values.redB) != null ? (
          <div className="forehead" style={{ gap: 2 }}>
            <div className="card card--sm card--face card--red flip-in">
              {p.shownRed === 'redA' ? p.values.redA : p.values.redB}
            </div>
            <span style={{ fontSize: 10, color: 'var(--ink-dim)' }}>👁 معروضة</span>
          </div>
        ) : p.picked.redA || p.picked.redB ? (
          <div className="card card--sm card--back card--red">✦</div>
        ) : (
          <div className="card card--sm card--back card--red" style={{ opacity: 0.3 }}>—</div>
        )}
      </div>
      <div className="mt" style={{ minHeight: 22 }}>{statusBadge}</div>
    </div>
  );
}

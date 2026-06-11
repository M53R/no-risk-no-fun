// components/Splash.js — انترو الشعار (ستارة من الأسفل + الشعار يكبر + اختفاء)
import { useRef, useState, useCallback } from 'react';

export function useSplash() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef([]);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // تشغيل تلقائي: يظهر ثم يختفي وحده
  const play = useCallback((ms = 2400) => {
    clear();
    setVisible(true);
    setLeaving(false);
    timers.current.push(setTimeout(() => setLeaving(true), ms));
    timers.current.push(setTimeout(() => { setVisible(false); setLeaving(false); }, ms + 550));
  }, []);

  // تثبيت (F2): يبقى حتى يُطلب إخفاؤه
  const hold = useCallback(() => {
    clear();
    setVisible(true);
    setLeaving(false);
  }, []);

  const hide = useCallback(() => {
    clear();
    setLeaving(true);
    timers.current.push(setTimeout(() => { setVisible(false); setLeaving(false); }, 550));
  }, []);

  return { visible, leaving, play, hold, hide };
}

export default function Splash({ visible, leaving, byName }) {
  if (!visible) return null;
  return (
    <div className={`splash ${leaving ? 'splash--leaving' : ''}`}>
      <div className="splash__bg" />
      <div className="splash__content">
        <img src="/logo.png" alt="No Risk No Fun" className="splash__logo" />
        {byName ? <div className="splash__by">مع {byName}</div> : null}
      </div>
    </div>
  );
}

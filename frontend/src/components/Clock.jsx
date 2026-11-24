import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

/** Live date and time for the top bar (updates every second). */
export default function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const date = now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className="top-clock" role="timer" aria-live="off" title={now.toString()}>
      <Icon name="clock" />
      <span className="tc-date">{date}</span>
      <time dateTime={now.toISOString()}>{time}</time>
    </div>
  );
}

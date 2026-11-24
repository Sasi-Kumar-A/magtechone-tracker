import { useEffect, useRef, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Icon } from './ui.jsx';
import { timeAgo } from '../lib/rules.js';

export default function Notifications({ openBug }) {
  const { notifications, unread, seenAt, markAllRead } = useTracker();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="notif" ref={ref}>
      <button className="icon-btn on-dark bell" aria-expanded={open} aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />{unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <header>
            <strong>Notifications</strong>
            <button className="link small" disabled={unread === 0} onClick={markAllRead}>Mark all as read</button>
          </header>
          {notifications.length === 0 ? (
            <div className="notif-empty">
              <Icon name="bell" size={22} />
              <p>Nothing yet. You'll see bugs assigned to you and bugs your developers complete here.</p>
            </div>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.key} className={n.at > seenAt ? 'unread' : ''}>
                  <button onClick={() => { setOpen(false); openBug(n.bugId); }}>
                    <span className={`n-ico ${n.kind}`}><Icon name={n.kind === 'done' ? 'check' : 'user'} size={15} /></span>
                    <span className="n-text"><span>{n.text}</span><small className="muted">{n.title}</small><small className="muted">{timeAgo(n.at)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

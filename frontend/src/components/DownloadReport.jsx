import { useState } from 'react';
import { useTracker } from '../store.jsx';
import { Icon } from './ui.jsx';

/** "Download report" button: Excel in the ATT_Test_Report_FINAL layout, all modules or one. */
export default function DownloadReport({ className = 'btn', compact = false }) {
  const { testcases, bugs, modules, team, user, toast } = useTracker();
  const [module, setModule] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { downloadReport } = await import('../lib/report.js');
      const file = await downloadReport({ testcases, bugs, modules, team }, { module, by: user?.name });
      toast(`Downloaded ${file}`);
    } catch (e) {
      toast(`Could not create the report: ${e.message}`, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="dl-report">
      <label htmlFor="dl-mod" className="sr">Report for module</label>
      <select id="dl-mod" value={module} onChange={(e) => setModule(e.target.value)} disabled={busy}>
        <option value="ALL">All modules</option>
        {modules.map((m) => <option key={m.code} value={m.code}>{m.code} – {m.name}</option>)}
      </select>
      <button className={className} onClick={go} disabled={busy}>
        <Icon name="download" /> {busy ? 'Preparing…' : compact ? 'Excel' : 'Download report'}
      </button>
    </span>
  );
}

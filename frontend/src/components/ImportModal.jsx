import { useRef, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Icon, ModPill, Modal } from './ui.jsx';
import { readXlsx } from '../lib/xlsx.js';
import { analyse } from '../lib/importer.js';

export default function ImportModal({ onClose }) {
  const data = useTracker();
  const { actions, toast } = data;
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [onExisting, setOnExisting] = useState('skip');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);

  const result = sheets ? analyse(sheets, data, { onExisting }) : null;
  const errors = result ? result.issues.filter((i) => i.level === 'error') : [];
  const warns = result ? result.issues.filter((i) => i.level === 'warn') : [];
  const total = result ? result.testcases.length + result.bugs.length : 0;

  const pick = async (f) => {
    if (!f) return;
    setErr(''); setSheets(null); setFile(f);
    if (!/\.xlsx$/i.test(f.name)) { setErr('Please choose an Excel .xlsx file (in Excel: File → Save As → .xlsx).'); return; }
    try {
      setBusy(true);
      setSheets(await readXlsx(f));
    } catch (e) {
      setErr(e.message || 'Could not read this file.');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!result || total === 0) return;
    setBusy(true);
    const r = await actions.importData({ testcases: result.testcases, bugs: result.bugs, modules: result.modulesToCreate });
    setBusy(false);
    if (r) {
      toast(`Imported ${result.testcases.length} test cases and ${result.bugs.length} bugs`);
      onClose();
    }
  };

  return (
    <Modal title="Import from Excel" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!result || total === 0 || busy} onClick={run}>
          {busy && result ? 'Importing…' : result ? `Import ${total} record${total === 1 ? '' : 's'}` : 'Import'}
        </button>
      </>}>
      <div className="import">
        <div className={`drop ${drag ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}>
          <Icon name="upload" size={26} />
          <p><strong>{file ? file.name : 'Drop your .xlsx file here'}</strong></p>
          <button className="btn" onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Choose file'}</button>
          <input ref={input} type="file" accept=".xlsx" className="sr" onChange={(e) => pick(e.target.files[0])} aria-label="Excel file" />
          <p className="muted small">Sheets with a header row containing <b>TC ID</b> + <b>Scenario</b> become test cases; <b>Bug ID</b> + <b>Title</b> become bugs. Other sheets (like Summary) are ignored.</p>
        </div>

        {err && <p className="error-text" role="alert">{err}</p>}
        {busy && !result && <div className="skeleton short" />}

        {result && (
          <>
            <div className="imp-opts" role="radiogroup" aria-label="Records that already exist">
              <span className="strong">If an ID already exists:</span>
              {[['skip', 'Keep the tracker version (skip)'], ['update', 'Overwrite with the Excel values']].map(([v, l]) => (
                <label key={v} className="radio"><input type="radio" name="onExisting" checked={onExisting === v} onChange={() => setOnExisting(v)} /> {l}</label>
              ))}
            </div>

            <div className="imp-stats">
              <div><strong>{result.stats.tcNew}</strong><span>new test cases</span></div>
              <div><strong>{result.stats.tcUpdate}</strong><span>test cases updated</span></div>
              <div><strong>{result.stats.bugNew}</strong><span>new bugs</span></div>
              <div><strong>{result.stats.bugUpdate}</strong><span>bugs updated</span></div>
              <div className={result.stats.invalid ? 'bad' : ''}><strong>{result.stats.invalid}</strong><span>rows skipped</span></div>
            </div>

            <p className="muted small">Read: {result.sheetsUsed.join(', ') || 'nothing usable'}{result.stats.tcSkip + result.stats.bugSkip ? ` · ${result.stats.tcSkip + result.stats.bugSkip} existing skipped` : ''}</p>

            {result.modulesToCreate.length > 0 && (
              <div className="callout soft"><span>New modules will be created: {result.modulesToCreate.map((m) => <ModPill key={m.code} code={m.code} />)}</span></div>
            )}

            {(errors.length > 0 || warns.length > 0) && (
              <div className="imp-issues">
                <h3>Checks ({errors.length} problem{errors.length === 1 ? '' : 's'}, {warns.length} note{warns.length === 1 ? '' : 's'})</h3>
                <ul>
                  {[...errors, ...warns].slice(0, 80).map((i, k) => (
                    <li key={k} className={i.level}><span className="tag">{i.level === 'error' ? 'Skipped' : 'Note'}</span>{i.sheet && <span className="muted">{i.sheet}{i.row ? ` row ${i.row}` : ''}:</span>} {i.text}</li>
                  ))}
                </ul>
                {errors.length + warns.length > 80 && <p className="muted small">…and {errors.length + warns.length - 80} more.</p>}
              </div>
            )}
            {errors.length === 0 && warns.length === 0 && total > 0 && <div className="callout soft"><Icon name="check" /><span>Everything checks out.</span></div>}
          </>
        )}
      </div>
    </Modal>
  );
}

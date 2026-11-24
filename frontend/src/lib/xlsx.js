// Minimal .xlsx reader (values only) built on JSZip + the browser's XML parser.
import JSZip from 'jszip';

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(el) {
  // shared strings / inline strings can be split into rich-text runs <r><t>…</t></r>
  const ts = el.getElementsByTagName('t');
  let s = '';
  for (const t of ts) s += t.textContent;
  return s;
}

export function excelDateToIso(n) {
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

/** Returns [{ name, rows: [[cell, ...], ...] }] with strings, numbers and booleans. */
export async function readXlsx(file) {
  const zip = await JSZip.loadAsync(file);
  const parse = async (path) => {
    const f = zip.file(path);
    if (!f) return null;
    return new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  };
  const wb = await parse('xl/workbook.xml');
  if (!wb) throw new Error('This is not an Excel .xlsx file.');
  const rels = await parse('xl/_rels/workbook.xml.rels');
  const targets = {};
  for (const r of rels.getElementsByTagName('Relationship')) targets[r.getAttribute('Id')] = r.getAttribute('Target');

  const shared = [];
  const sst = await parse('xl/sharedStrings.xml');
  if (sst) for (const si of sst.getElementsByTagName('si')) shared.push(textOf(si));

  const sheets = [];
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttributeNS(NS_REL, 'id') || s.getAttribute('r:id');
    let target = targets[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const doc = await parse(target);
    if (!doc) continue;
    const rows = [];
    for (const row of doc.getElementsByTagName('row')) {
      const r = parseInt(row.getAttribute('r'), 10) - 1;
      const cells = [];
      for (const c of row.getElementsByTagName('c')) {
        const idx = colIndex(c.getAttribute('r') || 'A1');
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent;
        let val = null;
        if (t === 's') val = shared[parseInt(v, 10)] ?? '';
        else if (t === 'inlineStr') val = textOf(c);
        else if (t === 'b') val = v === '1';
        else if (t === 'str' || t === 'e') val = v ?? '';
        else if (v != null && v !== '') val = Number(v);
        cells[idx] = val;
      }
      rows[r] = cells;
    }
    sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, (r) => r || []) });
  }
  return sheets;
}

/** CSV / TSV reader: detects , ; or tab, handles quotes and line breaks inside quotes. */
export function parseCsv(textIn) {
  const t = textIn.replace(/^﻿/, '');
  const firstLines = t.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (ch) => firstLines.split(ch).length - 1;
  const sep = ['\t', ';', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Reads .xlsx or .csv/.tsv/.txt into [{ name, rows }]. */
export async function readAnySheet(file) {
  const name = file.name || 'file';
  if (/\.xlsx$/i.test(name)) return readXlsx(file);
  if (/\.(csv|tsv|txt)$/i.test(name)) {
    const buf = await file.arrayBuffer();
    let txt = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf); // Excel "CSV" on Windows
    return [{ name: name.replace(/\.[^.]+$/, ''), rows: parseCsv(txt) }];
  }
  if (/\.xls$/i.test(name)) throw new Error('Old .xls files can\'t be read. In Excel: File → Save As → Excel Workbook (.xlsx) or CSV.');
  throw new Error('Please choose an Excel (.xlsx) or CSV file.');
}

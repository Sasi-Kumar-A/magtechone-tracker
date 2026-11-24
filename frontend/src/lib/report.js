// Excel report in the same layout as ATT_Test_Report_FINAL.xlsx:
//  Summary sheet + for each module a "<CODE> Test" sheet and a "<CODE> Bugs" sheet.
// exceljs is loaded only when someone clicks Download, so the page stays fast.

const RED = 'FFB80035';
const BLUE = 'FF0070C0';
const GREY = 'FFF1F5F9';
const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

const TEST_COLS = [
  ['Test Case ID', 12], ['Module', 20], ['Screen Name', 14], ['Test Type', 12], ['Pre-condition', 22],
  ['Test Scenario / Steps', 34], ['Input Data', 22], ['Expected Result', 42], ['Actual Result', 32],
  ['Status', 11], ['Priority', 10], ['Tested By', 14], ['Test Date', 12], ['Browser / Device', 16],
  ['Notes / Defect ID', 14], ['Bug Status', 12], ['Assigned To (Developer)', 18], ['Retest Date', 12],
  ['Retest Result', 13], ['Remark', 34],
];
const BUG_COLS = [
  ['Bug ID', 10], ['Test Case ID', 12], ['Sheet', 13], ['Screen Name', 12], ['Scenario', 44], ['Actual Result', 36],
  ['Priority', 10], ['Bug Status', 13], ['Retest Result', 13], ['Remark', 34],
  ['Severity', 10], ['Assigned To', 16], ['Reported By', 14], ['Reported On', 12], ['Steps to Reproduce', 40], ['Expected Result', 36],
];

const tcStatus = (s) => ({ Pass: 'PASS', Fail: 'FAIL', Blocked: 'BLOCKED', 'N/A': 'N/A' }[s] || '');
const bugStatus = (s) => ({ Open: 'Open', 'In progress': 'In Progress', 'Fixed – retest': 'Retest', Closed: 'Closed' }[s] || s || '');
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const sheetName = (s) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

function retest(bug) {
  if (!bug) return { date: '', result: '' };
  // a bug that went Fixed – retest → Closed passed retest; Fixed – retest → Open/In progress failed it
  const h = [...(bug.history || [])].reverse();
  let date = '', result = '';
  for (let i = 0; i < h.length; i++) {
    const a = h[i].action || '';
    if (/^Status: Fixed – retest → Closed/.test(a)) { date = day(h[i].at); result = 'PASS'; }
    else if (/^Status: Fixed – retest → (Open|In progress)/.test(a)) { date = day(h[i].at); result = 'FAIL'; }
  }
  if (!result && bug.status === 'Closed') { date = day(bug.closedAt); result = 'PASS'; }
  return { date, result };
}

function header(row, fill) {
  row.height = 29;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = box;
  });
}

export async function buildReport({ testcases, bugs, modules, team }, { module = 'ALL', by = '' } = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MagtechOne Tracker';
  wb.created = new Date();
  const name = (id) => team.find((m) => m.id === id)?.name || id || '';
  const bugById = new Map(bugs.map((b) => [b.id, b]));
  const mods = modules.filter((m) => module === 'ALL' || m.code === module)
    .filter((m) => module !== 'ALL' || testcases.some((t) => t.module === m.code) || bugs.some((b) => b.module === m.code));

  const summary = wb.addWorksheet('Summary');
  const sheets = [];

  for (const m of mods) {
    const tcs = testcases.filter((t) => t.module === m.code).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const testName = sheetName(`${m.code} Test`);
    const ws = wb.addWorksheet(testName, { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
    ws.columns = TEST_COLS.map(([, w]) => ({ width: w }));
    const n = Math.max(tcs.length, 1);
    const last = 4 + n;
    const J = `J5:J${last}`;

    ws.getCell('A1').value = 'TEST EXECUTION & DEFECT TRACKING REPORT';
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: RED } };
    ws.getRow(1).height = 18.5;
    ['Total', 'Pass', 'Fail', 'Blocked', 'Not run', 'Pass %'].forEach((t, i) => {
      const c = ws.getCell(1, 9 + i);
      c.value = t; c.font = { bold: true }; c.alignment = { horizontal: 'center' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; c.border = box;
    });
    ws.getCell('A2').value = 'Project:'; ws.getCell('B2').value = `MAGTECH ONE – ${m.name}`;
    ws.getCell('C2').value = 'Module:'; ws.getCell('D2').value = m.code;
    ws.getCell('E2').value = 'Last Run Date:';
    const lastRun = tcs.map((t) => t.testedOn).filter(Boolean).sort().pop();
    ws.getCell('F2').value = lastRun || '';
    [['A2'], ['C2'], ['E2']].forEach(([a]) => { ws.getCell(a).font = { bold: true }; });
    const f = [
      `COUNTIF(${J},"?*")`, `COUNTIF(${J},"PASS")`, `COUNTIF(${J},"FAIL")`, `COUNTIF(${J},"BLOCKED")`,
      `COUNTA(A5:A${last})-COUNTIF(${J},"?*")`, `IFERROR(COUNTIF(${J},"PASS")/COUNTIF(${J},"?*"),0)`,
    ];
    const run = tcs.filter((t) => tcStatus(t.status)).length;
    const pass = tcs.filter((t) => t.status === 'Pass').length;
    const results = [run, pass, tcs.filter((t) => t.status === 'Fail').length, tcs.filter((t) => t.status === 'Blocked').length, tcs.length - run, run ? pass / run : 0];
    f.forEach((formula, i) => {
      const c = ws.getCell(2, 9 + i);
      c.value = { formula, result: results[i] };
      c.font = { bold: true, size: 12 }; c.alignment = { horizontal: 'center' }; c.border = box;
      if (i === 5) c.numFmt = '0%';
    });

    const hr = ws.getRow(4);
    hr.values = TEST_COLS.map(([h]) => h);
    header(hr, BLUE);
    ws.autoFilter = { from: 'A4', to: `T${last}` };

    tcs.forEach((t, i) => {
      const linked = (t.bugIds || []).map((id) => bugById.get(id)).filter(Boolean);
      const bug = linked[linked.length - 1];
      const rt = retest(bug);
      const row = ws.getRow(5 + i);
      row.values = [
        t.id, m.name, t.screen || '', t.testType || 'Functional',
        [t.loginAs ? `Signed in as ${t.loginAs}` : '', t.precondition || ''].filter(Boolean).join('. '),
        [t.scenario, t.steps].filter(Boolean).join('\n'), t.inputData || '', t.expected || '',
        t.actual || bug?.actual || '', tcStatus(t.status), t.priority || '', name(t.testedBy), day(t.testedOn),
        t.browser || '', (t.bugIds || []).join(', '), bug ? bugStatus(bug.status) : '', bug ? name(bug.assignee) : '',
        rt.date, rt.result, t.remarks || '',
      ];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        if (col > 20) return;
        c.alignment = { vertical: 'top', wrapText: true };
        c.border = box;
      });
    });

    // Same colouring rules as the reference sheet.
    ws.addConditionalFormatting({
      ref: `A5:T${last}`,
      rules: [
        { type: 'expression', priority: 4, formulae: ['UPPER(TRIM($J5))="PASS"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE9F7EC' } } } },
        { type: 'expression', priority: 5, formulae: ['UPPER(TRIM($J5))="FAIL"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDECEE' } } } },
        { type: 'expression', priority: 6, formulae: ['UPPER(TRIM($J5))="BLOCKED"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREY } } } },
      ],
    });
    ws.addConditionalFormatting({
      ref: J,
      rules: [
        { type: 'expression', priority: 1, formulae: ['UPPER(TRIM($J5))="PASS"'], style: { font: { color: { argb: 'FF006100' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } } } },
        { type: 'expression', priority: 2, formulae: ['UPPER(TRIM($J5))="FAIL"'], style: { font: { color: { argb: 'FF9C0006' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } },
        { type: 'expression', priority: 3, formulae: ['UPPER(TRIM($J5))="BLOCKED"'], style: { font: { color: { argb: 'FF334155' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE2E8F0' } } } },
      ],
    });
    ws.addConditionalFormatting({
      ref: `S5:S${last}`,
      rules: [
        { type: 'expression', priority: 7, formulae: ['UPPER($S5)="PASS"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } } } },
        { type: 'expression', priority: 8, formulae: ['UPPER($S5)="FAIL"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } },
      ],
    });
    const lists = { D: '"Functional,Negative,UI,Permission,Regression"', J: '"PASS,FAIL,BLOCKED,N/A"', K: '"Critical,High,Medium,Low"', P: '"Open,In Progress,Fixed,Retest,Closed,Rejected"', S: '"PASS,FAIL"' };
    for (let r = 5; r <= last; r++) for (const [col, list] of Object.entries(lists)) ws.getCell(`${col}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [list] };

    // Bugs sheet for this module
    const mb = bugs.filter((b) => b.module === m.code).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const bs = wb.addWorksheet(sheetName(`${m.code} Bugs`), { views: [{ state: 'frozen', ySplit: 1 }] });
    bs.columns = BUG_COLS.map(([, w]) => ({ width: w }));
    const bh = bs.getRow(1);
    bh.values = BUG_COLS.map(([h]) => h);
    header(bh, RED);
    mb.forEach((b, i) => {
      const tc = testcases.find((t) => t.id === b.testCaseId);
      const rt = retest(b);
      const row = bs.getRow(2 + i);
      row.values = [
        b.id, b.testCaseId || '', tc ? testName : '', tc?.screen || '', b.title || tc?.scenario || '', b.actual || '',
        b.severity || '', bugStatus(b.status), rt.result, b.notes || '',
        b.severity || '', name(b.assignee), name(b.reporter), day(b.createdAt), b.steps || '', b.expected || '',
      ];
      row.eachCell({ includeEmpty: true }, (c, col) => { if (col <= BUG_COLS.length) { c.alignment = { vertical: 'top', wrapText: true }; c.border = box; } });
    });
    if (mb.length) bs.autoFilter = { from: 'A1', to: `P${1 + mb.length}` };
    sheets.push({ testName, last, open: mb.filter((b) => b.status !== 'Closed').length });
  }

  // Summary (formulas point at the module sheets, like the reference file)
  summary.columns = [{ width: 18 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 11 }];
  summary.getCell('A1').value = 'MAGTECH ONE — Test summary';
  summary.getCell('A1').font = { bold: true, size: 15, color: { argb: RED } };
  summary.getCell('A2').value = `Generated ${new Date().toLocaleString()}${by ? ` by ${by}` : ''} · MagtechOne Tracker`;
  summary.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } };
  const sh = summary.getRow(3);
  sh.values = ['Sheet', 'Test cases', 'Run', 'Pass', 'Fail', 'Blocked', 'Not run', 'Pass %', 'Open bugs'];
  header(sh, RED);
  sheets.forEach((s, i) => {
    const r = 4 + i;
    const q = `'${s.testName}'!`;
    const J = `${q}J5:J${s.last}`;
    const row = summary.getRow(r);
    row.values = [
      s.testName,
      { formula: `COUNTA(${q}A5:A${s.last})` },
      { formula: `COUNTIF(${J},"?*")` },
      { formula: `COUNTIF(${J},"PASS")` },
      { formula: `COUNTIF(${J},"FAIL")` },
      { formula: `COUNTIF(${J},"BLOCKED")` },
      { formula: `B${r}-C${r}` },
      { formula: `IFERROR(D${r}/C${r},0)` },
      s.open,
    ];
    row.getCell(8).numFmt = '0%';
    row.eachCell((c) => { c.border = box; });
  });
  const tr = 4 + sheets.length;
  const total = summary.getRow(tr);
  total.values = ['Total', ...['B', 'C', 'D', 'E', 'F', 'G'].map((c) => ({ formula: `SUM(${c}4:${c}${tr - 1})` })), { formula: `IFERROR(D${tr}/C${tr},0)` }, { formula: `SUM(I4:I${tr - 1})` }];
  total.getCell(8).numFmt = '0%';
  total.eachCell((c) => { c.font = { bold: true }; c.border = box; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; });

  return wb.xlsx.writeBuffer();
}

export async function downloadReport(data, opts = {}) {
  const buf = await buildReport(data, opts);
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `MagtechOne_Test_Report_${opts.module && opts.module !== 'ALL' ? `${opts.module}_` : ''}${stamp}.xlsx`;
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: file });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return file;
}

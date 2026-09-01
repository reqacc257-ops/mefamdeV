/**
 * Report Card Component
 * Displays DepEd "Report on Learning Progress and Achievement" format
 */

// Default learning areas; will be merged with configured subjects or grades-derived subjects
const DEFAULT_AREAS = [
  'Filipino','English','Mathematics','Science','Araling Panlipunan (AP)','GMRC / Values Education','EPP / TLE','MAPEH'
];

function getReportCardPeriodCount() {
  try {
    const configured = Number(localStorage.getItem('mefamdev_grading_periods'));
    return configured === 4 ? 4 : 3;
  } catch (e) {
    return 3;
  }
}

function calculateFinalGrade(grades) {
  if (!grades || grades.length === 0) return 0;
  const sum = grades.reduce((acc, g) => acc + (Number(g) || 0), 0);
  return Math.round((sum / grades.length) * 10) / 10;
}

function getRemarkFromGrade(grade) {
  const g = Number(grade) || 0;
  if (g >= 90) return 'Passed';
  if (g >= 85) return 'Passed';
  if (g >= 80) return 'Passed';
  if (g >= 75) return 'Passed';
  return 'Did Not Meet';
}

function canonicalSubjectName(name) {
  const normalized = String(name || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  if (['music', 'arts', 'pe', 'physical education', 'health', 'mapeh'].includes(normalized)) return 'MAPEH';
  if (normalized.includes('araling panlipunan') || normalized === 'ap') return 'Araling Panlipunan (AP)';
  if (normalized.includes('gmrc') || normalized.includes('values education')) return 'GMRC / Values Education';
  if (normalized === 'epp' || normalized.includes('epp / tle') || normalized.includes('edukasyong pantahanan')) return 'EPP / TLE';
  if (normalized === 'esp' || normalized === 'edukasyon sa pagpapakatao') return 'Edukasyon sa Pagpapakatao';
  if (normalized === 'tle' || normalized.includes('technology') && normalized.includes('livelihood') || normalized === 'education (tle)') return 'Technology and Livelihood Education (TLE)';
  return String(name || '').trim();
}

function mergeSubjectGrades(target, source) {
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(quarter => {
    if (target[quarter] === '' && source[quarter] !== '') target[quarter] = source[quarter];
  });
}

function buildReportCardHTML(scholarData, gradesData) {
  const { name, gradeLevel, school, refNo, schoolYear } = scholarData;
  const periodCount = getReportCardPeriodCount();
  const periods = Array.from({ length: periodCount }, (_, index) => `Q${index + 1}`);
  
  // Organize grades by subject and quarter
  const gradesBySubject = {};
  const componentNames = new Set(['music', 'arts', 'pe', 'physical education', 'health']);
  const componentGrades = [];
  (gradesData || []).forEach(grade => {
    const rawSubject = grade.subject || grade.subject_name || grade.subjectName;
    const normalizedRawSubject = String(rawSubject || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    if (componentNames.has(normalizedRawSubject)) {
      componentGrades.push(grade);
      return;
    }
    const subj = canonicalSubjectName(rawSubject);
    if (!subj) return;
    if (!gradesBySubject[subj]) {
      gradesBySubject[subj] = { Q1: '', Q2: '', Q3: '', Q4: '' };
    }
    if (grade.quarter) {
      const q = `Q${grade.quarter}`;
      const value = grade.grade_val ?? grade.grade_value;
      if (value !== null && value !== undefined && value !== '') gradesBySubject[subj][q] = value;
    }
  });

  if (!gradesBySubject.MAPEH && componentGrades.length) {
    gradesBySubject.MAPEH = { Q1: '', Q2: '', Q3: '', Q4: '' };
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach(quarter => {
      const values = componentGrades.map(grade => grade.quarter && `Q${grade.quarter}` === quarter ? Number(grade.grade_val ?? grade.grade_value) : null).filter(Number.isFinite);
      if (values.length) gradesBySubject.MAPEH[quarter] = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10;
    });
  }

  // If no configured subjects, assemble from grades and default areas
  const configured = (() => {
    try {
      const raw = localStorage.getItem('mefamdev_subjects');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  })();

  const subjectsFromGrades = Object.keys(gradesBySubject);
  const configuredSubjects = configured && Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_AREAS;
  const excludedSubjects = new Set();
  const finalSubjectList = Array.from(new Set([...configuredSubjects, ...subjectsFromGrades].map(canonicalSubjectName)))
    .filter(subject => subject && !excludedSubjects.has(String(subject).toLowerCase()) && subject !== 'Music' && subject !== 'Arts' && subject !== 'PE' && subject !== 'Health');

  const quarterlyAverages = Object.fromEntries(periods.map(period => [period, []]));
  const subjectFinalGrades = [];
  let tableRows = '';

  for (const subj of finalSubjectList) {
    const subjectGrades = gradesBySubject[subj] || {};
    const periodValues = periods.map(period => subjectGrades[period] || '');
    const finalGrade = calculateFinalGrade(periodValues.filter(g => g !== ''));
    const remark = getRemarkFromGrade(finalGrade);
    if (finalGrade > 0) subjectFinalGrades.push(finalGrade);

    periods.forEach((period, index) => {
      if (periodValues[index]) quarterlyAverages[period].push(Number(periodValues[index]));
    });

    tableRows += `
      <tr>
        <td class="rc-area">${subj}</td>
        ${periodValues.map(value => `<td class="rc-grade">${value || '-'}</td>`).join('')}
        <td class="rc-final">${finalGrade > 0 ? finalGrade : '-'}</td>
        <td class="rc-remark ${remark === 'Passed' ? 'remark-pass' : 'remark-pending'}">${finalGrade > 0 ? remark : '-'}</td>
      </tr>
    `;
  }

  // Calculate general average
  const periodAverages = periods.map(period => quarterlyAverages[period].length > 0
    ? Math.round((quarterlyAverages[period].reduce((a, b) => a + b, 0) / quarterlyAverages[period].length) * 10) / 10
    : 0);
  const overallGenAvg = periodAverages.filter(g => g > 0).length > 0
    ? Math.round((periodAverages.filter(g => g > 0).reduce((a, b) => a + b, 0) / periodAverages.filter(g => g > 0).length) * 10) / 10
    : 0;
  const overallFinalGrade = subjectFinalGrades.length
    ? Math.round((subjectFinalGrades.reduce((sum, grade) => sum + grade, 0) / subjectFinalGrades.length) * 10) / 10
    : 0;

  tableRows += `
    <tr class="rc-avg">
      <td class="rc-area">General Average</td>
      ${periodAverages.map(average => `<td>${average > 0 ? average : '-'}</td>`).join('')}
      <td class="rc-final" style="background:var(--navy); color:#fff;">${overallFinalGrade > 0 ? overallFinalGrade : '-'}</td>
      <td class="rc-remark" style="color:#8be3ae;">${overallGenAvg >= 75 ? 'Passed' : overallGenAvg > 0 ? 'Did Not Meet' : '-'}</td>
    </tr>
  `;

  return `
    <div class="rc-card">
      <div class="rc-head">
        <div class="rc-org">MEFAMDEV-Life · Angat, Bulacan</div>
        <div class="rc-title">Report on Learning Progress and Achievement</div>
        <div class="rc-sub">School Year ${schoolYear || 'N/A'} · ${periodCount === 3 ? 'Terms 1–3' : 'Quarters 1–4'}</div>
      </div>

      <div class="rc-info">
        <div class="rc-info-cell">
          <div class="rc-lbl">Scholar</div>
          <div class="rc-val">${name || 'N/A'}</div>
        </div>
        <div class="rc-info-cell">
          <div class="rc-lbl">Grade / Level</div>
          <div class="rc-val">${gradeLevel || 'N/A'}</div>
        </div>
        <div class="rc-info-cell">
          <div class="rc-lbl">School</div>
          <div class="rc-val">${school || 'N/A'}</div>
        </div>
        <div class="rc-info-cell">
          <div class="rc-lbl">Reference No.</div>
          <div class="rc-val">${refNo || 'N/A'}</div>
        </div>
      </div>

      <div class="rc-table-wrap">
        <table class="rc-table">
          <thead>
            <tr>
              <th style="text-align:left; width:34%;">Learning Areas</th>
              ${periods.map((period, index) => `<th>${periodCount === 3 ? `Term ${index + 1}` : `Q${index + 1}`}</th>`).join('')}
              <th>Final Grade</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>

      <div class="rc-legend">Grading scale: 90–100 Outstanding · 85–89 Very Satisfactory · 80–84 Satisfactory · 75–79 Fairly Satisfactory · Below 75 Did Not Meet Expectations</div>

      <div class="rc-footer">
        <div class="rc-sign">
          <div class="rc-line"><span class="rc-sign-name">Adviser's Signature</span></div>
        </div>
        <div class="rc-sign">
          <div class="rc-line"><span class="rc-sign-name">MEFAMDEV Program Coordinator</span></div>
        </div>
      </div>
    </div>
  `;
}

// CSS for report card
const REPORT_CARD_STYLES = `
  :root {
    --navy: #1a2e44;
    --gold: #f5a623;
    --gold-light: #fdf0d5;
    --green: #27ae60;
    --red: #e74c3c;
    --bg: #f0f3f8;
    --white: #ffffff;
    --border: #d7dde6;
    --text: #2c3e50;
    --muted: #7f8c8d;
    --shadow: 0 2px 14px rgba(26,46,68,.09);
    --radius: 12px;
  }

  .rc-card { background: var(--white); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; margin: 20px 0; }

  .rc-head {
    background: var(--navy); color: #fff; padding: 26px 32px 22px; text-align: center; position: relative;
  }
  .rc-head::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 90% -20%, rgba(255,255,255,.12) 0%, transparent 55%); }
  .rc-head .rc-org { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.55); position: relative; z-index: 1; }
  .rc-head .rc-title { font-family: 'DM Serif Display', serif; font-size: 1.55rem; margin: 6px 0 2px; position: relative; z-index: 1; }
  .rc-head .rc-sub { font-size: .8rem; color: rgba(255,255,255,.65); position: relative; z-index: 1; }

  .rc-info {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .rc-info-cell {
    padding: 14px 20px; border-right: 1px solid var(--border);
  }
  .rc-info-cell:last-child { border-right: none; }
  .rc-info-cell .rc-lbl { font-size: .66rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; margin-bottom: 3px; }
  .rc-info-cell .rc-val { font-size: .9rem; font-weight: 600; color: var(--text); }

  .rc-table-wrap { padding: 24px 28px 8px; }
  table.rc-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
  table.rc-table caption { text-align: left; font-size: .78rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
  table.rc-table th, table.rc-table td { border: 1px solid var(--border); padding: 8px 10px; text-align: center; }
  table.rc-table thead th { background: #f4f6fa; color: var(--navy); font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; }
  table.rc-table td.rc-area { text-align: left; font-weight: 600; color: var(--text); }
  table.rc-table td.rc-sub { text-align: left; padding-left: 24px; font-weight: 400; color: var(--muted); font-size: .8rem; }
  table.rc-table td.rc-grade { font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
  table.rc-table tr.rc-group-head td { background: #fafbfd; }
  table.rc-table td.rc-final { font-weight: 700; color: var(--navy); background: #f8f5ea; }
  table.rc-table td.rc-remark { font-size: .74rem; font-weight: 600; }
  .remark-pass { color: var(--green); }
  .remark-pending { color: var(--muted); }
  tr.rc-avg td, tr.rc-avg td.rc-area { background: var(--navy); color: #fff !important; font-weight: 700; font-size: .86rem; }
  tr.rc-avg td.rc-area { text-transform: uppercase; letter-spacing: .04em; font-size: .74rem; }
  tr.rc-avg td.rc-remark { color: #8be3ae !important; }

  .rc-legend { padding: 6px 28px 20px; font-size: .72rem; color: var(--muted); }

  .rc-footer {
    display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
    padding: 22px 32px 28px; border-top: 1px solid var(--border);
  }
  .rc-sign { text-align: center; }
  .rc-sign .rc-line { border-top: 1px solid var(--text); margin-top: 34px; padding-top: 6px; font-size: .74rem; color: var(--muted); }
  .rc-sign .rc-sign-name { font-weight: 700; font-size: .85rem; color: var(--text); }

  @media (max-width: 700px) {
    .rc-info { grid-template-columns: repeat(2, 1fr); }
    table.rc-table { font-size: .72rem; }
    table.rc-table td.rc-sub { padding-left: 14px; }
    .rc-footer { grid-template-columns: 1fr; }
  }

  @media print {
    @page { size: auto; margin: 8mm 10mm; }
    .rc-card { box-shadow: none; border: 1px solid var(--border); }
    .rc-head { padding: 16px 20px 14px; }
    .rc-title { font-size: 1.2rem; }
    .rc-table-wrap { padding: 14px 18px 4px; }
    table.rc-table th, table.rc-table td { padding: 5px 7px; font-size: .72rem; }
    .rc-footer { padding: 14px 20px 18px; }
  }
`;

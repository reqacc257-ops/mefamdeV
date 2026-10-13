const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('report card escapes untrusted scholar and grade fields', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'components', 'report-card.js'), 'utf8');
  const context = {};
  vm.runInNewContext(`${source}\nglobalThis.renderReportCard = buildReportCardHTML;`, context);

  const payload = `<img src=x onerror="alert(1)"> & '`;
  const html = context.renderReportCard({
    name: payload,
    gradeLevel: payload,
    school: payload,
    refNo: payload,
    schoolYear: payload
  }, [{
    subject: payload,
    quarter: 1,
    grade_val: payload
  }]);

  const escapedPayload = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;';
  assert.equal(html.split(escapedPayload).length - 1, 7);
  assert.doesNotMatch(html, /<img\b/i);
});

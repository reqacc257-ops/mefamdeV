const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./server');

const server = app.listen(3101, () => {
  const token = jwt.sign({ type: 'applicant', appId: 1, name: 'Test Applicant' }, 'mefamdev-secret-change-in-production');
  const req = http.request({
    hostname: '127.0.0.1',
    port: 3101,
    path: '/api/documents/1',
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('status', res.statusCode);
      console.log(data);
      server.close();
    });
  });

  req.on('error', (err) => {
    console.error(err);
    server.close();
  });

  req.end();
});

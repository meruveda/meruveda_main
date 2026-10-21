const https = require('https');

const options = {
  hostname: 'meruvedawellness.com',
  path: '/api/migration/migrate-007',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-migration-token': 'super-secret-migration-token-123'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.write(JSON.stringify({}));
req.end();
// Carrega o arquivo .env (Node 20.12+), se existir.
const path = require('path');
const fs = require('fs');
const file = path.join(__dirname, '..', '.env');
if (fs.existsSync(file)) process.loadEnvFile(file);

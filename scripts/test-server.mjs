import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testScriptPath = path.join(__dirname, '..', 'test', 'server.test.js');

const result = spawnSync('node', [testScriptPath], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

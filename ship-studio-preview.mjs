import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.mjs';
import { createLocalServer } from './src/http/server.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const api = createLocalServer({ app: createApp(), staticRoot: path.join(root, 'app'), port: Number(process.env.PORT || 4173) });
await api.listen();
console.log(`Ancrage local : http://127.0.0.1:${api.server.address().port}`);

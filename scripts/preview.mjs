import { fileURLToPath } from 'node:url';
import { createStaticServer } from './server.mjs';
const port = Number(process.argv[2] || 4173);
// fileURLToPath gives a correct folder path on Windows too (URL.pathname would start with /C:/).
const server = createStaticServer(fileURLToPath(new URL('../dist/', import.meta.url)));
server.listen(port, '0.0.0.0', () => console.log(`Nuntio preview: http://localhost:${port}`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());

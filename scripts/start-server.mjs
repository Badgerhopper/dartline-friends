/* Railway HTTPS reverse proxy -> local HTTP and WebSockets. */
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const port = Number.parseInt(process.env.PORT || '3000', 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid PORT'); process.exit(1);
}
const raw = process.env.PUBLIC_ORIGIN || process.env.RAILWAY_PUBLIC_DOMAIN || '';
let origin = null;
if (raw) {
  try {
    const url = new URL(raw.startsWith('https://') ? raw : 'https://' + raw);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || !url.hostname) throw Error();
    origin = url.origin;
  } catch {
    console.error('Invalid PUBLIC_ORIGIN/RAILWAY_PUBLIC_DOMAIN'); process.exit(1);
  }
}
const config = {
  server: { http: { enabled: true, port }, https: { enabled: false }, allowedOrigins: origin ? [origin] : null, maxMatches: 128, maxPlayersPerMatch: 8 },
  media: { iceUrls: ['stun:stun.l.google.com:19302'] },
};
writeFileSync('/app/instadarts.config.json', JSON.stringify(config, null, 2));
console.log('DartLine listening on ' + port);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/start.ts'], { stdio: 'inherit', cwd: '/app', env: process.env });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on('error', err => { console.error(err); process.exit(1); });

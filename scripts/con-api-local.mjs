// Lanza `node <args>` con NODE_TLS_REJECT_UNAUTHORIZED=0, SOLO para pruebas contra el API local
// (https://factusmart.test usa un certificado propio). Nunca uses esto contra producción.
import { spawnSync } from 'node:child_process'

const r = spawnSync(process.execPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_NO_WARNINGS: '1' },
})
process.exit(r.status ?? 1)

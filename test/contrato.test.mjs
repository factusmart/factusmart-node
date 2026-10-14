// Prueba de contrato: cada operationId del openapi.yaml oficial debe tener su método en el SDK.
// Si el API crece y nadie actualiza el SDK, esta prueba falla.
// Ruta del yaml: variable FACTUSMART_OPENAPI o la copia en test/fixtures/openapi.yaml.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { FactuSmart } from '../dist/index.js'

const RUTA_YAML = process.env.FACTUSMART_OPENAPI || new URL('./fixtures/openapi.yaml', import.meta.url)

/** operationId → ruta del método en el SDK (DISENO_SDK.md). */
export const METODOS = {
  ping: 'ping',
  getAccount: 'cuenta.saldo',
  listSeries: 'series.listar',
  emitDocument: 'comprobantes.emitir',
  listDocuments: 'comprobantes.listar',
  getDocument: 'comprobantes.consultar',
  downloadDocumentFile: 'comprobantes.descargar',
  resendDocument: 'comprobantes.reenviar',
  querySunatStatus: 'comprobantes.consultarSunat',
  getDocumentHistory: 'comprobantes.historial',
  voidDocument: 'anulaciones.crear',
  getVoidStatus: 'anulaciones.estado',
  emitDispatchGuide: 'guias.emitir',
  getDispatchGuideStatus: 'guias.estado',
  listRucs: 'rucs.listar',
  createRuc: 'rucs.crear',
  setRucActivation: 'rucs.activar',
  calculateDocument: 'comprobantes.calcular',
  listCatalogs: 'catalogos.listar',
  getCatalog: 'catalogos.consultar',
  // Webhook (sección `webhooks` del yaml): lo manda el API; el SDK solo verifica la firma (método estático).
  webhookComprobanteEstado: 'FactuSmart.verificarFirmaWebhook',
}

test('contrato: todos los operationId del openapi.yaml tienen método en el SDK', { skip: !existsSync(RUTA_YAML) && `no existe ${RUTA_YAML}` }, () => {
  const yaml = readFileSync(RUTA_YAML, 'utf8')
  const ids = [...yaml.matchAll(/^\s*operationId:\s*['"]?([A-Za-z0-9_]+)['"]?\s*$/gm)].map((m) => m[1])
  assert.ok(ids.length > 0, 'no se encontró ningún operationId en el yaml')

  const fs = new FactuSmart({ apiKey: 'x', baseUrl: 'https://ejemplo.test/api/v1/issuer' })
  const faltan = []
  for (const id of ids) {
    const ruta = METODOS[id]
    if (!ruta) {
      faltan.push(`${id} (sin método asignado en el SDK)`)
      continue
    }
    // 'FactuSmart.x' = método estático de la clase; lo demás, método de una instancia.
    const [raiz, partes] = ruta.startsWith('FactuSmart.') ? [FactuSmart, ruta.split('.').slice(1)] : [fs, ruta.split('.')]
    const fn = partes.reduce((o, k) => (o == null ? undefined : o[k]), raiz)
    if (typeof fn !== 'function') faltan.push(`${id} → ${ruta} (no existe)`)
  }
  assert.deepEqual(faltan, [], `operationId sin método en el SDK:\n  ${faltan.join('\n  ')}`)

  const sobran = Object.keys(METODOS).filter((id) => !ids.includes(id))
  assert.deepEqual(sobran, [], `métodos del SDK cuyo operationId ya no está en el yaml: ${sobran.join(', ')}`)
  console.log(`  ${ids.length} operationId verificados contra ${RUTA_YAML}`)
})

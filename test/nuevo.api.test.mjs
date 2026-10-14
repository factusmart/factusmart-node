// Pruebas contra el API LOCAL solo de lo nuevo de 1.1.0 (anexos, PDF por formato, código de producto
// SUNAT). NO emite nada ni crea locales: solo lee. Corre con: npm run test:api:nuevo
// (el script define NODE_TLS_REJECT_UNAUTHORIZED=0 porque https://factusmart.test usa un certificado propio).
//
// Variables opcionales: FACTUSMART_BASE_URL, FACTUSMART_API_KEY, FACTUSMART_RUC.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FactuSmart, ErrorDeValidacion } from '../dist/index.js'

const BASE_URL = process.env.FACTUSMART_BASE_URL || 'https://factusmart.test/api/v1/issuer'
const API_KEY = process.env.FACTUSMART_API_KEY || 'test_apikey_demo_123'
const RUC = process.env.FACTUSMART_RUC || '20777666555'

if (/factusmart\.pe/i.test(BASE_URL)) throw new Error('Estas pruebas no se corren contra producción.')

const fs = new FactuSmart({ apiKey: API_KEY, baseUrl: BASE_URL, ruc: RUC, verificarSsl: false })

test('10. establecimientos.listar() trae establecimientos con codigo_anexo y series', async () => {
  const r = await fs.establecimientos.listar()
  assert.equal(r.success, true)
  assert.ok(Array.isArray(r.establecimientos), 'falta establecimientos[]')
  assert.ok(r.establecimientos.length > 0, 'el RUC debería tener al menos su local principal')
  for (const e of r.establecimientos) {
    assert.match(e.codigo_anexo, /^\d{4}$/)
    assert.equal(typeof e.predeterminado, 'boolean')
    assert.ok(Array.isArray(e.series))
  }
})

test('11. descargar(pdf, formato ticket58) de un comprobante existente empieza con %PDF (sin emitir)', async () => {
  const lista = await fs.comprobantes.listar({ limite: 1 })
  assert.equal(lista.success, true)
  assert.ok(lista.comprobantes.length > 0, 'no hay comprobantes en el RUC demo para descargar')
  const id = lista.comprobantes[0].external_id
  const pdf = await fs.comprobantes.descargar(id, 'pdf', { formato: 'ticket58' })
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF')

  // Validación local: no llega al API.
  await assert.rejects(fs.comprobantes.descargar(id, 'xml', { formato: 'ticket' }), ErrorDeValidacion)
})

test('12. catalogos.buscarProductoSunat("computador") trae 43211503', async () => {
  const r = await fs.catalogos.buscarProductoSunat('computador', { limite: 50 })
  assert.equal(r.success, true)
  assert.equal(r.catalogo_sunat, '25')
  assert.ok(Array.isArray(r.datos))
  assert.ok(r.datos.length <= 50)
  assert.ok(r.datos.some((d) => d.codigo === '43211503'), `no vino 43211503: ${r.datos.map((d) => d.codigo).join(', ')}`)
})

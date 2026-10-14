// Pruebas obligatorias contra el API LOCAL (nunca producción). Corre con: npm run test:api
// Gasta 2 créditos por corrida (boleta + prueba de idempotencia). El script de npm define
// NODE_TLS_REJECT_UNAUTHORIZED=0 porque https://factusmart.test usa un certificado propio.
//
// Variables opcionales: FACTUSMART_BASE_URL, FACTUSMART_API_KEY, FACTUSMART_RUC.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { FactuSmart, ErrorDeAutenticacion, ErrorDeValidacion, NoEncontrado } from '../dist/index.js'

const BASE_URL = process.env.FACTUSMART_BASE_URL || 'https://factusmart.test/api/v1/issuer'
const API_KEY = process.env.FACTUSMART_API_KEY || 'test_apikey_demo_123'
// DISENO_SDK.md indica 20000000000, pero ese RUC no está enlazado a la cuenta local
// (el API responde 403). 20777666555 es un RUC demo activo de la misma cuenta.
const RUC = process.env.FACTUSMART_RUC || '20777666555'

if (/factusmart\.pe/i.test(BASE_URL)) throw new Error('Estas pruebas no se corren contra producción.')

const nuevoCliente = (extra = {}) => new FactuSmart({ apiKey: API_KEY, baseUrl: BASE_URL, ruc: RUC, verificarSsl: false, ...extra })
const fs = nuevoCliente()

/** Boleta pequeña a un cliente con DNI (nombre enviado para no depender de RENIEC). */
function boleta(descripcion) {
  const { items, totales } = FactuSmart.calcularComprobante([
    { codigo_interno: 'SDK-NODE-01', descripcion, cantidad: 2, valor_unitario: 12.5, afectacion: '10' },
  ])
  return {
    codigo_tipo_documento: '03',
    datos_del_cliente_o_receptor: {
      codigo_tipo_documento_identidad: '1',
      numero_documento: '12345678',
      apellidos_y_nombres_o_razon_social: 'CLIENTE PRUEBA SDK NODE',
    },
    items,
    totales,
  }
}

let emitido = null

test('1. ping() responde', async () => {
  const r = await fs.ping()
  assert.equal(r.success, true)
  assert.equal(r.ruc_emisor, RUC)
  assert.equal(typeof r.creditos, 'number')
})

test('2. cuenta.saldo() trae creditos_disponibles', async () => {
  const r = await fs.cuenta.saldo()
  assert.equal(r.success, true)
  assert.equal(typeof r.creditos_disponibles, 'number')
  assert.ok(r.creditos_disponibles > 0, 'la cuenta local no tiene créditos')
})

test('3. emitir una boleta (03) con calcularComprobante → aceptada y en entorno prueba', async () => {
  const r = await fs.comprobantes.emitir(boleta('Prueba SDK Node - boleta'))
  emitido = r
  assert.equal(r.success, true)
  assert.match(r.serie_numero, /^B\w{3}-\d+$/)
  assert.equal(r.entorno, 'prueba')
  assert.equal(r.tiene_validez_fiscal, false)
  assert.equal(r.aceptado_por_sunat, true, `SUNAT beta no aceptó: estado ${r.estado}, ${JSON.stringify(r.sunat)}`)
})

test('4. consultar, historial y descargar PDF del comprobante emitido', async () => {
  assert.ok(emitido, 'la prueba 3 no emitió nada')
  const c = await fs.comprobantes.consultar(emitido.external_id)
  assert.equal(c.external_id, emitido.external_id)
  assert.equal(c.serie_numero, emitido.serie_numero)
  assert.ok(c.links && c.links.pdf)

  const h = await fs.comprobantes.historial(emitido.external_id)
  assert.equal(h.external_id, emitido.external_id)
  assert.ok(Array.isArray(h.historial) && h.historial.length > 0)

  const pdf = await fs.comprobantes.descargar(emitido.external_id, 'pdf')
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF')
})

test('5. idempotencia: misma idempotencyKey dos veces → mismo external_id y el saldo baja solo 1', async () => {
  const clave = `sdk-node-${randomUUID()}`
  const antes = (await fs.cuenta.saldo()).creditos_disponibles
  const datos = boleta('Prueba SDK Node - idempotencia')
  const r1 = await fs.comprobantes.emitir(datos, { idempotencyKey: clave })
  const r2 = await fs.comprobantes.emitir(datos, { idempotencyKey: clave })
  const despues = (await fs.cuenta.saldo()).creditos_disponibles
  assert.equal(r2.external_id, r1.external_id)
  assert.equal(r2.serie_numero, r1.serie_numero)
  assert.equal(antes - despues, 1, `el saldo bajó ${antes - despues} (antes ${antes}, después ${despues})`)
})

test('6. apiKey falsa → ErrorDeAutenticacion con codigo NO_AUTENTICADO',async () => {
  const falso = nuevoCliente({ apiKey: 'llave_falsa_que_no_existe' })
  await assert.rejects(falso.ping(), (e) => {
    assert.ok(e instanceof ErrorDeAutenticacion, `fue ${e.constructor.name}: ${e.message}`)
    assert.equal(e.status, 401)
    assert.equal(e.codigo, 'NO_AUTENTICADO')
    assert.equal(e.reintentable, false)
    return true
  })
})

test('7. payload inválido → ErrorDeValidacion con mensaje legible (y no cobra)', async () => {
  const datos = { ...boleta('Prueba SDK Node - inválida'), serie_documento: 'ZZ99' }
  await assert.rejects(fs.comprobantes.emitir(datos), (e) => {
    assert.ok(e instanceof ErrorDeValidacion, `fue ${e.constructor.name} (${e.status}): ${e.message}`)
    assert.equal(e.status, 422)
    assert.equal(typeof e.mensaje, 'string')
    assert.ok(e.mensaje.length > 10 && !e.mensaje.includes('[object'), `mensaje poco legible: ${e.mensaje}`)
    console.log(`  mensaje del API: ${e.mensaje}`)
    return true
  })

  // Validación Laravel (mapa de campos) también legible
  await assert.rejects(fs.comprobantes.listar({ limite: 500 }), (e) => {
    assert.ok(e instanceof ErrorDeValidacion, `fue ${e.constructor.name} (${e.status}): ${e.message}`)
    assert.ok(/limite/i.test(e.mensaje), e.mensaje)
    assert.equal(e.codigo, 'DATOS_INVALIDOS')
    assert.ok(Array.isArray(e.campos.limite) && e.campos.limite.length > 0, JSON.stringify(e.campos))
    console.log(`  mensaje del API (listar): ${e.mensaje}`)
    return true
  })
})

// 8. (contrato) está en test/contrato.test.mjs
// 9. (calcularComprobante caso común) está en test/unit.test.mjs

test('extra: series.listar, comprobantes.listar y rucs.listar responden', async () => {
  const s = await fs.series.listar()
  assert.ok(s.series.some((x) => x.codigo_tipo_documento === '03'))
  const l = await fs.comprobantes.listar({ limite: 2 })
  assert.ok(Array.isArray(l.comprobantes))
  assert.ok(l.comprobantes.length <= 2)
  const r = await fs.rucs.listar()
  assert.ok(r.rucs.some((x) => x.ruc === RUC))
})

test('extra: descargar un external_id inexistente → NoEncontrado con codigo NO_ENCONTRADO (404 JSON)', async () => {
  const inexistente = '00000000-0000-4000-8000-000000000000'
  await assert.rejects(fs.comprobantes.descargar(inexistente, 'pdf'), (e) => {
    assert.ok(e instanceof NoEncontrado, `fue ${e.constructor.name} (${e.status}): ${e.message}`)
    assert.equal(e.status, 404)
    assert.equal(e.codigo, 'NO_ENCONTRADO', `codigo recibido: ${e.codigo}`)
    assert.equal(e.reintentable, false)
    assert.ok(e.mensaje.length > 0 && !/<html/i.test(e.mensaje), e.mensaje)
    console.log(`  mensaje del API (descarga): ${e.mensaje}`)
    return true
  })
})

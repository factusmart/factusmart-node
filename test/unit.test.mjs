// Pruebas sin red: se inyecta un fetch falso. Corre con: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import FactuSmartDefault, {
  FactuSmart,
  calcularComprobante,
  redondear2,
  fechaHoraPeru,
  FactuSmartError,
  ErrorDeAutenticacion,
  SinCreditos,
  RucNoAutorizado,
  NoEncontrado,
  ErrorDeValidacion,
  LimiteDePeticiones,
  verificarFirmaWebhook,
  CODIGOS_DE_ERROR,
} from '../dist/index.js'

const BASE = 'https://api.ejemplo.test/api/v1/issuer'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** fetch falso: responde en orden la lista de respuestas y guarda cada llamada. */
function fetchFalso(respuestas) {
  const llamadas = []
  const fn = async (url, init = {}) => {
    llamadas.push({ url: String(url), init, cuerpo: init.body ? JSON.parse(init.body) : undefined, cabeceras: init.headers })
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)]
    if (r instanceof Error) throw r
    const { status = 200, cuerpo = {}, cabeceras = {} } = r
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)
    return new Response(status === 204 ? null : texto, { status, headers: cabeceras })
  }
  fn.llamadas = llamadas
  return fn
}

function cliente(respuestas, extra = {}) {
  const fetch = fetchFalso(respuestas)
  const esperas = []
  const fs = new FactuSmart({
    apiKey: 'k_prueba',
    baseUrl: BASE + '/',
    ruc: '20123456789',
    fetch,
    dormir: async (ms) => {
      esperas.push(ms)
    },
    ...extra,
  })
  return { fs, fetch, esperas }
}

const EMISION_OK = {
  success: true,
  estado: '05',
  estado_descripcion: 'Aceptado',
  serie_numero: 'BA01-1',
  external_id: '9822f52c-108e-47ff-9d2e-5f0c3c1a7b11',
  creditos_restantes: 10,
  aceptado_por_sunat: true,
  entorno: 'prueba',
  tiene_validez_fiscal: false,
}

const DATOS = () => ({
  codigo_tipo_documento: '03',
  datos_del_cliente_o_receptor: { codigo_tipo_documento_identidad: '1', numero_documento: '12345678' },
  ...calcularComprobante([{ descripcion: 'X', cantidad: 1, valor_unitario: 50, afectacion: '10' }]),
})

// ───────────── Constructor y exportaciones ─────────────

test('exporta la clase como default y nombrada, y el ayudante suelto y estático', () => {
  assert.equal(FactuSmartDefault, FactuSmart)
  assert.equal(typeof FactuSmart.calcularComprobante, 'function')
  const x = [{ descripcion: 'X', cantidad: 1, valor_unitario: 50, afectacion: '10' }]
  assert.deepEqual(FactuSmart.calcularComprobante(x), calcularComprobante(x))
})

test('la versión CommonJS también se puede requerir', () => {
  const require = createRequire(import.meta.url)
  const cjs = require('../dist/index.cjs')
  assert.equal(typeof cjs.FactuSmart, 'function')
  assert.equal(cjs.default, cjs.FactuSmart)
  assert.equal(typeof cjs.calcularComprobante, 'function')
  assert.equal(typeof cjs.ErrorDeValidacion, 'function')
})

test('sin apiKey o sin baseUrl lanza un error claro en español', () => {
  assert.throws(() => new FactuSmart({ baseUrl: BASE }), (e) => e instanceof FactuSmartError && /Falta apiKey/.test(e.message))
  assert.throws(() => new FactuSmart({ apiKey: 'x' }), (e) => e instanceof FactuSmartError && /Falta baseUrl/.test(e.message))
})

test('quita la barra final de baseUrl y manda X-API-Key + Accept JSON', async () => {
  const { fs, fetch } = cliente([{ cuerpo: { success: true, message: 'ok', cuenta: 'c', creditos: 1 } }])
  await fs.ping()
  assert.equal(fetch.llamadas[0].url, `${BASE}/ping?ruc=20123456789`)
  assert.equal(fetch.llamadas[0].cabeceras['X-API-Key'], 'k_prueba')
  assert.equal(fetch.llamadas[0].cabeceras.Accept, 'application/json')
})

// ───────────── Envío del RUC y valores por defecto ─────────────

test('GET manda el RUC como query; se puede sobreescribir por llamada', async () => {
  const { fs, fetch } = cliente([{ cuerpo: { success: true, comprobantes: [], siguiente_cursor: null } }])
  await fs.comprobantes.listar({ estado: '01', limite: 5 }, { ruc: '20999999999' })
  const url = new URL(fetch.llamadas[0].url)
  assert.equal(url.pathname, '/api/v1/issuer/documents')
  assert.equal(url.searchParams.get('ruc'), '20999999999')
  assert.equal(url.searchParams.get('estado'), '01')
  assert.equal(url.searchParams.get('limite'), '5')
})

test('emitir completa los valores por defecto y respeta lo que manda el usuario', async () => {
  const { fs, fetch } = cliente([{ cuerpo: EMISION_OK }, { cuerpo: EMISION_OK }])
  await fs.comprobantes.emitir(DATOS())
  const c = fetch.llamadas[0].cuerpo
  assert.equal(fetch.llamadas[0].init.method, 'POST')
  assert.equal(c.ruc, '20123456789')
  assert.equal(c.numero_documento, '#')
  assert.equal(c.codigo_tipo_operacion, '0101')
  assert.equal(c.codigo_tipo_moneda, 'PEN')
  const peru = fechaHoraPeru()
  assert.equal(c.fecha_de_emision, peru.fecha)
  assert.match(c.hora_de_emision, /^\d{2}:\d{2}:\d{2}$/)

  await fs.comprobantes.emitir({ ...DATOS(), ruc: '20555555555', numero_documento: '77', codigo_tipo_moneda: 'USD', fecha_de_emision: '2026-01-02', hora_de_emision: '08:00:00' })
  const c2 = fetch.llamadas[1].cuerpo
  assert.equal(c2.ruc, '20555555555')
  assert.equal(c2.numero_documento, '77')
  assert.equal(c2.codigo_tipo_moneda, 'USD')
  assert.equal(c2.fecha_de_emision, '2026-01-02')
  assert.equal(c2.hora_de_emision, '08:00:00')
})

test('la fecha/hora por defecto es la de Perú (UTC-5), no la de la máquina', () => {
  // 2026-01-01 03:30 UTC = 2025-12-31 22:30 en Lima
  assert.deepEqual(fechaHoraPeru(new Date('2026-01-01T03:30:00Z')), { fecha: '2025-12-31', hora: '22:30:00' })
})

test('los endpoints /rucs nunca agregan el RUC emisor', async () => {
  const { fs, fetch } = cliente([{ cuerpo: { success: true, ruc: '20609999991', activo: false, mensaje: 'ok' } }])
  await fs.rucs.activar('20609999991', false)
  assert.equal(fetch.llamadas[0].init.method, 'PATCH')
  assert.ok(fetch.llamadas[0].url.endsWith('/rucs/20609999991/activation'))
  assert.deepEqual(fetch.llamadas[0].cuerpo, { activo: false })
})

// ───────────── Idempotencia y reintentos ─────────────

test('emitir: los reintentos reusan la MISMA Idempotency-Key generada (UUID v4)', async () => {
  const { fs, fetch, esperas } = cliente([
    new TypeError('fetch failed'),
    { status: 503, cuerpo: { success: false, message: 'Servicio no disponible' } },
    { status: 409, cuerpo: { success: false, message: 'Ya hay una emisión en curso con esa Idempotency-Key.' } },
    { cuerpo: EMISION_OK },
  ])
  const r = await fs.comprobantes.emitir(DATOS())
  assert.equal(r.external_id, EMISION_OK.external_id)
  assert.equal(fetch.llamadas.length, 4)
  const claves = fetch.llamadas.map((l) => l.cabeceras['Idempotency-Key'])
  assert.match(claves[0], UUID_V4)
  assert.equal(new Set(claves).size, 1, 'todas las llamadas deben llevar la misma clave')
  assert.deepEqual(esperas, [1000, 2000, 4000], 'espera creciente 1 s, 2 s, 4 s')
})

test('emitir: usa la Idempotency-Key del usuario y cada emisión nueva genera otra clave', async () => {
  const { fs, fetch } = cliente([{ status: 502, cuerpo: 'Bad Gateway' }, { cuerpo: EMISION_OK }])
  await fs.comprobantes.emitir(DATOS(), { idempotencyKey: 'venta-123' })
  assert.deepEqual(fetch.llamadas.map((l) => l.cabeceras['Idempotency-Key']), ['venta-123', 'venta-123'])

  const otro = cliente([{ cuerpo: EMISION_OK }])
  await otro.fs.comprobantes.emitir(DATOS())
  await otro.fs.comprobantes.emitir(DATOS())
  const [a, b] = otro.fetch.llamadas.map((l) => l.cabeceras['Idempotency-Key'])
  assert.notEqual(a, b)
})

test('agotados los reintentos lanza el último error', async () => {
  const { fs, fetch } = cliente([{ status: 503, cuerpo: { success: false, message: 'caído' } }], { maxReintentos: 2 })
  await assert.rejects(fs.cuenta.saldo(), (e) => e instanceof FactuSmartError && e.status === 503 && e.mensaje === 'caído')
  assert.equal(fetch.llamadas.length, 3)
})

test('NO reintenta reenviar, consultarSunat, anulaciones.crear, guias.emitir ni rucs.activar', async () => {
  const casos = [
    (fs) => fs.comprobantes.reenviar('abc'),
    (fs) => fs.comprobantes.consultarSunat('abc'),
    (fs) => fs.anulaciones.crear({ fecha_de_emision_de_documentos: '08-07-2026', documentos: [] }),
    (fs) => fs.guias.emitir({ serie_documento: 'TA01', codigo_tipo_documento: '09', datos_del_emisor: { codigo_del_domicilio_fiscal: '0000' }, items: [] }),
    (fs) => fs.rucs.activar('20609999991', true),
  ]
  for (const llamar of casos) {
    const { fs, fetch } = cliente([{ status: 503, cuerpo: { success: false, message: 'caído' } }, { cuerpo: { success: true } }])
    await assert.rejects(llamar(fs), FactuSmartError)
    assert.equal(fetch.llamadas.length, 1)
  }
  // guias.emitir no manda Idempotency-Key
  const { fs, fetch } = cliente([{ cuerpo: { success: true } }])
  await fs.guias.emitir({ serie_documento: 'TA01', codigo_tipo_documento: '09', datos_del_emisor: { codigo_del_domicilio_fiscal: '0000' }, items: [] })
  assert.equal(fetch.llamadas[0].cabeceras['Idempotency-Key'], undefined)
})

test('409 NO se reintenta fuera de emitir (ej. rucs.crear con RUC de otra cuenta)', async () => {
  const { fs, fetch } = cliente([{ status: 409, cuerpo: { success: false, message: 'Ese RUC ya está registrado en el sistema (con otra cuenta).' } }])
  await assert.rejects(fs.rucs.crear({ ruc: '20609999991', empresa: 'X', correo: 'a@b.pe', clave: '123456' }), (e) => e.status === 409)
  assert.equal(fetch.llamadas.length, 1)
})

test('429 respeta el header Retry-After', async () => {
  const { fs, fetch, esperas } = cliente([
    { status: 429, cuerpo: { success: false, message: 'Too Many Attempts.' }, cabeceras: { 'Retry-After': '7' } },
    { cuerpo: { success: true, message: 'ok', cuenta: 'c', creditos: 1 } },
  ])
  await fs.ping()
  assert.equal(fetch.llamadas.length, 2)
  assert.deepEqual(esperas, [7000])
})

test('429 sin Retry-After usa el "Espera N segundos" del mensaje', async () => {
  const { fs, esperas } = cliente([
    { status: 429, cuerpo: { success: false, message: 'Límite alcanzado. Espera 12 segundos.' } },
    { cuerpo: EMISION_OK },
  ])
  await fs.comprobantes.emitir(DATOS())
  assert.deepEqual(esperas, [12000])
})

test('500 "Too Many Attempts." (como responde hoy el API) cuenta como límite y se reintenta', async () => {
  const { fs, fetch } = cliente([
    { status: 500, cuerpo: { success: false, message: 'Too Many Attempts.', file: '/x.php', line: 200 } },
    { cuerpo: { success: true, series: [] } },
  ])
  await fs.series.listar()
  assert.equal(fetch.llamadas.length, 2)

  const sinReintentos = cliente([{ status: 500, cuerpo: { success: false, message: 'Too Many Attempts.' } }], { maxReintentos: 0 })
  await assert.rejects(sinReintentos.fs.ping(), (e) => e instanceof LimiteDePeticiones && e.status === 500)
})

// ───────────── Errores ─────────────

test('mapeo HTTP → clase de error, con status, mensaje y respuesta', async () => {
  const casos = [
    [401, { success: false, message: 'API key inválida o cuenta desactivada.' }, ErrorDeAutenticacion],
    [402, { success: false, message: 'Sin créditos disponibles en la cuenta.', creditos_restantes: 0 }, SinCreditos],
    [403, { success: false, message: 'El RUC indicado no pertenece a esta cuenta o no existe.' }, RucNoAutorizado],
    [404, { success: false, message: 'Comprobante no encontrado.' }, NoEncontrado],
    [422, { success: false, message: 'Datos del comprobante inválidos o incompletos.' }, ErrorDeValidacion],
    [429, { success: false, message: 'Too Many Attempts.' }, LimiteDePeticiones],
    [500, { success: false, message: 'Error interno' }, FactuSmartError],
  ]
  for (const [status, cuerpo, Clase] of casos) {
    const { fs } = cliente([{ status, cuerpo }], { maxReintentos: 0 })
    await assert.rejects(fs.comprobantes.consultar('abc'), (e) => {
      assert.ok(e instanceof Clase, `${status} debe ser ${Clase.name}, fue ${e.constructor.name}`)
      assert.ok(e instanceof FactuSmartError)
      assert.equal(e.status, status)
      assert.equal(e.mensaje, cuerpo.message)
      assert.equal(e.message, cuerpo.message)
      assert.deepEqual(e.respuesta, cuerpo)
      return true
    })
  }
})

test('422 de validación Laravel (mapa de campos) da un mensaje legible y expone `errores`', async () => {
  const mapa = { limite: ['El campo limite no debe ser mayor que 100.'], desde: ['No es una fecha válida.'] }
  const { fs } = cliente([{ status: 422, cuerpo: mapa }])
  await assert.rejects(fs.comprobantes.listar({ limite: 500 }), (e) => {
    assert.ok(e instanceof ErrorDeValidacion)
    assert.equal(e.mensaje, 'limite: El campo limite no debe ser mayor que 100. | desde: No es una fecha válida.')
    assert.deepEqual(e.errores, mapa)
    return true
  })
  // Variante sin Accept JSON: el mapa viene dentro de `message`
  const { fs: fs2 } = cliente([{ status: 422, cuerpo: { success: false, message: mapa, file: 'x', line: 1 } }])
  await assert.rejects(fs2.rucs.activar('20609999991', true), (e) => e instanceof ErrorDeValidacion && e.errores?.limite?.length === 1)
})

test('error de red sin reintentos restantes lanza FactuSmartError con status 0', async () => {
  const { fs } = cliente([new TypeError('fetch failed')], { maxReintentos: 0 })
  await assert.rejects(fs.ping(), (e) => e instanceof FactuSmartError && e.status === 0 && /No se pudo conectar/.test(e.mensaje))
})

test('HTTP 200 con aceptado_por_sunat=false NO lanza: se devuelve tal cual', async () => {
  const rechazado = {
    ...EMISION_OK,
    estado: '01',
    estado_descripcion: 'Registrado',
    aceptado_por_sunat: false,
    sunat: { codigo: '2800', descripcion: 'SUNAT no respondió' },
    accion_requerida: 'Reintenta con /reenviar',
  }
  const { fs } = cliente([{ cuerpo: rechazado }])
  const r = await fs.comprobantes.emitir(DATOS())
  assert.deepEqual(r, rechazado)
  assert.equal(r.aceptado_por_sunat, false)
})

// ───────────── Descargas ─────────────

test('descargar devuelve un Buffer; 404 en HTML (servidor anterior) → NoEncontrado; tipo inválido → error', async () => {
  const pdf = '%PDF-1.4 falso'
  const { fs, fetch } = cliente([{ cuerpo: pdf, cabeceras: { 'Content-Type': 'application/pdf' } }])
  const b = await fs.comprobantes.descargar('abc', 'pdf')
  assert.ok(Buffer.isBuffer(b))
  assert.equal(b.toString('latin1'), pdf)
  assert.ok(fetch.llamadas[0].url.endsWith('/documents/abc/pdf?ruc=20123456789'))

  const { fs: fs2 } = cliente([{ status: 404, cuerpo: '<html><body>No encontrado</body></html>', cabeceras: { 'Content-Type': 'text/html' } }])
  await assert.rejects(fs2.comprobantes.descargar('abc', 'cdr'), (e) => e instanceof NoEncontrado && e.status === 404)

  await assert.rejects(fs.comprobantes.descargar('abc', 'zip'), FactuSmartError)
})

// ───────────── calcularComprobante ─────────────

test('redondear2 redondea mitad hacia arriba sin el error de coma flotante', () => {
  assert.equal(redondear2(10.555 * 3), 31.67) // Math.round(n*100)/100 daría 31.66
  assert.equal(redondear2(1.005), 1.01)
  assert.equal(redondear2(2.675), 2.68)
  assert.equal(redondear2(-1.005), -1.01)
  assert.equal(redondear2(0.1 + 0.2), 0.3)
  assert.equal(redondear2(5.7006), 5.7)
})

test('calcularComprobante: caso común del diseño (igual que resultado_caso_comun.json)', () => {
  const r = calcularComprobante([
    { descripcion: 'A', cantidad: 3, valor_unitario: 10.555, afectacion: '10' },
    { descripcion: 'B', cantidad: 2, valor_unitario: 5, afectacion: '20' },
    { descripcion: 'C', cantidad: 1, valor_unitario: 7.1, afectacion: '30' },
    { descripcion: 'D', cantidad: 1, valor_unitario: 100, afectacion: '40' },
  ])
  assert.deepEqual(r.totales, {
    total_operaciones_gravadas: 31.67,
    total_operaciones_exoneradas: 10,
    total_operaciones_inafectas: 7.1,
    total_exportacion: 100,
    total_igv: 5.7,
    total_impuestos: 5.7,
    total_valor: 148.77,
    total_venta: 154.47,
  })
  assert.equal('codigo_interno' in r.items[0], false, 'sin codigo_interno la clave se omite')
  assert.deepEqual(r.items[0], {
    descripcion: 'A',
    unidad_de_medida: 'NIU',
    cantidad: 3,
    valor_unitario: 10.56,
    codigo_tipo_precio: '01',
    precio_unitario: 12.45,
    codigo_tipo_afectacion_igv: '10',
    total_base_igv: 31.67,
    porcentaje_igv: 18,
    total_igv: 5.7,
    total_impuestos: 5.7,
    total_valor_item: 31.67,
    total_item: 37.37,
  })
  assert.equal(r.items[3].porcentaje_igv, 0)
  assert.equal(r.items[3].total_igv, 0)
  const archivo = JSON.parse(readFileSync(new URL('../resultado_caso_comun.json', import.meta.url), 'utf8'))
  assert.deepEqual(archivo, JSON.parse(JSON.stringify(r)))
})

test('calcularComprobante valida la entrada', () => {
  assert.throws(() => calcularComprobante([]), TypeError)
  assert.throws(() => calcularComprobante([{ descripcion: 'X', cantidad: 1, valor_unitario: 1, afectacion: '99' }]), /afectación/)
  assert.throws(() => calcularComprobante([{ descripcion: 'X', cantidad: 0, valor_unitario: 1, afectacion: '10' }]), /cantidad/)
  const r = calcularComprobante([{ descripcion: 'X', cantidad: 2, valor_unitario: 3, afectacion: '10', codigo_interno: 'SKU1', unidad_de_medida: 'ZZ' }])
  assert.equal(r.items[0].codigo_interno, 'SKU1')
  assert.equal(r.items[0].unidad_de_medida, 'ZZ')
})

// ───────────── codigo / reintentable / campos (API 2026-10) ─────────────

test('el error expone codigo, reintentable y campos del cuerpo JSON', async () => {
  const cuerpo = {
    success: false,
    message: 'Datos del comprobante inválidos o incompletos.',
    codigo: 'DATOS_INVALIDOS',
    reintentable: false,
    campos: { 'items.0.cantidad': ['La cantidad debe ser mayor que 0.'], serie_documento: ['Serie inexistente.'] },
  }
  const { fs } = cliente([{ status: 422, cuerpo }])
  await assert.rejects(fs.comprobantes.emitir(DATOS()), (e) => {
    assert.ok(e instanceof ErrorDeValidacion)
    assert.equal(e.codigo, 'DATOS_INVALIDOS')
    assert.equal(e.reintentable, false)
    assert.deepEqual(e.campos, cuerpo.campos)
    assert.deepEqual(e.errores, cuerpo.campos, 'errores (compatibilidad) se llena con campos')
    assert.equal(e.mensaje, cuerpo.message)
    return true
  })

  const { fs: fs2 } = cliente([{ status: 401, cuerpo: { success: false, message: 'API key inválida.', codigo: 'NO_AUTENTICADO', reintentable: false } }])
  await assert.rejects(fs2.ping(), (e) => {
    assert.ok(e instanceof ErrorDeAutenticacion)
    assert.equal(e.codigo, 'NO_AUTENTICADO')
    assert.equal(e.reintentable, false)
    assert.deepEqual(e.campos, {})
    return true
  })
  assert.ok(CODIGOS_DE_ERROR.includes('SUNAT_NO_DISPONIBLE'))
})

test('servidor de versión anterior (sin codigo): codigo y reintentable null, campos {}', async () => {
  const { fs } = cliente([{ status: 404, cuerpo: { success: false, message: 'Comprobante no encontrado.' } }])
  await assert.rejects(fs.comprobantes.consultar('abc'), (e) => {
    assert.ok(e instanceof NoEncontrado)
    assert.equal(e.codigo, null)
    assert.equal(e.reintentable, null)
    assert.deepEqual(e.campos, {})
    return true
  })
  // Errores de red tampoco traen código
  const red = cliente([new TypeError('fetch failed')], { maxReintentos: 0 })
  await assert.rejects(red.fs.ping(), (e) => e.codigo === null && e.reintentable === null && Object.keys(e.campos).length === 0)
})

test('reintentable:true reintenta en operaciones reintentables (GET, emitir con la misma clave, rucs.crear)', async () => {
  const fallo = { status: 500, cuerpo: { success: false, message: 'Error interno.', codigo: 'ERROR_INTERNO', reintentable: true } }

  const g = cliente([fallo, { cuerpo: { success: true, series: [] } }])
  await g.fs.series.listar()
  assert.equal(g.fetch.llamadas.length, 2)

  const em = cliente([
    { status: 500, cuerpo: { success: false, message: 'SUNAT no responde.', codigo: 'SUNAT_NO_DISPONIBLE', reintentable: true } },
    { cuerpo: EMISION_OK },
  ])
  await em.fs.comprobantes.emitir(DATOS())
  assert.equal(em.fetch.llamadas.length, 2)
  assert.equal(em.fetch.llamadas[0].cabeceras['Idempotency-Key'], em.fetch.llamadas[1].cabeceras['Idempotency-Key'])

  const rc = cliente([fallo, { cuerpo: { success: true, ya_existia: true } }])
  await rc.fs.rucs.crear({ ruc: '20609999991', empresa: 'X', correo: 'a@b.pe', clave: '123456' })
  assert.equal(rc.fetch.llamadas.length, 2)

  // Respeta maxReintentos y el backoff
  const tope = cliente([fallo], { maxReintentos: 2 })
  await assert.rejects(tope.fs.cuenta.saldo(), (e) => e.codigo === 'ERROR_INTERNO' && e.reintentable === true)
  assert.equal(tope.fetch.llamadas.length, 3)
  assert.deepEqual(tope.esperas, [1000, 2000])

  // Un 500 sin `reintentable` (servidor de versión anterior) sigue sin reintentarse
  const viejo = cliente([{ status: 500, cuerpo: { success: false, message: 'Error interno' } }])
  await assert.rejects(viejo.fs.ping(), FactuSmartError)
  assert.equal(viejo.fetch.llamadas.length, 1)
})

test('reintentable:true NO reintenta las operaciones prohibidas', async () => {
  const casos = [
    (fs) => fs.comprobantes.reenviar('abc'),
    (fs) => fs.comprobantes.consultarSunat('abc'),
    (fs) => fs.anulaciones.crear({ fecha_de_emision_de_documentos: '08-07-2026', documentos: [] }),
    (fs) => fs.guias.emitir({ serie_documento: 'TA01', codigo_tipo_documento: '09', datos_del_emisor: { codigo_del_domicilio_fiscal: '0000' }, items: [] }),
    (fs) => fs.rucs.activar('20609999991', true),
  ]
  for (const llamar of casos) {
    const { fs, fetch } = cliente([
      { status: 500, cuerpo: { success: false, message: 'SUNAT no responde.', codigo: 'SUNAT_NO_DISPONIBLE', reintentable: true } },
      { cuerpo: { success: true } },
    ])
    await assert.rejects(llamar(fs), (e) => e.codigo === 'SUNAT_NO_DISPONIBLE' && e.reintentable === true)
    assert.equal(fetch.llamadas.length, 1)
  }
})

test('descargar: 404 JSON → NoEncontrado con el message y el codigo del API', async () => {
  const cuerpo = { success: false, message: 'Comprobante no encontrado.', codigo: 'NO_ENCONTRADO', reintentable: false }
  const { fs } = cliente([{ status: 404, cuerpo, cabeceras: { 'Content-Type': 'application/json' } }])
  await assert.rejects(fs.comprobantes.descargar('abc', 'pdf'), (e) => {
    assert.ok(e instanceof NoEncontrado)
    assert.equal(e.mensaje, 'Comprobante no encontrado.')
    assert.equal(e.codigo, 'NO_ENCONTRADO')
    assert.equal(e.reintentable, false)
    assert.deepEqual(e.respuesta, cuerpo)
    return true
  })
})

test('codigo LIMITE_PETICIONES cuenta como límite aunque el status no sea 429', async () => {
  const { fs } = cliente([{ status: 500, cuerpo: { success: false, message: 'Límite alcanzado.', codigo: 'LIMITE_PETICIONES', reintentable: true } }], {
    maxReintentos: 0,
  })
  await assert.rejects(fs.ping(), (e) => e instanceof LimiteDePeticiones && e.codigo === 'LIMITE_PETICIONES')
})

// ───────────── Webhooks ─────────────

// Vector común de los tres SDK: no cambiarlo.
const WEBHOOK_CUERPO = '{"evento":"comprobante.aceptado"}'
const WEBHOOK_SECRETO = 'whsec_prueba'
const WEBHOOK_FIRMA = 'bc1542f6420851152ae42abd2cbcfe8f651cba4a2822ddd07a15d0fe036f72da'

test('verificarFirmaWebhook: vector común y variantes válidas', () => {
  assert.equal(verificarFirmaWebhook(WEBHOOK_CUERPO, WEBHOOK_FIRMA, WEBHOOK_SECRETO), true)
  assert.equal(FactuSmart.verificarFirmaWebhook(WEBHOOK_CUERPO, WEBHOOK_FIRMA, WEBHOOK_SECRETO), true)
  assert.equal(verificarFirmaWebhook(Buffer.from(WEBHOOK_CUERPO), WEBHOOK_FIRMA, WEBHOOK_SECRETO), true, 'Buffer')
  assert.equal(verificarFirmaWebhook(new TextEncoder().encode(WEBHOOK_CUERPO), WEBHOOK_FIRMA, WEBHOOK_SECRETO), true, 'Uint8Array')
  assert.equal(verificarFirmaWebhook(WEBHOOK_CUERPO, `  ${WEBHOOK_FIRMA.toUpperCase()}\n`, WEBHOOK_SECRETO), true, 'mayúsculas y espacios')
  const grande = Buffer.from(`xx${WEBHOOK_CUERPO}yy`)
  assert.equal(verificarFirmaWebhook(grande.subarray(2, grande.length - 2), WEBHOOK_FIRMA, WEBHOOK_SECRETO), true, 'vista parcial')
})

test('verificarFirmaWebhook: rechaza sin lanzar nunca', () => {
  const casos = [
    ['{"evento":"comprobante.rechazado"}', WEBHOOK_FIRMA, WEBHOOK_SECRETO, 'cuerpo alterado'],
    ['{ "evento": "comprobante.aceptado" }', WEBHOOK_FIRMA, WEBHOOK_SECRETO, 'JSON re-serializado'],
    [WEBHOOK_CUERPO, WEBHOOK_FIRMA, 'whsec_otro', 'secreto equivocado'],
    [WEBHOOK_CUERPO, '', WEBHOOK_SECRETO, 'firma vacía'],
    [WEBHOOK_CUERPO, WEBHOOK_FIRMA, '', 'secreto vacío'],
    [WEBHOOK_CUERPO, `sha256=${WEBHOOK_FIRMA}`, WEBHOOK_SECRETO, 'con prefijo'],
    [WEBHOOK_CUERPO, WEBHOOK_FIRMA.slice(0, 63), WEBHOOK_SECRETO, '63 hex'],
    [WEBHOOK_CUERPO, `${WEBHOOK_FIRMA}0`, WEBHOOK_SECRETO, '65 hex'],
    [WEBHOOK_CUERPO, 'z'.repeat(64), WEBHOOK_SECRETO, 'no hex'],
    [WEBHOOK_CUERPO, null, WEBHOOK_SECRETO, 'firma null'],
    [WEBHOOK_CUERPO, 123, WEBHOOK_SECRETO, 'firma número'],
    [WEBHOOK_CUERPO, WEBHOOK_FIRMA, undefined, 'secreto undefined'],
    [null, WEBHOOK_FIRMA, WEBHOOK_SECRETO, 'cuerpo null'],
    [{ evento: 'comprobante.aceptado' }, WEBHOOK_FIRMA, WEBHOOK_SECRETO, 'objeto ya parseado'],
  ]
  for (const [cuerpo, firma, secreto, caso] of casos) {
    assert.equal(verificarFirmaWebhook(cuerpo, firma, secreto), false, caso)
  }
})

test('la versión es 1.1.0 en el código y en package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(FactuSmart.VERSION, '1.1.0')
  assert.equal(pkg.version, FactuSmart.VERSION)
})

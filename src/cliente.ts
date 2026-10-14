import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { calcularComprobante } from './calculo.js'
import {
  ErrorDeAutenticacion,
  ErrorDeValidacion,
  FactuSmartError,
  LimiteDePeticiones,
  NoEncontrado,
  RucNoAutorizado,
  SinCreditos,
} from './errores.js'
import type {
  DatosAnulacion,
  DatosComprobante,
  DatosEstablecimiento,
  DatosGuia,
  DatosNuevoRuc,
  FiltrosComprobantes,
  ItemComprobante,
  ItemParaCalcular,
  ItemParaCalcularEnServidor,
  OpcionesCalculo,
  OpcionesBuscarProductoSunat,
  OpcionesCatalogo,
  OpcionesDescarga,
  OpcionesEmision,
  OpcionesRuc,
  RespuestaCalculo,
  RespuestaCatalogo,
  RespuestaCatalogos,
  RespuestaProductosSunat,
  RespuestaActivacionRuc,
  RespuestaAnulacion,
  RespuestaComprobante,
  RespuestaConsultaSunat,
  RespuestaCrearEstablecimiento,
  RespuestaCrearRuc,
  RespuestaCuenta,
  RespuestaEmision,
  RespuestaEstablecimientos,
  RespuestaEstadoAnulacion,
  RespuestaEstadoGuia,
  RespuestaGuia,
  RespuestaHistorial,
  RespuestaListado,
  RespuestaPing,
  RespuestaReenvio,
  RespuestaRucs,
  RespuestaSeries,
  TipoArchivo,
  Totales,
} from './tipos.js'

export const VERSION = '1.1.0'

type FuncionFetch = (url: string, init?: Record<string, unknown>) => Promise<Response>

export interface OpcionesCliente {
  /** API key de la cuenta (header X-API-Key). Obligatoria. */
  apiKey: string
  /** URL base de tu servidor, ej. `https://s2.factusmart.pe/api/v1/issuer`. Obligatoria (no hay dominio único). */
  baseUrl: string
  /** RUC emisor por defecto. Se puede cambiar en cada llamada con `{ ruc }`. */
  ruc?: string
  /** Tiempo máximo por petición, en segundos. Default 60 (SUNAT a veces tarda). */
  timeout?: number
  /** Reintentos ante errores transitorios. Default 3. */
  maxReintentos?: number
  /**
   * Default true. En false acepta certificados propios (SOLO pruebas locales). Usa un `dispatcher`
   * de undici si el paquete `undici` está instalado; si no, define NODE_TLS_REJECT_UNAUTHORIZED=0.
   */
  verificarSsl?: boolean
  /** Implementación de fetch propia (pruebas, proxies). Default: `globalThis.fetch` (Node 18+). */
  fetch?: FuncionFetch
  /** Función de espera entre reintentos, en milisegundos. Solo para pruebas. */
  dormir?: (ms: number) => Promise<void>
}

interface Peticion {
  metodo: 'GET' | 'POST' | 'PATCH'
  ruta: string
  query?: Record<string, string | number | undefined | null>
  cuerpo?: Record<string, unknown>
  cabeceras?: Record<string, string>
  /** Si se puede reintentar ante red/timeout/429/502/503/504. */
  reintentable: boolean
  /** Reintentar también ante 409 (solo emitir con Idempotency-Key). */
  reintentarEn409?: boolean
  binario?: boolean
}

const ESPERA_MAXIMA_MS = 60_000

const FORMATOS_PDF = ['a4', 'a5', 'ticket', 'ticket80', 'ticket58', 'ticket50'] as const

/** Error de validación local (sin petición), con la misma forma que un 422 DATOS_INVALIDOS del API. */
function errorLocalDeValidacion(campo: string, mensaje: string): ErrorDeValidacion {
  const campos = { [campo]: [mensaje] }
  return new ErrorDeValidacion(mensaje, 422, { success: false, message: mensaje, codigo: 'DATOS_INVALIDOS', reintentable: false, campos }, campos)
}

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Fecha (YYYY-MM-DD) y hora (HH:MM:SS) actuales en Perú (America/Lima). */
export function fechaHoraPeru(ahora: Date = new Date()): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora)
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '00'
  return { fecha: `${p('year')}-${p('month')}-${p('day')}`, hora: `${p('hour')}:${p('minute')}:${p('second')}` }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Convierte un mapa de validación Laravel {campo: [mensajes]} en texto legible. */
function mapaATexto(mapa: Record<string, unknown>): string {
  return Object.entries(mapa)
    .map(([campo, msgs]) => `${campo}: ${Array.isArray(msgs) ? msgs.join(' ') : String(msgs)}`)
    .join(' | ')
}

function esMapaDeValidacion(v: unknown): v is Record<string, string[]> {
  return esObjeto(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => Array.isArray(x))
}

/** Lee los segundos de espera del header Retry-After o de un texto "Espera N segundos". */
function leerSegundosDeEspera(retryAfter: string | null, mensaje: string): number | null {
  if (retryAfter) {
    const n = Number(retryAfter)
    if (Number.isFinite(n) && n >= 0) return n
    const fecha = Date.parse(retryAfter)
    if (!Number.isNaN(fecha)) return Math.max(0, Math.ceil((fecha - Date.now()) / 1000))
  }
  const m = /espera\s+(\d+)\s*segundo/i.exec(mensaje)
  return m ? Number(m[1]) : null
}

function construirError(status: number, cuerpo: unknown, cabeceras: Headers): FactuSmartError {
  let mensaje = ''
  let errores: Record<string, string[]> | null = null

  if (esObjeto(cuerpo)) {
    const m = cuerpo.message ?? cuerpo.mensaje
    if (typeof m === 'string') mensaje = m
    else if (esMapaDeValidacion(m)) {
      errores = m
      mensaje = mapaATexto(m)
    } else if (esMapaDeValidacion(cuerpo)) {
      errores = cuerpo
      mensaje = mapaATexto(cuerpo)
    }
  }
  if (!mensaje) {
    const textos: Record<number, string> = {
      401: 'API key inválida o ausente.',
      402: 'Sin créditos disponibles en la cuenta.',
      403: 'El RUC no está autorizado para esta cuenta.',
      404: 'Recurso no encontrado.',
      422: 'Datos inválidos.',
      429: 'Límite de peticiones alcanzado.',
    }
    mensaje = `${textos[status] ?? 'Error del API de FactuSmart.'} (HTTP ${status})`
  }

  // El API actual convierte el 429 del limitador en un 500 "Too Many Attempts." (ver openapi.yaml).
  const codigo = esObjeto(cuerpo) && typeof cuerpo.codigo === 'string' ? cuerpo.codigo : null
  const esLimite = status === 429 || codigo === 'LIMITE_PETICIONES' || (status === 500 && /too many attempts/i.test(mensaje))
  if (esLimite) {
    return new LimiteDePeticiones(mensaje, status, cuerpo, leerSegundosDeEspera(cabeceras.get('retry-after'), mensaje))
  }
  switch (status) {
    case 401:
      return new ErrorDeAutenticacion(mensaje, status, cuerpo)
    case 402:
      return new SinCreditos(mensaje, status, cuerpo)
    case 403:
      return new RucNoAutorizado(mensaje, status, cuerpo)
    case 404:
      return new NoEncontrado(mensaje, status, cuerpo)
    case 422:
      return new ErrorDeValidacion(mensaje, status, cuerpo, errores)
    default:
      return new FactuSmartError(mensaje, status, cuerpo)
  }
}

const FIRMA_HEX = /^[0-9a-f]{64}$/

/**
 * Verifica la firma de un webhook de FactuSmart (header `X-FactuSmart-Firma`): HMAC-SHA256, en hex
 * minúscula, del cuerpo CRUDO de la petición con el secreto del webhook, sin prefijo.
 *
 * Usa el cuerpo tal como llegó (string o Buffer), nunca un JSON re-serializado: cualquier espacio u
 * orden distinto cambia la firma. Nunca lanza: ante datos vacíos o mal formados devuelve `false`.
 */
export function verificarFirmaWebhook(cuerpoCrudo: string | Buffer | Uint8Array, firma: string, secreto: string): boolean {
  try {
    if (typeof firma !== 'string' || typeof secreto !== 'string' || secreto === '') return false
    const recibida = firma.trim().toLowerCase()
    if (!FIRMA_HEX.test(recibida)) return false
    let cuerpo: Buffer
    if (typeof cuerpoCrudo === 'string') cuerpo = Buffer.from(cuerpoCrudo, 'utf8')
    else if (cuerpoCrudo instanceof Uint8Array) cuerpo = Buffer.from(cuerpoCrudo.buffer, cuerpoCrudo.byteOffset, cuerpoCrudo.byteLength)
    else return false
    const esperada = createHmac('sha256', secreto).update(cuerpo).digest()
    const dada = Buffer.from(recibida, 'hex')
    return dada.length === esperada.length && timingSafeEqual(dada, esperada)
  } catch {
    return false
  }
}

export class FactuSmart {
  static readonly VERSION = VERSION

  /** Verifica el header `X-FactuSmart-Firma` de un webhook. Ver `verificarFirmaWebhook`. */
  static verificarFirmaWebhook(cuerpoCrudo: string | Buffer | Uint8Array, firma: string, secreto: string): boolean {
    return verificarFirmaWebhook(cuerpoCrudo, firma, secreto)
  }

  /** Calcula `items` y `totales` listos para `comprobantes.emitir`. */
  static calcularComprobante(items: ItemParaCalcular[]): { items: ItemComprobante[]; totales: Totales } {
    return calcularComprobante(items)
  }

  readonly apiKey: string
  readonly baseUrl: string
  readonly ruc: string | undefined
  readonly timeout: number
  readonly maxReintentos: number
  readonly verificarSsl: boolean

  private readonly fetchFn: FuncionFetch | undefined
  private readonly dormir: (ms: number) => Promise<void>
  private transporteInseguro: Promise<{ fetch: FuncionFetch; dispatcher: unknown } | null> | null = null

  readonly cuenta: {
    /** GET /account — saldo, plan y RUCs. */
    saldo: () => Promise<RespuestaCuenta>
  }

  readonly series: {
    /** GET /series — series del RUC con el siguiente número estimado. */
    listar: (opciones?: OpcionesRuc) => Promise<RespuestaSeries>
  }

  readonly comprobantes: {
    /** POST /documents — siempre con Idempotency-Key (reusada en reintentos). Revisa `aceptado_por_sunat`. */
    emitir: (datos: DatosComprobante, opciones?: OpcionesEmision) => Promise<RespuestaEmision>
    /** GET /documents — paginación por cursor (`antes_de`). */
    listar: (filtros?: FiltrosComprobantes, opciones?: OpcionesRuc) => Promise<RespuestaListado>
    /** GET /documents/{external_id} — estado guardado (no consulta a SUNAT en vivo). */
    consultar: (externalId: string, opciones?: OpcionesRuc) => Promise<RespuestaComprobante>
    /**
     * GET /documents/{external_id}/{pdf|xml|cdr} — devuelve los bytes del archivo. Con `pdf` acepta
     * `{ formato: 'ticket' }` (a4, a5, ticket, ticket80, ticket58, ticket50); sin formato, el A4.
     */
    descargar: (externalId: string, tipo: TipoArchivo, opciones?: OpcionesDescarga) => Promise<Buffer>
    /** POST /documents/{external_id}/reenviar — no se reintenta automáticamente. */
    reenviar: (externalId: string, opciones?: OpcionesRuc) => Promise<RespuestaReenvio>
    /** POST /documents/{external_id}/consultar-sunat — no se reintenta automáticamente. */
    consultarSunat: (externalId: string, opciones?: OpcionesRuc) => Promise<RespuestaConsultaSunat>
    /** GET /documents/{external_id}/historial */
    historial: (externalId: string, opciones?: OpcionesRuc) => Promise<RespuestaHistorial>
    /**
     * POST /calcular — FactuSmart calcula `items` y `totales` listos para `emitir`. No emite ni cobra
     * crédito. Admite `precio_unitario` (con IGV) y `porcentaje_igv` 10.5 (Ley 31556). Para hacerlo
     * sin petición (solo `valor_unitario` y 18 %) usa `FactuSmart.calcularComprobante`.
     */
    calcular: (items: ItemParaCalcularEnServidor[], opciones?: OpcionesCalculo) => Promise<RespuestaCalculo>
  }

  readonly catalogos: {
    /** GET /catalogos — catálogos SUNAT disponibles. No consume crédito. */
    listar: (opciones?: OpcionesRuc) => Promise<RespuestaCatalogos>
    /**
     * GET /catalogos/{nombre} — filas de un catálogo. `nombre` = `unidades` o el número SUNAT (`03`).
     * Usa solo las filas con `activo: true`.
     */
    consultar: (nombre: string, opciones?: OpcionesCatalogo) => Promise<RespuestaCatalogo>
    /**
     * GET /catalogos/productos-sunat — busca el código de producto SUNAT (catálogo 25) por código
     * (exacto o prefijo) o por texto (sin tildes). `limite` máx. 50. No consume crédito.
     */
    buscarProductoSunat: (q: string, opciones?: OpcionesBuscarProductoSunat) => Promise<RespuestaProductosSunat>
  }

  readonly establecimientos: {
    /** GET /establecimientos — locales (anexos SUNAT) del RUC con sus series. No consume crédito. */
    listar: (opciones?: OpcionesRuc) => Promise<RespuestaEstablecimientos>
    /**
     * POST /establecimientos — crea un local (regístralo antes en SUNAT). No se reintenta nunca.
     * Límite del plan → `RucNoAutorizado` con `codigo: 'LIMITE_ESTABLECIMIENTOS'`.
     */
    crear: (datos: DatosEstablecimiento, opciones?: OpcionesRuc) => Promise<RespuestaCrearEstablecimiento>
  }

  readonly anulaciones: {
    /**
     * POST /anulaciones — facturas (comunicación de baja, `tipo: 'baja'`) o boletas aceptadas
     * (resumen diario, `tipo: 'resumen'`); no mezcles las dos (422 ANULACION_MIXTA). No se reintenta.
     */
    crear: (datos: DatosAnulacion, opciones?: OpcionesRuc) => Promise<RespuestaAnulacion>
    /** GET /anulaciones/{ticket}/status */
    estado: (ticket: string, opciones?: OpcionesRuc) => Promise<RespuestaEstadoAnulacion>
  }

  readonly guias: {
    /** POST /guias — GRE 2.0. No usa Idempotency-Key, no se reintenta automáticamente. */
    emitir: (datos: DatosGuia, opciones?: OpcionesRuc) => Promise<RespuestaGuia>
    /** GET /guias/{external_id}/status */
    estado: (externalId: string, opciones?: OpcionesRuc) => Promise<RespuestaEstadoGuia>
  }

  readonly rucs: {
    /** GET /rucs */
    listar: () => Promise<RespuestaRucs>
    /** POST /rucs — idempotente por RUC (si ya es tuyo devuelve `ya_existia: true`). */
    crear: (datos: DatosNuevoRuc) => Promise<RespuestaCrearRuc>
    /** PATCH /rucs/{ruc}/activation — no se reintenta automáticamente. */
    activar: (ruc: string, activo: boolean) => Promise<RespuestaActivacionRuc>
  }

  constructor(opciones: OpcionesCliente) {
    if (!esObjeto(opciones)) {
      throw new FactuSmartError('Pasa las opciones del cliente: new FactuSmart({ apiKey, baseUrl, ruc }).')
    }
    if (typeof opciones.apiKey !== 'string' || opciones.apiKey.trim() === '') {
      throw new FactuSmartError('Falta apiKey: es la API key de tu panel de integrador (pestaña Configuración).')
    }
    if (typeof opciones.baseUrl !== 'string' || opciones.baseUrl.trim() === '') {
      throw new FactuSmartError(
        'Falta baseUrl: copia la "URL base de la API" de tu panel de integrador (ej. https://s2.factusmart.pe/api/v1/issuer).',
      )
    }
    this.apiKey = opciones.apiKey.trim()
    this.baseUrl = opciones.baseUrl.trim().replace(/\/+$/, '')
    this.ruc = opciones.ruc
    this.timeout = opciones.timeout ?? 60
    this.maxReintentos = Math.max(0, Math.floor(opciones.maxReintentos ?? 3))
    this.verificarSsl = opciones.verificarSsl ?? true
    this.fetchFn = opciones.fetch
    this.dormir = opciones.dormir ?? dormirReal

    const id = (externalId: string) => {
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        throw new FactuSmartError('Falta el external_id del comprobante.')
      }
      return encodeURIComponent(externalId.trim())
    }

    this.cuenta = {
      saldo: () => this.peticion({ metodo: 'GET', ruta: '/account', reintentable: true }),
    }

    this.series = {
      listar: (o) => this.peticion({ metodo: 'GET', ruta: '/series', query: { ruc: this.rucDe(o) }, reintentable: true }),
    }

    this.comprobantes = {
      emitir: (datos, o) => this.emitir(datos, o),
      listar: (filtros, o) =>
        this.peticion({
          metodo: 'GET',
          ruta: '/documents',
          query: { ...(filtros ?? {}), ruc: this.rucDe(o) } as Peticion['query'],
          reintentable: true,
        }),
      consultar: (externalId, o) =>
        this.peticion({ metodo: 'GET', ruta: `/documents/${id(externalId)}`, query: { ruc: this.rucDe(o) }, reintentable: true }),
      descargar: (externalId, tipo, o) => {
        if (tipo !== 'pdf' && tipo !== 'xml' && tipo !== 'cdr') {
          return Promise.reject(new FactuSmartError(`Tipo de archivo inválido "${String(tipo)}": usa 'pdf', 'xml' o 'cdr'.`))
        }
        const formato = o?.formato
        if (formato !== undefined && formato !== null) {
          if (tipo !== 'pdf') {
            return Promise.reject(errorLocalDeValidacion('formato', `formato solo aplica al PDF, no a '${tipo}'.`))
          }
          if (!(FORMATOS_PDF as readonly unknown[]).includes(formato)) {
            return Promise.reject(
              errorLocalDeValidacion('formato', `Formato de PDF inválido "${String(formato)}": usa ${FORMATOS_PDF.join(', ')}.`),
            )
          }
        }
        return this.peticion<Buffer>({
          metodo: 'GET',
          ruta: `/documents/${id(externalId)}/${tipo}`,
          query: { formato: formato ?? undefined, ruc: this.rucDe(o) },
          reintentable: true,
          binario: true,
        })
      },
      reenviar: (externalId, o) =>
        this.peticion({ metodo: 'POST', ruta: `/documents/${id(externalId)}/reenviar`, cuerpo: this.cuerpoConRuc({}, o), reintentable: false }),
      consultarSunat: (externalId, o) =>
        this.peticion({
          metodo: 'POST',
          ruta: `/documents/${id(externalId)}/consultar-sunat`,
          cuerpo: this.cuerpoConRuc({}, o),
          reintentable: false,
        }),
      historial: (externalId, o) =>
        this.peticion({ metodo: 'GET', ruta: `/documents/${id(externalId)}/historial`, query: { ruc: this.rucDe(o) }, reintentable: true }),
      // POST sin efectos (no emite ni cobra): se reintenta como un GET. No lleva `ruc` (el API lo ignora).
      calcular: (items, o) => {
        if (!Array.isArray(items) || items.length === 0) {
          return Promise.reject(new FactuSmartError('comprobantes.calcular(items): pasa una lista con al menos un ítem.'))
        }
        const cuerpo: Record<string, unknown> = { items }
        if (o?.porcentaje_igv !== undefined && o.porcentaje_igv !== null) cuerpo.porcentaje_igv = o.porcentaje_igv
        return this.peticion({ metodo: 'POST', ruta: '/calcular', cuerpo, reintentable: true })
      },
    }

    this.catalogos = {
      listar: (o) => this.peticion({ metodo: 'GET', ruta: '/catalogos', query: { ruc: this.rucDe(o) }, reintentable: true }),
      consultar: (nombre, o) => {
        if (typeof nombre !== 'string' || nombre.trim() === '') {
          return Promise.reject(new FactuSmartError('catalogos.consultar(nombre): pasa el nombre (ej. "unidades") o el número SUNAT (ej. "03").'))
        }
        return this.peticion({
          metodo: 'GET',
          ruta: `/catalogos/${encodeURIComponent(nombre.trim())}`,
          query: { q: o?.q, ruc: this.rucDe(o) },
          reintentable: true,
        })
      },
      buscarProductoSunat: (q, o) => {
        if (typeof q !== 'string' || q.trim() === '') {
          return Promise.reject(new FactuSmartError('catalogos.buscarProductoSunat(q): pasa un texto (ej. "computador") o un código (ej. "4321").'))
        }
        return this.peticion({
          metodo: 'GET',
          ruta: '/catalogos/productos-sunat',
          query: { q: q.trim(), limite: o?.limite, ruc: this.rucDe(o) },
          reintentable: true,
        })
      },
    }

    this.establecimientos = {
      listar: (o) => this.peticion({ metodo: 'GET', ruta: '/establecimientos', query: { ruc: this.rucDe(o) }, reintentable: true }),
      // No es idempotente ni acepta Idempotency-Key: nunca se reintenta solo.
      crear: (datos, o) => {
        if (!esObjeto(datos)) {
          return Promise.reject(new FactuSmartError('establecimientos.crear(datos): pasa el local como objeto.'))
        }
        return this.peticion({ metodo: 'POST', ruta: '/establecimientos', cuerpo: this.cuerpoConRuc(datos, o), reintentable: false })
      },
    }

    this.anulaciones = {
      crear: (datos, o) => this.peticion({ metodo: 'POST', ruta: '/anulaciones', cuerpo: this.cuerpoConRuc(datos, o), reintentable: false }),
      estado: (ticket, o) => {
        if (typeof ticket !== 'string' || ticket.trim() === '') {
          return Promise.reject(new FactuSmartError('Falta el ticket de la anulación.'))
        }
        return this.peticion({
          metodo: 'GET',
          ruta: `/anulaciones/${encodeURIComponent(ticket.trim())}/status`,
          query: { ruc: this.rucDe(o) },
          reintentable: true,
        })
      },
    }

    this.guias = {
      emitir: (datos, o) => {
        const cuerpo = this.cuerpoConRuc(datos, o)
        const ahora = fechaHoraPeru()
        if (cuerpo.numero_documento === undefined) cuerpo.numero_documento = '#'
        if (cuerpo.fecha_de_emision === undefined) cuerpo.fecha_de_emision = ahora.fecha
        if (cuerpo.hora_de_emision === undefined) cuerpo.hora_de_emision = ahora.hora
        return this.peticion({ metodo: 'POST', ruta: '/guias', cuerpo, reintentable: false })
      },
      estado: (externalId, o) =>
        this.peticion({ metodo: 'GET', ruta: `/guias/${id(externalId)}/status`, query: { ruc: this.rucDe(o) }, reintentable: true }),
    }

    // Los endpoints /rucs* gestionan la cuenta: nunca se les agrega el RUC emisor.
    this.rucs = {
      listar: () => this.peticion({ metodo: 'GET', ruta: '/rucs', reintentable: true }),
      crear: (datos) => this.peticion({ metodo: 'POST', ruta: '/rucs', cuerpo: { ...datos }, reintentable: true }),
      activar: (ruc, activo) => {
        if (typeof activo !== 'boolean') {
          return Promise.reject(new FactuSmartError('rucs.activar(ruc, activo): activo debe ser true o false.'))
        }
        return this.peticion({
          metodo: 'PATCH',
          ruta: `/rucs/${encodeURIComponent(String(ruc).trim())}/activation`,
          cuerpo: { activo },
          reintentable: false,
        })
      },
    }
  }

  /** GET /ping — prueba la API key. No consume crédito. */
  ping(opciones?: OpcionesRuc): Promise<RespuestaPing> {
    return this.peticion({ metodo: 'GET', ruta: '/ping', query: { ruc: this.rucDe(opciones) }, reintentable: true })
  }

  // ───────────── Internos ─────────────

  private rucDe(o?: OpcionesRuc): string | undefined {
    return o?.ruc ?? this.ruc
  }

  /** En POST el RUC va en el cuerpo; si el usuario ya puso `ruc` en sus datos, se respeta el suyo. */
  private cuerpoConRuc(datos: object, o?: OpcionesRuc): Record<string, unknown> {
    const cuerpo: Record<string, unknown> = { ...(datos as Record<string, unknown>) }
    const ruc = this.rucDe(o)
    if (cuerpo.ruc === undefined && ruc !== undefined) cuerpo.ruc = ruc
    return cuerpo
  }

  private emitir(datos: DatosComprobante, o?: OpcionesEmision): Promise<RespuestaEmision> {
    if (!esObjeto(datos)) {
      return Promise.reject(new FactuSmartError('comprobantes.emitir(datos): pasa el comprobante como objeto.'))
    }
    const cuerpo = this.cuerpoConRuc(datos, o)
    const ahora = fechaHoraPeru()
    if (cuerpo.numero_documento === undefined || cuerpo.numero_documento === null || cuerpo.numero_documento === '') {
      cuerpo.numero_documento = '#'
    }
    if (cuerpo.fecha_de_emision === undefined) cuerpo.fecha_de_emision = ahora.fecha
    if (cuerpo.hora_de_emision === undefined) cuerpo.hora_de_emision = ahora.hora
    if (cuerpo.codigo_tipo_moneda === undefined) cuerpo.codigo_tipo_moneda = 'PEN'
    // El yaml dice que codigo_tipo_operacion "no aplica a notas": solo se completa en 01/03.
    const tipo = String(cuerpo.codigo_tipo_documento ?? '')
    if (cuerpo.codigo_tipo_operacion === undefined && (tipo === '01' || tipo === '03')) {
      cuerpo.codigo_tipo_operacion = '0101'
    }

    const clave = o?.idempotencyKey ?? randomUUID()
    return this.peticion({
      metodo: 'POST',
      ruta: '/documents',
      cuerpo,
      cabeceras: { 'Idempotency-Key': clave },
      reintentable: true,
      reintentarEn409: true,
    })
  }

  private obtenerFetch(): FuncionFetch {
    if (this.fetchFn) return this.fetchFn
    if (typeof globalThis.fetch !== 'function') {
      throw new FactuSmartError('Este entorno no tiene fetch nativo. Usa Node 18 o superior, o pasa la opción `fetch`.')
    }
    return globalThis.fetch as unknown as FuncionFetch
  }

  /**
   * Con verificarSsl=false intenta usar el paquete `undici` (si el proyecto lo tiene instalado; el
   * SDK no lo agrega como dependencia): su propio `fetch` + un `Agent` que acepta certificados
   * propios. Se usa el fetch de undici y no el nativo para no mezclar versiones distintas de undici.
   * Si no está instalado, avisa una vez y sigue con el fetch nativo: la petición solo pasará si el
   * proceso corre con NODE_TLS_REJECT_UNAUTHORIZED=0.
   */
  private async obtenerTransporteInseguro(): Promise<{ fetch: FuncionFetch; dispatcher: unknown } | null> {
    if (this.verificarSsl || this.fetchFn) return null
    if (!this.transporteInseguro) {
      this.transporteInseguro = (async () => {
        try {
          const nombre = 'undici'
          const undici = (await import(nombre)) as { Agent: new (o: unknown) => unknown; fetch: FuncionFetch }
          return { fetch: undici.fetch, dispatcher: new undici.Agent({ connect: { rejectUnauthorized: false } }) }
        } catch {
          if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
            process.emitWarning(
              'factusmart: verificarSsl=false necesita el paquete "undici" o la variable NODE_TLS_REJECT_UNAUTHORIZED=0 (solo en pruebas locales).',
            )
          }
          return null
        }
      })()
    }
    return this.transporteInseguro
  }

  private construirUrl(ruta: string, query?: Peticion['query']): string {
    const url = new URL(this.baseUrl + ruta)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
    return url.toString()
  }

  private async peticion<T>(p: Peticion): Promise<T> {
    const url = this.construirUrl(p.ruta, p.query)
    const cabeceras: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: p.binario ? 'application/pdf, application/xml, application/zip, application/json;q=0.9, */*;q=0.8' : 'application/json',
      'User-Agent': `factusmart-node/${VERSION}`,
      ...(p.cabeceras ?? {}),
    }
    let cuerpoTexto: string | undefined
    if (p.cuerpo !== undefined) {
      cabeceras['Content-Type'] = 'application/json'
      cuerpoTexto = JSON.stringify(p.cuerpo)
    }

    const inseguro = await this.obtenerTransporteInseguro()
    const fetchFn = inseguro ? inseguro.fetch : this.obtenerFetch()
    const dispatcher = inseguro?.dispatcher
    const maxIntentos = p.reintentable ? this.maxReintentos + 1 : 1

    for (let intento = 0; ; intento++) {
      const quedan = intento + 1 < maxIntentos
      const espera = (segundos: number | null) =>
        this.dormir(Math.min(ESPERA_MAXIMA_MS, segundos !== null ? segundos * 1000 : 1000 * 2 ** intento))

      const control = new AbortController()
      const temporizador = setTimeout(() => control.abort(), this.timeout * 1000)
      let respuesta: Response
      try {
        const init: Record<string, unknown> = { method: p.metodo, headers: cabeceras, body: cuerpoTexto, signal: control.signal }
        if (dispatcher) init.dispatcher = dispatcher
        respuesta = await fetchFn(url, init)
      } catch (e) {
        clearTimeout(temporizador)
        const porTimeout = control.signal.aborted
        if (quedan) {
          await espera(null)
          continue
        }
        const causa = e instanceof Error ? ((e as Error & { cause?: Error }).cause?.message ?? e.message) : String(e)
        throw new FactuSmartError(
          porTimeout
            ? `El API no respondió en ${this.timeout} s (${p.metodo} ${p.ruta}).`
            : `No se pudo conectar con el API (${p.metodo} ${p.ruta}): ${causa}`,
          0,
          null,
        )
      }

      try {
        if (respuesta.ok) {
          if (p.binario) return Buffer.from(await respuesta.arrayBuffer()) as unknown as T
          const texto = await respuesta.text()
          try {
            return JSON.parse(texto) as T
          } catch {
            throw new FactuSmartError(`El API respondió algo que no es JSON (HTTP ${respuesta.status}).`, respuesta.status, texto)
          }
        }

        const texto = await respuesta.text()
        let cuerpo: unknown = texto
        try {
          cuerpo = JSON.parse(texto)
        } catch {
          /* no es JSON (p. ej. una página HTML de un proxy o de un servidor de versión anterior) */
        }
        const error = construirError(respuesta.status, cuerpo, respuesta.headers)

        // `reintentable: false` en el cuerpo manda sobre la regla por HTTP (ej. 429 LIMITE_PRUEBAS_DIARIO).
        // Sin el campo (servidor anterior), `error.reintentable` es null y se usa la regla por HTTP.
        const transitorio =
          error.reintentable !== false &&
          (error instanceof LimiteDePeticiones ||
            respuesta.status === 502 ||
            respuesta.status === 503 ||
            respuesta.status === 504 ||
            (respuesta.status === 409 && p.reintentarEn409 === true) ||
            // Señal adicional del API (ej. 500 ERROR_INTERNO, SUNAT_NO_DISPONIBLE). Solo cuenta en
            // operaciones reintentables: en las demás maxIntentos es 1 y `quedan` siempre es false.
            error.reintentable === true)
        if (transitorio && quedan) {
          await espera(error instanceof LimiteDePeticiones ? error.segundosDeEspera : null)
          continue
        }
        throw error
      } catch (e) {
        // Timeout mientras se leía el cuerpo.
        if (!(e instanceof FactuSmartError) && control.signal.aborted) {
          if (quedan) {
            await espera(null)
            continue
          }
          throw new FactuSmartError(`El API no respondió en ${this.timeout} s (${p.metodo} ${p.ruta}).`, 0, null)
        }
        throw e
      } finally {
        clearTimeout(temporizador)
      }
    }
  }
}

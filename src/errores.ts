/**
 * Errores del SDK. Todos heredan de FactuSmartError.
 *
 * IMPORTANTE: un HTTP 200 con `aceptado_por_sunat: false` NO lanza error.
 * Es un resultado normal que tu sistema debe revisar.
 */

/**
 * Códigos de error que manda hoy el API (campo `codigo`). La lista no es cerrada: el API puede
 * agregar códigos nuevos y también manda el genérico `ERROR_<status>` (ej. `ERROR_418`).
 */
export const CODIGOS_DE_ERROR = [
  'NO_AUTENTICADO',
  'PLAN_VENCIDO',
  'SIN_CREDITOS',
  'RUC_NO_AUTORIZADO',
  'RUC_DESACTIVADO',
  'LLAVE_DE_PRUEBA_EN_PRODUCCION',
  'SIN_PERMISO',
  'NO_ENCONTRADO',
  'RUTA_NO_ENCONTRADA',
  'METODO_NO_PERMITIDO',
  'EMISION_EN_CURSO',
  'CONFLICTO',
  'DATOS_INVALIDOS',
  'RUC_REQUERIDO',
  'RUC_SIN_TENANT',
  'CERTIFICADO_NO_CONFIGURADO',
  'ERROR_EMISION',
  'RECHAZADO_SUNAT',
  'REENVIO_FALLIDO',
  'SUNAT_NO_DISPONIBLE',
  'LIMITE_PETICIONES',
  /** 429 NO reintentable: tope diario de 200 operaciones en RUCs demo (se reinicia a medianoche de Lima). */
  'LIMITE_PRUEBAS_DIARIO',
  /** 422: facturas y boletas en la misma anulación. */
  'ANULACION_MIXTA',
  'ERROR_INTERNO',
  /** 500 (`reintentable: true`): el generador del PDF falló dos veces seguidas. */
  'PDF_NO_GENERADO',
  /** 403: el plan del RUC no permite más locales (`establecimientos.crear`). */
  'LIMITE_ESTABLECIMIENTOS',
  'CATALOGO_NO_DISPONIBLE',
] as const

/** Código conocido, o cualquier otro string (el tipo queda abierto a códigos nuevos). */
export type CodigoDeError = (typeof CODIGOS_DE_ERROR)[number] | (string & {})

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Mapa campo → mensajes; acepta también un mensaje suelto por campo. */
function leerCampos(v: unknown): Record<string, string[]> | null {
  if (!esObjeto(v)) return null
  const salida: Record<string, string[]> = {}
  for (const [campo, msgs] of Object.entries(v)) {
    if (Array.isArray(msgs)) salida[campo] = msgs.map((m) => String(m))
    else if (typeof msgs === 'string') salida[campo] = [msgs]
  }
  return salida
}

export class FactuSmartError extends Error {
  /** Código HTTP (0 si fue un error de red o timeout). */
  readonly status: number
  /** Mensaje legible del API (campo `message`), o descripción del error de red. */
  readonly mensaje: string
  /** Cuerpo completo de la respuesta (objeto JSON, texto o null). */
  readonly respuesta: unknown
  /**
   * Código estable del error (campo `codigo` del API), ej. `NO_AUTENTICADO`, `DATOS_INVALIDOS`.
   * `null` si el error no vino del API (red, timeout, validación local) o si el servidor es de una
   * versión anterior que no lo manda.
   */
  readonly codigo: CodigoDeError | null
  /**
   * Si el API indica que repetir la misma petición más tarde puede funcionar (campo `reintentable`).
   * `null` cuando el API no lo manda (servidor de versión anterior, red, timeout, validación local).
   */
  readonly reintentable: boolean | null
  /** Errores por campo (campo `campos` del API, sobre todo en 422). `{}` si no hay. */
  readonly campos: Record<string, string[]>

  constructor(mensaje: string, status = 0, respuesta: unknown = null) {
    super(mensaje)
    this.name = new.target.name
    this.status = status
    this.mensaje = mensaje
    this.respuesta = respuesta
    const cuerpo = esObjeto(respuesta) ? respuesta : {}
    this.codigo = typeof cuerpo.codigo === 'string' && cuerpo.codigo !== '' ? cuerpo.codigo : null
    this.reintentable = typeof cuerpo.reintentable === 'boolean' ? cuerpo.reintentable : null
    this.campos = leerCampos(cuerpo.campos) ?? {}
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 401: API key ausente, inválida o cuenta desactivada. */
export class ErrorDeAutenticacion extends FactuSmartError {}

/** 402: la cuenta no tiene créditos. No se emitió nada. */
export class SinCreditos extends FactuSmartError {}

/** 403: el RUC no pertenece a la cuenta o está desactivado. */
export class RucNoAutorizado extends FactuSmartError {}

/** 404: comprobante, guía, anulación o RUC no encontrado. */
export class NoEncontrado extends FactuSmartError {}

/** 422: datos inválidos o error del motor de emisión. El crédito no se cobra. */
export class ErrorDeValidacion extends FactuSmartError {
  /**
   * Mapa campo → mensajes (formato de validación Laravel de versiones anteriores del API, o `campos`
   * si solo viene ese). Se mantiene por compatibilidad: en código nuevo usa `campos`.
   */
  readonly errores: Record<string, string[]> | null

  constructor(mensaje: string, status = 422, respuesta: unknown = null, errores: Record<string, string[]> | null = null) {
    super(mensaje, status, respuesta)
    this.errores = errores ?? (Object.keys(this.campos).length > 0 ? this.campos : null)
  }
}

/**
 * Límite superado (HTTP 429, o 500 con `message: "Too Many Attempts."` en servidores anteriores).
 * Distingue el caso por `codigo`:
 * - `LIMITE_PETICIONES` (`reintentable: true`): límite por minuto; el SDK reintenta solo.
 * - `LIMITE_PRUEBAS_DIARIO` (`reintentable: false`): tope de 200 operaciones/día en RUCs demo. No se
 *   reintenta; el cupo se reinicia a medianoche (hora de Perú).
 */
export class LimiteDePeticiones extends FactuSmartError {
  /** Segundos que pide esperar el API (Retry-After o "Espera N segundos"), si se pudo leer. */
  readonly segundosDeEspera: number | null

  constructor(mensaje: string, status = 429, respuesta: unknown = null, segundosDeEspera: number | null = null) {
    super(mensaje, status, respuesta)
    this.segundosDeEspera = segundosDeEspera
  }
}

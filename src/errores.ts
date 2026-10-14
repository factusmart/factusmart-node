/**
 * Errores del SDK. Todos heredan de FactuSmartError.
 *
 * IMPORTANTE: un HTTP 200 con `aceptado_por_sunat: false` NO lanza error.
 * Es un resultado normal que tu sistema debe revisar.
 */

export class FactuSmartError extends Error {
  /** Código HTTP (0 si fue un error de red o timeout). */
  readonly status: number
  /** Mensaje legible del API (campo `message`), o descripción del error de red. */
  readonly mensaje: string
  /** Cuerpo completo de la respuesta (objeto JSON, texto o null). */
  readonly respuesta: unknown

  constructor(mensaje: string, status = 0, respuesta: unknown = null) {
    super(mensaje)
    this.name = new.target.name
    this.status = status
    this.mensaje = mensaje
    this.respuesta = respuesta
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
  /** Mapa campo → mensajes, cuando el API lo devuelve (validación Laravel). */
  readonly errores: Record<string, string[]> | null

  constructor(mensaje: string, status = 422, respuesta: unknown = null, errores: Record<string, string[]> | null = null) {
    super(mensaje, status, respuesta)
    this.errores = errores
  }
}

/**
 * Límite de peticiones superado. El API puede responder 429, o 500 con
 * `message: "Too Many Attempts."` (comportamiento actual documentado en openapi.yaml).
 */
export class LimiteDePeticiones extends FactuSmartError {
  /** Segundos que pide esperar el API (Retry-After o "Espera N segundos"), si se pudo leer. */
  readonly segundosDeEspera: number | null

  constructor(mensaje: string, status = 429, respuesta: unknown = null, segundosDeEspera: number | null = null) {
    super(mensaje, status, respuesta)
    this.segundosDeEspera = segundosDeEspera
  }
}

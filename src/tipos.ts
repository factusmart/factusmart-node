/**
 * Tipos derivados de docs/api/openapi.yaml.
 * Las claves van tal cual las define el API (español, con guion bajo).
 * Los objetos aceptan campos extra (`[campo: string]: unknown`) porque el API puede crecer.
 */

// ───────────── Catálogos ─────────────

/** 01 Registrado, 03 Enviado, 05 Aceptado, 07 Observado, 09 Rechazado, 11 Anulado, 13 Por anular. */
export type EstadoCodigo = '01' | '03' | '05' | '07' | '09' | '11' | '13'
/** 01 Factura, 03 Boleta, 07 Nota de crédito, 08 Nota de débito. */
export type TipoDocumentoComprobante = '01' | '03' | '07' | '08'
export type Moneda = 'PEN' | 'USD'
/** Catálogo 07 SUNAT. */
export type AfectacionIgv =
  | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17'
  | '20' | '21'
  | '30' | '31' | '32' | '33' | '34' | '35' | '36' | '37'
  | '40'
/** Catálogo 06 SUNAT: 0, 1 DNI, 4 CE, 6 RUC, 7 Pasaporte, A-E. */
export type TipoDocumentoIdentidad = '0' | '1' | '4' | '6' | '7' | 'A' | 'B' | 'C' | 'D' | 'E'
/** Afectaciones que soporta `calcularComprobante`. */
export type Afectacion = '10' | '20' | '30' | '40'
export type TipoArchivo = 'pdf' | 'xml' | 'cdr'

// ───────────── Opciones por llamada ─────────────

export interface OpcionesRuc {
  /** RUC emisor para esta llamada (sobreescribe el del constructor). */
  ruc?: string
}

export interface OpcionesEmision extends OpcionesRuc {
  /** Clave única por venta. Si no la pasas, el SDK genera un UUID v4 y la reusa en los reintentos. */
  idempotencyKey?: string
}

// ───────────── Ayudante de cálculo ─────────────

export interface ItemParaCalcular {
  descripcion: string
  cantidad: number
  /** Precio unitario SIN IGV. */
  valor_unitario: number
  /** 10 gravado (18%), 20 exonerado, 30 inafecto, 40 exportación. */
  afectacion: Afectacion
  codigo_interno?: string
  /** Default `NIU`. */
  unidad_de_medida?: string
}

/**
 * Ítem para `comprobantes.calcular` (cálculo en el servidor, `POST /calcular`).
 * Manda `valor_unitario` (SIN IGV) **o** `precio_unitario` (CON IGV), no los dos.
 */
export type ItemParaCalcularEnServidor = {
  descripcion: string
  /** Mayor que 0. */
  cantidad: number
  /** 10 gravado, 20 exonerado, 30 inafecto, 40 exportación. */
  afectacion: Afectacion
  /** Se copia tal cual al resultado. */
  codigo_interno?: string
  /** Código SUNAT (`NIU` bienes, `ZZ` servicios, `KGM`…). Default `NIU`. */
  unidad_de_medida?: string
} & (
  | {
      /** Precio unitario SIN IGV. */
      valor_unitario: number
      precio_unitario?: never
    }
  | {
      /** Precio unitario CON IGV (respeta lo que paga el cliente: 3 × 10.00 = 30.00). */
      precio_unitario: number
      valor_unitario?: never
    }
)

export interface OpcionesCalculo {
  /** IGV de los ítems gravados: 18 (default) o 10.5 (tasa reducida Ley 31556, solo RUCs acogidos). */
  porcentaje_igv?: 18 | 10.5
}

export interface OpcionesCatalogo extends OpcionesRuc {
  /** Filtro por código o descripción (no distingue mayúsculas). Máx. 100 caracteres. */
  q?: string
}

// ───────────── Emisión ─────────────

export interface Cliente {
  codigo_tipo_documento_identidad: TipoDocumentoIdentidad
  numero_documento: string
  /** Opcional con RUC (6) o DNI (1); obligatorio con otros tipos. */
  apellidos_y_nombres_o_razon_social?: string
  nombre_comercial?: string
  codigo_pais?: string
  ubigeo?: string
  direccion?: string
  correo_electronico?: string
  telefono?: string
  codigo_tipo_direccion?: string
  [campo: string]: unknown
}

export interface Totales {
  total_operaciones_gravadas?: number
  total_operaciones_exoneradas?: number
  total_operaciones_inafectas?: number
  total_operaciones_gratuitas?: number
  total_exportacion?: number
  total_igv?: number
  total_igv_operaciones_gratuitas?: number
  total_base_isc?: number
  total_isc?: number
  total_base_otros_impuestos?: number
  total_otros_impuestos?: number
  total_impuestos_bolsa_plastica?: number
  total_impuestos?: number
  total_valor?: number
  total_anticipos?: number
  total_descuentos?: number
  total_cargos?: number
  subtotal_venta?: number
  /** Importe total con impuestos (obligatorio). */
  total_venta: number
  total_pendiente_pago?: number
  [campo: string]: unknown
}

export interface CargoDescuento {
  codigo: string
  descripcion: string
  factor: number
  monto: number
  base: number
}

export interface ItemComprobante {
  codigo_interno?: string
  descripcion: string
  unidad_de_medida: string
  cantidad: number
  valor_unitario?: number
  codigo_tipo_precio?: string
  precio_unitario?: number
  codigo_tipo_afectacion_igv?: AfectacionIgv
  total_base_igv?: number
  porcentaje_igv?: number
  total_igv?: number
  total_impuestos?: number
  total_valor_item?: number
  total_item?: number
  nombre?: string
  codigo_tipo_item?: string
  codigo_producto_sunat?: string
  informacion_adicional?: string
  descuentos?: CargoDescuento[]
  cargos?: CargoDescuento[]
  [campo: string]: unknown
}

export interface Cuota {
  fecha: string
  codigo_tipo_moneda: Moneda
  monto: number
  codigo_metodo_de_pago?: string
}

export interface Pago {
  codigo_metodo_pago: string
  codigo_destino_pago?: string
  referencia?: string
  monto?: number
  pago_recibido?: number
}

export interface Detraccion {
  codigo_tipo_detraccion: string
  porcentaje: number
  monto: number
  codigo_metodo_pago: string
  cuenta_bancaria: string
  ubigeo_origen?: string
  ubigeo_destino?: string
  [campo: string]: unknown
}

export interface DocumentoAfectado {
  external_id?: string
  serie_documento?: string
  numero_documento?: string
  codigo_tipo_documento?: '01' | '03'
}

/**
 * Payload de `comprobantes.emitir`. Los campos que el SDK completa solo si faltan:
 * `numero_documento` ("#"), `fecha_de_emision` / `hora_de_emision` (hora de Perú),
 * `codigo_tipo_operacion` ("0101", solo 01/03), `codigo_tipo_moneda` ("PEN") y `ruc`.
 */
export interface DatosComprobante {
  codigo_tipo_documento: TipoDocumentoComprobante
  datos_del_cliente_o_receptor: Cliente
  items: ItemComprobante[]
  totales: Totales
  ruc?: string
  codigo_establecimiento?: string
  serie_documento?: string
  numero_documento?: string
  fecha_de_emision?: string
  hora_de_emision?: string
  fecha_de_vencimiento?: string
  codigo_tipo_operacion?: string
  codigo_tipo_moneda?: Moneda
  factor_tipo_de_cambio?: number
  numero_orden_de_compra?: string
  numero_de_placa?: string
  informacion_adicional?: string
  codigo_condicion_de_pago?: '01' | '02'
  cuotas?: Cuota[]
  pagos?: Pago[]
  detraccion?: Detraccion
  percepcion?: { codigo: string; porcentaje: number; monto: number; base: number }
  retencion?: { codigo: string; porcentaje: number; monto: number; base: number }
  cargos?: CargoDescuento[]
  descuentos?: CargoDescuento[]
  leyendas?: { codigo: string; valor: string }[]
  acciones?: { enviar_email?: boolean; enviar_xml_firmado?: boolean; formato_pdf?: string }
  /** Obligatorio en 07/08. */
  codigo_tipo_nota?: string
  motivo_o_sustento_de_nota?: string
  /** Obligatorio en 07/08. */
  documento_afectado?: DocumentoAfectado
  [campo: string]: unknown
}

export interface DatosAnulacion {
  /** Formato DD-MM-AAAA; igual a la fecha de emisión de cada comprobante. */
  fecha_de_emision_de_documentos: string
  documentos: { external_id: string; motivo_anulacion: string }[]
  ruc?: string
}

/** Payload de `guias.emitir` (GRE 2.0). Ver DispatchGuideRequest en openapi.yaml. */
export interface DatosGuia {
  serie_documento: string
  codigo_tipo_documento: '09' | '31'
  datos_del_emisor: { codigo_del_domicilio_fiscal: string }
  items: { descripcion: string; unidad_de_medida: string; cantidad: number; codigo_interno?: string; [campo: string]: unknown }[]
  fecha_de_emision?: string
  hora_de_emision?: string
  numero_documento?: string
  ruc?: string
  [campo: string]: unknown
}

export interface DatosNuevoRuc {
  ruc: string
  empresa: string
  correo: string
  clave: string
}

export interface FiltrosComprobantes {
  estado?: EstadoCodigo
  /** YYYY-MM-DD inclusive. */
  desde?: string
  /** YYYY-MM-DD inclusive. */
  hasta?: string
  /** 1 a 100 (default 50). */
  limite?: number
  /** Cursor: pasa `siguiente_cursor` de la página anterior. */
  antes_de?: number
}

// ───────────── Respuestas ─────────────

export interface SunatFeedback {
  sunat?: { codigo?: string | null; descripcion?: string | null; [campo: string]: unknown } | unknown[]
  /** true solo si `estado` es `05`. Revísalo SIEMPRE: HTTP 200 no significa aceptado. */
  aceptado_por_sunat: boolean
  entorno: 'prueba' | 'produccion'
  tiene_validez_fiscal: boolean
  /** Solo en estados 01 y 09. */
  accion_requerida?: string
}

export interface RespuestaPing {
  success: true
  message: string
  cuenta: string | null
  creditos: number
  ruc_emisor?: string | null
  razon_social?: string | null
  [campo: string]: unknown
}

export interface ResumenPlan {
  plan?: string | null
  plan_activo?: boolean
  periodo?: 'mensual' | 'anual' | null
  plan_vence?: string | null
  cupo_mensual?: number
  cupo_usado_mes?: number
  cupo_restante_mes?: number
  cupo_se_renueva?: string | null
  bolsa?: number
  bolsa_vence?: { fecha: string; cantidad: number } | null
  disponibles?: number
  [campo: string]: unknown
}

export interface RespuestaCuenta {
  success: true
  cuenta: string
  creditos_disponibles: number
  creditos_recargados_total: number
  creditos_consumidos: number
  plan: ResumenPlan
  rucs: { ruc: string; nombre: string }[]
  [campo: string]: unknown
}

export interface RespuestaSeries {
  success: true
  series: { serie: string; codigo_tipo_documento: string; siguiente_numero: number }[]
}

/** Campos de cobro de las operaciones que consumen crédito (schema CobroOperacion). */
export interface CobroOperacion {
  /** Saldo real de créditos después de la operación (en demo no cambia). */
  creditos_restantes: number
  /** true si esta operación descontó 1 crédito. En RUCs demo siempre false. */
  credito_cobrado?: boolean
  /** Solo en RUCs demo (sin costo). */
  modo_demo?: true
  /** Solo en RUCs demo: operaciones demo que le quedan hoy a la cuenta (tope 200/día, hora de Perú). */
  pruebas_restantes_hoy?: number
}

export interface RespuestaEmision extends SunatFeedback, CobroOperacion {
  success: true
  estado: EstadoCodigo
  estado_descripcion?: string | null
  serie_numero: string
  external_id: string
  [campo: string]: unknown
}

export interface ComprobanteListado extends SunatFeedback {
  external_id: string
  serie_numero: string
  codigo_tipo_documento: TipoDocumentoComprobante
  estado: EstadoCodigo
  estado_descripcion?: string | null
  fecha_emision?: string | null
  total: number
  [campo: string]: unknown
}

export interface RespuestaListado {
  success: true
  comprobantes: ComprobanteListado[]
  /** Pásalo como `antes_de`. null = no hay más. */
  siguiente_cursor: number | null
}

export interface RespuestaComprobante extends SunatFeedback {
  success: true
  estado: EstadoCodigo
  estado_descripcion?: string | null
  serie_numero: string
  external_id: string
  fecha_emision?: string | null
  total?: number
  links: { pdf?: string; xml?: string; cdr?: string }
  [campo: string]: unknown
}

export interface RespuestaReenvio extends SunatFeedback {
  success: boolean
  mensaje?: string | null
  estado: EstadoCodigo
  serie_numero: string
  external_id: string
  [campo: string]: unknown
}

export interface RespuestaConsultaSunat extends SunatFeedback {
  success: true
  estado: EstadoCodigo
  serie_numero: string
  external_id: string
  consulta?: Record<string, unknown> | null
  [campo: string]: unknown
}

export interface EventoHistorial {
  fecha: string | null
  evento: 'creado' | 'registrado' | 'enviado' | 'aceptado' | 'observado' | 'rechazado' | 'anulado' | 'por_anular' | 'error' | 'reintento'
  mensaje: string | null
  codigo_sunat: string | null
  detalle: unknown
}

export interface RespuestaHistorial extends SunatFeedback {
  success: true
  external_id: string
  serie_numero: string
  estado: EstadoCodigo
  historial: EventoHistorial[]
  [campo: string]: unknown
}

/** `baja` = comunicación de baja (facturas y sus notas); `resumen` = resumen diario (boletas y sus notas). */
export type TipoAnulacion = 'baja' | 'resumen'

export interface RespuestaAnulacion extends CobroOperacion {
  success: true
  message: string
  /** El API elige el camino según lo que mandes: facturas → `baja`, boletas → `resumen`. */
  tipo: TipoAnulacion
  /** Ticket de SUNAT para `anulaciones.estado(ticket)`. */
  ticket: string | null
  /** Identificador de la anulación (comunicación de baja o resumen). */
  external_id: string
  /** Número SUNAT de la anulación: `RA-AAAAMMDD-N` (baja) o `RC-AAAAMMDD-N` (resumen). */
  identificador: string | null
  [campo: string]: unknown
}

export interface DocumentoEnAnulacion {
  external_id: string | null
  serie_numero: string | null
  /** `11` anulado, `13` todavía por anular; `01` si SUNAT rechazó un resumen de boletas. */
  estado: string | null
  [campo: string]: unknown
}

export interface RespuestaEstadoAnulacion {
  success: true
  tipo: TipoAnulacion
  ticket: string
  /** Estado de la anulación: `05` aceptada, `09` rechazada, `03` enviada. */
  estado: EstadoCodigo
  external_id: string
  /** Cada comprobante incluido en la anulación y su estado actual. */
  documentos: DocumentoEnAnulacion[]
  sunat?: Record<string, unknown> | unknown[] | null
  [campo: string]: unknown
}

export interface RespuestaGuia extends CobroOperacion {
  success: true
  serie_numero: string
  external_id: string
  /** true si SUNAT aceptó el envío (solo entonces se cobra el crédito, y solo en un RUC en producción). */
  enviado: boolean
  mensaje: string
  envio?: Record<string, unknown> | null
  [campo: string]: unknown
}

export interface RespuestaEstadoGuia {
  success: true
  external_id: string
  estado: EstadoCodigo
  sunat?: Record<string, unknown> | null
  [campo: string]: unknown
}

export interface RespuestaRucs {
  success: true
  rucs: {
    ruc: string
    nombre: string
    correo: string | null
    entorno: 'demo' | 'produccion' | null
    activo: boolean
    creado: string | null
  }[]
}

export interface RespuestaCrearRuc {
  success: true
  ya_existia: boolean
  ruc: string
  nombre: string
  activo: boolean
  tenant_url: string | null
  mensaje?: string
  [campo: string]: unknown
}

export interface RespuestaActivacionRuc {
  success: true
  ruc: string
  activo: boolean
  mensaje: string
}

// ───────────── Herramientas (/calcular, /catalogos) ─────────────

export interface RespuestaCalculo {
  success: true
  /** Ítems en el formato exacto de `comprobantes.emitir` (`items`). */
  items: ItemComprobante[]
  totales: Totales
  [campo: string]: unknown
}

export interface CatalogoDisponible {
  /** Ej. `unidades`. */
  nombre: string
  /** Número SUNAT, ej. `03`. */
  catalogo_sunat: string
  descripcion: string
  url: string
  [campo: string]: unknown
}

export interface RespuestaCatalogos {
  success: true
  catalogos: CatalogoDisponible[]
  nota?: string
  [campo: string]: unknown
}

export interface FilaCatalogo {
  codigo: string
  descripcion: string
  /** Usa solo las filas activas: el RUC valida contra ellas al emitir. */
  activo: boolean
  /** Solo en tipos-documento. */
  abreviatura?: string | null
  /** Solo en monedas y unidades. */
  simbolo?: string | null
  /** Solo en afectacion-igv y tipos-operacion. */
  es_exportacion?: boolean
  /** Solo en afectacion-igv. */
  es_gratuito?: boolean
  /** Solo en detracciones. */
  porcentaje?: number | string | null
  [campo: string]: unknown
}

export interface RespuestaCatalogo {
  success: true
  /** Nombre del catálogo, ej. `afectacion-igv`. */
  catalogo: string
  catalogo_sunat: string
  descripcion: string
  total: number
  datos: FilaCatalogo[]
  [campo: string]: unknown
}

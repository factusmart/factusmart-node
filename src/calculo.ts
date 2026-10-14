/**
 * Ayudante para calcular IGV y totales, igual que la función de la doc pública
 * (sección "Calcular IGV y totales"), con una sola diferencia deliberada en el redondeo:
 * ver `redondear2`.
 */
import type { Afectacion, ItemComprobante, ItemParaCalcular, Totales } from './tipos.js'

const TASA_IGV = 0.18

/**
 * Redondea a 2 decimales "mitad hacia arriba" (alejándose de cero), tolerante al error
 * de coma flotante.
 *
 * Por qué no `Math.round(n * 100) / 100` como la doc: 10.555 * 3 da 31.664999999999996 en
 * coma flotante, y ese método devuelve 31.66 cuando el valor decimal real (31.665) redondea a
 * 31.67. PHP `round()` y Python con `Decimal(ROUND_HALF_UP)` dan 31.67. Así los tres SDK
 * coinciden al centavo.
 */
export function redondear2(n: number): number {
  if (!Number.isFinite(n)) throw new TypeError(`No es un número válido: ${n}`)
  const signo = n < 0 ? -1 : 1
  // toFixed(6) elimina el ruido de coma flotante (…4999999996 → …5000000) antes de redondear.
  const centavos = Math.round(Number((Math.abs(n) * 100).toFixed(6)))
  const r = (signo * centavos) / 100
  return r === 0 ? 0 : r // evita -0
}

const AFECTACIONES_VALIDAS: readonly Afectacion[] = ['10', '20', '30', '40']

/**
 * Convierte ítems simples (precio sin IGV, cantidad, afectación) en los bloques
 * `items` y `totales` que espera `POST /documents`.
 *
 * Afectación: `10` gravado (IGV 18%), `20` exonerado, `30` inafecto, `40` exportación (IGV 0).
 */
export function calcularComprobante(items: ItemParaCalcular[]): { items: ItemComprobante[]; totales: Totales } {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('calcularComprobante: pasa una lista con al menos un ítem.')
  }

  let gravadas = 0
  let exoneradas = 0
  let inafectas = 0
  let exportacion = 0
  let totalIgv = 0

  const itemsApi = items.map((it, i): ItemComprobante => {
    const afectacion = String(it.afectacion) as Afectacion
    if (!AFECTACIONES_VALIDAS.includes(afectacion)) {
      throw new TypeError(`calcularComprobante: ítem ${i + 1}, afectación "${it.afectacion}" no soportada (usa 10, 20, 30 o 40).`)
    }
    const cantidad = Number(it.cantidad)
    const valorUnitario = Number(it.valor_unitario)
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new TypeError(`calcularComprobante: ítem ${i + 1}, cantidad inválida.`)
    }
    if (!Number.isFinite(valorUnitario) || valorUnitario < 0) {
      throw new TypeError(`calcularComprobante: ítem ${i + 1}, valor_unitario inválido.`)
    }

    const base = redondear2(valorUnitario * cantidad)
    const gravado = afectacion === '10'
    const igv = gravado ? redondear2(base * TASA_IGV) : 0

    if (afectacion === '10') gravadas += base
    else if (afectacion === '20') exoneradas += base
    else if (afectacion === '30') inafectas += base
    else exportacion += base
    totalIgv += igv

    const item: ItemComprobante = {
      // Sin codigo_interno se omite la clave (igual que los SDK de PHP y Python).
      ...(it.codigo_interno !== undefined && it.codigo_interno !== null ? { codigo_interno: it.codigo_interno } : {}),
      descripcion: it.descripcion,
      unidad_de_medida: it.unidad_de_medida || 'NIU',
      cantidad,
      valor_unitario: redondear2(valorUnitario),
      codigo_tipo_precio: '01',
      precio_unitario: redondear2(valorUnitario * (gravado ? 1 + TASA_IGV : 1)),
      codigo_tipo_afectacion_igv: afectacion,
      total_base_igv: base,
      porcentaje_igv: gravado ? 18 : 0,
      total_igv: igv,
      total_impuestos: igv,
      total_valor_item: base,
      total_item: redondear2(base + igv),
    }
    return item
  })

  const totalValor = redondear2(gravadas + exoneradas + inafectas + exportacion)
  const igv = redondear2(totalIgv)
  return {
    items: itemsApi,
    totales: {
      total_operaciones_gravadas: redondear2(gravadas),
      total_operaciones_exoneradas: redondear2(exoneradas),
      total_operaciones_inafectas: redondear2(inafectas),
      total_exportacion: redondear2(exportacion),
      total_igv: igv,
      total_impuestos: igv,
      total_valor: totalValor,
      total_venta: redondear2(totalValor + igv),
    },
  }
}

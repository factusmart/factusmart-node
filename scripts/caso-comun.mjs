// Genera resultado_caso_comun.json con el caso de prueba común de DISENO_SDK.md,
// para comparar al centavo con los SDK de PHP y Python.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { calcularComprobante } from '../dist/index.js'

export const ENTRADA_CASO_COMUN = [
  { descripcion: 'A', cantidad: 3, valor_unitario: 10.555, afectacion: '10' },
  { descripcion: 'B', cantidad: 2, valor_unitario: 5, afectacion: '20' },
  { descripcion: 'C', cantidad: 1, valor_unitario: 7.1, afectacion: '30' },
  { descripcion: 'D', cantidad: 1, valor_unitario: 100, afectacion: '40' },
]

const destino = fileURLToPath(new URL('../resultado_caso_comun.json', import.meta.url))
writeFileSync(destino, JSON.stringify(calcularComprobante(ENTRADA_CASO_COMUN), null, 2) + '\n')
console.log('Escrito', destino)

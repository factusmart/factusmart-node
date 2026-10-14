import { FactuSmart } from './cliente.js'

export { FactuSmart, VERSION, fechaHoraPeru } from './cliente.js'
export type { OpcionesCliente } from './cliente.js'
export { calcularComprobante, redondear2 } from './calculo.js'
export {
  FactuSmartError,
  ErrorDeAutenticacion,
  SinCreditos,
  RucNoAutorizado,
  NoEncontrado,
  ErrorDeValidacion,
  LimiteDePeticiones,
} from './errores.js'
export type * from './tipos.js'

export default FactuSmart

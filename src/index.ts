import { FactuSmart } from './cliente.js'

export { FactuSmart, VERSION, fechaHoraPeru, verificarFirmaWebhook } from './cliente.js'
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
  CODIGOS_DE_ERROR,
} from './errores.js'
export type { CodigoDeError } from './errores.js'
export type * from './tipos.js'

export default FactuSmart

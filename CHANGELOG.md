# Cambios

## 1.4.0 — 2026-11-10

- `rucs.configurarSunat(ruc, datos)` acepta la **modalidad de firma** (`PUT /rucs/{ruc}/sunat`):
  `modalidad: 'propio' | 'pse'` y, con Smart PSE, `pse_usuario` + `pse_clave` (las credenciales CPE
  de la empresa en Smart PSE; van juntos o el SDK lanza `ErrorDeValidacion` sin llamar).
- `pse_clave` se reemplaza por `***` en el mensaje, la respuesta y los campos de cualquier error,
  igual que `clave_sol`. El PUT sigue sin reintentarse.
- `entorno: 'demo'` ya no se rechaza localmente (la API lo acepta como sinónimo de `prueba`).
- Tipos: nuevo `ModalidadRuc`; `RespuestaConfiguracionRuc` trae `modalidad`, `pse` (`proveedor`,
  `configurado`, `usuario` enmascarado o `null`) y `aviso`; `RespuestaVerificarRuc` trae `modalidad`
  y `checks.pse`; `FaltanteConfiguracion` suma `pse_credenciales`.

## 1.3.0 — 2026-11-10

- Configuración del RUC por API (tag «Configuración del RUC» del openapi.yaml), en el recurso `rucs`:
  - `rucs.subirCertificado(ruc, certificado, clave)` (`PUT /rucs/{ruc}/certificado`): `certificado`
    es la ruta del .pfx / .p12 o sus bytes (`Buffer`, `Uint8Array`, `ArrayBuffer`); el SDK lo lee y
    lo manda en base64. Ruta inexistente → `ErrorDeValidacion` local, sin petición. No se reintenta.
  - `rucs.configurarSunat(ruc, { usuario_sol, clave_sol, entorno })` (`PUT /rucs/{ruc}/sunat`): solo
    manda los campos dados. No se reintenta.
  - `rucs.verificar(ruc)` (`POST /rucs/{ruc}/verificar`, sin cuerpo) y `rucs.configuracion(ruc)`
    (`GET /rucs/{ruc}/configuracion`): se reintentan como un GET.
  - El RUC va solo en la ruta (nunca `?ruc=`, `X-RUC` ni en el cuerpo) y se valida (11 dígitos)
    antes de llamar.
  - La clave del certificado, la clave SOL y el contenido del certificado se reemplazan por `***` en
    el mensaje, la respuesta, los campos y el stack de cualquier error de estas llamadas.
  - Tipos nuevos: `CertificadoEntrada`, `PeticionSubirCertificado`, `RespuestaSubirCertificado`,
    `DatosSunatRuc`, `EntornoRuc`, `FaltanteConfiguracion`, `RespuestaConfiguracionRuc`,
    `ComprobacionConfiguracion`, `RespuestaVerificarRuc`.

## 1.2.0 — 2026-11-06

- Nuevo recurso `consultas` (`GET /consultas/{tipo}/{numero}`): `consultas.ruc(numero)`,
  `consultas.dni(numero)` y `consultas.documento(tipo, numero)`. Devuelve nombre, dirección, estado,
  condición, ubigeo, `desde_cache` y el cupo (`consultas_restantes`, `periodo`, `se_renueva`). No
  manda el RUC emisor y se reintenta como un GET. Nuevos tipos `RespuestaConsultaDocumento` y
  `TipoDocumentoConsulta`.
- 429 `LIMITE_CONSULTAS` (`reintentable: false`) lanza `LimiteDePeticiones` tras una sola petición;
  `LIMITE_PETICIONES` y 503 `CONSULTA_NO_DISPONIBLE` sí se reintentan. Nuevos códigos en
  `CODIGOS_DE_ERROR`: `LIMITE_CONSULTAS`, `CONSULTA_NO_DISPONIBLE`.
- Nuevo `raiz()` (`GET /`, operación `apiRoot`): confirma que el servicio responde, sin llave. Tipo
  `RespuestaRaiz`.

## 1.1.0 — 2026-10-14

- Los errores traen `codigo` (ej. `NO_AUTENTICADO`, `DATOS_INVALIDOS`), `reintentable` y `campos`
  (errores por campo). Con servidores anteriores que no los mandan: `codigo` y `reintentable` son
  `null` y `campos` es `{}`. Nuevo export `CODIGOS_DE_ERROR` y tipo `CodigoDeError`.
- Reintentos: en las operaciones ya reintentables (GET, `comprobantes.emitir`, `rucs.crear`) también
  se reintenta cuando el API responde `reintentable: true`. Las operaciones que nunca se reintentan
  siguen igual.
- Nuevo `verificarFirmaWebhook(cuerpoCrudo, firma, secreto)` (también `FactuSmart.verificarFirmaWebhook`)
  para validar el header `X-FactuSmart-Firma` de los webhooks.
- `comprobantes.descargar()` de un comprobante inexistente: el API ahora responde 404 en JSON y el SDK
  lanza `NoEncontrado` con su `message` y `codigo: 'NO_ENCONTRADO'`.
- Nuevo `comprobantes.calcular(items, { porcentaje_igv }?)` (`POST /calcular`): FactuSmart calcula
  `items` y `totales`. Admite `precio_unitario` con IGV y la tasa 10.5 % (Ley 31556). No emite ni
  cobra; se reintenta como un GET. `FactuSmart.calcularComprobante` (local, sin red) se mantiene.
- Nuevo recurso `catalogos`: `listar()` (`GET /catalogos`) y `consultar(nombre, { q, ruc }?)`
  (`GET /catalogos/{nombre}`, por nombre o número SUNAT).
- `reintentable: false` en el cuerpo del error manda: no se reintenta aunque el HTTP sea
  429/409/5xx. El 429 `LIMITE_PRUEBAS_DIARIO` (tope de 200 operaciones/día en RUCs demo) lanza
  `LimiteDePeticiones` tras una sola petición.
- `comprobantes.descargar(id, 'pdf', { formato })`: PDF en `a4`, `a5`, `ticket` (= `ticket80`),
  `ticket58` o `ticket50` (`?formato=`). Sin `formato` no se manda el parámetro (A4 de siempre).
  `formato` con `xml`/`cdr` o fuera de la lista lanza `ErrorDeValidacion` (422 local,
  `DATOS_INVALIDOS`, `campos.formato`) sin hacer la petición. Nuevo tipo `FormatoPdf`.
- Nuevo recurso `establecimientos` (anexos): `listar()` (`GET /establecimientos`, se reintenta como
  GET) y `crear(datos)` (`POST /establecimientos`, `ruc` en el cuerpo, nunca se reintenta).
- Nuevo `catalogos.buscarProductoSunat(q, { limite, ruc }?)` (`GET /catalogos/productos-sunat`):
  código de producto SUNAT (catálogo 25) por texto o código.
- `CODIGOS_DE_ERROR` suma `PDF_NO_GENERADO`, `LIMITE_ESTABLECIMIENTOS` y `CATALOGO_NO_DISPONIBLE`.
- Anulaciones de boletas (resumen diario): tipos de `anulaciones.crear` con `tipo` (`baja` |
  `resumen`), `identificador`, `credito_cobrado`, `modo_demo` y `pruebas_restantes_hoy`; y de
  `anulaciones.estado` con `tipo` y `documentos[]`.
- Tipos de emisión y guías con `credito_cobrado`, `modo_demo` y `pruebas_restantes_hoy` (en RUCs
  demo no se cobra crédito).
- `CODIGOS_DE_ERROR` suma `LIMITE_PRUEBAS_DIARIO`, `ANULACION_MIXTA` y `LLAVE_DE_PRUEBA_EN_PRODUCCION`.

## 1.0.x — 2026-10

- Primera versión publicada: cuenta, series, comprobantes, anulaciones, guías y RUCs;
  `calcularComprobante`, reintentos con `Idempotency-Key` y errores tipados.

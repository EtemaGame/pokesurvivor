# Auditoría diferencial: PokéSurvivor original frente al fork

**Fecha:** 2026-10-15  
**Original:** [JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor), `main` @ [`c31715d`](https://github.com/JPTER78/pokesurvivor/commit/c31715d183c0fd0b357e5ebc10fd85606132865e) (14-10-2026).  
**Fork `main`:** [EtemaGame/pokesurvivor](https://github.com/EtemaGame/pokesurvivor/tree/main) @ el mismo `c31715d`.  
**Rama experimental acumulada:** [`fix/cross-device-save-recovery`](https://github.com/EtemaGame/pokesurvivor/tree/fix/cross-device-save-recovery), 43 commits sobre `main` y 18 archivos cambiados.  
**CI experimental:** [ejecución 38759663144](https://github.com/EtemaGame/pokesurvivor/actions/runs/38759663144), correcta; 24 pruebas (4 audio, 6 PWA, 2 borrado, 6 sesiones, 5 recuperación, 1 Chromium).  
**Ámbito:** código público, historial, changelog e incidencias abiertas. Sin cuentas reales, sin acceso administrativo a Firebase y sin pruebas en dispositivos físicos. **La apertura de una incidencia no prueba que el defecto continúe.**

## 1. Incorporado ya en el original: no duplicar

La comparación de SHA de los archivos entre `JPTER78/main` y la rama experimental da **coincidencia exacta** en `js/net/social.js`, `js/net/coop.js`, `js/data/changelog.js`, `js/ui/login.js`, `js/entities/enemy.js` y `js/core/firebase-config.js`.

| Área | Evidencia original | Conclusión |
| --- | --- | --- |
| Amigos e invitaciones con reloj / zona horaria desfasados | `js/net/social.js` calcula `skew` con cabecera HTTP `Date` de `version.json` y utiliza `now()` para presencia / invitaciones; [commit b297089](https://github.com/JPTER78/pokesurvivor/commit/b29708900da26b34e70d2dc07ad1659a719f4a78). | **Corregido en original.** No implementar otra compensación para amigos. |
| Cooperativo bloqueado al elegir cartas/objetos y enemigos invisibles tras grieta | [Changelog 14-10](https://github.com/JPTER78/pokesurvivor/blob/main/js/data/changelog.js), commit b297089; `js/net/coop.js` es idéntico. | **Corrección declarada e incluida.** Si vuelve a suceder, crear reproducción antes de modificarlo; los issues #109/#114 siguen abiertos. |
| Recuperación por Gmail vinculado | [Commit 5374405](https://github.com/JPTER78/pokesurvivor/commit/537440510dcdadf8ed711ec3dea7ae795533a662), `js/ui/login.js`. | **Ya implementado.** No confundir vinculación/recuperación de acceso con migración/recuperación de partidas antiguas. |
| Guardado más frecuente de logros valiosos | [Commit 2420c0f](https://github.com/JPTER78/pokesurvivor/commit/2420c0f627b8a23789b61a000de46d11a5affc6e), `js/core/db.js` ya usa `PUSH_GAP_URGENT`. | **Mejorado en original.** No presentar como una funcionalidad añadida por el fork. |
| Joystick fijo y distribución de botones móviles | [Commit 4de8495](https://github.com/JPTER78/pokesurvivor/commit/4de84950eae7fb269b3a6a26f446179311d09547). | **Ya incluido.** El issue #150 (15-10) sobre cambio de movimientos en teléfono exige reproducir navegador/modelo antes de atribuir una regresión. |

### Precisión sobre los «relojes»

El parche del 14-10 corrige el desfase en **amigos e invitaciones** mediante `G.Social.now()`. El archivo original `js/core/db.js` aún asigna `updated = Date.now()` y `merge(a,b)` escoge el saldo monetario/compañero/pity del guardado con mayor `updated`. Es un **riesgo de diseño a probar con dos relojes distintos**, no una pérdida de cuenta demostrada. No decir que el parche social arregló o dejó de arreglar el reloj de las partidas sin prueba específica.

## 2. Diferencias propias: valor real, grado de evidencia y cautelas

| Módulo | Diferencia frente al original | Evidencia existente | Estado |
| --- | --- | --- | --- |
| `js/core/audio.js` | Suspender Web Audio al ocultar/minimizar, reanudar al volver. | 4 pruebas de API simulada; [issue original #80](https://github.com/JPTER78/pokesurvivor/issues/80) describe problema Android. | **Aportación distinta**, pendiente Samsung Internet/PWA y Safari reales. |
| `sw.js` | Precarga `app.min.js`, CSS y páginas ES/EN; salida offline por ruta; evita cachear infinitos `version.json?t=`. | 6 pruebas de Service Worker simuladas y smoke Chromium. El SW original precargaba HTML/CSS, no el bundle JS durante instalación. | **Aportación distinta**, pendiente actualización real de SW, almacenamiento lleno y primera instalación offline en navegador/PWA. |
| `tools/build.js`, `tools/make_seo_pages.py` | Revisionado reproducible de JS+CSS+HTML, y CSS versionado también en página inglesa. | CI recompila y verifica identificadores/versiones. | **Mejora técnica comprobable**; comprobar implicancias de CDN, despliegue y SEO. |
| `js/core/updater.js` | Evita recargar en lobby cooperativo y otras pantallas. | Prueba simulada. El original recargaba en sala *por decisión explícita* (comentario del autor). | **Cambio de política de UX, no bug demostrado**; documentar trade-off (usuario en lobby podría quedar desactualizado). |
| `js/core/db.js`: aislamiento de sesión / borrado | Captura UID y época para las operaciones asíncronas, bloquea transacciones en borrado. | 2 pruebas de borrado + 6 pruebas con dos cuentas y respuestas retrasadas. | **Prevención razonable de carrera**, pendiente emulador de Firestore/Auth y revisión de fallos parciales. |
| `js/core/db.js`: sincronización de logros | Detecta logros/colecciones recuperados desde copia local vieja y fuerza subida, aunque `updated` sea anterior. | 5 pruebas simuladas, incluida PC -> nube -> móvil. El original fusiona progresos **en memoria** pero no siempre los sube en ese inicio si la caché era más antigua. | **Diferencia comprobada en lógica**, pero no afirmar pérdida irreversible: una subida posterior puede recuperar los logros. |
| `js/core/db.js`: documento remoto incompleto | Aborta la apertura si un documento existe pero no contiene un `save` reconocible. | Prueba simulada de documentos incompletos. | **Protección experimental que requiere revisión antes de desplegar**; la validación es heurística y `ready()` registra error pero no muestra mensaje de recuperación en arranque automático. |

**Regresión CI:** el test Chromium usa viewport PC y emulación móvil horizontal, pero **no** hace interacción de juego, no prueba Android/Safari/Firefox, y arranca Chrome con `--disable-gpu`: no valida consumo de GPU ni temperatura.

## 3. Problemas que requieren reproducción, no otro parche anticipado

1. **Google devuelve cuenta nueva / progreso ausente**: [#149](https://github.com/JPTER78/pokesurvivor/issues/149), [#120](https://github.com/JPTER78/pokesurvivor/issues/120), [#121](https://github.com/JPTER78/pokesurvivor/issues/121), [#119](https://github.com/JPTER78/pokesurvivor/issues/119). La migración al proyecto Firebase `pokesurvivor-free` aparece en el historial, pero **no demuestra** la causa de estos casos. Requiere comparar UID, proveedor de Authentication, proyecto Firebase y documentos disponibles, **sin utilizar datos privados de jugadores ni escribir producción**.
2. **Selección de movimientos en teléfono**: [#150](https://github.com/JPTER78/pokesurvivor/issues/150) posterior al parche móvil. Reproducir en navegadores y dispositivos concretos y comparar con los cambios oficiales antes de tocar input.
3. **Curación acumulada de enemigos**: [#140](https://github.com/JPTER78/pokesurvivor/issues/140), código original idéntico en el fork. Buen candidato a caso de prueba determinista de balance, sin asumir que cualquier ajuste será aceptable.
4. **Marcadores de tiempo de guardado y saldos concurrentes**: probar dos relojes con desvío de horas/días, actualizaciones simultáneas y gasto de monedas/tickets; no sumar balances como si fueran logros. Una reconciliación correcta probablemente necesita eventos/revisiones de servidor, no otra regla simple de máximo.

**Evitar duplicar PRs ajenos aún abiertos:** [#146](https://github.com/JPTER78/pokesurvivor/pull/146) iOS, [#144](https://github.com/JPTER78/pokesurvivor/pull/144) seguridad, [#102](https://github.com/JPTER78/pokesurvivor/pull/102) GPU, [#147](https://github.com/JPTER78/pokesurvivor/pull/147) mandos. Ninguno debe tratarse como fusionado solo por estar propuesto.

## 4. Próximas pruebas con criterios de aceptación

| Prioridad | Prueba | Criterio mínimo |
| --- | --- | --- |
| P0 | **Emuladores Auth + Firestore**: cuenta A y B, writes retrasados, timeout, logout, eliminación cancelada | UID correcto siempre; ninguna escritura a otro UID; caché local recuperable. |
| P0 | **Doble dispositivo con tiempo incorrecto**: progresos contradictorios, monedas, pity y recompensas | Definir resultado esperado de cada campo *antes* del test; ningún saldo se duplica o retrocede silenciosamente. |
| P1 | **Navegador y PWA real**: Chrome y Firefox PC, Chrome/Samsung Internet Android, Safari iOS | Audio se suspende al minimizar, guardado local persiste, instalación y vuelta offline funcionan. |
| P1 | **Nueva sesión de Google**: emulador y cuenta de prueba sin valor real | Nunca crear/sobrescribir partida por un fallo transitorio de lectura; diagnóstico visible y seguro. |
| P2 | **Co-op y entrada móvil** solo si se reproduce regresión en original | Secuencia mínima registrada y test que falla en baseline `c31715d` y pasa con la corrección. |

El fork en otro dominio pasa a modo local por la comprobación `HOSTS` en `js/core/db.js`; para ensayar nube sin tocar producción se debe configurar **Firebase Emulator Suite** y `emulator: true`. No usar cuentas reales ni intentar reutilizar el backend oficial.

## 5. Reglas de continuación

- Separar cada arreglo en rama/commit pequeño y guardar reproducción antes de editar fuente.
- Exigir comparación con original vigente; marcar **ya corregido**, **nuevo probado** o **hipótesis**.
- Mantener los experimentos acumulados sin fusionar a `main` hasta completar pruebas de emuladores y dispositivos reales.
- No abrir PR ni modificar el repositorio original sin autorización expresa.

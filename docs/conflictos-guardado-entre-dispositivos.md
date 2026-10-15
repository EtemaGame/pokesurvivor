# Protección de conflictos de guardado entre dispositivos (15-10-2026)

Rama experimental: `fix/offline-concurrent-save-conflicts`, heredada de `fix/save-clock-proof`. No se toca `main` ni se publica en `JPTER78/pokesurvivor`.

## Prueba de referencia que fallaba

`test/concurrent-save-baseline` usa el mismo código del fork anterior. Las dos pruebas añadidas fallan en [CI 38774326772](https://github.com/EtemaGame/pokesurvivor/actions/runs/38774326772).

- A y B parten de 500 monedas, ambos gastan 100 sin recibir el cambio remoto. El `merge()` previo unía las dos mejoras pero dejaba 400 monedas: **dos compras por un cargo**.
- Un navegador reabre una partida modificada offline mientras otro ya guardó otro gasto: el login anterior fusionaba sin comparar el saldo base, con riesgo de sobrescritura silenciosa.

## Política implementada

1. Por UID, se almacena por separado en `ps.cloudbase.<uid>` una **instantánea económica de la última lectura/confirmación remota** (`coins`, tickets, pity, upgrades, pupg). Es distinta de la copia local íntegra `ps.cloud.<uid>`. También sobrevive a un cierre offline.
2. En la apertura de sesión y en cada transacción, se efectúa una conciliación de tres vías: base conocida, copia local y copia remota.
3. Si dos dispositivos modificaron **el mismo campo económico** desde esa base, incluso si ambos terminan con el mismo saldo, el juego **no elige automáticamente un ganador**. La nube conserva su versión, la partida local sigue en el navegador, la sincronización se detiene (`syncState = 'conflict'`) y la interfaz muestra un aviso visible de color rojo. No se hacen reintentos automáticos de un conflicto sin resolver.
4. Si sólo un lado cambió un campo económico, se conserva ese cambio independientemente de cuál de las dos partidas tenga el `updated` más reciente. Los Pokémon, shinies y logros siguen fusionándose mediante unión / máximo.
5. El control también comprueba modificaciones económicas del usuario mientras una transacción está en curso, y fija la instantánea al UID original para evitar interferencia entre sesiones.

## Alcance y limitaciones

- No suma monedas ni tickets de dos dispositivos ciegamente: eso duplicaría recompensas o compras. No intenta resolver automáticamente dos cambios económicos simultáneos. **Este estado necesitará una futura interfaz de revisión y resolución explícita de conflictos**, con exportación de ambas copias.
- Requiere una base remota conocida. Usuarios con partidas antiguas previas a este cambio carecen de esta base hasta su primera lectura online correcta; no se afirma retrocompatibilidad causal total.
- Los cambios en otros campos no económicos (por ejemplo, algunas preferencias) aún usan la regla de `updated`; tampoco constituye un libro contable de operaciones.
- Las pruebas de doble dispositivo ejecutan el `db.js` real bajo VM con Firestore simulado. La suite de Firebase Auth + Firestore Emulator prueba permisos/segregación con reglas reales, **pero no el flujo completo de dos navegadores con SDK Firebase conectado al emulador**.
- Ningún test usa credenciales ni datos de producción. El entorno usa el proyecto explícito `demo-pokesurvivor`.

## Cómo verificar

`node --test tests/save-recovery.test.cjs` y `node --test tests/account-session.test.cjs`.

Pipeline de la rama: pruebas de audio, PWA, integridad de borrados, sesiones, 10 casos de recuperación/concurrencia, Firebase Emulator Suite y smoke de Chromium. Consultar GitHub Actions de la rama para resultados exactos y finales.

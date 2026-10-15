# Resolución manual de conflictos de guardado

**Rama:** `feat/save-conflict-review` (derivada de `fix/offline-concurrent-save-conflicts`). No se toca `main` ni el repositorio original.

## Problema reproducido

Dos dispositivos pueden comenzar con el mismo saldo y gastar monedas sin sincronizarse. La fusión anterior reunía mejoras compradas por ambos pero reflejaba solo un gasto. El arreglo previo detectaba el conflicto y suspendía la sincronización, pero no ofrecía al jugador elegir y resguardar su partida.

## Qué ve el jugador

1. El indicador de cuenta se pone rojo y aparece **Revisar conflicto de guardado** en el menú. La pantalla de comparación se abre al volver al menú.
2. Se leen de nuevo las dos versiones completas (este dispositivo y Firestore); se presentan saldos, tickets, colecciones, mejoras, logros y estadísticas.
3. El jugador debe pulsar **Descargar ambas copias (.json)** y comprobar que se ha guardado el archivo; el juego exige además marcar la casilla de confirmación. El archivo contiene ambas partidas: conservarlo en un lugar privado.
4. Puede **usar la partida de la nube** (no escribir Firestore, descartar localmente la versión conflictiva) o **sustituir la nube por este dispositivo** (transacción que verifica que la nube NO ha cambiado desde la consulta).
5. Antes de reemplazar, se archivan en el navegador **las dos versiones completas** en claves inmutables `ps.conflictbackup.<uid>.<fecha>-<id>-<aleatorio>`; no se sobrescriben respaldos anteriores. El menú permite descargar el último respaldo tras resolver.
6. Las copias no se fusionan automáticamente. Al elegir, puede quedar progreso exclusivo de la otra versión **sólo en el archivo de respaldo**. No existe todavía una importación automática de este archivo al juego.

### Seguridad, fallos y cambios simultáneos

- La API no admite resolución fuera del estado `conflict`, ni sin revisión activa del UID correcto.
- Se verifican cambios del guardado local y del documento completo de Firestore entre comparar y confirmar; una versión desfasada obliga a revisar de nuevo.
- La elección que escribe nube ocurre dentro de `Firestore.runTransaction`, con lectura y validación previas y preservando el campo administrativo `ban`.
- Si falla el almacenamiento local de **las dos copias**, se cancela la decisión sin tocar la nube.
- Si falla la transacción, no se borra la partida local y el archivo de respaldo ya guardado permanece; se puede reintentar.
- Si se juega mientras la transacción está pendiente, no se pisan las modificaciones posteriores. Se mantiene el bloqueo y se exige revisar nuevamente.
- Al borrar definitivamente la cuenta, se eliminan todos sus respaldos y su base de conciliación de este navegador, pero no los de otras cuentas.

### Limitaciones

La protección utiliza el almacenamiento del navegador: el sistema operativo puede borrarlo por falta de espacio o cuando el usuario limpia datos; **descargar el archivo es indispensable** si se requiere una copia duradera. El archivo puede contener progreso personal, y no debe publicarse en incidencias abiertas.

La comparación se limita a dos versiones y a un historial económico observado anteriormente. No implementa un registro de operaciones con control del servidor: **no puede arbitrar de forma automática compras paralelas**, ni reconstruir perfectamente cuentas antiguas anteriores a la captura de la base conocida. Elegir una versión completa es una decisión del jugador, no una fusión de balances.

### Comprobaciones

- `tests/save-recovery.test.cjs`: conflictos, revisión, elección local/nube, cambios de remoto/local, recarga, límites de espacio, transacción fallida y modificaciones durante la transacción.
- `tests/save-integrity.test.cjs`: borrado de todos los respaldos del UID al borrar la cuenta.
- `tests/firebase-emulator-save.test.cjs`: reglas reales Auth + Firestore Emulator con `demo-pokesurvivor`, sin acceso al proyecto de producción.
- `tests/browser-chromium.test.cjs`: HTML ES/EN, carga del diálogo, bloqueo inicial de botones y geometría en viewport móvil.

**No se ha comprobado aún** una sesión completa de dos PWA o dispositivos físicos con Firebase real; las pruebas VM usan el código real `db.js` y Firestore simulado, mientras las pruebas de reglas usan emuladores. La decisión de fusionar esta rama requiere validación manual UX y pruebas en Android/iOS.

## Comandos

```sh
node --test tests/save-recovery.test.cjs tests/save-integrity.test.cjs
GCLOUD_PROJECT=demo-pokesurvivor npx --yes firebase-tools@14.12.0 emulators:exec --project demo-pokesurvivor --only auth,firestore --non-interactive "node --test tests/firebase-emulator-save.test.cjs"
```

No abrir PR al original ni fusionar en `main` sin autorización.

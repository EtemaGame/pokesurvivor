# PokéSurvivor: laboratorio privado para amigos

**Rama:** `feat/group-playtest-sandbox` de `EtemaGame/pokesurvivor`.

El laboratorio sirve para partidas con 2–4 amigos, sin usar cuentas, monedas ni bases de datos de pokesurvivor.com. **No es la web oficial**. No tiene permisos de administrador de Firebase ni permite administrar las cuentas de otros jugadores.

## Qué funciona

- El código incluye la transición de subida de nivel (cámara lenta en solitario), la pausa cooperativa original y la protección temporal de un segundo después de elegir y al regresar de grietas.
- Cada amigo crea una cuenta temporal mediante el registro normal (apodo y contraseña de al menos 6 caracteres).
- Tras elegir su Pokémon inicial aparece **Laboratorio → Preparar cuenta DEV** en el menú: desbloquea todos los Pokémon del juego, sus shiny con sprite disponible y prepara 50.000 monedas, 200 tickets normales y 20 de diez tiradas. Una nueva pulsación solo repone hasta esos importes, no los duplica.
- Una cuenta DEV **no** tiene privilegios administrativos, logros regalados ni cambios automáticos a sus estadísticas o récords.
- Si no se configura Firebase de pruebas, el juego funciona **solo en modo local** y no permitirá cooperativo.

## Preparación única (responsable del grupo)

1. En [Firebase Console](https://console.firebase.google.com/) crea un proyecto **NUEVO** cuyo **ID** empiece por `ps-test-`, por ejemplo `ps-test-mi-grupo-26`. Sin Analytics, en el plan gratuito Spark. No uses `pokesurvivor-free` ni una cuenta o configuración del creador.
2. Activa **Authentication → Sign-in method → Email/Password**. Google no hace falta para las cuentas de prueba.
3. Activa **Firestore Database** (modo producción/restringido) y **Realtime Database** (modo bloqueado). Copia la URL completa de Realtime Database.
4. Activa **Hosting**, registra una app **Web** en el proyecto y copia los valores del objeto `firebaseConfig`.
5. En tu ordenador instala **Node.js 22**, **Python 3** y Git. Clona la rama:
   ```bash
   git clone --single-branch --branch feat/group-playtest-sandbox https://github.com/EtemaGame/pokesurvivor.git
   cd pokesurvivor
   ```
6. Crea en la raíz un fichero **`playtest-config.local.json`** (está excluido de Git) con los valores **de TU nuevo proyecto**:
   ```json
   {
     "apiKey": "LA_API_KEY_DE_TU_NUEVA_APP_WEB",
     "authDomain": "ps-test-mi-grupo-26.firebaseapp.com",
     "projectId": "ps-test-mi-grupo-26",
     "appId": "EL_APP_ID_DE_TU_NUEVA_APP_WEB",
     "messagingSenderId": "EL_SENDER_ID_DE_TU_APP_WEB",
     "storageBucket": "EL_BUCKET_DE_TU_APP_WEB",
     "databaseURL": "https://ps-test-mi-grupo-26-default-rtdb.europe-west1.firebasedatabase.app"
   }
   ```
   El valor de `databaseURL` tiene que ser el **real** que muestra tu consola (la región puede cambiar). Estos identificadores web no son una contraseña ni una clave de administración.
7. Inicia sesión en Firebase CLI y publica:
   ```bash
   npx --yes firebase-tools@14.12.0 login
   node tools/deploy-playtest.cjs
   ```
   El despliegue crea la web estática y aplica las reglas de Firestore y Realtime Database **en el proyecto de pruebas**. El script rechaza IDs sin el prefijo `ps-test-` y no utiliza un proyecto por defecto. La primera publicación puede necesitar crear el sitio Hosting desde Firebase Console.

## Compartir el enlace

Cuando el despliegue termine correctamente, abre `https://ID-DE-TU-PROYECTO.web.app/` y compártelo **solamente** con tus amigos. Verificad en el juego que aparece «VERSIÓN EXPERIMENTAL». **No uséis vuestro apodo/contraseña habitual ni entréis con Google.**

Cada uno:

1. Elige **Crear cuenta** y registra un apodo nuevo.
2. Completa una vez la elección del Pokémon inicial.
3. Desde el menú pulsa **Preparar cuenta DEV** para desbloquear la Pokédex. Se puede jugar con mejoras normales y hacer compras usando monedas de prueba.
4. Agrega a tus amigos y crea una sala con 2–4 personas.

En móviles: abrir con navegador moderno. El cooperativo requiere **WebRTC directo** y puede fallar en algunas redes móviles, aun con Firebase bien configurado: no hay servidor TURN.

## Pruebas prioritarias

- Subid de nivel cerca de una horda: no deben elegirse cartas accidentalmente; tras elegir, el jugador dispone de un segundo protegido.
- En grupo: nadie recibe inmunidad extra mientras siga esperando a que otro termine de escoger su carta; el reloj sigue compartido.
- Volved de una grieta con enemigos cerca: deben transcurrir aproximadamente un segundo sin daño. La lava debe volver a dañar cuando pase ese periodo.
- Probad distintos Pokémon, shinies y velocidades de juego. La cámara lenta breve solo se activa en solitario.
- Registrad errores con navegador, conexión, pasos y captura.

## Seguridad, costes y límites

- El sitio está marcado **noindex**. Aun así, el enlace es público para quien lo conozca. No compartáis datos personales, contraseñas reales ni archivos de partidas reales.
- Firestore y Realtime Database usan las reglas del repositorio del juego, publicadas en un proyecto diferente. Cada jugador solo puede modificar su propio guardado; la función DEV no da acceso administrativo.
- Los límites gratuitos y las restricciones de red siguen aplicándose. No se garantiza que todos los routers o datos móviles permitan conexiones WebRTC directas.
- La rama original `main` y el proyecto `JPTER78/pokesurvivor` **no se modifican**. No se utiliza el Firebase oficial.
- Las contraseñas de prueba se eliminan al borrar el proyecto Firebase del laboratorio; no reutilizar contraseñas reales.

# Laboratorio PokéSurvivor con amigos — solo móvil

Proyecto **de pruebas**: `ps-test-etema-261016`, **no** el juego oficial. Rama exclusiva: `feat/group-playtest-sandbox`. Todos los datos de partida y los usuarios son nuevos e independientes.

## Ya configurado

- Firebase Authentication: acceso con apodo y contraseña (internamente email/contraseña).
- Cloud Firestore y Realtime Database en un proyecto nuevo.
- App web registrada; `playtest-config.json` contiene solo los identificadores **públicos** del cliente.
- Rama de laboratorio con perfiles DEV: toda la Pokédex y shiny disponible, 50.000 monedas, 200 tickets individuales y 20 tickets ×10 por cuenta. Los recursos se reponen hasta ese máximo, no se multiplican pulsando el botón. **No** hay administradores con control sobre otras cuentas.
- Pruebas automáticas de seguridad y jugabilidad y empaquetado, sin credenciales administrativas.

## Publicación desde un teléfono con Chrome

**No se requiere PC.** La única intervención necesaria en infraestructura es desde Google Cloud Shell:

1. Abre [Google Cloud Console](https://console.cloud.google.com/) con la **misma cuenta de Google** que creó el Firebase.
2. Si la interfaz es diminuta en el móvil, usa en Chrome **⋮ → Sitio para ordenador**.
3. Comprueba en la barra superior que el proyecto seleccionado es `ps-test-etema-261016`.
4. Abre **Cloud Shell** (icono terminal `>_` en la parte superior). Espera a que cargue. Cloud Shell tiene cuotas y algunas cuentas pueden necesitar aceptar sus términos antes de iniciarlo.
5. Copia y pega estas líneas en la terminal, **una por una o juntas**:
   ```bash
   git clone --depth 1 --branch feat/group-playtest-sandbox https://github.com/EtemaGame/pokesurvivor.git
   cd pokesurvivor
   cp playtest-config.json playtest-config.local.json
   node tools/deploy-playtest.cjs
   ```
6. Si la terminal solicita iniciar sesión en Firebase, ejecuta:
   ```bash
   npx --yes firebase-tools@14.12.0 login --no-localhost
   ```
   Abre la URL indicada en el navegador, autoriza con **la misma cuenta del proyecto de pruebas**, copia el código de autorización a la terminal y vuelve a ejecutar `node tools/deploy-playtest.cjs`.

Este script exige un proyecto cuyo ID comience por `ps-test-`, usa el ID explícitamente en cada despliegue, publica la web de prueba y aplica las reglas Firestore/Realtime Database **solo en ese proyecto**. No modifica `main`, no toca `pokesurvivor.com` y no realiza cambios en el Firebase del autor.

Si Hosting no estaba habilitado, entra primero en **Firebase Console → Hosting → Comenzar** para activar el sitio predeterminado del proyecto (sin contratar plan Blaze) y después repite el despliegue.

## Enlace esperado tras desplegar correctamente

`https://ps-test-etema-261016.web.app/`

No es un enlace operativo hasta que la consola confirme **Deploy complete**. El sitio se indexa como **noindex**; aun así, cualquiera con la URL puede visitarlo.

Si las cuentas dan error de «dominio no autorizado», abre Firebase Console → **Authentication → Configuración → Dominios autorizados** y agrega `ps-test-etema-261016.web.app`. La versión `.firebaseapp.com` puede estar autorizada automáticamente.

## Para los amigos

- Compartir el enlace solo después de que la web esté publicada.
- Usar **cuentas nuevas de laboratorio** con contraseñas distintas a las oficiales. No utilizar Google ni contraseñas reales del juego.
- Cada persona pasa la elección inicial y pulsa **Preparar cuenta DEV** en el menú para probar cualquier Pokémon, incluido shiny cuando exista.
- Entrar a Amigos, agregarse y probar cooperativo con 2–4 personas. El anfitrión puede invitar aunque el indicador de presencia del amigo esté retrasado; si la sala falla, ahora se muestra el código de error para diagnosticar las reglas.
- Subida de nivel: las cartas aparecen en pausa, sin elección accidental los primeros 0,4 s; al terminar de elegir (todos en cooperativo), hay cámara lenta 0,85 s al 35 % del ritmo normal, **sin inmunidad extra**.
- Al volver de una grieta: cámara lenta 0,85 s al 35 % del ritmo, **no escudo**. El daño de enemigos y lava sigue siendo posible. Si aparece una elección de vínculo, el efecto espera al regreso al combate.
- Revisar que las cuentas se sincronizan entre dispositivos y que no hay fallos de conexión.

## Restricciones

- La web se ejecuta con reglas de Firebase protegidas y cuentas normales, no acceso administrativo.
- El enlace es público aunque no aparezca en buscadores. No compartir datos personales.
- WebRTC del juego necesita conexión directa: algunas redes móviles pueden bloquear el cooperativo. No hay servidor TURN.
- Recursos e inventario DEV **solo en este proyecto**, nunca en cuentas oficiales.
- La API Key del cliente de Firebase es un identificador público, pero **no** publiques claves de cuenta de servicio, tokens administrativos, contraseñas ni códigos OAuth.

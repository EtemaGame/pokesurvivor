# Digimon Survivor — diseño técnico v0.1

Estado: diseño inicial. Rama de trabajo aislada; no modifica la experiencia Pokémon existente.

## Objetivo
Fangame gratuito, sin transacciones, basado en el motor Canvas 2D de PokéSurvivor.
Todos los Digimon obtenidos son jugables directamente; no existe digievolución durante la partida.

## Loop
Seleccionar Digimon → partida Survivor → recompensas → gacha / mejoras → nueva partida.

## MVP
- 8–12 especies con recursos utilizables y procedencia documentada.
- Una partida de 10 minutos, un jefe y tres arquetipos enemigos.
- Catálogo y selección, atributos Vacuna/Datos/Virus/Libre y ataques diferenciados.
- Gacha general y dos banners Field; pity y puntos de selección.
- Duplicados convertidos en DigiCoins; DigiTickets obtenidos jugando.
- Mejoras permanentes por especie y persistencia local versionada.
- Sin multijugador ni Firebase en v0.1.

## Datos
Separar species, skills, fields, banners y balance del motor. IDs estables, sin lógica dependiente de nombres.
Cada sprite requiere ruta, fuente, autor, estado de permiso y metadatos de animación.
No publicar recursos de terceros sin autorización. La licencia del código no cubre los personajes de Digimon.

## Gacha
Rarezas objetivo: Rookie 50%, Champion 30%, Ultimate 15%, Mega 4%, Ultra 1%.
No habilitar una rareza sin especies disponibles; redistribuir y mostrar las tasas efectivas.
Seleccionar primero rareza y luego especie de forma uniforme dentro del pool filtrado.
Pity por banner con contador persistente y canje de puntos para una especie elegida.
Duplicados: moneda universal; primera copia desbloquea la especie.
Todos los premios se validan contra el catálogo disponible.

## Arquitectura
Mantener Canvas, movimiento, enemigos y proyectiles existentes.
Implementar módulos de catálogo, combate Digimon, banners, colección, economía y guardado.
Editar dev.html como fuente; index.html se genera con tools/build.js.
Evitar tocar sistemas de red hasta cerrar el MVP local.

## Roadmap y pruebas
1. Auditoría: identificar puntos de extensión, scripts y guardado; verificar arranque original.
2. Vertical slice: un Digimon, sprite permitido o placeholder propio, ataque y partida completa.
3. Catálogo: 8–12 especies y validación automática de IDs, recursos y habilidades.
4. Gacha: distribución, pity, selector, duplicados y pruebas deterministas con RNG inyectado.
5. Economía: mejoras y persistencia; pruebas de migración y recarga.
6. UI: DigiDex, banners, resultados y mensajes de error.
7. QA: smoke test de arranque, partida de 10 minutos, reinicio, guardado, integridad de colección y rendimiento.

## Criterios de aceptación
- Arranque sin errores y partida terminable.
- Ningún personaje no desbloqueado seleccionable.
- Ninguna recompensa pierde o duplica monedas por error.
- Tasas de gacha suman 100% para cada banner activo.
- Guardado y carga preservan colección, mejoras y contadores.
- Sin recursos gráficos redistribuidos sin derechos verificados.

## Riesgos
La auditoría anterior solo identificó candidatos: no verificó individualmente animaciones, ataques ni permisos.
Revisar obligaciones de PolyForm Noncommercial y avisos de copyright originales.

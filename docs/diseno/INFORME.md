# MBA FC: auditoría de diseño y propuesta de colores por club

Fecha: 2026-11-02 · Alcance: solo auditoría y propuesta. No se cambió código, no hubo commit ni push y no se tocó la base de datos (`git status` quedó limpio).

**Cómo se miró.** No usé páginas mock dentro del repo. Monté un **Supabase falso** fuera del repo, en el scratchpad (hoy en `docs/diseno/arnes/server.mjs`: PostgREST + auth con datos de ejemplo). Luego levanté `next dev` con `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321` por variable de entorno, sin tocar `.env.local`. Así se renderizaron **las pantallas reales**: inicio, admin, votación, puntaje, historial, perfil y login, y además sus rutas de API (fondo, puntaje, evaluaciones, equipos). Usé Chromium, 390×844, `isMobile`/`hasTouch` y DPR 2. Todas las capturas dieron `scrollWidth = 390` y ningún `pageerror`.

Hay huecos que salen de los datos de ejemplo y no de la app: en Admin → Historial dice "0 jugadores", `/historial` no muestra los reconocimientos y algunos textos de `motivos` no tienen el formato real. **Safari/iOS no se pudo verificar.** Cada punto específico de iOS lo marco como *no comprobado*.

Las capturas están en esta misma carpeta. `NN-nombre.png` es la página completa; `NN-nombre-K.png` son cortes de 844 px, una pantalla de teléfono cada uno.

---

## 1. Resumen ejecutivo

1. **11 campos de formulario harán zoom en iOS** al tocarlos, con la letra entre 12 y 13 px. Es la trampa nº 1 de la skill y sigue viva en `/historial` (los 4 selectores, todos los jugadores) y en el panel. La receta de búsqueda de la skill **no los detecta**: su regex corta en el primer `>`, y el `=>` de un `onChange` la termina antes de llegar al `style`. **P0, esfuerzo S.**
2. **El gris secundario no se lee al sol.** `--text-dim` (#666) da **3.0–3.5:1** y es el color más usado de la app (206 usos). Casi siempre va en 9–11 px: el **46 %** de los `fontSize` declarados son ≤ 11 px. Los bordes (#222 sobre #111) dan **1.19:1**, así que tarjetas e inputs pierden su contorno.
3. **Tamaños táctiles.** En la votación, 152 de 153 elementos tocables miden menos de 44 px (los chips de 34 px). La barra del inicio tiene "Notificaciones", avatar y "Salir" a **28 px** de alto, uno al lado del otro. En el panel, cada inscrito lleva un "REMOVER" rojo en texto suelto: el mismo patrón que §6 ya quitó del historial porque se tocaba sin querer.
4. **Tipografía sin sistema.** Conviven cuatro familias. DM Serif Display es la fuente por defecto del `<html>` y pinta los nombres del inicio. DM Mono va en 430 elementos. Bebas Neue va en los titulares. Y la **fuente del sistema** aparece sola en todos los `<button>` sin clase, porque los botones no heredan la fuente; por eso los nombres del panel de jugadores salen en otra letra. Hay 9 radios de esquina distintos y 151 `letterSpacing` sueltos.
5. **Lo que está bien:** la jerarquía de la tarjeta de resultado, la foto con fondo desenfocado, los colores de rol en la lista del panel, el dorsal como avatar, el aviso de foto y la barra de cupos. Hay que mantenerlos.
6. **Colores configurables, factible sin migración.** Va en `app_settings`, clave `tema`, con una acción `guardar_tema` siguiendo el patrón de `guardar_tiers`. Se inyecta como `<style>` en el `<head>` desde `layout.tsx` (SSR, sin parpadeo). El club elige **primario + acento + fondo (de 3 presets oscuros)** y el resto se deriva con contraste garantizado.
7. **El bloqueo real es otro: el verde significa dos cosas.** `var(--green)` (122 usos) es a la vez la marca y "subió / confirmado / ok". Hay que separarlo antes de dejar que un club elija rojo. Además hay **262 hex sueltos** en la UI, sin contar `email.ts` ni `tier.ts`, que hay que pasar a tokens. Es el grueso del trabajo, y se puede hacer **sin ningún cambio visual**, verificable con capturas comparadas.

---

## 2. Auditoría por pantalla

### 2.0 Contraste: los pares de color reales (WCAG 2.x)

| Par (texto/fondo) | Ratio | Uso | Veredicto |
|---|---|---|---|
| `--text` #fff / `--bg` #080808 | 20.0 | texto principal | ✓ |
| `--text-muted` #a0a0a0 / `--bg-card` #111 | 7.2 | texto secundario | ✓ |
| **`--text-dim` #666 / `--bg-card` #111** | **3.29** | 206 usos, casi siempre 9–11 px | ✗ (pide 4.5) |
| **`--text-dim` #666 / `--bg-elevated` #1a1a1a** | **3.03** | placeholders, ayudas en inputs | ✗ |
| `--text-dim` / fondo de rol admin #1c1503 | 3.16 | metadatos en tarjetas de admin | ✗ |
| `--green` #4ade80 / #111 | 10.8 | marca, positivos | ✓ |
| #080808 / `--green` (btn-primary) | 11.5 | botón principal | ✓ |
| `--amber` / #111 | 11.3 | avisos, admin | ✓ |
| `--red` #f87171 / #111 | 6.8 | error, negativo | ✓ |
| **#7f1d1d como texto / #080808** | **2.0** | "Resetear equipos" `TabEquipos.tsx:580`, botón de `TabJugadores.tsx:469`, ✕ de `TabEquipos.tsx:647` | ✗ |
| **#16a34a como texto / #111** | 5.7 | | ✓, pero blanco sobre #16a34a da 3.3 ✗ |
| **`--border` #222 / #111** | **1.19** | contorno de toda tarjeta | ✗ (componentes UI piden 3:1 en inputs) |
| `--border-light` #2a2a2a / input #1a1a1a | 1.21 | contorno de input | ✗ el campo no se ve como campo |
| superadmin #a78bfa / #150b26 | 7.0 | rol | ✓ |
| portero #818cf8 / #111 | 6.3 | | ✓ |

El ✗ de `--text-dim` es el más caro: es la letra de las explicaciones ("Los invitados están en lista de espera…"), de los `motivos` del puntaje, de las fechas del log y de las etiquetas. **#8a8a8a da 5.5:1** sobre #111 y conserva la jerarquía frente a `--text-muted`.

### 2.1 Inicio con partido abierto (`01-inicio*.png`, `src/app/page.tsx`)

**Lo que funciona**
- El orden es correcto: próximo partido → cupos → tu estado → lista. La barra de 14 cupos se lee de un vistazo y "1 en lista de espera" en ámbar explica el 13/14.
- Tu fila va resaltada con borde verde y "TÚ" (`01-inicio-2.png`).
- El aviso de foto en ámbar es visible sin ser modal (respeta §6).

**Lo que no**
- **El nombre del club se corta a "M"** en la barra si eres admin y no diste permiso de notificaciones (`01-inicio-1.png`, `page.tsx:593-616`). El `ellipsis` se come todo el espacio porque a la derecha van ADMIN ↗, 🔔 Notificaciones, el avatar y Salir. Por eso se lee "MADMIN ↗".
- **Tocables de 28 px en la barra** (medidos): 🔔 Notificaciones 148×28, avatar 28×28, Salir 66×28, ADMIN 57×16. "Salir" queda a 14 px del avatar: un toque fallido cierra la sesión.
- **El héroe "MBA / FC" en Bebas de 64 px ocupa unos 250 px** de la primera pantalla (`page.tsx:1137-1150`) y no aporta información, porque el nombre ya está en la barra. Empuja el estado ("Confirmado / Cancelar") hasta y≈620 de 844.
- "3 de noviembre · 7:00 / PM" parte la hora en dos líneas al lado de "MARTES".
- **Lista de jugadores:** 12 filas de ~45 px con el nombre en **DM Serif Display** porque no llevan clase y heredan la serif del `<html>`. No muestran el dorsal, que la tarjeta de resultado de más abajo sí muestra. La misma persona aparece con dos tratamientos en la misma pantalla.
- El formulario de invitados (`MisInvitados`) va siempre desplegado. Ocupa ~300 px y el `+ AGREGAR` deshabilitado parece un botón roto (borde #222 de 1.19:1). El checkbox mide 13×13 sin label clicable más grande.
- "Ver las reglas y simular →" mide 13 px de alto como objetivo táctil.

### 2.2 Tarjeta de resultado (`01-inicio-3.png`, `03-inicio-puntaje-abierto-*.png`, `MatchResultCard.tsx`)

**Funciona bien** y es la pieza mejor resuelta de la app. La foto 16:9 con `contain` y fondo desenfocado, "EQUIPO BLANCO 🤍 6-4" en Bebas, los reconocimientos con emoji, dorsal, categoría y votos, el EMPATE en ámbar, el punto de equipo con anillo y la sección de puntaje plegada con "TÚ +0.02" en la cabecera. Todo coincide con §6.

**Detalles**
- El marcador "6 - 4" va en verde de marca (`MatchResultCard.tsx:278`). El verde ahí no significa nada: no es "ganaste". Cuando el color sea configurable debería ir en `--text`, o resaltar el número del ganador.
- El negativo usa `'#f87171'` hardcodeado (`:132`) mientras el positivo usa `var(--green)`. Es justo la asimetría que rompe el tema.
- Los `motivos` del puntaje van en #666 con 12 px (`-4.png`): **3.3:1**, y es el texto que explica "por qué me movió", que fue el reclamo que originó `/puntaje`.
- 🖤 sobre fondo #111 casi no se ve, tanto en "EQUIPO NEGRO 🖤" (`40-historial.png`) como en el panel (`1x-admin-historial.png`). El punto de equipo ya lo resolvió con un anillo; el emoji no.

### 2.3 Votación (`20-evaluar-*.png`, `src/app/evaluar/[partido_id]/page.tsx`)

**Funciona:** el aviso de cierre ("cierran esta noche a medianoche") en ámbar. El estado seleccionado es claro: chip verde lleno, ✓ y nombre debajo de la categoría, borde de la tarjeta en verde.

**No funciona**
- **8 categorías × 14 chips + 13 filas de pulgares dan unos 4.200 px de página.** Los chips miden **34 px** de alto (152 de 153 tocables bajo 44 px). Con la mano, "jj21" y "jsanchez17" quedan pegados.
- Los chips sin seleccionar tienen el borde #222 sobre #111 (1.19:1): parecen texto suelto, no botones (`20-evaluar-1.png`).
- El botón fijo de abajo, deshabilitado, sale con `opacity: .4` sobre verde: texto oscuro sobre verde apagado, ilegible (`20-evaluar-1.png`, primera toma).
- Los pulgares sin elegir van con opacidad baja (`ThumbsRater`). En el sol, 👍 😐 👎 apagados parecen deshabilitados.
- **Propuesta concreta, que no cambia ninguna regla:** una categoría a la vez, como un carrusel o paso 1/8, con la lista de compañeros en filas de 48 px con avatar, y un "Siguiente" grande. Es la pantalla que más depende del pulgar y la que más rinde por cambio.

### 2.4 Puntaje (`30-puntaje-*.png`)
**Funciona:** el simulador es claro ("+0.02 · 3.42 → 3.44" y el desglose) y la explicación de arriba está bien escrita. **No funciona:** los segmentados (Normal/Minitorneo, Jugué/No me inscribí, Gané/Empaté/Perdí) miden 34 px. Los reconocimientos son chips de borde #222. Hay 20 tocables y los 20 están bajo 44 px.

### 2.5 Historial (`40-historial*.png`, `src/app/historial/page.tsx`)
- **P0:** `selectStyle` usa `fontSize: 12` (`historial/page.tsx:37-41`) en los 4 selectores (`:182, :191, :204, :226`). En iOS, tocar "Todo el club" hace zoom y la barra se corta por los dos lados (trampa nº 1 de la skill). *No comprobado en Safari*, pero es exactamente la condición documentada.
- Los selectores miden 34 px de alto.
- Por lo demás reutiliza `MatchResultCard`, así que hereda lo bueno.

### 2.6 Perfil (`50-perfil-*.png`)
Funciona: avatar grande con dorsal, "Cambiar foto" visible y la sección de ausencia bien explicada. No funciona: en la fila de estadísticas, "RECONOCIMIENTOS" choca contra el divisor (columna demasiado angosta para 9–10 px con espaciado de letra). Los botones "Guardar posiciones", "Cambiar email" y "Cambiar contraseña" miden 32 px. El "Guardar" deshabilitado es un verde apagado que parece habilitado.

### 2.7 Login (`60-login.png`)
Está bien: un solo foco, botón primario a todo el ancho con 11.5:1 y campos de 16 px. El único detalle es el placeholder `tu_usuario o correo@ejemplo.com` en mono, que casi llena el campo a 390 px.

### 2.8 Panel de admin, general (`10-admin-partidos.png`, `src/app/admin/page.tsx`)
- **Hay tres niveles de navegación apilados:** los iconos 💰 ⚙ 🕐 🔔 (solo `title`, sin texto ni `aria-label`, 38–48×37 px, `admin/page.tsx:205-224`); debajo, las pestañas de texto PARTIDOS / EQUIPOS / JUGADORES / L…; y dentro de Ajustes, las subpestañas Club / Puntaje / Notifs / Diagnóstico. "LOG" queda cortado en el borde y no hay nada que avise que esa fila se desplaza de lado. En el teléfono, el admin no sabe que 💰 es "Fondo MBA" hasta que lo toca.
- Las "Solicitudes de acceso" empujan las pestañas a y≈700: con una solicitud pendiente, cada pestaña arranca abajo de la primera pantalla.
- `var(--surface)` **no existe** en `globals.css` y se usa en `TabPartidos.tsx:949` y `:966`, así que esas cajas quedan sin fondo.

### 2.9 Admin → Partidos (`11-admin-partido-abierto-*.png`)
- Cada inscrito lleva "EN ESPERA" y "REMOVER" como texto en mayúsculas, en ámbar y rojo, **13 veces seguidas**. Es el mismo problema que §6 ya resolvió en `ListaJugadores` de `TabHistorial` ("catorce botones rojos para algo que casi nunca se hace… fácil de tocar sin querer al desplazar"). Propongo el mismo patrón: rejilla compacta y un único control de agregar/remover abajo. **No cambia ninguna decisión vigente; la extiende.**
- "por juli9" al lado de juli9 repite el dato cuando uno se inscribió a sí mismo. La fecha "1 de nov · 10:00 a. m." se parte en dos líneas.

### 2.10 Admin → Equipos (`1x-admin-equipos.png`, `12-admin-equipos-sel-*.png`)
- El estado vacío obliga a elegir el partido en un `<select>`, aunque casi siempre es el próximo. Conviene preseleccionarlo.
- En el resultado, los equipos se rotulan "A" en verde y "B" en ámbar (hardcodeado en `TabEquipos`) mientras en toda la app son **blanco y negro**. `TEAM_A` y `TEAM_B` de `lib/design.ts` ya no los usa nadie (código muerto), y `colorLabel()` no conoce "morado".
- "× Resetear equipos" en #7f1d1d sobre negro da **2.0:1**.
- Tres selectores y un textarea de 12 px: `TabEquipos.tsx:351, 410, 624` (zoom en iOS).

### 2.11 Admin → Jugadores (`1x-admin-jugadores-*.png`)
**Funciona muy bien:** la barra y el fondo por rol, el avatar de 52 px y la 🔔 solo cuando hay avisos (§6). Las tarjetas miden 74 px, lo cual está bien para el pulgar. Detalle: el nombre sale en la fuente del sistema porque la fila es un `<button>` y no hereda la fuente; en el inicio el mismo nombre sale en serif.

### 2.12 Admin → Fondo (`1x-admin-fondo-*.png`)
Es claro: medalla, dorsal, "$ 2.000" en mono y la barra de proporción. Con muchos empates, la columna de medallas 🥇 repetidas pierde sentido (es un caso del dato). El título "Fondo MBA" está quemado (`admin/page.tsx:30`); con más clubes debería usar el nombre del club.

### 2.13 Admin → Ajustes / Notifs / Log (`1x-admin-ajustes-*.png`, `1x-admin-notifs-*.png`, `1x-admin-log-*.png`)
- Ajustes → Club es **el sitio natural para "Colores del club"**: ya tiene nombre, ciudad y los interruptores. Los toggles están bien, con área grande y verde claro.
- `TabNotifs.tsx:114, 132` y `TabHistorial.tsx:709`: selectores de 13 px, con zoom en iOS.
- El Log muestra claves internas (`guardar_setting`, `cancelar_inscripcion`) en tarjetas de ~100 px, con 12 eventos que ocupan 1.200 px. Faltan una etiqueta legible y filas compactas.

### 2.14 Transversal

| Tema | Evidencia | Estado |
|---|---|---|
| Campos con letra < 16 px (zoom en iOS) | `historial/page.tsx:37`, `AlineacionVoto.tsx:89`, `TabEquipos.tsx:351/410/624`, `TabHistorial.tsx:709`, `TabNotifs.tsx:114/132` | ✗ P0 |
| Áreas seguras de iOS | `layout.tsx:25` usa `black-translucent`, y no hay **ningún** `env(safe-area-inset-*)` ni `viewport-fit=cover` en `src/` | ⚠ *no comprobado*: confirmar en un iPhone con notch que "← INICIO" y la barra no queden debajo del reloj |
| Foco visible | `outline: none` en inputs (`globals.css:77`); sin `:focus-visible` en ningún sitio | ⚠ menor en táctil |
| `prefers-reduced-motion` | no existe; hay `pulsing` infinito en "CARGANDO…" | menor |
| Iconos solo-emoji sin nombre | 4 pestañas de admin con `title` pero sin `aria-label`; solo 20 `aria-label` en toda la app | ⚠ |
| Estados de carga | "CARGANDO…" en mono con pulso, sin esqueletos; el panel entero espera los 4 fetch (`admin/page.tsx:49-73`) | aceptable |
| Estados vacíos | Equipos ("Selecciona un partido…") e invitados guardados ("Aún no has guardado…") están bien escritos | ✓ |
| Errores | `ErrorAlert` y `MSG.error` con 6.5:1 | ✓ |
| Fuentes | `@import` de Google Fonts al tope de `globals.css:1` (bloquea el render y es una petición externa en una PWA) | mejorar con `next/font` |
| `theme-color` | `#0a0a0a` en `layout.tsx:23` y `manifest.ts`, con `--bg` #080808 | trivial; pasa a derivarse del tema |
| `--accent` | definido en `globals.css:16`, **0 usos** | se reutiliza en la propuesta |
| `clubs.color_primary` | existe en el esquema (default #22c55e), `api/club` lo lee y `useClub` lo tipa, pero **no lo usa nadie y nada lo escribe** | no usar (ver §5.4) |

---

## 3. Mejoras priorizadas

Esfuerzo: S ≤ ½ día · M 1–2 días · L 3 días o más.

| # | Prio | Mejora | Esf. | Archivos |
|---|---|---|---|---|
| 1 | **P0** | `fontSize` ≥ 16 en los 11 campos. Arreglar también la receta de la skill para que encuentre estilos por variable y `=>` (el script de §2.14 de este informe, adaptado) | S | `historial/page.tsx`, `AlineacionVoto.tsx`, `TabEquipos.tsx`, `TabHistorial.tsx`, `TabNotifs.tsx`, `.claude/skills/ui-movil/SKILL.md` |
| 2 | **P0** | `--text-dim` #666 → **#8a8a8a** (5.5:1); `--border` #222 → **#2e2e2e** (1.4:1, solo separa tarjetas, es decorativo); `--border-light`, que es el contorno de inputs y controles, de #2a2a2a → **#6b6b6b** (3.3:1 sobre #1a1a1a, el mínimo de WCAG 1.4.11 para componentes) | S | `globals.css:7-11` (un solo lugar: 206 + 122 usos heredan el cambio) |
| 3 | **P0** | Barra del inicio: tocables de 44 px. "Salir" se va a Mi perfil. Notificaciones como 🔔 de 44×44 con `aria-label`. ADMIN como icono. El nombre del club deja de cortarse | S | `page.tsx:591-620` |
| 4 | **P0** | #7f1d1d como texto → `var(--red)` (3 sitios) | S | `TabEquipos.tsx:580,647`, `TabJugadores.tsx:469` |
| 5 | P1 | Reset `button, input, select, textarea { font: inherit }`, y fijar la fuente de texto (ver §4) para que los nombres no cambien de letra entre pantallas | S | `globals.css` |
| 6 | P1 | Chips, segmentados y botones de 44 px mínimo: `.btn` con `min-height: 44px` y chips de votación con `min-height: 44px` | S–M | `globals.css` (`.btn`), `evaluar/[partido_id]/page.tsx:110-135`, `puntaje/page.tsx`, `ThumbsRater.tsx` |
| 7 | P1 | Definir `--surface` o reemplazarlo por `--bg-elevated` | S | `TabPartidos.tsx:949,966` |
| 8 | P1 | Inscritos del panel: rejilla compacta + un control de agregar/remover (el patrón ya aprobado en §6 para `ListaJugadores`) | M | `TabPartidos.tsx` |
| 9 | P1 | Navegación del admin: una sola fila de pestañas con icono + texto corto (Partidos, Equipos, Jugadores, Historial, Fondo, Más…), con desplazamiento lateral evidente (degradado en el borde) o con una segunda fila "Más" | M | `admin/page.tsx:22-33, 205-245` |
| 10 | P1 | Votación de a una categoría (paso 1/8), con filas de 48 px | M | `evaluar/[partido_id]/page.tsx` |
| 11 | P1 | Inicio: quitar el héroe de 64 px (el nombre va en la barra); hora en una línea; invitados plegados tras "+ Invitado"; dorsal en la lista de inscritos | M | `page.tsx` |
| 12 | P1 | 🖤: reemplazar el emoji por el `PuntoEquipo` con anillo que ya existe, o envolverlo en una pastilla clara | S | `MatchResultCard.tsx`, `TabHistorial.tsx` |
| 13 | P1 | Equipos: rotular blanco/negro/morado y no A-verde/B-ámbar; borrar `TEAM_A`, `TEAM_B` y `MSG.warn` muertos o pasarlos a tokens; `colorLabel` con morado | S | `TabEquipos.tsx`, `lib/design.ts` |
| 14 | P1 | Áreas seguras de iOS: `viewport-fit=cover` + `padding-top: env(safe-area-inset-top)` en las barras fijas. **Verificar primero en un iPhone** | S | `layout.tsx`, barras de `page.tsx` / `admin/page.tsx` / subpáginas |
| 15 | P2 | Fuentes con `next/font` (autohospedadas, sin `@import`) | S | `layout.tsx`, `globals.css:1` |
| 16 | P2 | Log con etiquetas legibles y filas de una línea | S | `TabLog.tsx` |
| 17 | P2 | Escala tipográfica: eliminar 9 y 10 px (154 usos), mínimo 12 px; mayúsculas mono solo en etiquetas | M (mecánico) | todos los `.tsx` |
| 18 | P2 | Equipos: preseleccionar el próximo partido | S | `TabEquipos.tsx` |
| 19 | P2 | Barra inferior de 4 secciones (Partido, Historial, Puntaje, Admin), con `safe-area-inset-bottom`. Hoy historial y puntaje solo se alcanzan desde enlaces dentro del contenido o del pie (la lección de §2 sobre el historial) | M | `layout.tsx` o un componente nuevo |
| 20 | P2 | `:focus-visible`, `prefers-reduced-motion`, `aria-label` en los botones que solo tienen emoji | S | `globals.css`, `admin/page.tsx` |

Los colores configurables van aparte, en fases (ver §5.8).

---

## 4. Propuesta de rediseño

### 4.1 Dos direcciones

**A. "Cancha nocturna" (recomendada).** Es una evolución, no un cambio de identidad. Mantiene el fondo negro, Bebas Neue en los titulares y el tono deportivo-nocturno, y corrige lo que falla en el sol y con el pulgar:
- **Texto e interfaz en la fuente del sistema** (SF Pro en iPhone). Pesa cero bytes, es la más legible a 15–17 px y es la que ya ven en sus botones. Sale DM Serif Display.
- **DM Mono solo para cifras**, con `tabular-nums`: marcador, puntaje, cupos, plata, horas. Deja de ser la voz de toda la interfaz (hoy va en 430 elementos, mayúsculas con espaciado ancho y 9–11 px).
- Contraste: los secundarios suben a ≥ 4.5:1 y los bordes se ven.
- Esquinas más redondeadas (10–14 px), sombras mínimas y 44 px en todo lo tocable.
- **Ventaja:** se puede hacer por partes y cada paso se ve igual o mejor que el anterior. **Riesgo:** bajo.

**B. "Día de partido" (fondo claro de alto contraste).** Fondo blanco, texto casi negro y color del club en botones. Es objetivamente lo más legible a pleno sol: la pantalla clara pelea mejor contra el reflejo.
- **Contras:** rompe la identidad actual, hay que revisar cada foto, emoji y color de rol, y duplica la verificación.
- **No la recomiendo ahora.** Con el sistema de tokens de §4.2 se puede agregar después como un **cuarto preset de fondo ("Claro")**. La derivación ya calcula el texto sobre el primario y el primario como texto según el fondo; habría que invertir las mezclas de superficies.

### 4.2 Sistema de tokens

Ver `mockup.html`: el bloque `:root` y la tabla generada al pie.

**Color.** Los derivados los inyecta el servidor por club; los semánticos son fijos.

| Token | Valor actual (MBA) | Rol | ¿Configurable? |
|---|---|---|---|
| `--bg` | #080808 | fondo de página | por preset de fondo |
| `--surface-1` / `--surface-2` | #121212 / #1a1a1a | tarjeta / elevado e input | derivado del preset |
| `--line` / `--line-strong` | #333 / #6b6b6b | borde de tarjeta / borde de input y control | derivado (decorativo / ≥ 3:1 sobre `--surface-2`) |
| `--text` / `--text-2` / `--text-3` | #f5f5f5 / #b4b4b4 / #8a8a8a | jerarquía de texto | derivado: se aclara hasta ≥ 7 / ≥ 4.5 sobre `--surface-2` |
| `--primary` | #4ade80 | botón principal, selección, barra de cupos, nombre del club | **sí** |
| `--on-primary` | derivado | texto sobre el botón | negro o blanco según cuál dé más contraste (≥ 4.5) |
| `--primary-text` | derivado | primario usado como texto o enlace | se aclara hasta ≥ 4.5 sobre `--surface-2` |
| `--primary-soft` / `--primary-line` | derivados | fondo de "tu fila" / borde de selección | 14 % de mezcla / ≥ 3:1 |
| `--accent` (+ `-text`, `-soft`, `on-`) | #fbbf24 | admin, destacados de marca | **sí** |
| `--pos` / `--pos-soft` | #4ade80 / #0f2d1a | subió, confirmado, ok | **no** |
| `--neg` / `--neg-soft` / `--neg-line` | #f87171 / #2d0a0a / #b91c1c | bajó, error, cancelar | **no** |
| `--warn` / `--warn-soft` | #fbbf24 / #1f1803 | espera, empate, aviso | **no** |
| `--info` | #7dd3fc | información | **no** |
| equipo blanco/negro/morado | #e5e5e5 / #4a4a4a + anillo / #a78bfa | punto de equipo | **no** |
| rol superadmin / admin | #a78bfa / #fbbf24 (+ fondo y borde de `roles.ts`) | lista y ficha | **no** (ver §5.6) |

**Tipografía.**
- `--font-display`: Bebas Neue. `--font-ui`: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`. `--font-num`: DM Mono con `tabular-nums`.
- Escala `--fs-*`: **12 / 13 / 15 / 17 / 22 / 32 / 48** (Bebas hasta 64 para un solo número). **Nada bajo 12 px**: hoy hay 154 usos de 9–10 px.
- Etiquetas tipo "PRÓXIMO PARTIDO": 12 px, peso 600, mayúsculas, `letter-spacing: .08em`. Es un único estilo `.eyebrow` en vez de 151 `letterSpacing` inline.

**Espaciado.** Base 4: `--sp-1..8` = 4, 8, 12, 16, 20, 24, 32. Margen lateral de 16 px a 390 px de ancho; hoy es 20, y 16 gana 8 px de línea para los nombres.

**Radios.** Hoy hay 9 valores (2, 3, 4, 6, 10, 12, 20, 50 %, 999). Pasan a 4: `--r-sm` 6 (chip interno), `--r-md` 10 (botón, input), `--r-lg` 14 (tarjeta) y `--r-pill`.

**Sombras.** `--shadow-1` es un filo interior de 4 % más una sombra de 2 px, para separar la tarjeta del fondo junto al borde. `--shadow-2` es solo para modales.

**Tamaño táctil.** `--tap: 44px`, aplicado como `min-height` de `.btn`, chips, segmentados y filas tocables.

### 4.3 Cómo se vería

Ver `mockup.html` y las capturas `mockup-verde.png`, `mockup-rojo-azul.png` y `mockup-amarillo.png`.

- **Inicio:** barra con "MBA **FC**" en Bebas de 24 px, 🔔 de 44 px y avatar de 44 px. Una sola tarjeta "Próximo partido" con MARTES (48) y la hora en una línea, la fecha y la cancha, la barra de cupos, "13/14 · 1 en espera" y, separado por una línea, "✓ Estás dentro" con **[Salirme]** en contorno rojo. Todo dentro de la primera pantalla. Debajo, el aviso de foto (ámbar), y luego jugadores en filas de 52 px con dorsal, tu fila sobre `--primary-soft`, los primeros 4 y "Ver los 13 →". Barra inferior con Partido / Historial / Puntaje / Admin.
- **Tarjeta de resultado:** foto 16:9; "● BLANCO / ● NEGRO" con el punto del equipo y el **6** del ganador en `--text` y el **– 4** en `--text-3`. El marcador ya no usa el verde de marca. Debajo, "Ganó **Blanco** por 2", los reconocimientos en filas de 48 px y "Tu puntaje en este partido **+0.02** ▾" como fila tocable de 44 px.

---

## 5. Colores configurables: arquitectura

### 5.1 Inventario de lo que hay que migrar

Fuera de `email.ts` (152, son correos: ver fase 4) y `tier.ts` (45, la paleta de rangos ya es configurable a su manera), **la UI tiene 262 hex sueltos**, 108 valores distintos en todo `src`, 13 `rgba()` y 122 `var(--green)` que mezclan dos significados.

| Familia | Usos | Dónde se concentra | Destino |
|---|---|---|---|
| Verde (marca **y** semántico) | 80 hex + 122 `var(--green)` | `TabHistorial` 8, `TabPartidos` 7, `TabEquipos` 7, `page.tsx` 7, `design.ts` 7 | **separar:** `--primary*` (botones, selección, cupos, nombre, día de la semana del historial, tu fila) / `--pos*` (deltas +, "✓ confirmado", `MSG.ok`, `badge-green`) |
| Rojo | 58 | `TabJugadores` 10, `TabAjustes` 7, `login` 6, `TabEquipos` 4, `design.ts` 4 | `--neg`, `--neg-soft`, `--neg-line` |
| Ámbar | 48 | `TabPartidos` 7, `design.ts` 6, `page.tsx` 5, `login` 5 | `--warn*` (semántico) o `--accent*` (decorativo: "ADMIN" de la barra, el título del panel) |
| Morado / índigo | 38 | `page.tsx` 10, `TabAjustes` 7, `TabHistorial` 6, `roles.ts` 3 | superadmin y minitorneo fijos; portero #818cf8 como `--info-2` fijo |
| Celeste | 13 | `PerfilJugadorModal` 6, `TabJugadores` 4 | `--info*` |
| Neutros | 25 (+ 13 definiciones de `:root`) | `TabEquipos` 6, `MatchResultCard` 3, `login` 3 | `--bg`, `--surface-*`, `--line*`, `--text*` |

Decisión por familia: el verde se separa entre marca y semántico; rojo, ámbar, morado, celeste y neutros pasan a tokens fijos o derivados según la tabla. **La sustitución es mecánica y no debe cambiar ni un píxel** (ver fase 1).

### 5.2 Qué expone el club: solo 3 valores

```jsonc
// app_settings: club_id = …, key = 'tema'
{ "v": 1, "primario": "#4ade80", "acento": "#fbbf24", "fondo": "carbon" }  // fondo: 'carbon' | 'noche' | 'cancha'
```

- **Primario**: la marca. Va en botón principal, selección, barra de cupos, la segunda palabra del nombre, enlaces y tu fila.
- **Acento**: un segundo color de marca, para el rótulo ADMIN, títulos del panel y detalles.
- **Fondo**: tres presets oscuros (carbón #080808 / azul noche #070b14 / verde cancha #06100a), **no un color libre**. Un fondo libre permite elegir gris medio o blanco, y con eso se rompen todos los ratios de texto, los colores de rol y los semánticos. Un preset se puede verificar una vez y queda verificado.

### 5.3 Cómo se deriva el resto con contraste garantizado

Todo lo hace una función pura, `derivarTokens(tema)` en `src/lib/tema.ts`. Es pura como `calcularPuntaje()` y por la misma razón que §6: una sola implementación que usan el servidor, el `<style>`, la vista previa del editor y el manifest. El algoritmo funciona dentro de `mockup.html`:

```ts
on-primary   = ratio(negro, p) ≥ ratio(blanco, p) ? mezcla(p, negro, .88) : blanco     // ≥ 4.5 siempre
primary-text = aclarar(p, hacia blanco) hasta ratio(·, surface-2) ≥ 4.5              // un azul marino se aclara solo
primary-soft = mezcla(surface-1, p, .14)
primary-line = aclarar(mezcla(surface-1, p, .6)) hasta ≥ 3:1 sobre surface-1
text-2/3     = aclarar(#b4b4b4 / #8a8a8a) hasta ≥ 7 / ≥ 4.5 sobre surface-2
(igual para el acento)
```

Probado en la maqueta: verde #4ade80 da 10.3 / 10.0 / 4.5; rosa-rojo #f43f5e da 5.2 / 4.7 / 3.2; amarillo #facc15 da 11.6 / 11.4 / 5.0; azul #60a5fa da 7.3 / 6.9 / 3.4; blanco da 16.5 / 17.4 / 7.2. **Ningún color elegido puede dejar un botón ilegible**: el peor caso pasa a texto blanco o negro, o se aclara.

**Lo que la matemática no resuelve es el significado.** El editor avisa, sin bloquear, cuando el primario está a menos de 30° de tono de un semántico:
- verde "subió": el propio verde de MBA dispara el aviso, y es honesto, porque hoy marca y "subió" son el mismo color;
- rojo "bajó/cancelar";
- ámbar "aviso".

Con un primario rojo, el botón "Salirme" y el "−0.02" se confunden con la marca. El aviso lo dice y el superadmin decide.

### 5.4 Dónde se guarda

En `app_settings`, clave **`tema`**. **Sin migración:** la tabla y el `UNIQUE (club_id, key)` ya existen.

- **No** se reusa `guardar_setting`: solo acepta string o bool y una lista fija de claves (`api/admin/route.ts:1325-1360`).
- Se agrega **`accion: 'guardar_tema'`**, una copia del patrón de `guardar_tiers` (`:1381`): `sanitizeTema()` → `upsert` → `logActivity`. Es **solo superadmin** (agregarla a `SUPERADMIN_ONLY`).
- `GET settings` ya devuelve todas las claves; se le suma `tema: parseTema(settings.tema)`, como ya hace con `tiers`.
- **Seguridad:** el valor termina dentro de un `<style>` en el HTML. `sanitizeTema` acepta **solo** `^#[0-9a-f]{6}$` y el enum de fondos, y `derivarTokens` produce solo hex. Sin eso, un `primario: "red}</style><script>…"` sería un XSS persistente para todo el club. El CSP ya permite `style-src 'unsafe-inline'`, así que el `<style>` no necesita cambios de CSP.
- **Por qué no `clubs.color_primary`:** existe en el esquema, pero ninguna ruta escribe en `clubs`, sería una sola columna para 3 valores, y §2 avisa que `schema_current.sql` puede no coincidir con producción. Se puede dejar de leer en `api/club` cuando el tema esté.

### 5.5 Cómo se aplica sin parpadeo (SSR y PWA)

1. `src/lib/tema.ts` → `getTemaClub(clubId)`: lee `app_settings` con `createAdminClient()` y `.eq('club_id', clubId)` (regla de §2). Guarda en una caché en memoria de 60 s, como `slugCache` del middleware. Si la lectura falla, usa `TEMA_DEFAULT`; **nunca bloquea el render**.
2. `RootLayout` (`layout.tsx`, ya es `async` y ya lee `headers()`): toma `x-club-id`, calcula los tokens y pinta en el `<head>`:
   ```tsx
   <style id="tema" dangerouslySetInnerHTML={{ __html: `html:root{${css}}` }} />
   <meta name="theme-color" content={tokens['--bg']} />
   ```
   El selector `html:root` le gana en especificidad al `:root` de `globals.css`, sin depender del orden de los `<link>`. Como el CSS viene en el HTML del servidor, el primer pintado ya sale con los colores del club: **no hay parpadeo**, ni siquiera sin JS.
3. `manifest.ts`: `theme_color` y `background_color` salen de los tokens.
4. **PWA y service worker:** el HTML va *network-first* (§2), así que el tema nuevo llega en la siguiente apertura con red. Sin red, la caché sirve el tema anterior, lo cual es aceptable.
5. **Lo que no se puede cambiar en caliente:**
   - iOS lee `apple-mobile-web-app-status-bar-style` y el ícono al instalar.
   - Android usa `background_color` del manifest para la pantalla de arranque, y solo lo relee al reinstalar.
   - Los íconos `icon-192/512.png` son PNG fijos, no se recolorean.
   - El editor debe decirlo: "La barra del sistema y el ícono se actualizan al reinstalar la app".
6. Tras guardar, el editor hace `location.reload()`: el layout se vuelve a pintar en el servidor con la caché ya invalidada en esa instancia. En Vercel, otras instancias tardan ≤ 60 s, y vale decirlo en el mensaje de éxito.

### 5.6 La pantalla del superadmin

Va en Ajustes → Club → **"Colores del club"**, visible solo para superadmin. Ver la columna derecha de `mockup.html`.
- **Primario:** 8 muestras redondas de 44 px más un "＋" con `<input type="color">`, que en iOS 12.2+ abre el selector nativo. *No comprobado en Safari.*
- **Acento:** 6 muestras más "＋".
- **Fondo:** segmentado de 3 (Carbón / Azul noche / Verde cancha).
- **Vista previa en vivo:** fija las variables CSS **solo en el contenedor de la vista previa**, no en todo el documento, para no repintar el panel mientras se prueba. Muestra la barra con el nombre, el botón principal, la etiqueta ADMIN y los chips +0.02 / −0.02, para que se vea junto a los semánticos.
- **Chequeos:** ✓ con su ratio, o ⚠ "se aclara como texto" o "se confunde con el rojo de 'bajó'". Solo avisan, no bloquean: el contraste ya lo garantiza la derivación.
- Botones **Restaurar** (vuelve a `TEMA_DEFAULT`) y **Guardar colores**.

### 5.7 Qué NO es configurable, y por qué

- **Semánticos** (`--pos` verde, `--neg` rojo, `--warn` ámbar, `--info`). Son el idioma de la app: "+0.02 verde / −0.02 rojo" en `MatchResultCard`, `/puntaje` y el historial, y el rojo de cancelar o eliminar. Si un club los mueve, un rojo de marca haría que todo pareciera un error, y un verde de marca distinto haría dudar de qué significa "subió". `formatDelta` y `explicarMotivo` dan el texto; el color tiene que acompañarlo siempre igual.
- **Colores de equipo** (blanco, negro, morado). Son los petos reales de la cancha. Además el "negro" ya tiene un ajuste de legibilidad (§6, `COLOR_EQUIPO`) que se perdería.
- **Colores de rol** (morado superadmin, ámbar admin). §6 los fija en `lib/roles.ts` para que lista y ficha no se separen. La fila del **jugador normal** sí puede pasar a `--primary` (hoy es #4ade80, el mismo verde), porque "miembro normal" es la marca. El editor agrega un aviso si el primario cae a menos de 30° del morado o del ámbar de rol.
- **Paleta de rangos** (`tier.ts`). Ya es configurable por rango, con degradados elegidos de una paleta fija. No se mezcla con el tema.
- **El texto principal** (`--text`) y la escala de grises la deriva el sistema, no el club.

### 5.8 Plan por fases (cada una se despliega sola)

| Fase | Qué | Cambio visual | Migración | Esf. | Verificación |
|---|---|---|---|---|---|
| **0** | Los P0 de §3: zoom de iOS, contraste de `--text-dim` y bordes, #7f1d1d, la barra del inicio | sí, pequeño y deseado | no | S | capturas a 390 px |
| **1** | **Tokens sin tema.** Agregar `--primary*`, `--accent*`, `--pos*`, `--neg*`, `--warn*`, `--info`, `--surface-*`, `--line*`, `--text-2/3` a `globals.css` **con los valores de hoy**. Reemplazar los 262 hex. Partir los 122 `var(--green)` en `--primary` o `--pos`. `MSG` y `C` de `design.ts` y el jugador de `roles.ts` pasan a `var()`. Borrar `TEAM_A/B` | **ninguno** | no | M–L (mecánico, ~30 archivos) | capturas antes y después con el Supabase falso (§0) y **diff de píxeles = 0** en las ~20 pantallas de esta auditoría |
| **2** | **Tema por club.** `lib/tema.ts` (`parseTema`, `derivarTokens`, `getTemaClub`), el `<style>` en `layout.tsx`, `theme-color`, `manifest.ts`, y `guardar_tema` + `GET settings.tema` en el API. `TEMA_DEFAULT` reproduce exactamente la fase 1 | **ninguno** para MBA hasta que alguien edite | **no** (clave nueva en `app_settings`) | M | diff de píxeles = 0 con el tema por defecto; prueba de `sanitizeTema` con valores maliciosos |
| **3** | **El editor** en Ajustes → Club, con vista previa y chequeos | solo en Ajustes | no | M | capturas del editor; guardar → recargar → ver aplicado |
| **4** (opcional) | Correos (`email.ts`, 152 hex) con los valores del tema en línea; logo del club (`clubs.logo_url` ya existe); presets "Claro" (dirección B) | según el caso | no | M | — |

La fase 1 es la única grande, y es la que hay que hacer de todos modos para que el rediseño de §4 no sea otra capa de hex encima de la anterior.

---

## 6. Riesgos y cosas que NO cambiar

**No cambiar, porque está bien o porque es una decisión de §6:**
- `font-size: 16px` de la regla base de inputs (`globals.css:71`), el bloque `appearance: none` de fecha/hora (`:206-222`) y el cinturón `overflow-x: hidden` del modal. El rediseño no los toca.
- La foto del partido con `contain` + fondo desenfocado; `cover` está descartado y medido (§6).
- Los reconocimientos en rejilla con el **nombre de la categoría visible** ("La más perrota" es el chiste, §6), los empates mostrados completos y el punto de equipo con anillo.
- El rol **pintado** en la lista del panel (barra + fondo) y los colores en `lib/roles.ts`, compartidos con la ficha.
- El aviso de foto: molesta, no se puede cerrar y no bloquea.
- La sección de puntaje plegada, con el delta propio en la cabecera.
- El dorsal como avatar de respaldo (`lib/numeroCamiseta.ts`).
- Los textos de `motivos` en la base: el rediseño solo cambia cómo se pintan, vía `explicarMotivo()`.

**Cambios que propongo y que tocan una decisión vigente (dicho explícitamente):**
- **Ninguno contradice §6.** Dos la *extienden*:
  - pasar el patrón "un solo control de agregar/remover" de `ListaJugadores` (Historial) a los inscritos de Partidos;
  - "el día de la semana va en verde" (§6, historial del panel): seguirá siendo el color del club (`--primary-text`), no necesariamente verde.

**Riesgos**
1. **Partir `var(--green)` mal clasificado.** Si un "subió" queda como `--primary`, el día que un club elija azul ese "+0.02" sale azul. Mitigación: hacerlo archivo por archivo y repasar a mano los usos de deltas (`MatchResultCard.tsx:132`, `puntaje/page.tsx:36`, `historial`, `PerfilJugadorModal`). Una prueba rápida: renderizar con un `--primary` magenta de prueba y ver que no quede nada magenta que signifique "bien".
2. **Inyección en el `<style>`:** ver §5.4. La validación por regex no es opcional.
3. **Coste por petición:** el layout hace una lectura más de `app_settings` por cada carga completa de página, con caché de 60 s. Es despreciable frente a las consultas que ya hace la página (la navegación cliente no vuelve a ejecutar el layout raíz). Si la consulta falla se usa el valor por defecto; el layout nunca debe fallar por esto.
4. **Safari:** nada de lo específico de iOS se pudo comprobar aquí. Eso incluye el zoom de los 11 campos (la condición es la documentada), las áreas seguras con `black-translucent` y `<input type="color">`. Antes de cerrar la fase 0, abrir `/historial` y tocar un selector en un iPhone real.
5. **La receta de la skill tiene un punto ciego:** encontrar los campos de < 16 px exige seguir estilos por variable (`style={selectStyle}`) y no cortar en el `>` de un `=>`. Conviene actualizar el script de la skill cuando se implemente la fase 0.
6. **Fase 1 sin verificación de píxeles = regresiones silenciosas** en 30 archivos. El Supabase falso de esta auditoría (`docs/diseno/arnes/server.mjs` + `shot.mjs`) sirve como arnés: renderiza las pantallas reales sin tocar el repo, y valdría la pena llevarlo a la skill `ui-movil`.

---

### Archivos de esta auditoría

- Este informe y `mockup.html` (maqueta con editor de colores): `docs/diseno/`.
- Arnés para renderizar las pantallas reales sin base: `docs/diseno/arnes/` (ver su README).
- Las capturas no se guardaron en el repo (pesan); se regeneran con el arnés.

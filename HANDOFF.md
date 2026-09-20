# HANDOFF — estado compartido entre sesiones

Varias sesiones de Claude trabajan este repo (local en Windows y cloud). **GitHub `main` es lo único que comparten.** Esta conversación, `.env.local`, las ramas locales y la memoria de cada sesión no viajan. Si algo importa, va aquí.

Última actualización: 2026-09-20 (cloud — conteo de votaciones corregido; **sin migraciones nuevas, nada pendiente de correr**).

---

## 1. Reglas de convivencia

1. **Al empezar:** `git pull`, `npm install` (activa el hook que bloquea secretos), leer este archivo.
2. **Al terminar:** push y actualizar este archivo si cambió el estado.
3. **Un dueño por área** (ver §3). Si una tarea toca un archivo de otra área, se coordina con el usuario antes.
4. **`main` despliega solo a Vercel, y es producción.** No hay staging. Nunca `push --force`. Antes de push: `git pull --rebase`.
5. **Migraciones SQL:**
   - Las corre **el usuario**, a mano, en el SQL editor de Supabase. Ninguna sesión tiene acceso a la base.
   - **Nunca hacer push de código que dependa de una migración que el usuario no ha confirmado haber corrido.** Primero SQL, luego código.
   - Una sesión a la vez crea migraciones; los nombres llevan fecha y chocan.
   - Al crear una, agregarla a la tabla de §4 como "pendiente".
6. **Nada que mande push o email a jugadores reales** (crons forzados, notificaciones de prueba, resets de flags) sin OK explícito del usuario.
7. **Secretos:** nunca en el código, en commits ni en el chat. La sesión cloud no tiene `SUPABASE_SERVICE_ROLE_KEY` y está bien que no la tenga.

---

## 2. Trampas conocidas (cada una ya rompió algo)

| Trampa | Regla |
|---|---|
| El cliente service-role se salta RLS | Toda query en `src/app/api/**` con `createAdminClient()` lleva `.eq('club_id', clubId)`, o verifica primero que el recurso es del club. Sin club → 403 (fail closed). |
| Fechas en UTC | `partidos.fecha` es fecha de **Colombia**. Usar `fechaColombia()` / `horaColombia()` de `lib/promoHora.ts`. `new Date().toISOString().split('T')[0]` cambia de día a las 7 PM Colombia. |
| Política RLS que consulta su propia tabla | Recursión infinita, tumbó la app entera. Usar `public.mi_club_id()` (SECURITY DEFINER). |
| Verificar RLS solo con la llave anon | "0 filas" también es lo que ves cuando rompiste todo. Probar también con sesión autenticada. |
| `activity_log.club_id` es NOT NULL | `logActivity` sin `user_id` ni `club_id` se descarta en silencio. En crons, pasar siempre `club_id`. |
| IP del cliente | Usar `getClientIp()` de `lib/rateLimit.ts`. El primer valor de `x-forwarded-for` lo controla el cliente. |
| `supabase/schema_current.sql` puede estar desactualizado | Ejemplo: decía `habilidad numeric`, pero producción tenía 1 decimal. Ante la duda, verificar en producción. |
| Invitaciones pausadas | `src/app/api/invitaciones/`, `src/lib/invitaciones.ts` y `20260805_invitaciones.sql` están en `.gitignore` a propósito. No recrearlos ni hacer commit hasta que se compre dominio. |
| `git add -A` / `git add .` | Ya metió archivos que no tocaban. Agregar archivos por nombre. |
| El service worker escondía cada deploy una vuelta | `public/sw.js` servía el HTML con stale-while-revalidate. El HTML referencia los chunks de Next por hash y los chunks se cachean para siempre, así que servir el HTML viejo arrastraba los chunks viejos: **la app entera se quedaba en la versión anterior hasta la segunda apertura**. Quien abría una sola vez después de un deploy juraba que el cambio no estaba. Corregido 2026-09-18 a network-first con caché de respaldo. Si vuelve a aparecer un "no me sale lo nuevo" en unos y en otros sí, mirar aquí antes que en permisos. |
| Código en `main` antes de su migración | Pasó con `20260917_ausencia.sql`: los commits del panel de ausencia se fueron a `main` con la migración aún pendiente. No es un error cosmético — `lib/rating.ts` pide `ausente_desde`/`ausente_hasta` en el `select` de `profiles`, y si las columnas no existen PostgREST devuelve error, `data` queda null y `applyMatchRatings` sale por `sin_jugadores`: **el rating deja de moverse en silencio**. Lo mismo tumba inscripciones, perfil, panel de jugadores y los dos crons. |
| Borrar políticas RLS por nombre | Tres veces sobrevivieron políticas del dashboard que ninguna migración conocía. Borrar por barrido (`pg_policies` + `roles && ARRAY['public','anon']`), nunca por nombre. Herramienta: `supabase/auditoria_politicas.sql`. |
| PostgREST corta en 1000 filas, sin avisar | Un `.select()` sin paginar devuelve máximo ~1000 filas: no hay error, simplemente faltan datos, y cualquier conteo hecho encima queda mal. Mordió en `progreso_votaciones` (2026-09-20): mostraba "2 de 14 votaron" en partidos con 8 votantes, porque `inscripciones` (~550 filas) cabía bajo el tope pero `votos_reconocimiento` (~4.700) y `player_thumbs` (~6.200) venían cortadas. Lo peor es que **se ve bien mientras la tabla sea chica** y se rompe sola al crecer. Regla: si una query abarca varios partidos, paginar con `leerTodo()` (`src/app/api/admin/route.ts`), y **ordenar cada página por una columna única** (`.order('id')`) — sin `ORDER BY`, dos páginas seguidas pueden repetir filas y saltarse otras. Las queries de un solo partido o un solo jugador están bien sin paginar. |

---

## 3. Áreas y dueños

Asignar con el usuario. Hasta que se asigne, preguntar antes de tocar:

**Invariante de RLS (2026-09-17):** en el esquema `public` quedan **13 políticas, todas `SELECT` y todas `{authenticated}`**. Cero de escritura, cero concedidas a `{public}`. Eso es correcto y hay que mantenerlo: el navegador no escribe en ninguna tabla, todas las escrituras pasan por rutas de API con la service key, que se salta RLS. Una política de escritura para el cliente no habilita ninguna función del producto — abre un camino paralelo que evita todas las validaciones del API. Si una sesión cree que necesita una, primero preguntar.

| Área | Archivos principales | Dueño |
|---|---|---|
| Rating y reconocimientos | `lib/rating.ts`, `lib/reconocimientos.ts`, `api/evaluaciones`, `evaluar/` | cloud (commits 2026-09-17) |
| Balanceador de equipos | `lib/teamDraft.ts`, `lib/teamBalancer.ts`, `api/equipos`, `TabEquipos` | _sin asignar_ |
| Cierre de partido / cron | `lib/partidoCierre.ts`, `api/cron/notificaciones`, `CierrePartidoCard` | local |
| Seguridad / RLS / storage | `supabase/migrations/*policies*`, rutas `api/auth/*` | _coordinar_ |

---

## 4. Migraciones

Estado según lo que el usuario confirmó en conversación. **Si no dice "corrida", preguntar.**

| Archivo | Estado | Nota |
|---|---|---|
| hasta `20260907_fix_profiles_recursion.sql` | corrida | |
| `20260907_storage_policies.sql` | corrida | crea las `mbafc_*` |
| `20260912_partido_jugado.sql` | corrida | `partidos.jugado`, `cierre_procesado` |
| `20260912_storage_sin_listado_anon.sql` | **NO CORRER** | superada por `20260917_storage_limpiar_duplicadas.sql` |
| `20260917_abstencion_reconocimientos.sql` | corrida | cloud |
| `20260917_badges_votos.sql` | corrida | 288/288 badges con conteo. Primer intento dio deadlock contra la app viva; el archivo ya va en pasos separados |
| `20260917_quitar_bug_reports.sql` | corrida | el guard la frenó con 1 fila; el usuario la revisó (era basura), la borró y volvió a correr |
| `20260917_quitar_escrituras_de_cliente.sql` | corrida | estado final verificado: 13 políticas, todas SELECT |
| `20260917_quitar_politicas_public.sql` | corrida | 14 políticas quitadas |
| `20260917_reconocimientos_revocados.sql` | corrida | cloud |
| `20260917_registro_sin_metadata_del_cliente.sql` | corrida | cloud |
| `20260917_storage_limpiar_duplicadas.sql` | corrida | quedan solo las 5 `mbafc_*`, todas `{authenticated}`. Ojo: la prueba con llave anon que se citaba aquí era del 2026-09-12, anterior a esta migración |
| `20260917_thumbs_sin_politicas.sql` | corrida | `player_thumbs` queda con RLS y cero políticas |
| `20260919_recordatorio_votar.sql` | corrida | `partidos.notif_votar_sent`, y el histórico marcado para que no salga un recordatorio retroactivo |
| `20260918_limpiar_badges_pocos_votos.sql` | corrida | borró los reconocimientos de ≤2 votos y los dejó vetados. **Pide dos cosas que el SQL no puede hacer: subir `reco_min_ganador` a 3 en Ajustes, y ♻️ Recalcular.** Ver §5.7. |
| `20260917_votos_sin_politicas.sql` | corrida o innecesaria | las 3 políticas que buscaba eran `{public}`, así que `quitar_politicas_public` las barrió igual. Estado final verificado: `votos_reconocimiento` sin políticas |
| `20260917_habilidad_precision.sql` | corrida | el usuario vio su rating corregido (3.3 → 3.05) |
| `20260917_ausencia.sql` | corrida | `profiles.ausente_desde` / `ausente_hasta`. Se deduce del recálculo total del 2026-09-17: `applyMatchRatings` pide esas columnas y devolvió ratings con dispersión real (2.78–4.00), cosa imposible si el `select` estuviera fallando. |

---

## 5. Pendientes

### 5.1 Rating congelado — URGENTE
`profiles.habilidad` en producción redondeaba a **1 decimal** al guardar. `rating_events` guarda el valor exacto (2.98, 3.08), pero el perfil quedaba en 3.0 / 3.1 (34 de 38 jugadores).

No solo escondía decimales, **congelaba el rating**: 3.00 − 0.02 = 2.98 se guardaba como 3.0, y el siguiente partido partía otra vez de 3.0. Cualquier delta menor a 0.05 se borraba.

`20260917_habilidad_precision.sql` amplía la columna a 3 decimales y reconstruye cada rating desde el ledger (3.0 + suma de deltas). No requiere cambios de código. Después de correrla, los ratings van a cambiar visiblemente.

### 5.2 Balanceador — decisión pendiente del usuario
Diagnóstico (2026-09-12, datos de producción):
- 23 de 38 jugadores en 3.00 exacto: el rating no distingue a nadie. Parte de la causa es §5.1.
- `player_knowledge.skill_override`: 21 medium, 10 unknown, 2 high.
- Solo 2 porteros registrados.
- 12 notas de feedback en texto libre con apodos ("Melo") que no coinciden con los usernames (`melo8`). Reglas como "separar Melo y Alexis" se ignoraron.
- El prompt redondea a 1 decimal, usa temperatura 0.7 y pide "introduce variedad natural".
- 2026-09-08: Gemini falló y entró el snake draft (con empates = orden arbitrario). 2026-09-11: Gemini, y el admin re-guardó 4 veces.

Propuesta: optimizador determinista en vez de Gemini:
- nivel base de 1–5 estrellas por jugador, puesto por el admin, combinado con el rating;
- reglas estructuradas ("separar A y B", "juntar A y B") en lugar de texto libre;
- balance por posición y un portero por lado;
- rotación respecto al partido anterior;
- una explicación visible de por qué quedó así.

### 5.3 Anonimato de los pulgares — resuelto (2026-09-18)
`player_thumbs` conserva `thumbs club read` (SELECT, `{authenticated}`): cualquier jugador con sesión puede leer la tabla, que trae `votante_id` y `votado_id`, o sea **quién le puso pulgar abajo a quién**. La pantalla de evaluación dice "Anónimo y opcional".

Es el mismo agujero que se cerró en `votos_reconocimiento` (`20260917_votos_sin_politicas.sql`). El navegador no lee esa tabla — las dos únicas lecturas están en `api/evaluaciones` y `lib/rating`, ambas con la service key —, así que la política sobra.

Importa más desde el 2026-09-17: hasta entonces los pulgares se guardaban y no los leía nadie, así que filtrar la tabla no cambiaba el rating de nadie. Ahora que alimentan el rating, saber quién te bajó el puntaje es exactamente lo que el anonimato debía evitar.

`20260917_thumbs_sin_politicas.sql` lo cerró por barrido: `player_thumbs` queda con RLS activo y cero políticas. Comprobar con una sesión de jugador normal que `SELECT count(*) FROM public.player_thumbs` devuelve 0.

Misma situación, sin filtración de datos sensibles y por tanto sin urgencia: `equipos`, `equipo_jugadores`, `clubs`, `alineacion_votos`, `rating_events`, `invitados_guardados` y `badges_revocados` conservan SELECT para `{authenticated}` y el navegador tampoco los lee.

### 5.5 Medir el sesgo de los pulgares — pendiente
Quitar el premio por asistir deja la deriva casi en cero **si** los 👍 y 👎 están equilibrados (7 años hasta el techo, o sea nunca). Si el club da 70/30, la deriva sigue en 0.5 años. No sabemos la proporción real; hay que medirla, no suponerla:

```sql
SELECT value, count(*) AS n,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM public.player_thumbs GROUP BY value;
```

Con 👍 por encima de ~60% conviene subir `reco_thumbs_paso` (Ajustes → Puntaje → Pulgares) y volver a recalcular.

### 5.6 Revisión de seguridad 2026-09-18
Se revisaron los 24 commits de la sesión cloud (`8941b9b..HEAD`): rutas de API nuevas y tocadas, y las 12 migraciones. **Sin hallazgos de severidad alta o media.** Lo que se verificó y quedó limpio:

- `/api/auth/stamp-registro` — el `club_id` sale de `getClubId(req)`, y el middleware **borra** `x-club-id` de la petición antes de poner el suyo (`middleware.ts:138`), así que no se puede falsear por cabecera. La ruta entra en el matcher.
- `perfil_jugador`, `quitar_badge`, `restaurar_badge`, `recalcular_ratings`, `marcar_ausencia` — todas exigen admin, filtran por `club_id`, y validan ids con `isUUID` / fechas con `isDate` (regex + parseo).
- `recalcular_ratings` es superadmin-only y sus tres escrituras (`rating_events` delete, `profiles` update, `partidos` select) van filtradas por club.
- `sendBadgeRemovidoEmail` escapa `motivo`, `username` y los nombres de badge con `esc()`.
- La abstención en `POST /api/evaluaciones` está acotada por `validCategorias` + `seen` + el UNIQUE de la tabla: como mucho una fila por categoría.
- Las 12 migraciones solo **quitan** permisos. Ninguna abre nada.

**Punto latente, no explotable hoy, para cuando se retome multi-club:** `stamp-registro` usa `ip_registro IS NULL` como candado de un solo uso. Si `getClientIp` devuelve `unknown`, `ip_registro` se queda en NULL y el endpoint sigue llamable — y reescribe `club_id`. Con un solo club y las cabeceras saneadas no lleva a ninguna parte. Cuando existan subdominios por club, cambiar el candado a "solo si el perfil se creó hace menos de X minutos", o sellar `club_id` una sola vez aparte de la IP.

### 5.7 Configuración de puntaje — al día (2026-09-19)
Todo lo que quedaba del panel está aplicado:

- `reco_min_ganador` = **3**. El quórum asigna con `votos ≥ 5` **O** `votantes ≥ 8`; ese "o" dejaba pasar a un ganador de 2 votos en un partido concurrido, y el piso de 2 no lo frenaba.
- `reco_castigo_no_votar_desde` **configurada**. Sin fecha no se castiga a nadie; con fecha, solo cuentan los partidos de ahí en adelante. Lo anterior queda como lo que fue, un período en que nadie sabía que la regla existía.
- ♻️ Recalcular corrido después de la limpieza de reconocimientos de ≤2 votos.

**Si alguna vez hay que volver a recalcular**, revisar antes estos tres valores: el recálculo aplica las reglas de HOY a todo el historial, y la fecha del castigo es lo único que evita que la regla de no votar se vuelva retroactiva.

### 5.4 Otros
- **Invitaciones / multi-club:** pausado hasta comprar dominio (subdominios por club, `NEXT_PUBLIC_ROOT_DOMAIN`, `ALLOWED_ORIGINS`).
- **Prueba de aislamiento entre clubes:** propuesta, no hecha. Un club canario con datos dummy, más un script que inicie sesión en cada club e intente leer y escribir datos del otro por cada ruta y tabla. Requiere que el usuario cree el usuario canario.
- **Verificar en Vercel** que `NEXT_PUBLIC_SITE_URL` no sea localhost.
- **Primer recordatorio de votación, sin ver todavía:** sale a las 7 PM del día siguiente al próximo partido, y solo si la votación no llegó a `reco_min_votantes`. Vale la pena mirar el `activity_log` esa noche: `recordatorio_votar` (con cuántos push/email salieron) o `recordatorio_votar_omitido` si ya había quórum.
- **Prueba funcional con sesión de jugador, sin hacer:** las migraciones de RLS quitaron todas las políticas de escritura. La app no debería notarlo (el navegador no escribe en ninguna tabla: cero `insert`/`update`/`delete`/`upsert` y cero `.rpc()` en los doce archivos que usan el cliente de navegador), pero eso se verificó leyendo el código, no usando la app. Falta abrir home, lista del partido, historial y perfil con una sesión de jugador normal, e inscribirse y retirarse.
- **`avatars`: sin verificar si alguien subió algo** mientras existieron las políticas concedidas a `{public}`. La consulta que lo responde: `SELECT name, owner, created_at FROM storage.objects WHERE bucket_id='avatars' AND (owner IS NULL OR (storage.foldername(name))[1] <> owner::text)`. 0 filas = nunca se abusó.
- ~~`tsconfig.tsbuildinfo` versionado~~ — resuelto: destrackeado y `*.tsbuildinfo` en `.gitignore`.

---

## 6. Decisiones de producto vigentes

- **Rating v2** (`lib/rating.ts`):
  - Base 3.0, rango 1–5. Pasos de 0.02: ganó + / perdió −, reconocimientos ±, pulgares por escalones. Quien queda en espera está exento.
  - **Jugar vale 0, a propósito** (2026-09-17). Antes inscribirse daba +0.02 y era el único término sin contrapeso: ganar/perder es suma cero entre equipos, pero el premio por aparecer se lo llevaba todo el que jugaba, siempre. A dos partidos por semana eso son +2.0 al año — los habituales llegaban al techo de 5.0 en menos de un año y el rating dejaba de distinguir a nadie, el mismo problema que con todos clavados en 3.0 pero apilados arriba. El incentivo de ir no desapareció, cambió de lado: faltar tres seguidas resta. **No volver a agregar un premio por asistir sin resolver antes la deriva.**
  - Deriva que queda: los pulgares NO son de suma cero. Si el club da muchos más 👍 que 👎, todos suben. Se amortigua subiendo `reco_thumbs_paso`. Medir antes de tocar, con la consulta de §5.5. El sesgo de reconocimientos (5 positivos vs 3 negativos de fábrica) aporta +0.003 por partido.
  - **Castigo por no votar** (Ajustes → Puntaje): jugaste y no entregaste evaluación → −0.02. Cuenta como votar cualquier envío: votos, abstenciones ("No aplica") y pulgares — se castiga no abrir la pantalla, no el contenido. Tiene **tres condiciones, y las tres importan**:
    1. `partidos.evaluaciones_ya_abiertas` es true. Sin esto, un partido al que solo se le cargó el marcador castigaría a los 14 por algo que nunca pudieron hacer.
    2. La fecha del partido es `>= reco_castigo_no_votar_desde`. **Esa fecha no tiene default: vacía = no se castiga a nadie.** Es lo que impide que un recálculo vuelva la regla retroactiva sobre los partidos de cuando nadie sabía que existía.
    3. La votación NO llegó a `reco_min_votantes`. Si alcanzó el quórum, los reconocimientos se repartieron igual y nadie salió perjudicado — el castigo existe para que haya votos suficientes, no para cobrarle a cada quien.
  - `reco_castigo_no_votar` (bool) es el interruptor general por encima de todo eso.
  - **Faltas con racha** (`lib/faltas.ts`, `rating_faltas_gap`, default 3): no inscribirse solo resta desde la tercera falta **seguida**. Restar en cada partido castigaba a quien no puede un día fijo — el club juega martes y viernes, y el que solo puede martes perdía 0.02 cada viernes para siempre. Cortan la racha: jugar, quedar en espera, una ausencia marcada por admin, y los partidos anteriores a su llegada al club. Las faltas que no llegan al gap dejan un `rating_event` con delta 0 y motivo `no jugó (1/3)`, para que quede el rastro.
  - Tope por partido: ±0.075 normal, ±0.15 minitorneo. Se muestra con 2 decimales (`formatRating`).
  - Se aplica una vez por partido, al cerrar evaluaciones y con resultado, vía `rating_events`.
  - **Recálculo total** (Ajustes → Puntaje → "Recalcular ratings", superadmin): borra `rating_events`, vuelve todos a 3.0 y replaya cada partido en orden cronológico con `applyMatchRatings`. Replay y no SQL a propósito: el cálculo depende de badges, pulgares, resultado, equipos, inscripciones, ausencias y tres settings, así que una versión en SQL sería una segunda implementación y se separaría en el primer cambio de reglas. Va por lotes de 12 partidos (el historial completo son cientos de consultas y la función se cortaría por tiempo); el cliente recorre los lotes con el cursor `siguiente_fecha`. Es seguro repetirlo: el ledger es función pura de los datos. **Un jugador baneado o sin aprobar queda en 3.0** — el motor solo califica a quien está activo hoy y no hay registro histórico de esos campos.
- **Hora promo del club** (default 2 PM): se promueven invitados, se arma borrador de equipos automático (sin confirmar), se avisa a admins y jugadores, y el home deja de mostrar el partido anterior.
- **Cierre de partido:**
  - El partido se ve hasta hora + 1 h. Desde el inicio se ocultan inscribirse / cancelar / invitados.
  - A hora + 1 h: con **más de 12 confirmados** (invitados incluidos) se marca jugado y abren votaciones solas. Si no, se pregunta a los admins por push.
  - La tarjeta "¿Se jugó el partido?" (home y panel admin) pide marcador y foto. "Sí" abre votaciones de inmediato; "No" no abre nada y revierte el rating.
- **Ausencia** (`lib/ausencia.ts`, dentro de **Editar** en Admin → Jugadores):
  - Admins y superadmin también pueden marcarse a sí mismos desde **Mi perfil** (sección "MI AUSENCIA", visible solo para esos roles).
  - Desde 2026-09-18 vive dentro del modal de **Editar**, no en un botón ✈️ suelto en la fila. Por eso **"Editar" se muestra ahora también para admins y superadmins**: es lo único que se les puede hacer, y sin eso un admin no podría marcarle la ausencia a otro. Dentro del modal, a un target privilegiado solo se le pinta la ausencia — uniforme, email, contraseña, suspender y eliminar quedan ocultos porque el API ya los rechaza con `ERR_PRIVILEGED`.
  - **Solo la marca un admin o superadmin.** Si la marcara el jugador, cualquiera protegería su rating a gusto. El cliente no puede escribir en `profiles`.
  - Rango de fechas: desde el día en que se marca, hasta la fecha que elige el admin (máximo 90 días). Así, recalcular un partido viejo no la aplica hacia atrás.
  - Mientras está activa: no resta por no inscribirse (motivo `ausente` en `rating_events`), no llegan avisos de apertura ni de cupos, y **el jugador no puede inscribirse solo**.
  - Si juega igual (un admin lo agrega), el partido cuenta completo. La ausencia nunca protege de perder.
  - Nota: se tocó `lib/rating.ts` (área del cloud) solo para esta exención, en la rama "no jugó".
- **Ver perfil de un jugador** (`components/admin/PerfilJugadorModal.tsx`, acción GET `perfil_jugador`): ficha de solo lectura en Admin → Jugadores. Partidos jugados, % de asistencia, reconocimientos agrupados por tipo, rating y tier, posiciones.
  - Los reconocimientos se agrupan con `agruparBadges()` de `lib/categorias`, **compartida con el perfil del jugador**. Las dos pantallas tenían su propia copia; que muestren lo mismo con código distinto es lo que se separa al primer cambio.
  - **No muestra el historial partido por partido, a propósito.** Se probó y se descartó: lo que pasó ya pasó y el rating lo resume. Lo que sirve es el estado presente, en una sola frase — "No juega hace 45 días (20 partidos) · 5 faltas seguidas, ya le está restando" o "🔥 7 partidos seguidos". El cálculo vive en `lib/asistencia.ts` (puro, con pruebas).
  - El aviso de faltas usa el `rating_faltas_gap` del club, así que dice cuántas le faltan para que empiece a costarle. Sin ese número, "2 faltas seguidas" no le dice nada al admin.
- **Recordatorio de votación** (cron, 7 PM del día siguiente al partido): push **y** email a los confirmados que todavía no han entregado evaluación. No sale si la votación ya llegó a `reco_min_votantes` — si hay quórum nadie va a perder puntaje y no hay por qué molestar. Bandera `partidos.notif_votar_sent` para que no se repita cada minuto. Todo el bloque va en try/catch: si falta `20260919_recordatorio_votar.sql` no manda nada y el resto del cron sigue igual.
  - **La ventana de votación es más corta de lo que suena:** abren al cerrar el partido (~1 h después del pito) y el cron las cierra cuando la fecha queda dos días atrás, o sea en el tic de las **00:00 del día D+2**. Para un partido del martes: abren martes ~8 PM, cierran jueves a medianoche. En la práctica se vota "hasta que se acabe el miércoles".
- **Progreso de votación** (Admin → Historial, acción GET `progreso_votaciones`): barra + "8 de 14 han votado" junto al botón de cerrar, y "votaron" cuando ya cerró. Va por el servidor porque el cliente ya no puede leer `votos_reconocimiento` ni `player_thumbs` — quedaron sin políticas para que los votos sean anónimos de verdad. Un jugador cuenta una sola vez aunque haya mandado votos y pulgares.
  - **Nació mal y se corrigió el 2026-09-20:** decía "2 de 14 votaron" en partidos donde la tarjeta mostraba reconocimientos de 7 y 8 votos. No era desacuerdo entre dos conteos, era uno solo mal leído — las tres lecturas no paginaban y PostgREST las cortaba en 1000 filas (ver la trampa en §2). El denominador salía bien porque `inscripciones` cabía; el numerador no. Ahora las tres van por `leerTodo()`.
- **Empates en reconocimientos:** un empate arriba **se lo llevan todos los del tope**, no se desempata. Elegir "el primero" era una moneda al aire con cara de criterio. En la base eso son dos filas en `player_badges`, una por ganador, y la tarjeta del partido las repetía como si fueran dos categorías distintas ("La más perrota" dos veces, con nombres y votos distintos) — se leía como un error de conteo. Desde 2026-09-20 `MatchResultCard` agrupa por `badge_id` y lo dice: "hernan14 y danielb3 · 3 votos c/u · EMPATE". **El comportamiento no cambió, solo dejó de parecer un bug.**
- **Evaluaciones:** se abren una sola vez (`evaluaciones_ya_abiertas`) y se cierran solas a los 2 días.
- **Timezone:** todo en Colombia (UTC−5).

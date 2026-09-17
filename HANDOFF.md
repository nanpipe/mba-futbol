# HANDOFF — estado compartido entre sesiones

Varias sesiones de Claude trabajan este repo (local en Windows y cloud). **GitHub `main` es lo único que comparten.** Esta conversación, `.env.local`, las ramas locales y la memoria de cada sesión no viajan. Si algo importa, va aquí.

Última actualización: 2026-09-17.

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

---

## 3. Áreas y dueños

Asignar con el usuario. Hasta que se asigne, preguntar antes de tocar:

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
| `20260917_abstencion_reconocimientos.sql` | sin confirmar | cloud |
| `20260917_badges_votos.sql` | sin confirmar | cloud |
| `20260917_quitar_bug_reports.sql` | sin confirmar | cloud |
| `20260917_quitar_escrituras_de_cliente.sql` | sin confirmar | cloud |
| `20260917_quitar_politicas_public.sql` | sin confirmar | cloud |
| `20260917_reconocimientos_revocados.sql` | sin confirmar | cloud |
| `20260917_registro_sin_metadata_del_cliente.sql` | sin confirmar | cloud |
| `20260917_storage_limpiar_duplicadas.sql` | probablemente corrida | verificado 2026-09-17 con la llave anon: listar da 0 y subir queda rechazado en ambos buckets |
| `20260917_votos_sin_politicas.sql` | sin confirmar | cloud |
| `20260917_habilidad_precision.sql` | corrida | el usuario vio su rating corregido (3.3 → 3.05) |
| `20260917_ausencia.sql` | **pendiente** | `profiles.ausente_desde` / `ausente_hasta`. El panel admin la necesita: no hacer push del código sin que esté corrida. |

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

### 5.3 Otros
- **Invitaciones / multi-club:** pausado hasta comprar dominio (subdominios por club, `NEXT_PUBLIC_ROOT_DOMAIN`, `ALLOWED_ORIGINS`).
- **Prueba de aislamiento entre clubes:** propuesta, no hecha. Un club canario con datos dummy, más un script que inicie sesión en cada club e intente leer y escribir datos del otro por cada ruta y tabla. Requiere que el usuario cree el usuario canario.
- **Verificar en Vercel** que `NEXT_PUBLIC_SITE_URL` no sea localhost.

---

## 6. Decisiones de producto vigentes

- **Rating v2** (`lib/rating.ts`):
  - Base 3.0, rango 1–5. Pasos de 0.02: jugó +, ganó + / perdió −, reconocimientos ±, pulgares por escalones, no inscrito −. Quien queda en espera está exento.
  - Tope por partido: ±0.075 normal, ±0.15 minitorneo. Se muestra con 2 decimales (`formatRating`).
  - Se aplica una vez por partido, al cerrar evaluaciones y con resultado, vía `rating_events`.
- **Hora promo del club** (default 2 PM): se promueven invitados, se arma borrador de equipos automático (sin confirmar), se avisa a admins y jugadores, y el home deja de mostrar el partido anterior.
- **Cierre de partido:**
  - El partido se ve hasta hora + 1 h. Desde el inicio se ocultan inscribirse / cancelar / invitados.
  - A hora + 1 h: con **más de 12 confirmados** (invitados incluidos) se marca jugado y abren votaciones solas. Si no, se pregunta a los admins por push.
  - La tarjeta "¿Se jugó el partido?" (home y panel admin) pide marcador y foto. "Sí" abre votaciones de inmediato; "No" no abre nada y revierte el rating.
- **Ausencia** (`lib/ausencia.ts`, botón ✈️ en Admin → Jugadores):
  - **Solo la marca un admin o superadmin.** Si la marcara el jugador, cualquiera protegería su rating a gusto. El cliente no puede escribir en `profiles`.
  - Rango de fechas: desde el día en que se marca, hasta la fecha que elige el admin (máximo 90 días). Así, recalcular un partido viejo no la aplica hacia atrás.
  - Mientras está activa: no resta por no inscribirse (motivo `ausente` en `rating_events`), no llegan avisos de apertura ni de cupos, y **el jugador no puede inscribirse solo**.
  - Si juega igual (un admin lo agrega), el partido cuenta completo. La ausencia nunca protege de perder.
  - Nota: se tocó `lib/rating.ts` (área del cloud) solo para esta exención, en la rama "no jugó".
- **Evaluaciones:** se abren una sola vez (`evaluaciones_ya_abiertas`) y se cierran solas a los 2 días.
- **Timezone:** todo en Colombia (UTC−5).

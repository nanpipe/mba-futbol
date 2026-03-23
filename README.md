# ⚽ MBA Fútbol Club

App de registro para partidos de fútbol. Martes y viernes, 7pm.

---

## Stack

- **Frontend/Backend**: Next.js 15 (App Router)
- **Base de datos + Auth**: Supabase
- **Emails**: Resend
- **Deploy**: Vercel

---

## Configuración paso a paso

### 1. Supabase

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. En el dashboard ve a **SQL Editor** y pega todo el contenido de `supabase_schema.sql`. Ejecuta.
3. Ve a **Project Settings → API** y copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ nunca exponer en el frontend

4. **Deshabilitar confirmación de email** (para empezar rápido):
   - Ve a **Authentication → Providers → Email**
   - Desactiva "Confirm email" si quieres que los usuarios entren sin confirmar.
   - O déjalo activo y Supabase envía el email de confirmación automáticamente.

5. **Crear el admin manualmente**:
   ```sql
   -- Ejecutar en SQL Editor DESPUÉS de que el admin se registre normalmente en la app
   UPDATE public.profiles
   SET role = 'admin'
   WHERE username = 'tu_usuario_admin';
   ```

### 2. Resend

1. Entra a [resend.com](https://resend.com) y crea una cuenta gratuita.
2. Ve a **API Keys** y crea una nueva clave.
3. Cópiala como `RESEND_API_KEY`.
4. **Para producción**: verifica tu dominio en Resend → Domains.
   - **Para pruebas**: usa `onboarding@resend.dev` como `RESEND_FROM_EMAIL` (solo envía a tu email registrado en Resend).

### 3. Variables de entorno locales

```bash
cp .env.example .env.local
# Editar .env.local con tus valores reales
```

### 4. Desarrollo local

```bash
npm install
npm run dev
# → http://localhost:3000
```

### 5. Deploy en Vercel

1. Sube el proyecto a GitHub:
   ```bash
   git init
   git add .
   git commit -m "init: MBA Fútbol Club"
   git remote add origin https://github.com/TU_USUARIO/mba-futbol.git
   git push -u origin main
   ```

2. Entra a [vercel.com](https://vercel.com) → New Project → importa el repo.

3. En **Environment Variables** agrega todas las del `.env.example` con sus valores reales.

4. **Importante**: cambia `NEXT_PUBLIC_SITE_URL` a la URL de tu proyecto en Vercel (ej: `https://mba-futbol.vercel.app`).

5. Deploy → ¡listo!

---

## Lógica de inscripciones

| Día | Hora | Ventana abierta para |
|-----|------|----------------------|
| Domingo | ≥ 10:00am | Partido del martes |
| Lunes | todo el día | Partido del martes |
| Jueves | ≥ 10:00am | Partido del viernes |

Fuera de esas ventanas: inscripciones cerradas con countdown.

**Cupos**: 14 confirmados. Del 15 en adelante → lista de espera por orden de llegada.

**Promoción automática**: cuando alguien cancela o es removido por admin, el primero en espera pasa a confirmado y recibe un email.

---

## Restricción de IP

Al registrarse, se guarda la IP del dispositivo. Si otro intenta crear cuenta desde la misma IP → bloqueado.

> **Nota**: Si tus amigos están en la misma red WiFi y dos quieren registrarse al mismo tiempo desde el mismo lugar, tendrán que hacerlo desde datos móviles (IPs diferentes). Esta es una limitación conocida de la restricción por IP.

---

## Panel de Admin

Accede en `/admin` — solo visible para cuentas con `role = 'admin'`.

**Tab Partidos**: ver inscritos por partido, remover a alguien de un partido específico.

**Tab Jugadores**: suspender con razón y fecha de liberación, o liberar manualmente.

Al suspender: el jugador es removido de todos los partidos futuros y el siguiente en espera entra automáticamente.

---

## Estructura del proyecto

```
src/
├── app/
│   ├── page.tsx              # Página principal (inscripciones)
│   ├── login/page.tsx        # Login
│   ├── registro/page.tsx     # Registro con verificación de IP
│   ├── admin/page.tsx        # Panel de administración
│   ├── api/
│   │   ├── inscripciones/    # POST (inscribirse) / DELETE (cancelar)
│   │   ├── admin/            # Banear, liberar, remover de partido
│   │   ├── notify/           # Procesar cola de emails
│   │   └── ip/               # Detectar IP del cliente
│   └── globals.css
├── lib/
│   ├── supabase/
│   │   ├── client.ts         # Cliente browser
│   │   ├── server.ts         # Cliente SSR
│   │   └── admin.ts          # Cliente service role
│   ├── partidos.ts           # Lógica de ventanas de inscripción
│   └── email.ts              # Envío de emails via Resend
└── middleware.ts              # Refresco de sesión SSR
```

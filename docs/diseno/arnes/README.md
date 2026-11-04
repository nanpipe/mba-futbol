# Arnés de capturas

Sirve para renderizar las pantallas **reales** de la app (no páginas de prueba)
sin base de datos, y medir botones chicos y desbordes en tamaño de celular.

- `server.mjs`: un Supabase falso (PostgREST + auth) con datos de ejemplo del
  club en el puerto 54321. Escenarios: `abierto`, `votacion`, `cierre` (el partido del 3-nov ya marcado como jugado, sin marcador: la tarjeta de cierre muestra marcador y foto) (se cambian con
  `GET /__scenario/<nombre>`; `shot.mjs` lo hace solo). Un tema de colores
  guardado se simula con `GET /__tema/<json urlencoded>` (y `/__tema/null`).
- `shot.mjs`: abre una ruta con Chromium a 390×844 (`isMobile`, `hasTouch`),
  ya logueado como `pipes22`, guarda la captura completa y por pantallas, y
  muestra `scrollWidth`, cuántos tocables miden menos de 44 px y los errores.

```bash
npm install --no-save playwright           # si no está
node docs/diseno/arnes/server.mjs &         # Supabase falso
# Las claves falsas de push/correo evitan que algunas rutas de API respondan 500.
eval $(node -e "const k=require('web-push').generateVAPIDKeys();console.log('PUB='+k.publicKey+' PRIV='+k.privateKey)")
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_PUSHER_APP_KEY=$PUB PUSHER_APP_SECRET=$PRIV \
  RESEND_API_KEY=re_solo_para_el_test_local npx next dev -p 3000 &
OUT=/tmp/capturas/ node docs/diseno/arnes/shot.mjs / inicio.png abierto
OUT=/tmp/capturas/ node docs/diseno/arnes/shot.mjs /evaluar/00000000-0000-4000-8000-000000000901 evaluar.png votacion
```

Va en el puerto **3000** a propósito: el middleware rechaza con `Forbidden` los POST a `/api/*` cuyo `Origin` no esté en `ALLOWED_ORIGINS` (3000 y 3001 sí están). En otro puerto se ven las pantallas pero no funciona ningún botón que guarde.

No toca `.env.local` ni la base real. Al terminar: `pkill -f "next dev"` (en su
propia llamada, sale con 144) y `git checkout next-env.d.ts` si `next dev` lo
reescribió. Las trampas de Safari que esto **no** detecta están en
`.claude/skills/ui-movil/SKILL.md`.

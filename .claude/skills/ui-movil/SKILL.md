---
name: ui-movil
description: Trampas de CSS y layout en iOS/Safari, y cómo verificar un cambio de interfaz renderizándolo antes de mandarlo. Leer ANTES de tocar globals.css, un modal, un formulario, o cualquier componente de pantalla. Cada trampa de acá ya rompió algo en producción y costó más de un intento arreglarla.
---

# Interfaz móvil: lo que ya se rompió y cómo verificarlo

Esta app se usa **en un iPhone**. El panel de admin también. Ante una
disyuntiva entre móvil y escritorio, **gana el móvil** — eso no es una
preferencia estética, es de dónde vienen todos los usuarios.

## Regla de oro

**No mandar CSS que no se haya renderizado.** Existe Chromium en el contenedor
y la receta de abajo toma diez minutos. Tres vueltas perdidas en un solo bug de
iOS salieron de mandar arreglos "que deberían funcionar".

Y cuando algo **no se pueda verificar acá** (todo lo específico de Safari),
decirlo explícitamente en la respuesta, no dejarlo implícito.

---

## Trampas de iOS / Safari

### 1. Zoom automático en campos con letra < 16 px

Safari hace zoom sobre la página al **enfocar** cualquier `input`, `select` o
`textarea` cuya letra mida menos de 16 px. Con el zoom puesto, la página entera
queda más ancha que la pantalla.

**Cómo se ve:** la barra de arriba sale cortada **por los dos lados**. Un
desbordamiento normal corta por uno solo — esa es la forma de distinguirlos en
una captura.

**No se puede desactivar:** desde iOS 10 Safari ignora `maximum-scale` y
`user-scalable=no` por accesibilidad. El único arreglo es `font-size: 16px`.

Está en la regla base de `globals.css`. **Ojo con los `style` inline que la
pisan** — son los que se escapan. Para buscarlos:

```bash
python3 - <<'PY'
import re, pathlib
pat = re.compile(r'<(input|select|textarea)\b(.*?)/>', re.S)
for f in sorted(pathlib.Path('src').rglob('*.tsx')):
    t = f.read_text()
    for m in pat.finditer(t):
        fs = re.search(r'fontSize:\s*(\d+)', m.group(2))
        if fs and int(fs.group(1)) < 16:
            print(f'{f}:{t[:m.start()].count(chr(10))+1}  fontSize {fs.group(1)}')
PY
```

### 2. Los `input` de fecha y hora tienen ancho propio

Safari les da un ancho intrínseco (del `-webkit-appearance` nativo) que
**ignora `width: 100%`**. En un modal eso deja barra de scroll horizontal
dentro de la tarjeta y el campo cortado.

**Cómo se ve:** los campos de fecha/hora sobresalen mientras los `type="number"`
del mismo formulario quedan bien. Esa diferencia entre unos campos y otros es
la pista.

**Lo único que lo suelta es `appearance: none`**, y va bajo
`@media (hover: none) and (pointer: coarse)`: en Chrome de escritorio quita el
icono de calendario y el clic deja de abrir el selector, y en escritorio el
campo nunca se desbordó.

Ya se intentó y **no funcionó**: `min-width: 0` en el input, y
`text-align: left` + `min-width: 0` en `::-webkit-date-and-time-value`. Alinea
el texto pero no quita el desborde. No volver a intentar por ahí.

### 3. `overflow-x: hidden` es red, no arreglo

`.modal-overlay > *` lo lleva para que un formulario no se deslice de lado. Pero
solo **recorta**: si un hijo es más ancho, se ve cortado en vez de encogerse. Si
aparece el síntoma, hay que arreglar el hijo igual.

### 4. Fechas formateadas rompen la hidratación

`toLocaleString('es-CO', …)` escribe el "a. m." con un espacio normal en Node y
uno angosto en Chrome. Si eso se pinta en servidor y otra vez en cliente, React
lo cuenta como *hydration mismatch*, bota el árbol y se ve un parpadeo.

Usar `fechaHoraCO()` / `fechaHoraCortaCO()` de `lib/notifHorario.ts`, que arman
la cadena a mano. Los números sí salen de `Intl`, que es lo que sabe pasar un
instante UTC a hora de Colombia.

### 5. Emojis sin glifo

`⚔` no tiene glifo en todas las fuentes y cae a `×`, que en un selector parece
un botón de borrar. `✏` sin selector de variación se pinta como texto gris.
Si el emoji importa, usar la variante con `️` (VS16) y **mirarlo renderizado**.

---

## Receta para verificar una pantalla

El `session-start` deja `.env.local` falso y `playwright` instalado. Falta
levantar el servidor y, casi siempre, una página de prueba.

### 1. Página de prueba temporal

Casi ninguna pantalla se puede abrir directo: piden sesión y Supabase. Se monta
un componente con datos de mentira:

```
src/app/mockX/page.tsx     ← 'use client', renderiza el componente con fixtures
src/app/api/mockY/route.ts ← si el componente hace fetch de settings
```

**Las carpetas que empiezan por `_` NO son rutas en Next** (son privadas). Usar
`mockX`, no `_mockX`.

Si el componente llama a un endpoint real, redirigir el `fetch` con `sed` y
devolverlo al final. **Borrar todo antes de commitear** y verificar con
`git status` que no quedó nada.

### 2. Levantar el servidor

```bash
rm -rf .next && (npx next dev -p 3111 > /tmp/dev.log 2>&1 &)
for i in $(seq 1 30); do sleep 2; if curl -sf -o /dev/null http://localhost:3111/mockX; then echo LISTO; break; fi; done
```

Trampas:
- **No borrar `.next` mientras el server arranca**: queda en 500 con
  `ENOENT build-manifest.json` y hay que reiniciarlo.
- `pkill -f "next dev"` sale con **código 144** y corta el resto del comando
  encadenado. Ponerlo en su propia llamada.

### 3. Mirar y medir

```js
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
// isMobile + hasTouch hace que (hover:none) y (pointer:coarse) coincidan.
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
})
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://localhost:3111/mockX', { waitUntil: 'networkidle' })
await p.screenshot({ path: 'out.png', fullPage: true })
console.log('scrollWidth', await p.evaluate(() => document.documentElement.scrollWidth)) // debe ser 390
console.log('errores:', errs.length ? errs : 'ninguno')
```

**Mirar la captura, no solo los números.** Los problemas que más ha reportado el
usuario (nombres cortados, tarjetas que se pisan, un `sticky` tapando la
sección de abajo) no aparecen en ninguna medición.

Revisar siempre:
- `document.documentElement.scrollWidth === 390`
- cero `pageerror` (ojo: un *hydration mismatch* por HMR viejo es ruido —
  reiniciar el server limpio antes de creerle)
- la captura a 390 px de ancho, que es el teléfono del usuario

### 4. Lo que NO se puede verificar acá

- **Safari / iOS.** Chromium no reproduce sus bugs y **WebKit no se puede bajar**
  (el proxy del contenedor bloquea `playwright install webkit`). Todo lo
  específico de Safari se manda con la advertencia explícita de que no está
  comprobado.
- `npm run build` **siempre falla** al final con `No key set vapidDetails.publicKey`:
  es la falta de secretos en la nube, no el código. Lo que vale mirar es
  `✓ Compiled successfully` y `Finished TypeScript`.

---

## Antes de mandar

1. `npx tsc --noEmit` limpio
2. `npm run build` → `Compiled successfully` (el fallo de VAPID se ignora)
3. La pantalla renderizada a 390 px, mirada
4. `npm run check:secrets`
5. `git status` sin páginas de prueba ni `.env.local`

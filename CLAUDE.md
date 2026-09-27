## Before starting any session (local or cloud)
More than one Claude session works on this repo. GitHub `main` is the only shared state.
1. `git pull` — never start from a stale checkout.
2. `npm install` (runs `prepare`, which enables the secret-scanning pre-commit hook).
3. Read `HANDOFF.md`: current state, pending work, who owns which area, migrations run.
4. When done: push, and update `HANDOFF.md` if state changed.

`main` auto-deploys to Vercel (production, the only environment). Never `push --force`.
Never push code that needs a migration the user hasn't confirmed running.

## Esta app se usa en un teléfono
El club entra desde el celular, y el panel de admin también. **Ante una
disyuntiva entre móvil y escritorio, gana el móvil.** Perder un icono en Chrome
de escritorio para que un formulario no se rompa en iOS es un buen cambio;
al revés no.

Antes de tocar `globals.css`, un modal o un formulario, leer
`.claude/skills/ui-movil/SKILL.md`: tiene las trampas de Safari que ya costaron
varios intentos y la receta para renderizar una pantalla y mirarla.

## Windows File Path Requirements (local Windows sessions only)
Applies only when running on the user's Windows machine. Cloud/Linux sessions use normal POSIX paths.
- All file paths MUST use drive letters (e.g., `C:\Users\TuNombre\...`)
- Use backslashes (`\`), NEVER forward slashes for file operations
- Use absolute paths, not relative paths without drive letters

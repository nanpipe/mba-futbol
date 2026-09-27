#!/bin/bash
# Prepara una sesión de Claude Code en la nube para poder VERIFICAR cambios:
# compilar, revisar tipos y renderizar pantallas en Chromium.
#
# Solo corre en remoto. En la máquina del usuario no toca nada: ahí ya está
# todo instalado y, sobre todo, ahí sí hay secretos de verdad.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# 1. Dependencias. `npm install` (y no `ci`) para aprovechar el caché del
#    contenedor. De paso corre `prepare`, que apunta core.hooksPath a githooks/.
npm install --no-audit --no-fund

# 2. El hook de secretos solo corre si el archivo es ejecutable. El bit ya está
#    guardado en git, pero esto lo deja bien aunque se clone de una forma que
#    no lo conserve: si se pierde, cada commit se hace SIN revisar secretos y
#    git solo avisa con un `hint` fácil de pasar por alto.
chmod +x githooks/* 2>/dev/null || true

# 3. Playwright, para poder mirar las pantallas antes de mandarlas. Va con
#    --no-save a propósito: es herramienta de esta sesión, no dependencia del
#    proyecto, y no tiene por qué aparecer en el package.json del usuario.
#    Los navegadores ya vienen en la imagen (PLAYWRIGHT_BROWSERS_PATH).
npm install --no-save --no-audit --no-fund playwright >/dev/null 2>&1 || \
  echo "[session-start] playwright no se pudo instalar; las capturas no van a funcionar"

# 4. Variables de mentira para que `next dev` arranque y se puedan renderizar
#    pantallas. La sesión en la nube NO tiene secretos y así debe seguir (ver
#    HANDOFF §1), así que acá nunca hay nada real que pisar. Solo se crea si
#    falta: si alguna vez el entorno inyecta credenciales, no las tapa.
if [ ! -f .env.local ] && [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  cat > .env.local << 'ENV'
# Generado por .claude/hooks/session-start.sh — TODO FALSO, solo para que
# `next dev` levante y se puedan tomar capturas. No sirve para hablar con
# Supabase: las pantallas con datos se prueban con una página de prueba
# temporal (ver .claude/skills/ui-movil).
NEXT_PUBLIC_SUPABASE_URL=https://local-no-existe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-de-mentira-solo-para-render-local
SUPABASE_SERVICE_ROLE_KEY=service-de-mentira-solo-para-render-local
NEXT_PUBLIC_SITE_URL=http://localhost:3000
TZ=America/Bogota
ENV
fi

echo "[session-start] listo · rama $(git rev-parse --abbrev-ref HEAD) · $(git log -1 --format=%h)"

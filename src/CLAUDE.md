## Windows File Path Requirements (local Windows sessions only)
Applies only when running on the user's Windows machine. Cloud/Linux sessions use normal POSIX paths.
See the root `CLAUDE.md` and `HANDOFF.md` before starting.
- All file paths MUST use drive letters (e.g., `C:\Users\TuNombre\...`)
- Use backslashes (`\`), NEVER forward slashes for file operations
- Use absolute paths, not relative paths without drive letters

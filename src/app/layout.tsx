import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MBA Fútbol Club',
  description: 'Registro de partidos — Martes y Viernes 7pm',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}

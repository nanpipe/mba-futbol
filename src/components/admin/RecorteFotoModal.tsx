'use client'

import { useState, useCallback, useEffect } from 'react'
import Cropper from 'react-easy-crop'
import { Card } from '@/components/Card'
import { ModalOverlay } from '@/components/ModalOverlay'
import {
  recortarYComprimir, extensionDe, FOTO_RATIO, FOTO_ANCHO_MAX,
  type AreaRecorte, type FotoProcesada,
} from '@/lib/imagen'

/**
 * Recorta la foto del partido a 16:9 antes de subirla.
 *
 * Se abre con el encuadre más grande que quepa, centrado, así que quien tenga
 * afán da un toque en "Usar así" sin mover nada. El que quiera, arrastra y
 * hace pinza para acercar.
 *
 * Todo pasa en el celular del admin: lo que sale de aquí ya va recortado,
 * reducido a 1280 px y en WebP. El servidor nunca ve los 4 MB originales.
 */
export function RecorteFotoModal({
  archivo, onCancelar, onListo,
  aspecto = FOTO_RATIO,
  redondo = false,
  titulo = 'ENCUADRAR FOTO · 16:9',
  ayuda,
  procesar,
}: {
  archivo: File
  onCancelar: () => void
  onListo: (foto: File) => void
  /** Relación del recorte. 1 para un avatar. */
  aspecto?: number
  /** Guía circular en vez de rectangular: lo que se ve es lo que queda. */
  redondo?: boolean
  titulo?: string
  ayuda?: React.ReactNode
  /** Cómo convertir el recorte. Por defecto, la foto del partido. */
  procesar?: (file: Blob, area: AreaRecorte) => Promise<FotoProcesada>
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<AreaRecorte | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(archivo)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [archivo])

  // react-easy-crop entrega el área en píxeles de la imagen ya orientada por
  // el navegador, que es el mismo espacio en el que decodifica lib/imagen.
  const alTerminar = useCallback((_: unknown, px: AreaRecorte) => setArea(px), [])

  const confirmar = async () => {
    if (!area) return
    setProcesando(true)
    setError(null)
    try {
      const r: FotoProcesada = procesar
        ? await procesar(archivo, area)
        : await recortarYComprimir(archivo, area)
      const nombre = `partido.${extensionDe(r.tipo)}`
      onListo(new File([r.blob], nombre, { type: r.tipo }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo procesar la foto.')
      setProcesando(false)
    }
  }

  return (
    <ModalOverlay>
      <Card style={{ width: '100%', maxWidth: 460, margin: 'auto' }} padding={18}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 10 }}>
          {titulo}
        </div>

        <div style={{
          position: 'relative', width: '100%', aspectRatio: String(aspecto),
          background: '#000', borderRadius: 4, overflow: 'hidden',
        }}>
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={aspecto}
              cropShape={redondo ? 'round' : 'rect'}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={alTerminar}
              showGrid={false}
              restrictPosition
            />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span className="mono" style={{ fontSize: 14, color: 'var(--text-dim)' }}>−</span>
          <input
            type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            disabled={procesando}
            aria-label="Acercar"
            style={{ flex: 1, accentColor: 'var(--green)' }}
          />
          <span className="mono" style={{ fontSize: 14, color: 'var(--text-dim)' }}>+</span>
        </div>

        <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          {ayuda ?? <>Arrastra para mover, pellizca o usa la barra para acercar.
            Se guarda a {FOTO_ANCHO_MAX} px, comprimida.</>}
        </div>

        {error && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--amber)', marginTop: 10 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={confirmar}
            disabled={procesando || !area}
            className="btn btn-primary"
            style={{ padding: '10px 20px', fontSize: 13 }}
          >
            {procesando ? 'Procesando...' : 'Usar así'}
          </button>
          <button
            onClick={onCancelar}
            disabled={procesando}
            className="btn btn-ghost"
            style={{ padding: '10px 20px', fontSize: 13 }}
          >
            Cancelar
          </button>
        </div>
      </Card>
    </ModalOverlay>
  )
}

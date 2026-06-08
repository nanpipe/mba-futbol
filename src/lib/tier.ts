export function calcTier(ovr: number): string {
  if (ovr >= 88) return 'leyenda'
  if (ovr >= 81) return 'crack'
  if (ovr >= 74) return 'oro'
  if (ovr >= 67) return 'plata'
  if (ovr >= 60) return 'bronce_alto'
  return 'bronce_bajo'
}

export function getTierStyle(tier: string): { bg: string; text: string; label: string } {
  switch (tier) {
    case 'leyenda':    return { bg: 'linear-gradient(145deg, #1a0533, #4c1d95, #7c3aed, #a855f7)', text: '#f3e8ff', label: 'LEYENDA' }
    case 'crack':      return { bg: 'linear-gradient(145deg, #431407, #9a3412, #ea580c, #fb923c)', text: '#fff7ed', label: 'CRACK'   }
    case 'oro':        return { bg: 'linear-gradient(145deg, #713f12, #a16207, #ca8a04, #eab308, #fde047)', text: '#1c1917', label: 'ORO' }
    case 'plata':      return { bg: 'linear-gradient(145deg, #1e293b, #334155, #64748b, #94a3b8)', text: '#f1f5f9', label: 'PLATA'      }
    case 'bronce_alto':return { bg: 'linear-gradient(145deg, #292524, #57534e, #a8a29e, #d6d3d1)', text: '#1c1917', label: 'BRONCE'     }
    default:           return { bg: 'linear-gradient(145deg, #1c1917, #44403c, #78716c)',           text: '#e7e5e4', label: 'BRONCE'     }
  }
}

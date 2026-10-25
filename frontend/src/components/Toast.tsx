import { CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { Toast as T } from 'radix-ui'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  message: string
  tone: 'success' | 'error'
}

const ToastContext = createContext<(message: string, tone?: ToastItem['tone']) => void>(() => {})

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext)

/** Radix toasts announce through an aria-live="polite" region (UI_UX_SPEC §7). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const show = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), message, tone }])
  }, [])

  return (
    <ToastContext.Provider value={show}>
      <T.Provider swipeDirection="right" duration={4500}>
        {children}
        {items.map((t) => (
          <T.Root
            key={t.id}
            className="card flex items-start gap-3 px-4 py-3 shadow-pop"
            onOpenChange={(open) => !open && setItems((prev) => prev.filter((x) => x.id !== t.id))}
          >
            {t.tone === 'success' ? (
              <CheckCircle2
                size={18}
                className="mt-0.5 shrink-0 text-verified"
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                size={18}
                className="mt-0.5 shrink-0 text-rejected"
                aria-hidden="true"
              />
            )}
            <T.Description className="flex-1 text-sm">{t.message}</T.Description>
            <T.Close
              aria-label="Dismiss"
              className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
            >
              <X size={16} aria-hidden="true" />
            </T.Close>
          </T.Root>
        ))}
        <T.Viewport className="fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 outline-none" />
      </T.Provider>
    </ToastContext.Provider>
  )
}

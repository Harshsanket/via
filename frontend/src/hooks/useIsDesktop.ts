import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 768px)'

const subscribe = (onStoreChange: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined

  const mediaQuery = window.matchMedia(QUERY)
  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

const getSnapshot = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(QUERY).matches

const getServerSnapshot = (): boolean => false

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

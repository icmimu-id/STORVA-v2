'use client'

import { useEffect, useState } from 'react'

export function useDashboardData(userId?: string) {
  const [storage, setStorage] = useState<any>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [favorites, setFavorites] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/storage/status')
      .then((r) => r.json())
      .then((d) => setStorage(d))
      .catch(() => {})
    fetch('/api/activity?page=1&limit=5')
      .then((r) => r.json())
      .then((d) => setActivity(d.items || []) )
      .catch(() => {})
    if (userId) {
      fetch('/api/favorites', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setFavorites(d.items || []))
        .catch(() => {})
    }
  }, [userId])

  return { storage, activity, favorites }
}

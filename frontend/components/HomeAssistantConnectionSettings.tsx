'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, RefreshCw } from 'lucide-react'
import api from '@/services/api'

interface EntityChoice {
    entity_id: string
    name: string
}

interface ConnectionCheck {
    configured: boolean
    connected: boolean
    url?: string
    tracker?: string
    tracker_found?: boolean
    zones?: EntityChoice[]
    trackers?: EntityChoice[]
    detail?: string
}

export default function HomeAssistantConnectionSettings() {
    const t = useTranslations('HomeAssistantConnection')
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<ConnectionCheck | null>(null)
    const [error, setError] = useState('')

    const checkConnection = async () => {
        setBusy(true)
        setError('')
        setResult(null)
        try {
            const response = await api.get<ConnectionCheck>('/core/home-assistant/connection/')
            setResult(response.data)
        } catch (err: any) {
            setError(err?.response?.data?.detail || t('failed'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div>
                <h3 className="text-base font-semibold text-gray-900">{t('title')}</h3>
                <p className="mt-1 text-sm text-gray-600">{t('description')}</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600">
                {t('serverConfiguration')}
            </div>
            <button
                type="button"
                onClick={checkConnection}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {t('check')}
            </button>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {result && !result.connected && (
                <p role="status" className="text-sm text-amber-800">
                    {result.detail || t('notConnected')}
                </p>
            )}
            {result?.connected && (
                <div role="status" className="space-y-3 text-sm">
                    <p className="font-semibold text-green-700">{t('connected')}</p>
                    <p className="break-all text-gray-600">{result.url}</p>
                    <p className="text-gray-700">
                        {t('found', {
                            zones: result.zones?.length || 0,
                            trackers: result.trackers?.length || 0,
                        })}
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <h4 className="font-semibold text-gray-800">{t('zones')}</h4>
                            <ul className="mt-1 space-y-1 text-xs text-gray-600">
                                {result.zones?.slice(0, 20).map(zone => (
                                    <li key={zone.entity_id}>{zone.name} <span className="text-gray-400">({zone.entity_id})</span></li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold text-gray-800">{t('trackers')}</h4>
                            <ul className="mt-1 space-y-1 text-xs text-gray-600">
                                {result.trackers?.slice(0, 20).map(tracker => (
                                    <li key={tracker.entity_id}>{tracker.name} <span className="text-gray-400">({tracker.entity_id})</span></li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500">
                        {result.tracker
                            ? result.tracker_found
                                ? t('selectedTracker', { tracker: result.tracker })
                                : t('trackerMissing', { tracker: result.tracker })
                            : t('trackerNotSelected')}
                    </p>
                    <p className="text-xs text-gray-500">{t('readOnly')}</p>
                </div>
            )}
        </section>
    )
}

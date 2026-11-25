'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Save } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { useUser } from '@/contexts/UserContext'

type EntityChoice = { entity_id: string; name: string }
type ConnectionCheck = {
    configured: boolean
    connected: boolean
    url?: string
    tracker?: string
    tracker_found?: boolean
    zones?: EntityChoice[]
    trackers?: EntityChoice[]
    detail?: string
}
type HASettings = {
    ha_base_url?: string
    ha_access_token_set?: boolean
    ha_tracker_entity_id?: string
}
const defaultUrl = 'https://musart.myds.me:8123'
const defaultTracker = 'device_tracker.peters_iphone'
const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'
const action = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50'

export default function HomeAssistantConnectionSettings() {
    const { currentUser, setCurrentUser } = useUser()
    const saved = (currentUser?.preferences?.technical || {}) as HASettings
    const [url, setUrl] = useState(saved.ha_base_url || defaultUrl)
    const [token, setToken] = useState('')
    const [tracker, setTracker] = useState(saved.ha_tracker_entity_id || defaultTracker)
    const [busy, setBusy] = useState<'save' | 'test' | null>(null)
    const [result, setResult] = useState<ConnectionCheck | null>(null)
    const [error, setError] = useState('')

    useEffect(() => {
        setUrl(saved.ha_base_url || defaultUrl)
        setTracker(saved.ha_tracker_entity_id || defaultTracker)
    }, [saved.ha_base_url, saved.ha_tracker_entity_id])

    const dirty = url.trim().replace(/\/+$/, '') !== (saved.ha_base_url || defaultUrl) ||
        Boolean(token.trim()) || tracker !== (saved.ha_tracker_entity_id || defaultTracker)

    const save = async () => {
        setBusy('save')
        setError('')
        setResult(null)
        try {
            const base = url.trim().replace(/\/+$/, '')
            if (!base.startsWith('https://')) {
                setError('Bitte eine HTTPS-Serveradresse eingeben.')
                return
            }
            await api.patch('/core/users/me/', {
                preferences: { technical: {
                    ha_base_url: base,
                    ha_tracker_entity_id: tracker,
                    ...(token.trim() ? { ha_access_token: token.trim() } : {}),
                } },
            })
            setToken('')
            const response = await api.get('/core/users/me/')
            setCurrentUser(response.data)
            toast.success('Home-Assistant-Einstellungen gespeichert.')
        } catch (err: any) {
            setError(err?.response?.data?.detail || 'Einstellungen konnten nicht gespeichert werden.')
        } finally {
            setBusy(null)
        }
    }

    const checkConnection = async () => {
        setBusy('test')
        setError('')
        setResult(null)
        try {
            const response = await api.get<ConnectionCheck>('/core/home-assistant/connection/')
            setResult(response.data)
            if (response.data.connected) toast.success('Home Assistant verbunden.')
        } catch (err: any) {
            setError(err?.response?.data?.detail || 'Verbindungstest fehlgeschlagen.')
        } finally {
            setBusy(null)
        }
    }

    const trackers = result?.trackers || []
    const trackerKnown = trackers.some(item => item.entity_id === tracker)

    return (
        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div>
                <h3 className="text-base font-semibold text-gray-900">Home Assistant API</h3>
                <p className="mt-1 text-sm text-gray-600">Verbindung zum GPS-Tracker und zu den Unterrichtszonen. StudioSync liest ausschließlich Daten.</p>
            </div>
            <div className="space-y-4 rounded-lg bg-gray-50 p-4">
                <div>
                    <label htmlFor="ha-url" className="block text-xs font-medium text-gray-700 mb-1">Serveradresse (HTTPS)</label>
                    <input id="ha-url" type="url" value={url} onChange={e => { setUrl(e.target.value); setResult(null) }} disabled={!!busy} className={field} />
                </div>
                <div>
                    <label htmlFor="ha-token" className="block text-xs font-medium text-gray-700 mb-1">Langlebiger Zugriffstoken</label>
                    <input id="ha-token" type="password" autoComplete="new-password" value={token}
                        onChange={e => { setToken(e.target.value); setResult(null) }} disabled={!!busy}
                        placeholder={saved.ha_access_token_set ? 'Token gespeichert' : 'Zugriffstoken eingeben'} className={field} />
                    <p className="mt-1 text-xs text-gray-500">Leer lassen, um den gespeicherten Token beizubehalten. Er wird nicht an den Browser zurückgegeben.</p>
                </div>
                <div>
                    <label htmlFor="ha-tracker" className="block text-xs font-medium text-gray-700 mb-1">GPS-Tracker</label>
                    <select id="ha-tracker" value={tracker} onChange={e => setTracker(e.target.value)} disabled={!!busy} className={field}>
                        {!trackerKnown && <option value={tracker}>{tracker || 'Bitte auswählen'}</option>}
                        {trackers.map(item => <option key={item.entity_id} value={item.entity_id}>{item.name} ({item.entity_id})</option>)}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">Der Verbindungstest lädt die verfügbaren GPS-Tracker und Zonen.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={save} disabled={!!busy || !url.trim()} className={action + ' bg-primary text-white'}>
                        {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Einstellungen speichern
                    </button>
                    <button type="button" onClick={checkConnection} disabled={!!busy || dirty} className={action + ' bg-indigo-50 text-indigo-600'}>
                        {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Verbindung testen / Zonen abrufen
                    </button>
                </div>
                {dirty && <p className="text-xs text-gray-500">Änderungen vor dem Verbindungstest speichern.</p>}
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {result && !result.connected && <p role="status" className="text-sm text-amber-800">{result.detail || 'Nicht verbunden.'}</p>}
            {result?.connected && (
                <div role="status" className="space-y-3 text-sm">
                    <p className="font-semibold text-green-700">Verbindung erfolgreich.</p>
                    <p className="break-all text-gray-600">{result.url}</p>
                    <p className="text-gray-700">{result.zones?.length || 0} Zonen · {trackers.length} GPS-Tracker</p>
                    <p className={trackerKnown ? 'text-green-700 text-xs' : 'text-amber-800 text-xs'}>{trackerKnown ? 'Ausgewählter Tracker gefunden.' : 'Ausgewählter Tracker nicht gefunden. Bitte auswählen.'}</p>
                    <div>
                        <h4 className="font-semibold text-gray-800">Zonen</h4>
                        <ul className="mt-1 grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
                            {result.zones?.map(zone => <li key={zone.entity_id}>{zone.name} <span className="text-gray-400">({zone.entity_id})</span></li>)}
                        </ul>
                    </div>
                </div>
            )}
        </section>
    )
}

'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Loader2, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { useUser } from '@/contexts/UserContext'
import ICloudSyncPanel from '@/components/ICloudSyncPanel'

type CalendarChoice = { name: string; url: string }
type ICloudState = { icloud_username?: string; icloud_calendar_url?: string; icloud_app_password_set?: boolean }

const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'
const action = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50'

export default function ICloudCalendarSettings() {
    const { currentUser, setCurrentUser } = useUser()
    const saved = (currentUser?.preferences?.technical || {}) as ICloudState
    const [username, setUsername] = useState(saved.icloud_username || '')
    const [password, setPassword] = useState('')
    const [calendarUrl, setCalendarUrl] = useState(saved.icloud_calendar_url || '')
    const [calendars, setCalendars] = useState<CalendarChoice[]>([])
    const [loading, setLoading] = useState<'save' | 'list' | 'test' | null>(null)
    const [tested, setTested] = useState(false)

    useEffect(() => {
        setUsername(saved.icloud_username || '')
        setCalendarUrl(saved.icloud_calendar_url || '')
    }, [saved.icloud_username, saved.icloud_calendar_url])

    const refreshProfile = async () => {
        const response = await api.get('/core/users/me/')
        setCurrentUser(response.data)
    }

    const save = async () => {
        setLoading('save')
        setTested(false)
        try {
            const technical = {
                icloud_username: username.trim(),
                icloud_calendar_url: calendarUrl,
                ...(password.trim() ? { icloud_app_password: password.trim() } : {}),
            }
            await api.patch('/core/users/me/', { preferences: { technical } })
            setPassword('')
            await refreshProfile()
            toast.success('iCloud-Einstellungen gespeichert.')
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'iCloud-Einstellungen konnten nicht gespeichert werden.')
        } finally {
            setLoading(null)
        }
    }

    const discover = async () => {
        setLoading('list')
        setTested(false)
        try {
            const response = await api.get<{ calendars: CalendarChoice[] }>('/core/calendar/icloud/calendars/')
            const choices = response.data.calendars || []
            setCalendars(choices)
            if (!choices.length) toast.error('Keine iCloud-Kalender gefunden.')
            else toast.success(choices.length + ' iCloud-Kalender gefunden.')
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'iCloud-Kalender konnten nicht geladen werden.')
        } finally {
            setLoading(null)
        }
    }

    const testReadWrite = async () => {
        setLoading('test')
        setTested(false)
        try {
            const response = await api.post<{ detail: string }>('/core/calendar/icloud/test/')
            setTested(true)
            toast.success(response.data.detail)
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'iCloud-Verbindungstest fehlgeschlagen.')
        } finally {
            setLoading(null)
        }
    }

    const working = loading !== null

    return (
        <section className="border-t border-gray-200 pt-6">
            <div className="mb-4 flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-gray-600" />
                <h3 className="font-semibold text-gray-900">Apple-Kalender (iCloud / CalDAV)</h3>
            </div>
            <div className="space-y-4 rounded-lg bg-gray-50 p-4">
                <p className="text-xs text-gray-600">
                    Verbindung zum iCloud-Kalender „MUSart Unterricht“. Die Einrichtung prüft
                    Lese- und Schreibzugriff, ohne bestehende Unterrichtstermine zu verändern.
                    Die Synchronisierung startest du direkt im Terminkalender links neben „Drucken“.
                </p>

                <div>
                    <label htmlFor="icloud-username" className="mb-1 block text-xs font-medium text-gray-700">
                        Apple Account (E-Mail-Adresse)
                    </label>
                    <input id="icloud-username" type="text" inputMode="email" autoComplete="username"
                        value={username} onChange={e => setUsername(e.target.value)}
                        placeholder="Deine Apple-Account-E-Mail-Adresse" className={field} />
                </div>

                <div>
                    <label htmlFor="icloud-password" className="mb-1 block text-xs font-medium text-gray-700">
                        App-spezifisches Passwort
                    </label>
                    <input id="icloud-password" type="password" autoComplete="new-password"
                        value={password} onChange={e => setPassword(e.target.value)}
                        placeholder={saved.icloud_app_password_set ? 'Gespeichert – leer lassen zum Beibehalten' : 'App-spezifisches Apple-Passwort'}
                        className={field} />
                    <p className="mt-1 text-xs text-gray-500">
                        Erstellen auf account.apple.com → Anmelden und Sicherheit → App-spezifische Passwörter.
                        Das gespeicherte Passwort wird nicht an den Browser zurückgegeben.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={save} disabled={working || !username.trim()}
                        className={action + ' bg-primary text-white hover:bg-primary-hover'}>
                        {loading === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Zugang speichern
                    </button>
                    <button type="button" onClick={discover} disabled={working || !saved.icloud_app_password_set}
                        className={action + ' border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}>
                        {loading === 'list' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        iCloud-Kalender laden
                    </button>
                </div>

                <div>
                    <label htmlFor="icloud-calendar" className="mb-1 block text-xs font-medium text-gray-700">
                        Zu synchronisierender Kalender
                    </label>
                    <select id="icloud-calendar" value={calendarUrl}
                        onChange={e => { setCalendarUrl(e.target.value); setTested(false) }}
                        className={field}>
                        <option value="">Kalender auswählen</option>
                        {calendarUrl && !calendars.some(item => item.url === calendarUrl) && (
                            <option value={calendarUrl}>Gespeicherte Kalenderauswahl</option>
                        )}
                        {calendars.map(item => (
                            <option key={item.url} value={item.url}>{item.name}</option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                        Bitte „MUSart Unterricht“ auswählen und anschließend die Auswahl speichern.
                        Andere iCloud-Kalender werden nicht verändert.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={save}
                        disabled={working || !calendarUrl || !username.trim()}
                        className={action + ' bg-primary text-white hover:bg-primary-hover'}>
                        <Save className="h-4 w-4" /> Kalenderauswahl speichern
                    </button>
                    <button type="button" onClick={testReadWrite}
                        disabled={working || !calendarUrl || calendarUrl !== saved.icloud_calendar_url || !saved.icloud_app_password_set}
                        className={action + ' border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}>
                        {loading === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        Lesen und Schreiben testen
                    </button>
                </div>

                {tested && (
                    <p className="flex items-center gap-2 text-sm font-medium text-green-700">
                        <CheckCircle2 className="h-4 w-4" /> iCloud-Kalender ist für lesenden und schreibenden Zugriff bereit.
                    </p>
                )}
                <ICloudSyncPanel enabled={Boolean(saved.icloud_app_password_set && saved.icloud_calendar_url)} />
            </div>
        </section>
    )
}

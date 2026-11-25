'use client'

import { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from 'react-hot-toast'

type Evidence = {
    zone_name?: string; tracker?: string; checked_at?: string; present?: boolean
    attendance_seconds?: number; arrival?: string | null; departure?: string | null
    total_seconds?: number; total_arrival?: string | null; total_departure?: string | null
    statistics_day?: string; error?: string
}
type Detail = { status: string; ha_attendance?: Evidence; ha_manual_override?: boolean; ha_finalized_at?: string | null; scheduled_start?: string }

const labels: Record<string, string> = { scheduled: 'Geplant', in_progress: 'Läuft', completed: 'Abgeschlossen', no_show: 'Nicht erschienen', cancelled: 'Abgesagt' }
const clock = (value?: string | null) => value ? new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '–'
const duration = (value?: number) => value == null ? '–' : Math.floor(value / 60) + ' Min. ' + (value % 60) + ' Sek.'

export default function LessonAttendancePanel({ lessonId }: { lessonId: string }) {
    const [detail, setDetail] = useState<Detail | null>(null)
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        let active = true
        setDetail(null)
        const refresh = async () => {
            try {
                const response = await api.get<Detail>('/lessons/' + lessonId + '/')
                if (active) setDetail(response.data)
            } catch { /* Keep the last known result. */ }
        }
        void refresh()
        const timer = window.setInterval(refresh, 120000)
        return () => { active = false; window.clearInterval(timer) }
    }, [lessonId])

    const check = async () => {
        setBusy(true)
        try {
            await api.post('/lessons/' + lessonId + '/check-attendance/')
            const response = await api.get<Detail>('/lessons/' + lessonId + '/')
            setDetail(response.data)
            toast.success('Anwesenheitsprüfung ausgeführt.')
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Anwesenheitsprüfung fehlgeschlagen.')
        } finally { setBusy(false) }
    }

    const data = detail?.ha_attendance || {}
    const canCheck = !!detail && !detail.ha_manual_override && !detail.ha_finalized_at &&
        ['scheduled', 'in_progress'].includes(detail.status) && !!detail.scheduled_start &&
        Date.now() >= new Date(detail.scheduled_start).getTime() - 1800000
    return (
        <section className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
            <h4 className="font-semibold text-gray-800">Home Assistant – Anwesenheit</h4>
            {detail && <p className="font-semibold">Aktueller Status: {labels[detail.status] || detail.status}</p>}
            {data.checked_at ? <>
                <p>{data.zone_name || 'Schülerzone'} · {data.present ? 'Tracker in Zone' : 'Tracker nicht in Zone'}</p>
                <p>Anwesenheit: {duration(data.attendance_seconds)} · Ankunft: {clock(data.arrival)} · Abfahrt: {clock(data.departure)}</p>
                <p className="text-xs text-gray-500">Letzte Prüfung: {new Date(data.checked_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>
            </> : <p className="text-gray-500">Noch keine Anwesenheitsdaten erfasst.</p>}
            {data.error && <p className="text-amber-800">{data.error}</p>}
            {data.statistics_day && <p>Gesamtaufenthalt: {duration(data.total_seconds)} · {clock(data.total_arrival)}–{clock(data.total_departure)}</p>}
            {detail?.ha_manual_override && <p className="text-gray-500">Status manuell festgelegt.</p>}
            {canCheck && <button type="button" disabled={busy} onClick={check} className="rounded-lg bg-indigo-50 px-3 py-2 font-semibold text-indigo-600 disabled:opacity-50">{busy ? 'Prüfung läuft …' : 'Anwesenheit prüfen'}</button>}
        </section>
    )
}

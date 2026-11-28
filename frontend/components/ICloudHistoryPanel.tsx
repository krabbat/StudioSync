'use client'

import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'

type StudentChoice = { id: string; name: string; contract_start_date: string | null }
type Result = { title: string; count: number; first_date: string | null; dates: { date: string; count: number }[] }
const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm'

export default function ICloudHistoryPanel({ students, studentsLoading, studentsError }: {
    students: StudentChoice[]; studentsLoading: boolean; studentsError: boolean
}) {
    const [title, setTitle] = useState('')
    const [result, setResult] = useState<Result | null>(null)
    const [studentId, setStudentId] = useState('')
    const [queryError, setQueryError] = useState('')
    const [busy, setBusy] = useState<'query' | 'save' | null>(null)
    const student = students.find(s => s.id === studentId)
    const firstDate = result?.first_date || result?.dates[0]?.date || null
    const total = result?.count || 0
    const [saved, setSaved] = useState<{ studentId: string; start: string } | null>(null)
    const currentStart = saved?.studentId === studentId ? saved.start : student?.contract_start_date
    const germanDate = (date: string) => date.split('-').reverse().join('.')
    const query = async () => {
        setResult(null); setQueryError(''); setBusy('query')
        try {
            const { data } = await api.post<Result>('/core/calendar/icloud/history/', { title: title.trim() })
            setResult(data)
        } catch (e: any) {
            const status = e?.response?.status
            const detail = e?.response?.data?.detail
            const message = typeof detail === 'string' ? detail : status === 404
                ? 'Die Kalenderabfrage ist im laufenden Backend nicht verfügbar (HTTP 404).'
                : status ? 'Kalenderabfrage fehlgeschlagen (HTTP ' + status + ').'
                    : 'Kalenderabfrage fehlgeschlagen: Keine Antwort vom Server.'
            setQueryError(message)
            toast.error(message)
        } finally { setBusy(null) }
    }
    const apply = async () => {
        if (!student?.contract_start_date || !result || !total || !firstDate) return
        if (!window.confirm(`Bei ${student.name} den Vertragsbeginn auf ${germanDate(firstDate)} und die Gesamtstundenzahl auf ${total} setzen? Der Vertragsjahresbeginn bleibt unverändert.`)) return
        setBusy('save')
        try {
            await api.post('/students/' + student.id + '/lesson-history/', { shared_lessons_total: total, contract_start_date: firstDate })
            setSaved({ studentId: student.id, start: firstDate })
            toast.success('Vertragsbeginn und Gesamtstundenzahl übernommen.')
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Übernahme fehlgeschlagen.')
        } finally { setBusy(null) }
    }
    return <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h4 className="text-sm font-semibold">Bisherige Unterrichtsstunden aus Apple-Kalender</h4>
        <p className="text-xs text-gray-500">Liest vergangene, nicht abgesagte Termine mit genau diesem Namen. Serien und verschobene Einzeltermine werden berücksichtigt. Der Apple-Kalender wird nicht verändert.</p>
        <label className="block text-sm font-medium">Termin-Name
            <input className={field + ' mt-1'} value={title} maxLength={500} disabled={busy !== null} onChange={e => {setTitle(e.target.value);setResult(null);setQueryError('')}} />
        </label>
        <button type="button" disabled={!title.trim() || busy !== null} onClick={() => void query()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'query' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Abfragen
        </button>
        <label className="block text-sm font-medium">Vertragsbeginn und Gesamtstundenzahl übernehmen für
            <select className={field + ' mt-1'} value={studentId} disabled={busy !== null || studentsLoading || studentsError} onChange={e => setStudentId(e.target.value)}>
                <option value="">{studentsLoading ? 'Schüler werden geladen…' : 'Schüler auswählen'}</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
        </label>
        {studentsError && <p className="text-sm text-red-700" role="alert">Schülerliste konnte nicht geladen werden. Bitte Übersicht aktualisieren.</p>}
        {!studentsError && !studentsLoading && !students.length && <p className="text-xs text-gray-500">Keine Schüler vorhanden.</p>}
        {queryError && <p className="text-sm text-red-700" role="alert">{queryError}</p>}
        {result && <div className="space-y-3 border-t pt-3">
            <p className="text-sm"><strong>{result.count}</strong> vergangene Termine für „{result.title}“ gefunden.</p>
            <p className="text-sm">Erster Unterrichtstermin: <strong>{firstDate ? germanDate(firstDate) : 'Kein Termin gefunden'}</strong></p>
            {result.dates.length > 0 && <details className="text-xs text-gray-600"><summary className="cursor-pointer">Gefundene Termine anzeigen</summary>
                <div className="max-h-48 overflow-y-auto mt-2">{result.dates.map(d => <div key={d.date}>{d.date.split('-').reverse().join('.')}{d.count > 1 ? ' (' + d.count + ' Termine)' : ''}</div>)}</div>
            </details>}
            {student && (currentStart ? <p className="text-sm text-gray-600">Bisheriger Vertragsbeginn: {germanDate(currentStart)}. {firstDate && <>Neuer Vertragsbeginn: <strong>{germanDate(firstDate)}</strong>, Gesamtstundenzahl: <strong>{total}</strong>.</>}</p> : <p className="text-sm text-amber-700">Bitte zuerst einen Vertrag mit Unterrichtskonditionen hinterlegen.</p>)}
            {!total && <p className="text-xs text-gray-500">Keine passenden Termine. Die bisherigen Daten werden nicht überschrieben.</p>}
        </div>}
        <button type="button" disabled={!student?.contract_start_date || !result || !total || !firstDate || busy !== null || studentsLoading || studentsError} onClick={() => void apply()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Vertragsbeginn und Gesamtstundenzahl übernehmen</button>
        <p className="text-xs text-gray-500">Übernimmt den ersten gefundenen Termin als Vertragsbeginn und alle gefundenen vergangenen Termine als Gesamtstundenzahl. Der Vertragsjahresbeginn bleibt unverändert. Bei Gruppentiteln bitte die tatsächliche Teilnahme des gewählten Schülers prüfen.</p>
    </div>
}

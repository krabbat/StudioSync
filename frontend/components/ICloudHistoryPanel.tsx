'use client'

import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'

type StudentChoice = { id: string; name: string; contract_start_date: string | null }
type Result = { title: string; count: number; dates: { date: string; count: number }[] }
const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm'

export default function ICloudHistoryPanel({ students }: { students: StudentChoice[] }) {
    const [title, setTitle] = useState('')
    const [result, setResult] = useState<Result | null>(null)
    const [studentId, setStudentId] = useState('')
    const [busy, setBusy] = useState<'query' | 'save' | null>(null)
    const student = students.find(s => s.id === studentId)
    const dates = result && student?.contract_start_date ? result.dates.filter(d => d.date >= student.contract_start_date!) : []
    const total = dates.reduce((sum, row) => sum + row.count, 0)
    const query = async () => {
        setResult(null); setBusy('query')
        try {
            const { data } = await api.post<Result>('/core/calendar/icloud/history/', { title: title.trim() })
            setResult(data)
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Kalenderabfrage fehlgeschlagen.')
        } finally { setBusy(null) }
    }
    const apply = async () => {
        if (!student?.contract_start_date || !result || !total) return
        if (!window.confirm(`Gesamtstundenzahl von ${student.name} auf ${total} setzen? Der bisherige Gesamtwert wird ersetzt, das Jahreskontingent bleibt unverändert.`)) return
        setBusy('save')
        try {
            await api.post('/students/' + student.id + '/lesson-history/', { shared_lessons_total: total })
            toast.success('Gesamtstundenzahl übernommen.')
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Übernahme fehlgeschlagen.')
        } finally { setBusy(null) }
    }
    return <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h4 className="text-sm font-semibold">Bisherige Unterrichtsstunden aus Apple-Kalender</h4>
        <p className="text-xs text-gray-500">Liest vergangene, nicht abgesagte Termine mit genau diesem Namen. Serien und verschobene Einzeltermine werden berücksichtigt. Der Apple-Kalender wird nicht verändert.</p>
        <label className="block text-sm font-medium">Termin-Name
            <input className={field + ' mt-1'} value={title} maxLength={500} disabled={busy !== null} onChange={e => {setTitle(e.target.value);setResult(null)}} />
        </label>
        <button type="button" disabled={!title.trim() || busy !== null} onClick={() => void query()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'query' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Abfragen
        </button>
        {result && <div className="space-y-3 border-t pt-3">
            <p className="text-sm"><strong>{result.count}</strong> vergangene Termine für „{result.title}“ gefunden.</p>
            {result.dates.length > 0 && <details className="text-xs text-gray-600"><summary className="cursor-pointer">Gefundene Termine anzeigen</summary>
                <div className="max-h-48 overflow-y-auto mt-2">{result.dates.map(d => <div key={d.date}>{d.date.split('-').reverse().join('.')}{d.count > 1 ? ' (' + d.count + ' Termine)' : ''}</div>)}</div>
            </details>}
            <label className="block text-sm font-medium">Schüler auswählen
                <select className={field + ' mt-1'} value={studentId} disabled={busy !== null} onChange={e => setStudentId(e.target.value)}>
                    <option value="">Schüler auswählen</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
            </label>
            {student && (student.contract_start_date ? <p className="text-sm">Seit Vertragsbeginn ({student.contract_start_date.split('-').reverse().join('.')}): <strong>{total}</strong> Unterrichtsstunden.</p> : <p className="text-sm text-amber-700">Bitte zuerst einen Vertrag hinterlegen.</p>)}
            <button type="button" disabled={!student?.contract_start_date || !total || busy !== null} onClick={() => void apply()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Gesamtstundenzahl übernehmen</button>
            <p className="text-xs text-gray-500">Ersetzt den bisherigen Gesamtwert, addiert ihn nicht. Bei Gruppentiteln bitte die tatsächliche Teilnahme des gewählten Schülers prüfen.</p>
        </div>}
    </div>
}

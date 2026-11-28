'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'

type StudentChoice = { id: string; name: string; contract_start_date: string | null }
type CalendarChoice = { name: string; url: string }
type SearchMode = 'exact' | 'partial'
type DateCount = { date: string; count: number }
type Occurrence = { date: string; start: string; end: string }
type TitleMatch = { title: string; count: number; first_date: string; dates: DateCount[]; occurrences?: Occurrence[] }
type Result = { title: string; mode: SearchMode; from_date: string | null; calendar_name: string; count: number; first_date: string | null; dates: DateCount[]; matches: TitleMatch[]; duplicate_count?: number }
const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm'

export default function ICloudHistoryPanel({ students, studentsLoading, studentsError, syncCalendarUrl }: {
    students: StudentChoice[]; studentsLoading: boolean; studentsError: boolean; syncCalendarUrl?: string
}) {
    const [title, setTitle] = useState('')
    const [mode, setMode] = useState<SearchMode>('exact')
    const [fromDate, setFromDate] = useState('')
    const [selectedTitles, setSelectedTitles] = useState<string[]>([])
    const [calendars, setCalendars] = useState<CalendarChoice[]>([])
    const [calendarUrl, setCalendarUrl] = useState('')
    const [calendarsLoading, setCalendarsLoading] = useState(false)
    const [calendarError, setCalendarError] = useState('')
    const loadCalendars = useCallback(async () => {
        setCalendarsLoading(true); setCalendarError('')
        try {
            const { data } = await api.get<{ calendars: CalendarChoice[] }>('/core/calendar/icloud/calendars/')
            const sync = (syncCalendarUrl || '').replace(/\/$/, '')
            const choices = (data.calendars || []).filter(c => c.url.replace(/\/$/, '') !== sync)
            setCalendars(choices)
            setCalendarUrl(previous => {
                if (choices.some(c => c.url === previous)) return previous
                const standard = choices.filter(c => ['standard', 'standardkalender'].includes(c.name.trim().toLowerCase()))
                return standard.length === 1 ? standard[0].url : ''
            })
        } catch (e: any) {
            setCalendarError(e?.response?.data?.detail || 'Apple-Kalender konnten nicht geladen werden.')
            setCalendars([]); setCalendarUrl('')
        } finally { setCalendarsLoading(false) }
    }, [syncCalendarUrl])
    useEffect(() => { void loadCalendars() }, [loadCalendars])
    const [result, setResult] = useState<Result | null>(null)
    const [studentId, setStudentId] = useState('')
    const [queryError, setQueryError] = useState('')
    const [busy, setBusy] = useState<'query' | 'save' | null>(null)
    const student = students.find(s => s.id === studentId)
    const selectedMatches = (result?.matches || []).filter(match => selectedTitles.includes(match.title))
    const countsByDay = new Map<string, number>()
    for (const match of selectedMatches) {
        for (const day of match.dates) countsByDay.set(day.date, (countsByDay.get(day.date) || 0) + day.count)
    }
    const selectedDates = Array.from(countsByDay, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date))
    const occurrencesByDay = new Map<string, { title: string; start: string; end: string }[]>()
    for (const match of selectedMatches) {
        for (const occurrence of match.occurrences || []) {
            const rows = occurrencesByDay.get(occurrence.date) || []
            rows.push({ title: match.title, start: occurrence.start, end: occurrence.end })
            occurrencesByDay.set(occurrence.date, rows)
        }
    }
    const firstDate = selectedDates[0]?.date || null
    const total = selectedDates.reduce((sum, day) => sum + day.count, 0)
    const [saved, setSaved] = useState<{ studentId: string; start: string } | null>(null)
    const currentStart = saved?.studentId === studentId ? saved.start : student?.contract_start_date
    const germanDate = (date: string) => date.split('-').reverse().join('.')
    const germanTime = (value: string) => new Date(value).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
    const query = async () => {
        if (!calendarUrl) return
        setResult(null); setSelectedTitles([]); setQueryError(''); setBusy('query')
        try {
            const { data } = await api.post<Result>('/core/calendar/icloud/history/', { title: title.trim(), calendar_url: calendarUrl, mode, from_date: fromDate || null })
            if (!Array.isArray(data.matches) || (fromDate && data.from_date !== fromDate)) throw new Error('Historische Trefferliste fehlt')
            setResult(data)
            // Partial-name results may include other pupils; require explicit selection.
            setSelectedTitles(mode === 'exact' ? data.matches.map(match => match.title) : [])
        } catch (e: any) {
            const status = e?.response?.status
            const detail = e?.response?.data?.detail
            const message = e?.message === 'Historische Trefferliste fehlt' ? 'Bitte das Backend auf die aktuelle Version aktualisieren.' : typeof detail === 'string' ? detail : status === 404
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
        <p className="text-xs text-gray-500">Liest vergangene, nicht abgesagte Termine nach exaktem Namen oder Teilnamen. Serien und verschobene Einzeltermine werden berücksichtigt. Der Apple-Kalender wird nicht verändert.</p>
        <div className="space-y-1">
            <label className="block text-sm font-medium">Ursprünglicher Apple-Kalender
                <select className={field + ' mt-1'} value={calendarUrl} disabled={busy !== null || calendarsLoading}
                    onChange={e => {setCalendarUrl(e.target.value);setResult(null);setQueryError('')}}>
                    <option value="">{calendarsLoading ? 'Kalender werden geladen…' : 'Kalender auswählen'}</option>
                    {calendars.map(c => <option key={c.url} value={c.url}>{c.name}</option>)}
                </select>
            </label>
            <button type="button" className="text-xs text-indigo-700 underline" disabled={calendarsLoading || busy !== null}
                onClick={() => {setResult(null);void loadCalendars()}}>Kalenderliste aktualisieren</button>
            {calendarError && <p className="text-sm text-red-700" role="alert">{calendarError}</p>}
            <p className="text-xs text-gray-500">Nur lesender Zugriff. Der Synchronisationskalender MUSart Unterricht bleibt unverändert.</p>
        </div>
        <label className="block text-sm font-medium">Termin-Name
            <input className={field + ' mt-1'} value={title} maxLength={500} disabled={busy !== null} onChange={e => {setTitle(e.target.value);setResult(null);setQueryError('')}} />
        </label>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <legend className="mb-2 font-medium">Suchmodus</legend>
            {([{ value: 'exact', label: 'Exakter Terminname' }, { value: 'partial', label: 'Teilname' }] as const).map(option =>
                <label key={option.value} className="flex min-h-9 cursor-pointer items-center gap-2">
                    <input type="radio" name="icloud-history-mode" value={option.value} checked={mode === option.value}
                        disabled={busy !== null} onChange={() => {setMode(option.value);setResult(null);setSelectedTitles([]);setQueryError('')}} />
                    {option.label}
                </label>
            )}
        </fieldset>
        <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="icloud-history-from-date">Ab Datum (optional)</label>
            <div className="flex items-center gap-2">
                <input id="icloud-history-from-date" type="date" className={field + ' max-w-xs min-w-0'} value={fromDate}
                    disabled={busy !== null} onChange={e => {setFromDate(e.target.value);setResult(null);setSelectedTitles([]);setQueryError('')}} />
                {fromDate && <button type="button" className="shrink-0 text-xs text-indigo-700 underline" disabled={busy !== null}
                    onClick={() => {setFromDate('');setResult(null);setSelectedTitles([]);setQueryError('')}}>Datum zurücksetzen</button>}
            </div>
            <p className="text-xs text-gray-500">Leer lassen für die gesamte Historie. Mit Datum werden nur Termine ab diesem Tag einschließlich berücksichtigt.</p>
        </div>
        <button type="button" disabled={!title.trim() || !calendarUrl || calendarsLoading || busy !== null} onClick={() => void query()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'query' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Abfragen
        </button>
        {queryError && <p className="text-sm text-red-700" role="alert">{queryError}</p>}
        {result && <div className="space-y-3 border-t pt-3">
            <p className="text-sm"><strong>{result.count}</strong> vergangene Termine für „{result.title}“ gefunden{result.calendar_name ? ' in „' + result.calendar_name + '“' : ''}.</p>
            {!!result.duplicate_count && <p className="text-xs text-gray-600">{result.duplicate_count} doppelte Einträge mit identischem Namen, Beginn und Ende wurden nicht mitgezählt.</p>}
            {result.from_date && <p className="text-xs text-amber-700">Auswertung ab {germanDate(result.from_date)}. Bei der Übernahme wird auch der Vertragsbeginn auf den ersten ausgewählten Termin in diesem Zeitraum gesetzt.</p>}
            {result.matches.length > 0 && <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-semibold">Terminnamen auswählen</legend>
                {result.mode === 'partial' && <p className="text-xs text-gray-500">Nur die zum Schüler gehörenden Terminnamen markieren.</p>}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {result.matches.map(match => <label key={match.title} className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                        <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={selectedTitles.includes(match.title)}
                            disabled={busy !== null} onChange={e => {
                                const checked = e.target.checked
                                setSelectedTitles(previous => checked ? [...previous, match.title] : previous.filter(title => title !== match.title))
                            }} />
                        <span className="min-w-0 flex-1 break-words">{match.title}<span className="block text-xs text-gray-500">Seit {germanDate(match.first_date)}</span></span>
                        <span className="shrink-0 font-semibold tabular-nums">{match.count}</span>
                    </label>)}
                </div>
            </fieldset>}
            <div className="rounded-lg bg-gray-50 p-3 space-y-1 text-sm">
                <p>Ausgewählte Unterrichtsstunden: <strong>{total}</strong></p>
                <p>Erster ausgewählter Unterrichtstermin: <strong>{firstDate ? germanDate(firstDate) : '–'}</strong></p>
            </div>
            {selectedDates.length > 0 && <details className="text-xs text-gray-600"><summary className="cursor-pointer">Ausgewählte Termine anzeigen</summary>
                <div className="max-h-64 overflow-y-auto mt-2 divide-y divide-gray-100">{selectedDates.map(d => <div key={d.date} className="py-1">
                    <div className={d.count > 1 ? 'font-semibold text-amber-700' : ''}>{germanDate(d.date)}{d.count > 1 ? ' (' + d.count + ' Termine)' : ''}</div>
                    {(occurrencesByDay.get(d.date) || []).sort((a,b)=>a.start.localeCompare(b.start)).map((o,i) =>
                        <div key={i} className="pl-3">{germanTime(o.start)}–{germanTime(o.end)} Uhr{o.title ? ' · ' + o.title : ''}</div>)}
                </div>)}</div>
            </details>}
            {!total && <p className="text-xs text-gray-500">{result.count ? 'Bitte mindestens einen passenden Terminnamen auswählen.' : 'Keine passenden Termine.'} Die bisherigen Daten werden nicht überschrieben.</p>}
        </div>}
        <div className="space-y-3 border-t pt-3">
            <label className="block text-sm font-medium">Vertragsbeginn und Gesamtstundenzahl übernehmen für
                <select className={field + ' mt-1'} value={studentId} disabled={busy !== null || studentsLoading || studentsError} onChange={e => setStudentId(e.target.value)}>
                    <option value="">{studentsLoading ? 'Schüler werden geladen…' : 'Schüler auswählen'}</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
            </label>
            {studentsError && <p className="text-sm text-red-700" role="alert">Schülerliste konnte nicht geladen werden. Bitte Übersicht aktualisieren.</p>}
            {!studentsError && !studentsLoading && !students.length && <p className="text-xs text-gray-500">Keine Schüler vorhanden.</p>}
            {result && (student && (currentStart ? <p className="text-sm text-gray-600">Bisheriger Vertragsbeginn: {germanDate(currentStart)}. {firstDate && <>Neuer Vertragsbeginn: <strong>{germanDate(firstDate)}</strong>, Gesamtstundenzahl: <strong>{total}</strong>.</>}</p> : <p className="text-sm text-amber-700">Bitte zuerst einen Vertrag mit Unterrichtskonditionen hinterlegen.</p>)) }
        </div>
        <button type="button" disabled={!student?.contract_start_date || !result || !total || !firstDate || busy !== null || studentsLoading || studentsError} onClick={() => void apply()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Vertragsbeginn und Gesamtstundenzahl übernehmen</button>
        <p className="text-xs text-gray-500">Übernimmt den ersten ausgewählten Termin als Vertragsbeginn und die Summe der ausgewählten vergangenen Termine als Gesamtstundenzahl. Der Vertragsjahresbeginn bleibt unverändert. Bei Gruppentiteln bitte die tatsächliche Teilnahme des gewählten Schülers prüfen.</p>
    </div>
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'

type LinkedSeries = {
    id: string; uid: string; title: string; student: string | null;
    student_name: string; error: string; occurrences: number
}
type StudentChoice = { id: string; name: string }
type SyncPayload = {
    imported: number; exported: number; deleted?: number; unassigned: number; conflicts: number;
    students: StudentChoice[]; series: LinkedSeries[]
}

export default function ICloudSyncPanel({ enabled }: { enabled: boolean }) {
    const [rows, setRows] = useState<LinkedSeries[]>([])
    const [students, setStudents] = useState<StudentChoice[]>([])
    const [assigning, setAssigning] = useState<string | null>(null)
    const [resolving, setResolving] = useState<string | null>(null)
    const [choices, setChoices] = useState<Record<string, string>>({})
    const [last, setLast] = useState<SyncPayload | null>(null)

    const list = useCallback(async () => {
        try {
            const { data } = await api.get<{ series: LinkedSeries[]; students: StudentChoice[] }>(
                '/core/calendar/icloud/series/'
            )
            setRows(data.series || [])
            setStudents(data.students || [])
        } catch {
            // Settings are optional until an Apple calendar has been configured.
        }
    }, [])

    useEffect(() => {
        if (enabled) void list()
    }, [enabled, list])

    const assign = async (seriesId: string) => {
        const student = choices[seriesId]
        if (!student) return toast.error('Bitte einen Schüler auswählen.')
        setAssigning(seriesId)
        try {
            const { data } = await api.post<SyncPayload>(
                '/core/calendar/icloud/series/' + seriesId + '/assign/',
                { student }
            )
            setRows(data.series || [])
            setStudents(data.students || [])
            setLast(data)
            toast.success('Schüler zugeordnet und Termine synchronisiert.')
        } catch (error: any) {
            toast.error(error?.response?.data?.detail || 'Zuordnung fehlgeschlagen.')
        } finally {
            setAssigning(null)
        }
    }

    const resolve = async (seriesId: string, prefer: 'apple' | 'studiosync') => {
        setResolving(seriesId)
        try {
            const { data } = await api.post<SyncPayload>(
                '/core/calendar/icloud/series/' + seriesId + '/resolve/', { prefer }
            )
            setRows(data.series || [])
            setStudents(data.students || [])
            setLast(data)
            toast.success(prefer === 'apple' ? 'Apple-Termin übernommen.' : 'StudioSync-Termin nach iCloud übertragen.')
        } catch (error: any) {
            toast.error(error?.response?.data?.detail || 'Kalenderkonflikt konnte nicht gelöst werden.')
        } finally {
            setResolving(null)
        }
    }

    const pending = rows.filter(item => !item.student)
    const problems = rows.filter(item => item.student && item.error)

    return (
        <div className="mt-5 space-y-4 border-t border-gray-200 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-gray-900">Bidirektionaler Unterrichtskalender</h4>
                    <p className="mt-1 text-xs text-gray-500">
                        Hier werden Schülerzuordnungen und Konflikte verwaltet. Den manuellen Abgleich
                        startest du im Terminkalender direkt neben „Drucken“.
                    </p>
                </div>
            </div>

            {last && (
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <p className="flex items-center gap-2 font-semibold text-gray-800">
                        <CheckCircle2 className="h-4 w-4 text-green-600" /> Letzter Abgleich
                    </p>
                    <p className="mt-1 text-gray-600">
                        {last.imported} importiert · {last.exported} exportiert · {last.deleted ?? 0} in iCloud gelöscht ·
                        {' '}{last.unassigned} nicht zugeordnet · {last.conflicts} Konflikte
                    </p>
                </div>
            )}

            {pending.length > 0 && (
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-amber-800">
                        Schülerzuordnung erforderlich ({pending.length})
                    </p>
                    {pending.map(item => (
                        <div key={item.id} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-semibold text-gray-900">{item.title || 'Ohne Titel'}</p>
                            <p className="text-xs text-gray-600">{item.uid}</p>
                            <div className="flex flex-wrap gap-2">
                                <select value={choices[item.id] || ''}
                                    onChange={e => setChoices(previous => ({ ...previous, [item.id]: e.target.value }))}
                                    aria-label={'Schüler für ' + item.title}
                                    className="min-w-48 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                                    <option value="">Schüler auswählen</option>
                                    {students.map(student => (
                                        <option key={student.id} value={student.id}>{student.name}</option>
                                    ))}
                                </select>
                                <button type="button" onClick={() => void assign(item.id)}
                                    disabled={assigning !== null || !choices[item.id]}
                                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                                    {assigning === item.id && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Zuordnen
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {problems.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800">
                    <p className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" /> Kalenderkonflikte
                    </p>
                    {problems.map(item => (
                        <div key={item.id} className="mt-3 space-y-2">
                            <p className="whitespace-pre-line"><strong>{item.title}:</strong> {item.error}</p>
                            {item.error.includes('Konflikt:') && (
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" disabled={resolving !== null || assigning !== null}
                                        onClick={() => void resolve(item.id, 'apple')}
                                        className="rounded-md border border-orange-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-50">
                                        Apple übernehmen
                                    </button>
                                    <button type="button" disabled={resolving !== null || assigning !== null}
                                        onClick={() => void resolve(item.id, 'studiosync')}
                                        className="rounded-md border border-orange-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-50">
                                        StudioSync übernehmen
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {rows.length > 0 && (
                <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span>{rows.length} verknüpfte Kalender-Serien / Termine</span>
                    <button type="button" onClick={() => void list()}
                        className="inline-flex items-center gap-1 text-indigo-700 hover:text-indigo-900">
                        <RefreshCw className="h-3.5 w-3.5" /> Übersicht aktualisieren
                    </button>
                </div>
            )}
        </div>
    )
}

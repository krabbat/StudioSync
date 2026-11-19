'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { fromGermanDate, toGermanDate } from '@/components/StudentPersonalFields'

type Classification = 'student_cancelled' | 'teacher_cancelled' | 'makeup_credited' | 'makeup_not_credited'
type LessonEvent = {
    id: string
    date: string
    status: 'completed' | 'cancelled' | 'no_show'
    lesson_type: string
    kind: Classification | ''
    delivered: boolean
    credited: number
    reason: string
}
type Adjustment = {
    id: string
    date: string
    delivered_delta: number
    credited_delta: number
    reason: string
}
type Account = {
    available: boolean
    reason?: string
    year_start: string
    year_end: string
    available_years: string[]
    quota: number
    quota_reason: string
    lesson_minutes: number
    summary: {
        delivered: number
        credited: number
        remaining: number
        student_cancelled: number
        teacher_cancelled: number
        makeups: number
        unclassified: number
    }
    entries: LessonEvent[]
    adjustments: Adjustment[]
}

function ClassificationEditor({
    entry, disabled, onSave
}: {
    entry: LessonEvent
    disabled: boolean
    onSave: (entry: LessonEvent, kind: Classification, reason: string) => Promise<void>
}) {
    const t = useTranslations('LessonAccount')
    const [kind, setKind] = useState<Classification | ''>(entry.kind)
    const [reason, setReason] = useState(entry.reason || '')
    const isMakeup = entry.lesson_type === 'makeup' && entry.status === 'completed'
    const options: Classification[] = isMakeup
        ? ['makeup_credited', 'makeup_not_credited']
        : ['student_cancelled', 'teacher_cancelled']

    return (
        <form onSubmit={event => {
            event.preventDefault()
            if (kind && reason.trim()) onSave(entry, kind, reason)
        }} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 mt-2">
            <select className="min-w-0 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={kind} disabled={disabled} required
                aria-label={t('classification')}
                onChange={event => setKind(event.target.value as Classification)}>
                <option value="">{t('chooseClassification')}</option>
                {options.map(option => <option key={option} value={option}>{t(option)}</option>)}
            </select>
            <input type="text" required maxLength={1000} value={reason}
                onChange={event => setReason(event.target.value)}
                disabled={disabled}
                placeholder={t('classificationReason')}
                aria-label={t('classificationReason')}
                className="min-w-0 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <button type="submit" disabled={disabled || !kind || !reason.trim()}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {t('apply')}
            </button>
        </form>
    )
}

export default function StudentLessonAccountCard({ studentId, readOnly }: {
    studentId: string
    readOnly: boolean
}) {
    const t = useTranslations('LessonAccount')
    const [year, setYear] = useState('')
    const [account, setAccount] = useState<Account | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [busy, setBusy] = useState(false)
    const [feedback, setFeedback] = useState<string | null>(null)
    const [quota, setQuota] = useState('46')
    const [quotaReason, setQuotaReason] = useState('')
    const [date, setDate] = useState('')
    const [deliveredDelta, setDeliveredDelta] = useState('0')
    const [creditedDelta, setCreditedDelta] = useState('0')
    const [adjustmentReason, setAdjustmentReason] = useState('')

    const url = useCallback(() => {
        const base = '/students/' + encodeURIComponent(studentId) + '/lesson-account/'
        return base + (year ? '?year_start=' + encodeURIComponent(year) : '')
    }, [studentId, year])

    const refresh = useCallback(async () => {
        const response = await api.get(url())
        const loaded = response.data as Account
        setAccount(loaded)
        if (loaded.available) {
            setQuota(String(loaded.quota))
            setQuotaReason(loaded.quota_reason || '')
        }
    }, [url])

    useEffect(() => {
        if (!studentId) return
        let active = true
        setLoading(true)
        setError(false)
        setFeedback(null)
        api.get(url()).then(response => {
            if (!active) return
            const loaded = response.data as Account
            setAccount(loaded)
            if (loaded.available) {
                setQuota(String(loaded.quota))
                setQuotaReason(loaded.quota_reason || '')
            }
        }).catch(() => { if (active) setError(true) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [studentId, url])

    async function submit(action: Record<string, unknown>) {
        if (readOnly || !account?.available) return
        setBusy(true)
        setFeedback(null)
        try {
            await api.post(url(), { ...action, year_start: account.year_start })
            await refresh()
            setFeedback(t('saved'))
            toast.success(t('saved'))
        } catch (error: any) {
            const data = error?.response?.data
            const description = data && typeof data === 'object'
                ? Object.values(data).flat().filter(x => typeof x === 'string').join(' ')
                : ''
            const message = description || t('saveFailed')
            setFeedback(message)
            toast.error(message)
        } finally {
            setBusy(false)
        }
    }

    function saveQuota(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const number = Number(quota)
        if (!Number.isInteger(number) || number < 1 || number > 999 || !quotaReason.trim()) {
            toast.error(t('invalidQuota'))
            return
        }
        submit({ action: 'set_quota', quota: number, reason: quotaReason.trim() })
    }

    function addAdjustment(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const iso = fromGermanDate(date)
        const delivered = Number(deliveredDelta)
        const credited = Number(creditedDelta)
        if (!iso || !Number.isInteger(delivered) || !Number.isInteger(credited) ||
            (delivered === 0 && credited === 0) || !adjustmentReason.trim()) {
            toast.error(t('invalidAdjustment'))
            return
        }
        submit({
            action: 'add_adjustment', date: iso,
            delivered_delta: delivered, credited_delta: credited,
            reason: adjustmentReason.trim()
        }).then(() => {
            // The server remains the authority for adjustments.
        })
    }

    const inputClass = 'w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2.5 text-foreground outline-none focus:border-primary'
    const stats = account?.available ? [
        { key: 'quota' as const, value: account.quota },
        { key: 'delivered' as const, value: account.summary.delivered },
        { key: 'credited' as const, value: account.summary.credited },
        { key: 'remaining' as const, value: account.summary.remaining },
        { key: 'studentCancelled' as const, value: account.summary.student_cancelled },
        { key: 'teacherCancelled' as const, value: account.summary.teacher_cancelled },
        { key: 'makeups' as const, value: account.summary.makeups },
    ] : []

    return (
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 text-card-foreground space-y-6">
            <header className="space-y-1">
                <h2 className="text-xl font-bold">{t('heading')}</h2>
                <p className="text-sm text-muted-foreground">{t('description')}</p>
            </header>
            {loading ? <p className="text-muted-foreground">{t('loading')}</p> :
                error ? <p role="alert" className="text-red-600">{t('loadFailed')}</p> :
                !account?.available ? <p className="text-muted-foreground">{t('noContract')}</p> : (
                    <>
                        <div className="flex flex-wrap gap-3 items-end justify-between">
                            <p className="text-sm font-semibold">{t('yearPeriod', {
                                start: toGermanDate(account.year_start), end: toGermanDate(account.year_end)
                            })}</p>
                            {account.available_years.length > 1 && (
                                <label className="text-sm font-medium space-y-1">
                                    <span className="block text-muted-foreground">{t('selectYear')}</span>
                                    <select className={inputClass} value={account.year_start}
                                        onChange={event => setYear(event.target.value)}>
                                        {account.available_years.map(yr =>
                                            <option key={yr} value={yr}>{toGermanDate(yr)}</option>)}
                                    </select>
                                </label>
                            )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {stats.map(item => (
                                <div key={item.key} className="rounded-xl border border-border bg-background p-3">
                                    <p className="text-xs text-muted-foreground">{t(item.key)}</p>
                                    <p className="text-2xl font-bold mt-1">{item.value}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">{t('unitHint', { minutes: account.lesson_minutes })}</p>
                        {account.summary.unclassified > 0 && (
                            <p className="rounded-xl border border-border bg-muted/50 p-3 text-sm"
                                role="status">
                                {t('unknownCount', { count: account.summary.unclassified })}
                            </p>
                        )}
                        {!readOnly && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <form onSubmit={saveQuota} className="rounded-xl border border-border p-4 space-y-3">
                                    <h3 className="font-semibold">{t('editQuota')}</h3>
                                    <label className="block text-sm space-y-1">
                                        {t('quota')}
                                        <input className={inputClass} type="number" min={1} max={999}
                                            value={quota} onChange={event => setQuota(event.target.value)} required />
                                    </label>
                                    <label className="block text-sm space-y-1">
                                        {t('reason')}
                                        <input className={inputClass} type="text" maxLength={1000}
                                            value={quotaReason} onChange={event => setQuotaReason(event.target.value)}
                                            required />
                                    </label>
                                    <button type="submit" disabled={busy}
                                        className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                                        {t('saveQuota')}
                                    </button>
                                </form>
                                <form onSubmit={addAdjustment} className="rounded-xl border border-border p-4 space-y-3">
                                    <h3 className="font-semibold">{t('addAdjustment')}</h3>
                                    <p className="text-xs text-muted-foreground">{t('adjustmentHint')}</p>
                                    <label className="block text-sm space-y-1">
                                        {t('adjustmentDate')}
                                        <input className={inputClass} type="text" placeholder="TT.MM.JJJJ"
                                            pattern="[0-9]{2}\.[0-9]{2}\.[0-9]{4}" value={date} required
                                            onChange={event => setDate(event.target.value)}/>
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="block text-sm space-y-1">
                                            {t('deliveredDelta')}
                                            <input className={inputClass} type="number" min={-999} max={999}
                                                value={deliveredDelta} required
                                                onChange={event => setDeliveredDelta(event.target.value)}/>
                                        </label>
                                        <label className="block text-sm space-y-1">
                                            {t('creditedDelta')}
                                            <input className={inputClass} type="number" min={-999} max={999}
                                                value={creditedDelta} required
                                                onChange={event => setCreditedDelta(event.target.value)}/>
                                        </label>
                                    </div>
                                    <label className="block text-sm space-y-1">
                                        {t('reason')}
                                        <input className={inputClass} type="text" maxLength={1000}
                                            value={adjustmentReason} required
                                            onChange={event => setAdjustmentReason(event.target.value)}/>
                                    </label>
                                    <button type="submit" disabled={busy}
                                        className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                                        {t('add')}
                                    </button>
                                </form>
                            </div>
                        )}
                        {feedback && !readOnly && (
                            <p role="status" aria-live="polite" className="text-sm font-semibold">{feedback}</p>
                        )}
                        <div className="space-y-3">
                            <h3 className="font-semibold">{t('timeline')}</h3>
                            {account.entries.length === 0 && account.adjustments.length === 0
                                ? <p className="text-sm text-muted-foreground">{t('noEntries')}</p>
                                : (
                                    <div className="space-y-3">
                                        {account.entries.map(entry => {
                                            const classifiable = (entry.status === 'cancelled' ||
                                                entry.status === 'no_show' ||
                                                (entry.status === 'completed' && entry.lesson_type === 'makeup'))
                                            return (
                                                <article key={entry.id} className="rounded-xl border border-border p-3 space-y-1">
                                                    <div className="flex flex-wrap justify-between gap-2">
                                                        <p className="font-semibold text-sm">
                                                            {toGermanDate(entry.date)} · {t(entry.lesson_type === 'makeup'
                                                                ? 'makeupLesson' : entry.status)}
                                                        </p>
                                                        <p className="text-sm text-muted-foreground">
                                                            {t('creditedEntry', { count: entry.credited })}
                                                        </p>
                                                    </div>
                                                    {entry.kind && <p className="text-sm text-muted-foreground">{t(entry.kind)}</p>}
                                                    {entry.reason && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{entry.reason}</p>}
                                                    {!readOnly && classifiable && (
                                                        <ClassificationEditor key={entry.id + ':' + entry.kind}
                                                            entry={entry} disabled={busy}
                                                            onSave={async (row, kind, reason) =>
                                                                submit({ action: 'classify', lesson_id: row.id, kind, reason })}/>
                                                    )}
                                                    {readOnly && classifiable && !entry.kind &&
                                                        <p className="text-xs text-muted-foreground">{t('unclassified')}</p>}
                                                </article>
                                            )
                                        })}
                                        {account.adjustments.map(item => (
                                            <article key={item.id} className="rounded-xl border border-border p-3">
                                                <p className="font-semibold text-sm">{toGermanDate(item.date)} · {t('adjustment')}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {t('adjustmentValues', {
                                                        delivered: item.delivered_delta, credited: item.credited_delta
                                                    })}
                                                </p>
                                                <p className="text-sm whitespace-pre-wrap">{item.reason}</p>
                                            </article>
                                        ))}
                                    </div>
                                )}
                        </div>
                    </>
                )}
        </section>
    )
}

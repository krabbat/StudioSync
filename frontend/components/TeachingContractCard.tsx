'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { fromGermanDate, toGermanDate } from '@/components/StudentPersonalFields'

type Contract = {
    id: string
    contract_start_date: string
    contract_year_start: string
    lesson_minutes: 30 | 45 | 60
    monthly_amount: string
    price_kind: 'standard' | 'individual'
    special_agreements: string
}

type EditorState = {
    contract_start_date: string
    contract_year_start: string
    lesson_minutes: '' | '30' | '45' | '60'
    monthly_amount: string
    price_kind: 'standard' | 'individual'
    special_agreements: string
}

const initialState: EditorState = {
    contract_start_date: '',
    contract_year_start: '',
    lesson_minutes: '',
    monthly_amount: '',
    price_kind: 'standard',
    special_agreements: '',
}

function toEditor(value: Contract): EditorState {
    return {
        contract_start_date: toGermanDate(value.contract_start_date),
        contract_year_start: toGermanDate(value.contract_year_start),
        lesson_minutes: String(value.lesson_minutes) as EditorState['lesson_minutes'],
        monthly_amount: value.monthly_amount.replace('.', ','),
        price_kind: value.price_kind,
        special_agreements: value.special_agreements || '',
    }
}

function parseEuros(input: string): string | null {
    const formatted = input.trim().replace(',', '.')
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(formatted)) return null
    const value = Number(formatted)
    return Number.isFinite(value) && value > 0 ? value.toFixed(2) : null
}

export default function TeachingContractCard({ studentId, readOnly }: {
    studentId: string
    readOnly: boolean
}) {
    const t = useTranslations('TeachingContract')
    const locale = useLocale()
    const [contract, setContract] = useState<Contract | null>(null)
    const [form, setForm] = useState<EditorState>(initialState)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [saving, setSaving] = useState(false)
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    function showError(message: string) {
        setFeedback({ type: 'error', message })
        toast.error(message)
    }

    useEffect(() => {
        if (!studentId) {
            setContract(null)
            setForm(initialState)
            setLoading(true)
            return
        }
        let active = true
        setLoading(true)
        setError(false)
        setFeedback(null)
        api.get('/students/' + encodeURIComponent(studentId) + '/contract/')
            .then(response => {
                if (!active) return
                const loaded = response.data.contract as Contract | null
                setContract(loaded)
                setForm(loaded ? toEditor(loaded) : initialState)
            })
            .catch(() => { if (active) setError(true) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [studentId])

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (readOnly || !studentId) return

        const start = fromGermanDate(form.contract_start_date)
        const yearStart = fromGermanDate(form.contract_year_start)
        const amount = parseEuros(form.monthly_amount)

        if (!start || !yearStart) {
            showError(t('invalidDate'))
            return
        }
        if (!form.lesson_minutes) {
            showError(t('missingDuration'))
            return
        }
        if (amount === null) {
            showError(t('invalidAmount'))
            return
        }

        setSaving(true)
        try {
            const response = await api.put('/students/' + encodeURIComponent(studentId) + '/contract/', {
                contract_start_date: start,
                contract_year_start: yearStart,
                lesson_minutes: Number(form.lesson_minutes),
                monthly_amount: amount,
                price_kind: form.price_kind,
                special_agreements: form.special_agreements,
            })
            const saved = response.data.contract as Contract
            setContract(saved)
            setForm(toEditor(saved))
            setFeedback({ type: 'success', message: t('saved') })
            toast.success(t('saved'))
        } catch (error: any) {
            const data = error.response?.data
            const details = data && typeof data === 'object'
                ? Object.values(data).flat().filter(x => typeof x === 'string').join(' ')
                : ''
            showError(details || t('saveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const inputClass = 'block w-full rounded-xl border border-input px-4 py-3 text-foreground outline-none ' +
        (readOnly
            ? 'bg-muted/40 cursor-default'
            : 'bg-background focus:border-primary focus:ring-1 focus:ring-primary')

    const editable = !readOnly

    return (
        <section className="rounded-2xl border border-border bg-card text-card-foreground p-6 sm:p-8 space-y-5">
            <header className="space-y-1">
                <h2 className="text-xl font-bold text-card-foreground">{t('heading')}</h2>
                <p className="text-sm text-muted-foreground">{readOnly ? t('studentHint') : t('adminHint')}</p>
            </header>

            {loading ? (
                <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : error ? (
                <p role="alert" className="text-sm text-red-600">{t('loadFailed')}</p>
            ) : readOnly && !contract ? (
                <p className="text-sm text-muted-foreground">{t('noContract')}</p>
            ) : (
                <form onSubmit={save} onChangeCapture={() => setFeedback(null)} className="space-y-5">
                    {editable && !contract &&
                        <p className="text-sm text-muted-foreground">{t('noContractAdmin')}</p>}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="block space-y-1 text-sm font-medium text-card-foreground">
                            {t('contractStart')}
                            <input className={inputClass} type="text" inputMode="numeric"
                                placeholder="TT.MM.JJJJ" pattern="[0-9]{2}\.[0-9]{2}\.[0-9]{4}"
                                required={editable} readOnly={readOnly}
                                value={form.contract_start_date}
                                onChange={event => setForm(prev => ({
                                    ...prev, contract_start_date: event.target.value
                                }))}
                            />
                        </label>

                        <label className="block space-y-1 text-sm font-medium text-card-foreground">
                            {t('contractYearStart')}
                            <input className={inputClass} type="text" inputMode="numeric"
                                placeholder="TT.MM.JJJJ" pattern="[0-9]{2}\.[0-9]{2}\.[0-9]{4}"
                                required={editable} readOnly={readOnly}
                                value={form.contract_year_start}
                                onChange={event => setForm(prev => ({
                                    ...prev, contract_year_start: event.target.value
                                }))}
                            />
                        </label>

                        <label className="block space-y-1 text-sm font-medium text-card-foreground">
                            {t('lessonMinutes')}
                            <select className={inputClass} required={editable} disabled={readOnly}
                                value={form.lesson_minutes}
                                onChange={event => setForm(prev => ({
                                    ...prev, lesson_minutes: event.target.value as EditorState['lesson_minutes']
                                }))}>
                                <option value="">{t('selectDuration')}</option>
                                {([30, 45, 60] as const).map(minutes => (
                                    <option key={minutes} value={String(minutes)}>
                                        {t('minutes', { count: minutes })}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block space-y-1 text-sm font-medium text-card-foreground">
                            {t('priceKind')}
                            <select className={inputClass} disabled={readOnly}
                                value={form.price_kind}
                                onChange={event => setForm(prev => ({
                                    ...prev, price_kind: event.target.value as EditorState['price_kind']
                                }))}>
                                <option value="standard">{t('standard')}</option>
                                <option value="individual">{t('individual')}</option>
                            </select>
                        </label>
                    </div>

                    <label className="block space-y-1 text-sm font-medium text-card-foreground">
                        {t('monthlyAmount')}
                        <div className="relative">
                            <input className={inputClass + ' pr-14'} required={editable}
                                type="text" inputMode="decimal" placeholder="135,00"
                                readOnly={readOnly}
                                value={form.monthly_amount}
                                onChange={event => setForm(prev => ({
                                    ...prev, monthly_amount: event.target.value
                                }))}
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                                aria-hidden="true">EUR</span>
                        </div>
                        {editable && <span className="block text-xs text-muted-foreground">{t('manualPriceHint')}</span>}
                    </label>

                    <label className="block space-y-1 text-sm font-medium text-card-foreground">
                        {t('specialAgreements')}
                        <textarea className={inputClass} rows={4} readOnly={readOnly}
                            value={form.special_agreements}
                            onChange={event => setForm(prev => ({
                                ...prev, special_agreements: event.target.value
                            }))}
                        />
                    </label>

                    {editable && (
                        <div className="flex flex-col items-start gap-3">
                            <button type="submit" disabled={saving}
                                className="rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-50">
                                {saving ? t('saving') : t('save')}
                            </button>
                            {feedback && (
                                <p role="status" aria-live="polite" className="text-sm font-semibold"
                                    style={{ color: feedback.type === 'success'
                                        ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
                                    {feedback.message}
                                </p>
                            )}
                        </div>
                    )}
                </form>
            )}
        </section>
    )
}

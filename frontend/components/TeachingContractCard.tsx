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
            toast.error(t('invalidDate'))
            return
        }
        if (!form.lesson_minutes) {
            toast.error(t('missingDuration'))
            return
        }
        if (amount === null) {
            toast.error(t('invalidAmount'))
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
            toast.success(t('saved'))
        } catch (error: any) {
            const data = error.response?.data
            const details = data && typeof data === 'object'
                ? Object.values(data).flat().filter(x => typeof x === 'string').join(' ')
                : ''
            toast.error(details || t('saveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const inputClass = 'block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-primary focus:ring-1 focus:ring-primary'
    const field = (label: string, value: string) => (
        <div className="space-y-1">
            <dt className="text-sm font-medium text-gray-500">{label}</dt>
            <dd className="font-semibold text-gray-900">{value || '–'}</dd>
        </div>
    )

    return (
        <section className="rounded-2xl border border-gray-100 bg-white p-6 sm:p-8 space-y-5">
            <div className="space-y-1">
                <h2 className="text-xl font-bold text-gray-900">{t('heading')}</h2>
                <p className="text-sm text-gray-500">{readOnly ? t('studentHint') : t('adminHint')}</p>
            </div>

            {loading ? <p className="text-sm text-gray-500">{t('loading')}</p> :
                error ? <p role="alert" className="text-sm text-red-600">{t('loadFailed')}</p> :
                readOnly ? (
                    contract ? (
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            {field(t('contractStart'), toGermanDate(contract.contract_start_date))}
                            {field(t('contractYearStart'), toGermanDate(contract.contract_year_start))}
                            {field(t('lessonMinutes'), t('minutes', { count: contract.lesson_minutes }))}
                            {field(t('priceKind'), t(contract.price_kind))}
                            {field(t('monthlyAmount'), new Intl.NumberFormat(
                                locale === 'de' ? 'de-DE' : 'en-US',
                                { style: 'currency', currency: 'EUR' }
                            ).format(Number(contract.monthly_amount)))}
                            <div className="sm:col-span-2 space-y-1">
                                <dt className="text-sm font-medium text-gray-500">{t('specialAgreements')}</dt>
                                <dd className="whitespace-pre-wrap break-words text-gray-900">{contract.special_agreements || '–'}</dd>
                            </div>
                        </dl>
                    ) : <p className="text-sm text-gray-500">{t('noContract')}</p>
                ) : (
                    <form onSubmit={save} className="space-y-5">
                        {!contract && <p className="text-sm text-gray-500">{t('noContractAdmin')}</p>}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <label className="space-y-1 text-sm font-medium text-gray-700">
                                {t('contractStart')}
                                <input className={inputClass} type="text" inputMode="numeric"
                                    placeholder="TT.MM.JJJJ" required
                                    value={form.contract_start_date}
                                    onChange={e => setForm(prev => ({ ...prev, contract_start_date: e.target.value }))}
                                />
                            </label>
                            <label className="space-y-1 text-sm font-medium text-gray-700">
                                {t('contractYearStart')}
                                <input className={inputClass} type="text" inputMode="numeric"
                                    placeholder="TT.MM.JJJJ" required
                                    value={form.contract_year_start}
                                    onChange={e => setForm(prev => ({ ...prev, contract_year_start: e.target.value }))}
                                />
                            </label>
                            <label className="space-y-1 text-sm font-medium text-gray-700">
                                {t('lessonMinutes')}
                                <select className={inputClass} required value={form.lesson_minutes}
                                    onChange={e => setForm(prev => ({
                                        ...prev, lesson_minutes: e.target.value as EditorState['lesson_minutes']
                                    }))}>
                                    <option value="">{t('selectDuration')}</option>
                                    {([30, 45, 60] as const).map(minutes => (
                                        <option key={minutes} value={String(minutes)}>
                                            {t('minutes', { count: minutes })}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium text-gray-700">
                                {t('priceKind')}
                                <select className={inputClass} value={form.price_kind}
                                    onChange={e => setForm(prev => ({
                                        ...prev, price_kind: e.target.value as EditorState['price_kind']
                                    }))}>
                                    <option value="standard">{t('standard')}</option>
                                    <option value="individual">{t('individual')}</option>
                                </select>
                            </label>
                        </div>
                        <label className="block space-y-1 text-sm font-medium text-gray-700">
                            {t('monthlyAmount')}
                            <div className="relative">
                                <input className={inputClass + ' pr-14'} required type="text"
                                    inputMode="decimal" placeholder="135,00"
                                    value={form.monthly_amount}
                                    onChange={e => setForm(prev => ({ ...prev, monthly_amount: e.target.value }))}
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500" aria-hidden="true">EUR</span>
                            </div>
                            <span className="block text-xs text-gray-500">{t('manualPriceHint')}</span>
                        </label>
                        <label className="block space-y-1 text-sm font-medium text-gray-700">
                            {t('specialAgreements')}
                            <textarea className={inputClass} rows={4} value={form.special_agreements}
                                onChange={e => setForm(prev => ({ ...prev, special_agreements: e.target.value }))}
                            />
                        </label>
                        <button type="submit" disabled={saving}
                            className="rounded-xl bg-primary px-5 py-3 font-bold text-white disabled:opacity-50">
                            {saving ? t('saving') : t('save')}
                        </button>
                    </form>
                )
            }
        </section>
    )
}

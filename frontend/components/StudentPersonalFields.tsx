'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

export type StudentPersonalData = {
    first_name: string; last_name: string; email: string; phone: string
    birth_date: string; address_line1: string; postal_code: string; city: string
    emergency_contact_name: string; emergency_contact_phone: string
}

export const emptyStudentPersonal: StudentPersonalData = {
    first_name: '', last_name: '', email: '', phone: '', birth_date: '',
    address_line1: '', postal_code: '', city: '',
    emergency_contact_name: '', emergency_contact_phone: ''
}

export function toGermanDate(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    return match ? match[3] + '.' + match[2] + '.' + match[1] : ''
}

export function fromGermanDate(value: string): string | null {
    if (!value.trim()) return ''
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
    if (!match) return null
    const day = Number(match[1]), month = Number(match[2]), year = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return match[3] + '-' + match[2] + '-' + match[1]
}

function BirthDateField({ value, onChange }: { value: string; onChange: (date: string) => void }) {
    const t = useTranslations('StudentPersonal')
    const [display, setDisplay] = useState(() => toGermanDate(value))
    useEffect(() => setDisplay(toGermanDate(value)), [value])
    return (
        <label className="block space-y-1 text-sm font-medium text-gray-700">
            {t('birth_date')}
            <input type="text" inputMode="numeric" autoComplete="bday"
                placeholder="TT.MM.JJJJ" title={t('birthDateHint')}
                pattern="[0-9]{2}\.[0-9]{2}\.[0-9]{4}"
                value={display}
                onChange={event => {
                    const typed = event.target.value
                    setDisplay(typed)
                    const date = fromGermanDate(typed)
                    event.target.setCustomValidity(date === null ? t('invalidDate') : '')
                    if (date !== null) onChange(date)
                }}
                className="block w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900"
            />
        </label>
    )
}

export default function StudentPersonalFields({ value, onChange }: {
    value: StudentPersonalData
    onChange: (patch: Partial<StudentPersonalData>) => void
}) {
    const t = useTranslations('StudentPersonal')
    const field = (
        key: keyof StudentPersonalData, type: 'text' | 'email' | 'tel' = 'text',
        required = false, autoComplete?: string
    ) => (
        <label key={key} className="block space-y-1 text-sm font-medium text-gray-700">
            {t(key)}
            <input type={type} name={key} value={value[key] || ''} required={required}
                autoComplete={autoComplete}
                onChange={event => onChange({ [key]: event.target.value })}
                className="block w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900"
            />
        </label>
    )
    return (
        <div className="space-y-8">
            <section className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900">{t('personal')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {field('first_name', 'text', true, 'given-name')}
                    {field('last_name', 'text', true, 'family-name')}
                </div>
                {field('email', 'email', true, 'email')}
                {field('phone', 'tel', false, 'tel')}
                <BirthDateField value={value.birth_date} onChange={birth_date => onChange({ birth_date })} />
            </section>
            <section className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900">{t('address')}</h2>
                {field('address_line1', 'text', false, 'street-address')}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {field('postal_code', 'text', false, 'postal-code')}
                    {field('city', 'text', false, 'address-level2')}
                </div>
            </section>
            <section className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900">{t('emergency')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {field('emergency_contact_name')}
                    {field('emergency_contact_phone', 'tel')}
                </div>
            </section>
        </div>
    )
}

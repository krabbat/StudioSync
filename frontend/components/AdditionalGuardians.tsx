'use client'

import { Plus, X } from 'lucide-react'
import { INTERNATIONAL_EMAIL_PATTERN, INTERNATIONAL_EMAIL_HINT } from '@/lib/internationalEmail'

export type GuardianContact = { first_name: string; last_name: string; phone: string; email: string }

export default function AdditionalGuardians({ value, onChange, canAdd }: {
    value: GuardianContact[]
    onChange: (value: GuardianContact[]) => void
    canAdd: boolean
}) {
    const fields = [
        ['first_name', 'Vorname Ansprechpartner', 'text'],
        ['last_name', 'Nachname Ansprechpartner', 'text'],
        ['phone', 'Telefon', 'tel'],
        ['email', 'E-Mail (optional)', 'email'],
    ] as const
    return (
        <div className="space-y-4">
            {value.map((guardian, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">Ansprechpartner {i + 2}</span>
                        <button type="button" aria-label={`Ansprechpartner ${i + 2} entfernen`} onClick={() => onChange(value.filter((_, j) => i !== j))} className="p-2 rounded-lg border border-gray-200 text-gray-600"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {fields.map(([key, label, type]) => (
                            <label key={key} className="block space-y-1 text-sm font-medium text-gray-700">
                                {label}
                                <input type={type === 'email' ? 'text' : type}
                                    inputMode={type === 'email' ? 'email' : undefined}
                                    pattern={type === 'email' ? INTERNATIONAL_EMAIL_PATTERN : undefined}
                                    title={type === 'email' ? INTERNATIONAL_EMAIL_HINT : undefined}
                                    maxLength={type === 'tel' ? 20 : type === 'email' ? 254 : 100}
                                    required={key !== 'email'} value={guardian[key] || ''}
                                    onChange={e => onChange(value.map((g, j) => i === j ? { ...g, [key]: e.target.value } : g))}
                                    className="block w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900" />
                            </label>
                        ))}
                    </div>
                </div>
            ))}
            {canAdd && <button type="button" aria-label="Weiteren Ansprechpartner hinzufügen" title="Weiteren Ansprechpartner hinzufügen"
                onClick={() => onChange([...value, { first_name: '', last_name: '', phone: '', email: '' }])}
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700"><Plus className="w-5 h-5" /></button>}
        </div>
    )
}

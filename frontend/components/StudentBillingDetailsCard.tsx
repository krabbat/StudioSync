'use client'

import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { FileText, Mail, Save } from 'lucide-react'
import api from '@/services/api'
import { Button } from '@/components/ui/button'

type BillingProfile = {
    payment_method: 'bank_transfer' | 'paypal' | 'cash'
    recipient_name: string
    recipient_email: string
    recipient_address_line1: string
    recipient_postal_code: string
    recipient_city: string
}

type StudentInvoice = {
    id: string
    invoice_number: string
    issue_date: string
    due_date: string
    total_amount: string | number
    amount_paid: string | number
    balance_due: string | number
    status: string
    is_overdue: boolean
}

const emptyProfile: BillingProfile = {
    payment_method: 'bank_transfer',
    recipient_name: '',
    recipient_email: '',
    recipient_address_line1: '',
    recipient_postal_code: '',
    recipient_city: '',
}

const euro = (amount: number | string) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(amount))

const germanDate = (value: string) =>
    value ? new Date(`${value}T12:00:00`).toLocaleDateString('de-DE') : '–'

function invoiceState(invoice: StudentInvoice) {
    if (invoice.status === 'cancelled') return { label: 'Storniert', className: 'text-gray-500' }
    if (invoice.status === 'paid' || Number(invoice.balance_due) <= 0)
        return { label: 'Bezahlt', className: 'text-emerald-700' }
    if (invoice.is_overdue)
        return { label: 'Überfällig', className: 'text-red-600' }
    if (invoice.status === 'partial')
        return { label: 'Teilbezahlt', className: 'text-amber-700' }
    if (invoice.status === 'draft')
        return { label: 'Entwurf', className: 'text-gray-500' }
    return { label: 'Offen', className: 'text-gray-700' }
}

export default function StudentBillingDetailsCard({
    studentId,
    studentEmail,
}: {
    studentId: string
    studentEmail: string
}) {
    const [profile, setProfile] = useState<BillingProfile>(emptyProfile)
    const [invoices, setInvoices] = useState<StudentInvoice[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [loadError, setLoadError] = useState(false)

    useEffect(() => {
        let active = true
        setLoading(true)
        setLoadError(false)
        Promise.all([
            api.get(`/students/${studentId}/billing-profile/`),
            api.get('/billing/invoices/', { params: { student: studentId } }),
        ])
            .then(([settings, invoiceResponse]) => {
                if (!active) return
                setProfile({ ...emptyProfile, ...settings.data })
                const data = invoiceResponse.data
                setInvoices(Array.isArray(data) ? data : (data.results || []))
            })
            .catch(() => {
                if (!active) return
                setLoadError(true)
                toast.error('Rechnungsdaten konnten nicht geladen werden.')
            })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [studentId])

    const setField = (key: keyof BillingProfile, value: string) =>
        setProfile(previous => ({ ...previous, [key]: value }))

    const save = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setSaving(true)
        try {
            const result = await api.put(`/students/${studentId}/billing-profile/`, profile)
            setProfile({ ...emptyProfile, ...result.data })
            toast.success('Rechnungsdaten gespeichert.')
        } catch (error: any) {
            const fields = error?.response?.data
            const firstError = fields && typeof fields === 'object'
                ? Object.values(fields).flat().find(message => typeof message === 'string')
                : null
            toast.error(typeof firstError === 'string' ? firstError : 'Rechnungsdaten konnten nicht gespeichert werden.')
        } finally {
            setSaving(false)
        }
    }

    const inputClass = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:border-primary focus:outline-none'
    const labelClass = 'block text-xs font-bold text-gray-600 mb-1.5'

    return (
        <section className="bg-white p-6 md:p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-5">
            <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <h2 className="text-sm font-black text-gray-800">Rechnungsdaten</h2>
            </div>
            {loading ? (
                <p className="text-sm text-gray-500">Rechnungsdaten werden geladen …</p>
            ) : loadError ? (
                <p className="text-sm text-red-600">Laden fehlgeschlagen. Bitte die Seite erneut öffnen.</p>
            ) : (
                <>
                    <form onSubmit={save} className="space-y-4">
                        <div>
                            <label htmlFor="student-billing-method" className={labelClass}>Zahlungsart</label>
                            <select
                                id="student-billing-method"
                                value={profile.payment_method}
                                onChange={e => setField('payment_method', e.target.value)}
                                className={inputClass}
                            >
                                <option value="bank_transfer">Banküberweisung</option>
                                <option value="paypal">PayPal</option>
                                <option value="cash">Barzahlung</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="student-billing-name" className={labelClass}>Rechnungsempfänger</label>
                            <input
                                id="student-billing-name"
                                type="text"
                                maxLength={200}
                                value={profile.recipient_name}
                                onChange={e => setField('recipient_name', e.target.value)}
                                placeholder="Name der zahlungspflichtigen Person"
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                <label htmlFor="student-billing-email" className="text-xs font-bold text-gray-600">
                                    E-Mail für den Rechnungsversand
                                </label>
                                <button
                                    type="button"
                                    disabled={!studentEmail}
                                    onClick={() => setField('recipient_email', studentEmail)}
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <Mail className="w-3.5 h-3.5" />
                                    Schüler-E-Mail übernehmen
                                </button>
                            </div>
                            <input
                                id="student-billing-email"
                                type="email"
                                maxLength={254}
                                value={profile.recipient_email}
                                onChange={e => setField('recipient_email', e.target.value)}
                                placeholder="rechnung@beispiel.de"
                                className={inputClass}
                            />
                            <p className="text-xs text-gray-500 mt-1.5">
                                Unabhängig von der Schüler-E-Mail. Eine Übernahme erfolgt ausschließlich über die Schaltfläche.
                            </p>
                        </div>
                        <div>
                            <label htmlFor="student-billing-street" className={labelClass}>Rechnungsanschrift – Straße und Hausnummer</label>
                            <input
                                id="student-billing-street"
                                type="text"
                                maxLength={255}
                                value={profile.recipient_address_line1}
                                onChange={e => setField('recipient_address_line1', e.target.value)}
                                className={inputClass}
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label htmlFor="student-billing-postal" className={labelClass}>Postleitzahl</label>
                                <input
                                    id="student-billing-postal"
                                    type="text"
                                    maxLength={20}
                                    value={profile.recipient_postal_code}
                                    onChange={e => setField('recipient_postal_code', e.target.value)}
                                    className={inputClass}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label htmlFor="student-billing-city" className={labelClass}>Ort</label>
                                <input
                                    id="student-billing-city"
                                    type="text"
                                    maxLength={100}
                                    value={profile.recipient_city}
                                    onChange={e => setField('recipient_city', e.target.value)}
                                    className={inputClass}
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-500">
                                Rechnungsnummern werden beim Erstellen automatisch vergeben: Datum + zufällige Ziffern.
                            </p>
                            <Button type="submit" disabled={saving} className="shrink-0 gap-2">
                                <Save className="w-4 h-4" />
                                {saving ? 'Speichert …' : 'Speichern'}
                            </Button>
                        </div>
                    </form>

                    <div className="border-t border-gray-100 pt-5 space-y-3">
                        <h3 className="text-sm font-bold text-gray-800">Rechnungen und Beiträge</h3>
                        {invoices.length === 0 ? (
                            <p className="text-sm text-gray-500">
                                Noch keine Rechnungen vorhanden. Automatische Monatsrechnungen sind ab Januar 2027 vorgesehen.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="text-xs text-gray-500 border-b border-gray-200">
                                        <tr>
                                            <th className="py-2 pr-3 font-semibold">Rechnung</th>
                                            <th className="py-2 pr-3 font-semibold">Fällig</th>
                                            <th className="py-2 pr-3 font-semibold text-right">Betrag</th>
                                            <th className="py-2 pr-3 font-semibold text-right">Rest</th>
                                            <th className="py-2 font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invoices.map(invoice => {
                                            const state = invoiceState(invoice)
                                            return (
                                                <tr key={invoice.id} className="border-b border-gray-100">
                                                    <td className="py-3 pr-3 whitespace-nowrap font-medium">{invoice.invoice_number}</td>
                                                    <td className="py-3 pr-3 whitespace-nowrap">{germanDate(invoice.due_date)}</td>
                                                    <td className="py-3 pr-3 text-right whitespace-nowrap">{euro(invoice.total_amount)}</td>
                                                    <td className="py-3 pr-3 text-right whitespace-nowrap">{euro(invoice.balance_due)}</td>
                                                    <td className={`py-3 whitespace-nowrap font-semibold ${state.className}`}>{state.label}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </section>
    )
}

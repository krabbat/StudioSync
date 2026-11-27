'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'react-hot-toast'
import { Mail } from 'lucide-react'
import api from '@/services/api'

type BillingProfile = {
    payment_method: 'bank_transfer' | 'paypal' | 'cash'
    recipient_name: string
    recipient_email: string
    recipient_address_line1: string
    recipient_postal_code: string
    recipient_city: string
}

type StudentAddress = {
    address_line1: string
    postal_code: string
    city: string
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
    family?:string|null
    line_items?:{student?:string|null;total_price:string;allocated_paid:string}[]
}

const initialProfile: BillingProfile = {
    payment_method: 'bank_transfer',
    recipient_name: '',
    recipient_email: '',
    recipient_address_line1: '',
    recipient_postal_code: '',
    recipient_city: '',
}

const euro = (amount: number | string) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(amount))

const germanDate = (date: string) =>
    date ? new Date(`${date}T12:00:00`).toLocaleDateString('de-DE') : '–'

function invoiceState(invoice: StudentInvoice) {
    if (invoice.status === 'cancelled') return { label: 'Storniert', color: 'text-muted-foreground' }
    if (invoice.status === 'paid' || Number(invoice.balance_due) <= 0)
        return { label: 'Bezahlt', color: 'text-emerald-700' }
    if (invoice.is_overdue) return { label: 'Überfällig', color: 'text-red-600' }
    if (invoice.status === 'partial') return { label: 'Teilbezahlt', color: 'text-amber-700' }
    if (invoice.status === 'draft') return { label: 'Entwurf', color: 'text-muted-foreground' }
    return { label: 'Offen', color: 'text-foreground' }
}

export default function StudentBillingDetailsCard({
    studentId,
    studentEmail,
    studentAddress,
}: {
    studentId: string
    studentEmail: string
    studentAddress: StudentAddress
}) {
    const t=useTranslations('FamilyBilling')
    const [profile, setProfile] = useState<BillingProfile>(initialProfile)
    // Empty stored address fields mean: dynamically use the student's current address.
    const [useStudentAddress, setUseStudentAddress] = useState(true)
    const [invoices, setInvoices] = useState<StudentInvoice[]>([])
    const [nextPage, setNextPage] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [loadError, setLoadError] = useState(false)

    useEffect(() => {
        let active = true
        setLoading(true)
        setLoadError(false)
        Promise.all([
            api.get(`/students/${studentId}/billing-profile/`),
            api.get('/billing/invoices/', { params: { student: studentId } }),
        ])
            .then(([settingsResponse, invoiceResponse]) => {
                if (!active) return
                const settings = { ...initialProfile, ...settingsResponse.data }
                setProfile(settings)
                setUseStudentAddress(
                    !settings.recipient_address_line1 &&
                    !settings.recipient_postal_code &&
                    !settings.recipient_city
                )
                const data = invoiceResponse.data
                setInvoices(Array.isArray(data) ? data : (data.results || []))
                setNextPage(!Array.isArray(data) && data.next ? 2 : null)
            })
            .catch(() => {
                if (!active) return
                setLoadError(true)
                toast.error('Rechnungsdaten konnten nicht geladen werden.')
            })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [studentId])

    const setField = (key: keyof BillingProfile, value: string) => {
        setProfile(previous => ({ ...previous, [key]: value }))
    }

    function changeAddressMode(useStudent: boolean) {
        setUseStudentAddress(useStudent)
        if (useStudent) {
            // Clearing custom address means inheritance; the email remains untouched.
            setProfile(previous => ({
                ...previous,
                recipient_address_line1: '',
                recipient_postal_code: '',
                recipient_city: '',
            }))
        } else {
            setProfile(previous => ({
                ...previous,
                recipient_address_line1: studentAddress.address_line1,
                recipient_postal_code: studentAddress.postal_code,
                recipient_city: studentAddress.city,
            }))
        }
    }

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setSaving(true)
        try {
            // Inherited addresses are never snapshotted in the billing profile.
            const payload = useStudentAddress ? {
                ...profile,
                recipient_address_line1: '',
                recipient_postal_code: '',
                recipient_city: '',
            } : profile
            const response = await api.put(`/students/${studentId}/billing-profile/`, payload)
            setProfile({ ...initialProfile, ...response.data })
            toast.success('Rechnungsdaten gespeichert.')
        } catch (error: any) {
            const fields = error?.response?.data
            const message = fields && typeof fields === 'object'
                ? Object.values(fields).flat().find(value => typeof value === 'string')
                : null
            toast.error(typeof message === 'string' ? message : 'Rechnungsdaten konnten nicht gespeichert werden.')
        } finally {
            setSaving(false)
        }
    }

    async function loadMore() {
        if (!nextPage || loadingMore) return
        setLoadingMore(true)
        try {
            const response = await api.get('/billing/invoices/', {
                params: { student: studentId, page: nextPage },
            })
            const data = response.data
            setInvoices(previous => [...previous, ...(data.results || [])])
            setNextPage(data.next ? nextPage + 1 : null)
        } catch {
            toast.error('Weitere Rechnungen konnten nicht geladen werden.')
        } finally {
            setLoadingMore(false)
        }
    }

    const inputClass = 'block w-full rounded-xl border border-input bg-background px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary'
    const labelClass = 'block space-y-1.5 text-sm font-medium text-foreground'
    const groupClass = 'rounded-xl border border-border bg-muted/20 p-4 sm:p-6 space-y-4'

    return (
        <section className="rounded-2xl border border-border bg-card text-card-foreground p-6 sm:p-8 space-y-6">
            <header className="space-y-1">
                <h2 className="text-xl font-bold text-card-foreground">Rechnungsdaten</h2>
                <p className="text-sm text-muted-foreground">
                    Zahlungsweg, Rechnungsempfänger und Rechnungsanschrift für diesen Schüler.
                </p>
            </header>

            {loading ? (
                <p className="text-sm text-muted-foreground">Rechnungsdaten werden geladen …</p>
            ) : loadError ? (
                <p role="alert" className="text-sm text-red-600">
                    Rechnungsdaten konnten nicht geladen werden. Bitte die Seite erneut öffnen.
                </p>
            ) : (
                <>
                    <form onSubmit={save} className="space-y-6">
                        <div className={groupClass}>
                            <h3 className="text-base font-semibold">Zahlungsweg und Rechnungsempfänger</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                                <label className={labelClass}>
                                    Zahlungsart
                                    <select
                                        value={profile.payment_method}
                                        onChange={event => setField('payment_method', event.target.value)}
                                        className={inputClass}
                                    >
                                        <option value="bank_transfer">Banküberweisung</option>
                                        <option value="paypal">PayPal</option>
                                        <option value="cash">Barzahlung</option>
                                    </select>
                                </label>
                                <label className={labelClass}>
                                    Rechnungsempfänger
                                    <input
                                        type="text" maxLength={200}
                                        value={profile.recipient_name}
                                        onChange={event => setField('recipient_name', event.target.value)}
                                        placeholder="Name der zahlungspflichtigen Person"
                                        className={inputClass}
                                    />
                                </label>
                                <div className="md:col-span-2 space-y-2">
                                    <div className="flex flex-wrap justify-between items-center gap-2">
                                        <label htmlFor="billing-recipient-email" className="text-sm font-medium text-foreground">
                                            E-Mail für den Rechnungsversand
                                        </label>
                                        <button
                                            type="button"
                                            disabled={!studentEmail}
                                            onClick={() => setField('recipient_email', studentEmail)}
                                            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Mail className="w-4 h-4" />
                                            Schüler-E-Mail übernehmen
                                        </button>
                                    </div>
                                    <input
                                        id="billing-recipient-email"
                                        type="text" inputMode="email" maxLength={254}
                                        value={profile.recipient_email}
                                        onChange={event => setField('recipient_email', event.target.value)}
                                        placeholder="rechnung@beispiel.de"
                                        className={inputClass}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Die Rechnungs-E-Mail ist von der Schüler-E-Mail unabhängig.
                                        Eine Übernahme erfolgt nur über die Schaltfläche.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className={groupClass}>
                            <h3 className="text-base font-semibold">Rechnungsanschrift</h3>
                            <label className="flex items-center gap-3 text-sm font-medium text-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useStudentAddress}
                                    onChange={event => changeAddressMode(event.target.checked)}
                                    className="h-4 w-4 accent-primary"
                                />
                                Schüleranschrift verwenden
                            </label>
                            {useStudentAddress ? (
                                <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground space-y-1">
                                    <p>{studentAddress.address_line1 || 'Straße und Hausnummer fehlen im Schülerprofil'}</p>
                                    <p>{[studentAddress.postal_code, studentAddress.city].filter(Boolean).join(' ') || 'PLZ und Ort fehlen im Schülerprofil'}</p>
                                    <p className="pt-1 text-xs text-muted-foreground">
                                        Die Anschrift wird direkt aus den Schülerdaten übernommen und bei Änderungen dort aktualisiert.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                                    <label className={`${labelClass} sm:col-span-3`}>
                                        Straße und Hausnummer
                                        <input
                                            type="text" maxLength={255} required
                                            value={profile.recipient_address_line1}
                                            onChange={event => setField('recipient_address_line1', event.target.value)}
                                            className={inputClass}
                                        />
                                    </label>
                                    <label className={labelClass}>
                                        Postleitzahl
                                        <input
                                            type="text" maxLength={20} required
                                            value={profile.recipient_postal_code}
                                            onChange={event => setField('recipient_postal_code', event.target.value)}
                                            className={inputClass}
                                        />
                                    </label>
                                    <label className={`${labelClass} sm:col-span-2`}>
                                        Ort
                                        <input
                                            type="text" maxLength={100} required
                                            value={profile.recipient_city}
                                            onChange={event => setField('recipient_city', event.target.value)}
                                            className={inputClass}
                                        />
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-t border-border pt-5">
                            <p className="text-xs text-muted-foreground">
                                Rechnungsnummern werden beim Erstellen vergeben: Datum und zufällige Ziffernfolge.
                            </p>
                            <button
                                type="submit" disabled={saving}
                                className="rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
                            >
                                {saving ? 'Speichert …' : 'Rechnungsdaten speichern'}
                            </button>
                        </div>
                    </form>

                    <div className="border-t border-border pt-6 space-y-4">
                        <div className="space-y-1">
                            <h3 className="text-lg font-bold">Rechnungen und Beiträge</h3>
                            <p className="text-sm text-muted-foreground">
                                Bereits gestellte Rechnungen mit Fälligkeit, Betrag und Zahlungsstatus.
                            </p>
                        </div>
                        {invoices.length === 0 ? (
                            <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">
                                Noch keine Rechnungen vorhanden. Automatische Monatsrechnungen sind ab Januar 2027 vorgesehen.
                            </p>
                        ) : (
                            <>
                                <div className="overflow-x-auto rounded-xl border border-border">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                                            <tr>
                                                <th className="p-3 font-semibold">Rechnungsnummer</th>
                                                <th className="p-3 font-semibold">Fälligkeit</th>
                                                <th className="p-3 font-semibold text-right">Betrag</th>
                                                <th className="p-3 font-semibold text-right">Offen</th>
                                                <th className="p-3 font-semibold">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {invoices.map(invoice => {
                                                const lines=invoice.family?(invoice.line_items||[]).filter(l=>l.student===studentId):[]
                                                const share=lines.reduce((n,l)=>n+Number(l.total_price),0)
                                                const paid=lines.reduce((n,l)=>n+Number(l.allocated_paid||0),0)
                                                const shown=invoice.family?{...invoice,total_amount:share,balance_due:Math.max(0,share-paid),status:invoice.status==='cancelled'?'cancelled':share===paid?'paid':paid>0?'partial':'sent'}:invoice
                                                const state = invoiceState(shown)
                                                return (
                                                    <tr key={invoice.id} className="border-t border-border">
                                                        <td className="p-3 whitespace-nowrap font-medium">{invoice.invoice_number}{invoice.family&&<small className="block text-gray-500">{t('familyInvoice')}</small>}</td>
                                                        <td className="p-3 whitespace-nowrap">{germanDate(invoice.due_date)}</td>
                                                        <td className="p-3 whitespace-nowrap text-right">{euro(shown.total_amount)}</td>
                                                        <td className="p-3 whitespace-nowrap text-right">{euro(shown.balance_due)}</td>
                                                        <td className={`p-3 whitespace-nowrap font-semibold ${state.color}`}>{state.label}</td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                {nextPage && (
                                    <button
                                        type="button" onClick={loadMore} disabled={loadingMore}
                                        className="rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                    >
                                        {loadingMore ? 'Lädt …' : 'Weitere Rechnungen anzeigen'}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </section>
    )
}

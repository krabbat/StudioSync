'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useStudioFormatting } from '@/lib/useStudioFormatting'
import { useState, useEffect } from 'react'
import { useUser } from '@/contexts/UserContext'
import { useInvoices, useSubscriptionPlans, useSubscriptions } from '@/hooks/useDashboardData'
import api from '@/services/api'
import { toast } from 'react-hot-toast'
import {
    DollarSign,
    Plus,
    X,
    Loader2,
    AlertCircle,
    CheckCircle2,
    Clock,
    Download,
    Share2,
    Send,
    Trash2,
    FileText,
    Search,
    Filter,
    Calendar,
    Eye,
    Mail,
    Receipt,
    ChevronRight,
    ArrowUpRight,
    CreditCard,
    Repeat
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { shareFilesOrDownload } from '@/lib/shareFile'

interface Invoice {
    id: string
    invoice_number: string
    test_only?: boolean
    total_amount: number | string
    balance_due: number | string
    payment_status: 'pending' | 'paid' | 'overdue' | 'cancelled'
    payment_remaining: number | string
    payment_received: number | string
    recipient?: { name: string; street: string; postal_code: string; city: string }
    due_date: string
    effective_due_date?: string
    status: 'paid' | 'pending' | 'overdue' | 'draft' | 'sent' | 'partial' | 'cancelled'
    line_items: Array<{
        id: string
        description: string
        quantity: number
        unit_price: number | string
        total_price: number | string
    }>
    student_name?: string
    lesson_subject?: string
    band_name?: string
    created_at?: string
    issue_date: string
    email_sent?: boolean
    sent_at?: string | null
    stripe_transaction_id?: string
}

function monthsInPeriod(from: string, to: string): number {
    if (!from) return 1
    const [startYear, startMonth] = from.split('-').map(Number)
    const [endYear, endMonth] = (to || from).split('-').map(Number)
    return (endYear - startYear) * 12 + endMonth - startMonth + 1
}

function periodMonthText(month: string): string {
    if (!month) return ''
    const [year, monthNumber] = month.split('-').map(Number)
    return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, monthNumber - 1, 1)))
}

function suggestedInvoiceDescription(from: string, to: string): string {
    if (!from) return ''
    if (!to || from === to) return 'Unterrichtsbeitrag ' + periodMonthText(from)
    return 'Unterrichtsbeiträge ' + periodMonthText(from) + ' bis ' + periodMonthText(to)
}

export default function BillingPage() {
  const tr = useTranslations('Billing')
  const locale = useLocale()
  const { money } = useStudioFormatting()
    const { currentUser } = useUser()
    const { invoices, loading: loadingInvoices, refetch: refetchInvoices } = useInvoices()
    const { plans, loading: loadingPlans } = useSubscriptionPlans()
    const { subscriptions, loading: loadingSubs, refetch: refetchSubs } = useSubscriptions()
    // Keep API values intact; only translate visible labels.
    const statusLabels: Record<string, string> = {
        paid: tr('paid'), pending: tr('pending'), overdue: tr('overdue'),
        draft: tr('draft'), sent: tr('sent'), partial: tr('partial'),
        cancelled: tr('cancelled'), active: tr('active'),
        past_due: tr('pastDue'), trialing: tr('trialing')
    }
    const intervalLabels: Record<string, string> = {
        day: tr('intervalDay'), week: tr('intervalWeek'),
        month: tr('intervalMonth'), year: tr('intervalYear')
    }
    const [studio, setStudio] = useState<any>(null)

    useEffect(() => {
        api.get('/core/studios/current/').then(res => setStudio(res.data)).catch(() => { })
    }, [])

    const [activeTab, setActiveTab] = useState<'invoices' | 'subscriptions'>('invoices')

    const [showCreateModal, setShowCreateModal] = useState(false)
    const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null)
    const [students, setStudents] = useState<any[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [creating, setCreating] = useState(false)

    const [newInvoice, setNewInvoice] = useState({
        student: '',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        serviceMonth: '',
        serviceMonthTo: '',
        line_items: [{ description: '', quantity: 1, unit_price: '' }]
    })

    useEffect(() => {
        if (showCreateModal) {
            api.get('/core/students/')
                .then(res => setStudents(res.data.results || (Array.isArray(res.data) ? res.data : [])))
                .catch(err => console.error('Failed to fetch students', err))
        }
    }, [showCreateModal])

    const handleCreateInvoice = async (e: React.FormEvent) => {
        e.preventDefault()
        if (newInvoice.serviceMonthTo && !newInvoice.serviceMonth) {
            toast.error('Bitte zuerst den Anfangsmonat auswählen.')
            return
        }
        if (newInvoice.serviceMonth && monthsInPeriod(newInvoice.serviceMonth, newInvoice.serviceMonthTo) < 1) {
            toast.error('Der Endmonat darf nicht vor dem Anfangsmonat liegen.')
            return
        }
        setCreating(true)

        try {
            const result = await api.post('/billing/invoices/', {
                student: newInvoice.student,
                due_date: newInvoice.dueDate,
                service_month: newInvoice.serviceMonth ? `${newInvoice.serviceMonth}-01` : null,
                service_month_end: newInvoice.serviceMonthTo ? `${newInvoice.serviceMonthTo}-01` : null,
                send_now: true,
                line_items: newInvoice.line_items.map(item => ({
                    ...item,
                    unit_price: Number(item.unit_price)
                }))
            })
            setShowCreateModal(false)
            setNewInvoice({
                student: '',
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                serviceMonth: '',
                serviceMonthTo: '',
                line_items: [{ description: '', quantity: 1, unit_price: '' }]
            })
            if (result.data.email_sent) {
                toast.success('Rechnung erstellt und per E-Mail versendet.')
            } else {
                toast.error('Rechnung als Entwurf angelegt, aber nicht versendet: ' +
                    (result.data.email_error || 'Versand nicht bestätigt.'), { duration: 7500 })
            }
            refetchInvoices()
        } catch (error: any) {
            console.error('Create invoice failed', error)
            const data = error.response?.data
            const detail = data && typeof data === 'object'
                ? Object.values(data).flat().filter(v => typeof v === 'string').join(' ')
                : ''
            toast.error(detail || tr('messageFailedToCreateInvoice'))
        } finally {
            setCreating(false)
        }
    }

    const handleInvoicePeriodChange = (field: 'serviceMonth' | 'serviceMonthTo', value: string) => {
        setNewInvoice(previous => {
            const from = field === 'serviceMonth' ? value : previous.serviceMonth
            const to = field === 'serviceMonthTo' ? value : previous.serviceMonthTo
            const validTo = from && to && to <= from ? '' : to
            const months = Math.max(1, monthsInPeriod(from, validTo))
            const previousDescription = suggestedInvoiceDescription(
                previous.serviceMonth, previous.serviceMonthTo,
            )
            const nextDescription = suggestedInvoiceDescription(from, validTo)
            return {
                ...previous,
                serviceMonth: from,
                serviceMonthTo: validTo,
                line_items: previous.line_items.map((item, index) => index === 0 ? {
                    ...item,
                    quantity: months,
                    description: !item.description || item.description === previousDescription
                        ? nextDescription : item.description,
                } : item),
            }
        })
    }

    const handleInvoiceStudentChange = (studentId: string) => {
        setNewInvoice(previous => ({
            ...previous,
            student: studentId,
            line_items: previous.line_items.map((item, index) => index === 0
                ? { ...item, unit_price: '' } : item),
        }))
        if (!studentId) return
        // Use this student's agreed monthly amount, including individual contracts.
        // The admin can still change the amount manually.
        api.get('/students/' + encodeURIComponent(studentId) + '/contract/')
            .then(response => {
                const agreedAmount = response.data?.contract?.monthly_amount
                if (agreedAmount === null || agreedAmount === undefined) return
                setNewInvoice(previous => {
                    if (previous.student !== studentId) return previous
                    if (previous.line_items[0]?.unit_price !== '') return previous
                    return {
                        ...previous,
                        line_items: previous.line_items.map((item, index) => index === 0
                            ? { ...item, unit_price: String(agreedAmount) } : item),
                    }
                })
            })
            .catch(() => { /* Without a teaching contract, enter the price manually. */ })
    }

    const addLineItem = () => {
        if (newInvoice.line_items.length >= 10) {
            toast.error(tr('messageLimitOf10ItemsPerInvoiceReached'))
            return
        }
        setNewInvoice(prev => ({
            ...prev,
            line_items: [...prev.line_items, { description: '', quantity: 1, unit_price: '' }]
        }))
    }

    const removeLineItem = (index: number) => {
        if (newInvoice.line_items.length <= 1) return
        setNewInvoice(prev => ({
            ...prev,
            line_items: prev.line_items.filter((_, i) => i !== index)
        }))
    }

    const updateLineItem = (index: number, field: string, value: any) => {
        setNewInvoice(prev => {
            const newItems = [...prev.line_items]
            newItems[index] = { ...newItems[index], [field]: value }
            return { ...prev, line_items: newItems }
        })
    }

    const modalTotal = newInvoice.line_items.reduce((sum, item) => {
        return sum + (Number(item.quantity) * Number(item.unit_price) || 0)
    }, 0)

    const handleSendInvoice = async (invoiceId: string) => {
        try {
            const result = await api.post(`/billing/invoices/${invoiceId}/send/`)
            toast.success(result.data.detail || 'Rechnung versendet.')
            setViewingInvoice(previous => previous?.id === invoiceId
                ? { ...previous, email_sent: true, status: previous.status === 'draft' ? 'sent' : previous.status }
                : previous)
            refetchInvoices()
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Der Rechnungsversand ist fehlgeschlagen.')
        }
    }

    const handleShareInvoice = async (invoice: Invoice) => {
        if (invoice.status === 'draft' || invoice.status === 'cancelled') {
            toast.error('Bitte die Rechnung zuerst ausstellen.')
            return
        }
        try {
            const response = await api.get<Blob>(
                `/billing/invoices/${invoice.id}/pdf/`,
                { responseType: 'blob' },
            )
            const filename = 'MUSart-Rechnung-' + invoice.invoice_number + '.pdf'
            const file = new File([response.data], filename, { type: 'application/pdf' })
            const outcome = await shareFilesOrDownload([file],
                'MUSart – Rechnung ' + invoice.invoice_number,
                'Anbei die Rechnung ' + invoice.invoice_number + '.')
            if (outcome === 'downloaded') {
                toast('Rechnung heruntergeladen. In WhatsApp bitte manuell anhängen.')
            }
        } catch (error: any) {
            toast.error(error?.response?.data?.detail || 'Rechnung konnte nicht geteilt werden.')
        }
    }

    const handleDeleteInvoice = async (invoiceId: string) => {
        if (!confirm(tr('messageAreYouSureYouWantToDeleteThisInvoiceThisActionCannotBeUndone'))) {
            return
        }

        try {
            await api.delete(`/billing/invoices/${invoiceId}/`)
            setViewingInvoice(previous => previous?.id === invoiceId ? null : previous)
            toast.success(tr('messageInvoiceDeletedSuccessfully'))
            refetchInvoices()
        } catch (error: any) {
            const detail = error.response?.data?.detail
            toast.error(typeof detail === 'string' ? detail : tr('messageFailedToDeleteInvoice'))
        }
    }

    const handleMarkPaid = async (invoice: Invoice) => {
        if (!confirm(`Rechnung ${invoice.invoice_number} als vollständig bezahlt markieren?`)) return
        try {
            const response = await api.post(`/billing/invoices/${invoice.id}/mark-paid/`)
            setViewingInvoice(current => current?.id === invoice.id ? response.data : current)
            toast.success('Zahlung verbucht – Rechnung bezahlt.')
            refetchInvoices()
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Zahlung konnte nicht verbucht werden.')
        }
    }

    const handleMarkPending = async (invoice: Invoice) => {
        if (!confirm(`Manuelle Zahlung für Rechnung ${invoice.invoice_number} zurücknehmen?`)) return
        try {
            const response = await api.post(`/billing/invoices/${invoice.id}/mark-pending/`)
            setViewingInvoice(current => current?.id === invoice.id ? response.data : current)
            toast.success('Manuelle Zahlung zurückgenommen.')
            refetchInvoices()
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Manuelle Zahlung konnte nicht zurückgenommen werden.')
        }
    }

    const handleDownloadInvoice = async (invoice: Invoice) => {
        try {
            const response = await api.get(`/billing/invoices/${invoice.id}/pdf/`, {
                responseType: 'blob',
            })
            const blobUrl = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
            const link = document.createElement('a')
            link.href = blobUrl
            link.download = `MUSart-Rechnung-${invoice.invoice_number}.pdf`
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2000)
        } catch {
            toast.error('PDF-Rechnung konnte nicht geladen werden.')
        }
    }

    const getStatusColor = (status: string) => {
        const styles: Record<string, string> = {
            paid: 'bg-green-50 text-green-600 border-green-100',
            pending: 'bg-yellow-50 text-yellow-600 border-yellow-100',
            overdue: 'bg-red-50 text-red-600 border-red-100',
            draft: 'bg-gray-50 text-gray-500 border-gray-100',
            sent: 'bg-blue-50 text-blue-600 border-blue-100',
        }
        return styles[status] || 'bg-gray-50 text-gray-500 border-gray-100'
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'paid': return <CheckCircle2 className="w-3 h-3" />
            case 'overdue': return <AlertCircle className="w-3 h-3" />
            case 'pending':
            case 'sent': return <Clock className="w-3 h-3" />
            default: return <FileText className="w-3 h-3" />
        }
    }

    const typedInvoices = invoices as Invoice[]

    // Calculate totals
    const paidAmount = typedInvoices
        .filter(i => !i.test_only && i.payment_status !== 'cancelled')
        .reduce((sum, i) => sum + Number(i.payment_received || 0), 0)

    const pendingAmount = typedInvoices
        .filter(i => !i.test_only && i.payment_status === 'pending')
        .reduce((sum, i) => sum + Number(i.payment_remaining || 0), 0)

    const overdueAmount = typedInvoices
        .filter(i => !i.test_only && i.payment_status === 'overdue')
        .reduce((sum, i) => sum + Number(i.payment_remaining || 0), 0)

    // Filter invoices
    const filteredInvoices = typedInvoices.filter(invoice => {
        const matchesSearch = invoice.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
            invoice.student_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            invoice.band_name?.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesStatus = filterStatus === 'all' || invoice.payment_status === filterStatus
        return matchesSearch && matchesStatus
    })

    const statusFilters = [
        { value: 'all', label: tr('all') },
        { value: 'pending', label: 'Ausstehend' },
        { value: 'paid', label: tr('paid') },
        { value: 'overdue', label: tr('overdue') }
    ]

    const isAdmin = currentUser?.role === 'admin'
    const isManager = currentUser && ['admin', 'teacher'].includes(currentUser.role)
    const isTeacher = currentUser?.role === 'teacher'

    if (loadingInvoices || loadingPlans || loadingSubs) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 animate-in fade-in duration-500">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{tr('loadingBilling')}</p>
            </div>
        )
    }

    return (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
                <div className="space-y-4">
                    <div className="space-y-2 text-center md:text-left">
                        <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">{tr('billingInvoices')}</h1>
                        <p className="text-gray-500 font-medium max-w-lg mx-auto md:mx-0">
                            {isAdmin ? 'Manage invoices and track studio revenue.' : isTeacher ? 'View invoices and track studio revenue (Read Only).' : 'View your invoices and manage your subscription.'}
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2 p-1 bg-gray-50 w-full sm:w-fit rounded-2xl border border-gray-100 overflow-x-auto no-scrollbar">
                        <button
                            onClick={() => setActiveTab('invoices')}
                            className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'invoices'
                                ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
                                : 'text-gray-400 hover:text-gray-600'
                                }`}
                        >
                            {tr('invoices')}
                        </button>
                        <button
                            onClick={() => setActiveTab('subscriptions')}
                            className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'subscriptions'
                                ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
                                : 'text-gray-400 hover:text-gray-600'
                                }`}
                        >
                            {tr('subscriptions')}
                        </button>
                    </div>
                </div>
                {isAdmin && activeTab === 'invoices' && (
                    <Button
                        onClick={() => setShowCreateModal(true)}
                        className="gap-2 hover:scale-105 shadow-xl shadow-primary/10 py-6 px-8 rounded-2xl font-black uppercase tracking-widest text-[10px]"
                    >
                        <Plus className="w-4 h-4" />
                        {tr('createInvoice')}
                    </Button>
                )}
            </header>

            {activeTab === 'invoices' && (
                <>
                    {/* Stats Overview */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow group">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-green-600 group-hover:scale-110 transition-transform">
                                    <CheckCircle2 className="w-5 h-5" />
                                </div>
                                <span className="hidden sm:inline-block text-[10px] font-black text-green-500 uppercase tracking-widest bg-green-50 px-2 py-0.5 rounded-full">{tr('paid')}</span>
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Bezahlt</p>
                            <div className="flex items-baseline gap-1">
                                <h3 className="text-xl sm:text-3xl font-black text-gray-900 tracking-tight">{money(paidAmount)}</h3>
                                
                            </div>
                        </div>

                        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow group">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 bg-yellow-50 rounded-xl flex items-center justify-center text-yellow-600 group-hover:scale-110 transition-transform">
                                    <Clock className="w-5 h-5" />
                                </div>
                                <span className="hidden sm:inline-block text-[10px] font-black text-yellow-500 uppercase tracking-widest bg-yellow-50 px-2 py-0.5 rounded-full">{tr('pending')}</span>
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Ausstehend</p>
                            <div className="flex items-baseline gap-1">
                                <h3 className="text-xl sm:text-3xl font-black text-gray-900 tracking-tight">{money(pendingAmount)}</h3>
                                
                            </div>
                        </div>

                        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow group">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-600 group-hover:scale-110 transition-transform">
                                    <AlertCircle className="w-5 h-5" />
                                </div>
                                <span className="hidden sm:inline-block text-[10px] font-black text-red-500 uppercase tracking-widest bg-red-50 px-2 py-0.5 rounded-full">{tr('overdue')}</span>
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Überfällig</p>
                            <div className="flex items-baseline gap-1">
                                <h3 className="text-xl sm:text-3xl font-black text-red-600 tracking-tight">{money(overdueAmount)}</h3>
                                
                            </div>
                        </div>

                        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow group">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-gray-600 group-hover:scale-110 transition-transform">
                                    <Receipt className="w-5 h-5" />
                                </div>
                                <span className="hidden sm:inline-block text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-0.5 rounded-full">{tr('volume')}</span>
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{tr('totalInvoices')}</p>
                            <div className="flex items-baseline gap-1">
                                <h3 className="text-xl sm:text-3xl font-black text-gray-900 tracking-tight">{typedInvoices.length}</h3>
                                <span className="text-[10px] sm:text-xs font-bold text-gray-400">{tr('count')}</span>
                            </div>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-3xl border border-gray-100 shadow-xl">
                        <div className="relative w-full md:w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder={tr('searchClientOrInvoice')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all"
                            />
                        </div>
                        <div className="flex p-1 bg-gray-50 rounded-2xl border border-gray-100 overflow-x-auto w-full md:w-auto no-scrollbar">
                            {statusFilters.map(filter => (
                                <button
                                    key={filter.value}
                                    onClick={() => setFilterStatus(filter.value)}
                                    className={`flex-1 sm:flex-none px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${filterStatus === filter.value
                                        ? 'bg-white text-primary shadow-sm'
                                        : 'text-gray-400 hover:text-gray-600'
                                        }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Invoices List */}
                    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-2xl overflow-hidden">
                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto custom-scrollbar">
                            <table className="w-full border-separate border-spacing-0">
                                <thead>
                                    <tr className="bg-gray-50/50">
                                        <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('invoice')}</th>
                                        <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('client')}</th>
                                        <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('amount')}</th>
                                        <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('status')}</th>
                                        <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('dueDate')}</th>
                                        <th className="px-6 py-5 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {filteredInvoices.length > 0 ? filteredInvoices.map((invoice) => (
                                        <tr key={invoice.id} className="group hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-primary/5 rounded-xl flex items-center justify-center text-primary font-black text-xs">
                                                        #{invoice.invoice_number.slice(-3)}
                                                    </div>
                                                    <span className="font-bold text-gray-900 text-sm tracking-tight">{invoice.invoice_number}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6 font-bold text-gray-600 text-sm">
                                                {invoice.student_name || invoice.band_name || 'Generic Client'}
                                            </td>
                                            <td className="px-6 py-6 font-black text-gray-900 text-sm">
                                                <span className={invoice.payment_status === 'paid' ? 'text-green-700' : invoice.payment_status === 'overdue' ? 'text-red-600' : 'text-amber-700'}>
                                                    {money(invoice.total_amount)}
                                                </span>
                                                {Number(invoice.payment_remaining) > 0 && Number(invoice.payment_remaining) !== Number(invoice.total_amount) && (
                                                    <div className="text-xs text-gray-400 mt-1">
                                                        Noch offen: {money(invoice.payment_remaining)}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-6">
                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${getStatusColor(invoice.payment_status)}`}>
                                                    {getStatusIcon(invoice.payment_status)}
                                                    {invoice.payment_status === 'pending' ? 'Ausstehend' : invoice.payment_status === 'paid' ? 'Bezahlt' : invoice.payment_status === 'overdue' ? 'Überfällig' : 'Storniert'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-6 font-bold text-gray-500 text-xs">
                                                {new Date(invoice.effective_due_date || invoice.due_date).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </td>
                                            <td className="px-6 py-6">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setViewingInvoice(invoice)}
                                                        className="hover:scale-110 active:scale-95"
                                                    >
                                                        <Eye className="w-4 h-4 text-gray-400" />
                                                    </Button>
                                                    {isAdmin && invoice.payment_status !== 'paid' && invoice.payment_status !== 'cancelled' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            title="Als bezahlt markieren"
                                                            onClick={() => handleMarkPaid(invoice)}
                                                            className="hover:scale-110 active:scale-95"
                                                        >
                                                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                                                        </Button>
                                                    )}
                                                    {isAdmin && invoice.payment_status === 'paid' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            title="Manuell verbuchte Zahlung zurücknehmen"
                                                            onClick={() => handleMarkPending(invoice)}
                                                            className="hover:scale-110 active:scale-95"
                                                        >
                                                            <Clock className="w-4 h-4 text-amber-600" />
                                                        </Button>
                                                    )}
                                                    {isAdmin && invoice.status !== 'cancelled' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleSendInvoice(invoice.id)}
                                                            title={invoice.email_sent ? 'Rechnung erneut per E-Mail versenden' : 'Rechnung per E-Mail senden'}
                                                            className="hover:scale-110 active:scale-95"
                                                        >
                                                            <Mail className="w-4 h-4 text-gray-400" />
                                                        </Button>
                                                    )}
                                                    {isAdmin && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDeleteInvoice(invoice.id)}
                                                            className="hover:scale-110 active:scale-95 text-red-400 hover:text-red-500 hover:bg-red-50"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                    {isAdmin && invoice.status !== 'draft' && invoice.status !== 'cancelled' && (
                                                        <Button variant="outline" size="icon"
                                                            title="Rechnung über Teilen-Menü versenden (z. B. WhatsApp)"
                                                            aria-label={'Rechnung ' + invoice.invoice_number + ' teilen'}
                                                            onClick={() => void handleShareInvoice(invoice)}>
                                                            <Share2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => handleDownloadInvoice(invoice)}
                                                        title="PDF-Rechnung herunterladen"
                                                        className="hover:scale-110 active:scale-95"
                                                    >
                                                        <Download className="w-4 h-4 text-gray-400" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    )) : null}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Card View */}
                        <div className="md:hidden divide-y divide-gray-50">
                            {filteredInvoices.length > 0 ? filteredInvoices.map((invoice) => (
                                <div key={invoice.id} className="p-4 space-y-4 hover:bg-gray-50/50 transition-colors">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-primary/5 rounded-xl flex items-center justify-center text-primary font-black text-xs">
                                                #{invoice.invoice_number.slice(-3)}
                                            </div>
                                            <div>
                                                <div className="font-black text-gray-900 text-sm tracking-tight">{invoice.invoice_number}</div>
                                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mt-1">
                                                    {new Date(invoice.effective_due_date || invoice.due_date).toLocaleDateString(locale)}
                                                </div>
                                            </div>
                                        </div>
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${getStatusColor(invoice.payment_status)}`}>
                                            {getStatusIcon(invoice.payment_status)}
                                            {invoice.payment_status === 'pending' ? 'Ausstehend' : invoice.payment_status === 'paid' ? 'Bezahlt' : invoice.payment_status === 'overdue' ? 'Überfällig' : 'Storniert'}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-bold text-gray-600">
                                            {invoice.student_name || invoice.band_name || 'Generic Client'}
                                        </div>
                                        <div className={`text-lg font-black ${invoice.payment_status === 'paid' ? 'text-green-700' : invoice.payment_status === 'overdue' ? 'text-red-600' : 'text-amber-700'}`}>
                                            {money(invoice.total_amount)}
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 pt-2">
                                        <Button
                                            variant="outline"
                                            onClick={() => handleDownloadInvoice(invoice)}
                                            className="flex-1 gap-2 py-5 rounded-2xl active:scale-95 font-black uppercase tracking-widest text-[10px]"
                                        >
                                            <Download className="w-4 h-4" />
                                            PDF-Rechnung
                                        </Button>
                                        <div className="flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setViewingInvoice(invoice)}
                                                className="w-11 h-11 rounded-2xl bg-gray-50 text-gray-400 active:scale-90"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </Button>
                                            {isAdmin && invoice.payment_status !== 'paid' && invoice.payment_status !== 'cancelled' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Als bezahlt markieren"
                                                    onClick={() => handleMarkPaid(invoice)}
                                                    className="w-11 h-11 rounded-2xl bg-green-50 text-green-600 active:scale-90"
                                                >
                                                    <CheckCircle2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {isAdmin && invoice.payment_status === 'paid' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Manuell verbuchte Zahlung zurücknehmen"
                                                    onClick={() => handleMarkPending(invoice)}
                                                    className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 active:scale-90"
                                                >
                                                    <Clock className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {isAdmin && invoice.status !== 'cancelled' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleSendInvoice(invoice.id)}
                                                    title={invoice.email_sent ? 'Rechnung erneut per E-Mail versenden' : 'Rechnung per E-Mail senden'}
                                                    className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-500 active:scale-90"
                                                >
                                                    <Mail className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {isAdmin && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDeleteInvoice(invoice.id)}
                                                    className="w-11 h-11 rounded-2xl bg-red-50 text-red-400 active:scale-90"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )) : null}
                        </div>

                        {filteredInvoices.length === 0 && (
                            <div className="px-6 py-20 text-center">
                                <div className="flex flex-col items-center">
                                    <div className="w-20 h-20 bg-gray-50 rounded-[2.5rem] flex items-center justify-center mb-6">
                                        <Receipt className="w-10 h-10 text-gray-200" />
                                    </div>
                                    <p className="text-sm font-black text-gray-400 uppercase tracking-widest">{tr('noInvoicesFound')}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {activeTab === 'subscriptions' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="flex flex-col md:flex-row gap-8">
                        {/* Subscriptions List (Left side for students, full width maybe for admins) */}
                        <div className="flex-1 space-y-6">
                            <h2 className="text-xl font-black text-gray-900 tracking-tight">{tr('yourSubscriptions')}</h2>
                            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                                {subscriptions?.length > 0 ? (
                                    <div className="divide-y divide-gray-50">
                                        {subscriptions.map((sub: any) => (
                                            <div key={sub.id} className="p-5 sm:p-6 hover:bg-gray-50/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                <div>
                                                    <h3 className="font-bold text-gray-900">{sub.plan_details?.name}</h3>
                                                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                                                        {isManager ? tr('studentName', {name: sub.student_name || ''}) : ''}
                                                        ({intervalLabels[sub.plan_details?.interval] || sub.plan_details?.interval})
                                                    </p>
                                                </div>
                                                <div className="flex items-center justify-between sm:justify-end gap-4">
                                                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${sub.status === 'active' ? 'bg-green-50 text-green-600 border-green-100' :
                                                        sub.status === 'past_due' ? 'bg-red-50 text-red-600 border-red-100' :
                                                            'bg-gray-50 text-gray-500 border-gray-100'
                                                        }`}>
                                                        {statusLabels[sub.status] || sub.status}
                                                    </span>
                                                    <span className="font-black text-gray-900">{money(sub.plan_details?.price)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-gray-400 font-bold text-sm">
                                        <Repeat className="w-8 h-8 mx-auto mb-3 opacity-20" />
                                        {tr('noActiveSubscriptions')}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Available Plans (Right side for students) */}
                        <div className="md:w-96 space-y-6">
                            <h2 className="text-xl font-black text-gray-900 tracking-tight">{tr('availablePlans')}</h2>
                            <div className="space-y-4">
                                {plans?.map((plan: any) => (
                                    <div key={plan.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform">
                                            <Repeat className="w-24 h-24" />
                                        </div>
                                        <div className="relative z-10 space-y-4">
                                            <div>
                                                <h3 className="font-black text-lg text-gray-900 mb-1">{plan.name}</h3>
                                                <div className="flex items-baseline gap-1">
                                                    <span className="text-3xl font-black tracking-tight">{money(plan.price)}</span>
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">/ {intervalLabels[plan.interval] || plan.interval}</span>
                                                </div>
                                                <p className="text-xs font-medium text-gray-500 mt-2">{plan.description || tr('subscriptionPlanDescription')}</p>
                                            </div>
                                            {!isManager && (
                                                <Button
                                                    onClick={async () => {
                                                        const tid = toast.loading(tr('messageStartingCheckout'));
                                                        try {
                                                            const res = await api.post(`/billing/create-subscription-checkout-session/${plan.id}/`);
                                                            if (res.data.url) window.location.href = res.data.url;
                                                            else toast.error(tr('messageCheckoutFailed'), { id: tid });
                                                        } catch (e) {
                                                            toast.error(tr('messageCouldNotInitiateCheckout'), { id: tid });
                                                        }
                                                    }}
                                                    className="w-full bg-gray-900 hover:bg-gray-800 py-6 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-gray-200"
                                                >
                                                    {tr('subscribeNow')}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {plans?.length === 0 && (
                                    <div className="p-8 text-center text-gray-400 font-bold text-sm bg-white rounded-[2rem] border border-dashed border-gray-200">
                                        {tr('noPlansAvailableRightNow')}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

            {/* Create Invoice Modal */}
            <Dialog
                open={showCreateModal}
                onOpenChange={setShowCreateModal}
                size="lg"
            >
                <DialogHeader title={tr('newInvoice')} />
                <DialogContent>
                    <form id="create-invoice-form" onSubmit={handleCreateInvoice} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('studentClient')}</label>
                                <select
                                    required
                                    value={newInvoice.student}
                                    onChange={(e) => handleInvoiceStudentChange(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all appearance-none"
                                >
                                    <option value="">{tr('selectStudent')}</option>
                                    {students.map(student => (
                                        <option key={student.id} value={student.id}>
                                            {student.user?.first_name} {student.user?.last_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('dueDate')}</label>
                                <input
                                    type="date"
                                    required
                                    value={newInvoice.dueDate}
                                    onChange={(e) => setNewInvoice({ ...newInvoice, dueDate: e.target.value })}
                                    className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="invoice-service-from" className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Leistungszeitraum von (Monat)</label>
                                <input
                                    id="invoice-service-from"
                                    type="month"
                                    value={newInvoice.serviceMonth}
                                    onChange={(e) => handleInvoicePeriodChange('serviceMonth', e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="invoice-service-to" className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Leistungszeitraum bis (optional)</label>
                                <input
                                    id="invoice-service-to"
                                    type="month"
                                    min={newInvoice.serviceMonth || undefined}
                                    value={newInvoice.serviceMonthTo}
                                    disabled={!newInvoice.serviceMonth}
                                    onChange={(e) => handleInvoicePeriodChange('serviceMonthTo', e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all disabled:opacity-50"
                                />
                            </div>
                            {newInvoice.serviceMonth && (
                                <p className="md:col-span-2 text-xs text-gray-500">
                                    {newInvoice.serviceMonthTo
                                        ? `${monthsInPeriod(newInvoice.serviceMonth, newInvoice.serviceMonthTo)} Monate – Betrag aus Monatsbeitrag × Anzahl der Monate`
                                        : 'Ein Monat – Feld „Bis“ bleibt leer.'}
                                    {' '}Der Rechnungsbetrag kann weiterhin manuell angepasst werden.
                                </p>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('lineItems')}</label>
                                <button
                                    type="button"
                                    onClick={addLineItem}
                                    className="text-[10px] font-black text-primary uppercase tracking-widest bg-primary/5 px-3 py-1 rounded-full hover:bg-primary/10 transition-colors"
                                >
                                    {tr('addItem')}
                                </button>
                            </div>

                            <div className="space-y-3">
                                {newInvoice.line_items.map((item, index) => (
                                    <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                                        <div className="md:col-span-6 space-y-1">
                                            <input
                                                type="text"
                                                required
                                                value={item.description}
                                                onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                                                className="w-full px-4 py-3 bg-white border border-gray-200 focus:border-primary rounded-xl font-bold text-sm text-gray-700 outline-none transition-all"
                                                placeholder={tr('itemDescription')}
                                            />
                                        </div>
                                        <div className="md:col-span-2 space-y-1">
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                value={item.quantity}
                                                onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                                                className="w-full px-4 py-3 bg-white border border-gray-200 focus:border-primary rounded-xl font-bold text-sm text-gray-700 outline-none transition-all"
                                                placeholder={tr('qty')}
                                            />
                                        </div>
                                        <div className="md:col-span-3 space-y-1">
                                            <input
                                                type="number"
                                                required
                                                step="0.01"
                                                value={item.unit_price}
                                                onChange={(e) => updateLineItem(index, 'unit_price', e.target.value)}
                                                className="w-full px-4 py-3 bg-white border border-gray-200 focus:border-primary rounded-xl font-bold text-sm text-gray-700 outline-none transition-all"
                                                placeholder={tr('price')}
                                            />
                                        </div>
                                        <div className="md:col-span-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={newInvoice.line_items.length <= 1}
                                                onClick={() => removeLineItem(index)}
                                                className="text-red-500 hover:text-red-600"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="pt-6 border-t border-gray-100 flex justify-between items-center">
                            <span className="text-xs font-black text-gray-400 uppercase tracking-widest">{tr('estimatedTotal')}</span>
                            <span className="text-3xl font-black text-gray-900 tracking-tight">{money(modalTotal)}</span>
                        </div>
                    </form>
                </DialogContent>
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => setShowCreateModal(false)}
                        className="flex-1"
                    >
                        {tr('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        form="create-invoice-form"
                        disabled={creating}
                        className="flex-[2] gap-2 active:scale-95 transition-transform"
                    >
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                        {creating ? tr('creating') : tr('issueInvoice')}
                    </Button>
                </DialogFooter>
            </Dialog>

            {/* View Invoice Modal */}
            <Dialog
                open={!!viewingInvoice}
                onOpenChange={(open) => !open && setViewingInvoice(null)}
                size="lg"
            >
                {viewingInvoice && (
                    <>
                        <DialogHeader title={tr('invoiceNumber', {number: viewingInvoice.invoice_number})} />
                        <DialogContent>
                            <div className="space-y-8 print:p-0">
                                {/* Invoice Header with Studio Branding */}
                                <div className="flex items-start gap-4 pb-6 border-b border-gray-100">
                                    <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                                        {studio?.logo ? (
                                            <img src={studio.logo} alt={tr('studioLogo')} className="w-full h-full object-cover" />
                                        ) : (
                                            <Receipt className="w-7 h-7 text-gray-300" />
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-black text-gray-900 text-lg leading-tight">{studio?.name || tr('studioInvoice')}</p>
                                        {(studio?.address_line1 || studio?.city) && (
                                            <p className="text-xs font-medium text-gray-400 mt-0.5">
                                                {[studio.address_line1, studio.city, studio.state].filter(Boolean).join(', ')}
                                            </p>
                                        )}
                                        {studio?.email && (
                                            <p className="text-xs font-medium text-gray-400">{studio.email}</p>
                                        )}
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('invoice')}</p>
                                        <p className="font-black text-gray-900 text-sm tracking-tight">#{viewingInvoice.invoice_number}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-8">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('billedTo')}</p>
                                        <p className="text-lg font-black text-gray-900 leading-tight">
                                            {viewingInvoice.recipient?.name || viewingInvoice.student_name || viewingInvoice.band_name || tr('genericClient')}
                                        </p>
                                        {viewingInvoice.recipient?.street && (
                                            <p className="text-xs text-gray-500">{viewingInvoice.recipient.street}</p>
                                        )}
                                        {(viewingInvoice.recipient?.postal_code || viewingInvoice.recipient?.city) && (
                                            <p className="text-xs text-gray-500">
                                                {[viewingInvoice.recipient?.postal_code, viewingInvoice.recipient?.city].filter(Boolean).join(' ')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right space-y-1">
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('dated')}</p>
                                        <p className="text-sm font-bold text-gray-900">
                                            {new Date(viewingInvoice.issue_date).toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })}
                                        </p>
                                    </div>
                                </div>

                                {viewingInvoice.student_name && (
                                    <p className="text-sm font-bold text-gray-800">
                                        {viewingInvoice.lesson_subject || 'Musikunterricht'} für {viewingInvoice.student_name}
                                    </p>
                                )}
                                <div className="border border-gray-100 rounded-[2rem] overflow-hidden shadow-sm">
                                    {/* Desktop Table */}
                                    <table className="hidden sm:table w-full text-left border-separate border-spacing-0">
                                        <thead className="bg-gray-50/50">
                                            <tr>
                                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('description')}</th>
                                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">{tr('qty')}</th>
                                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">{tr('price')}</th>
                                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">{tr('total')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {viewingInvoice.line_items?.map((item, idx) => (
                                                <tr key={idx}>
                                                    <td className="px-6 py-4 text-sm font-bold text-gray-700">{item.description}</td>
                                                    <td className="px-6 py-4 text-sm font-bold text-gray-500 text-center">{item.quantity}</td>
                                                    <td className="px-6 py-4 text-sm font-bold text-gray-500 text-right">{money(item.unit_price)}</td>
                                                    <td className="px-6 py-4 text-sm font-black text-gray-900 text-right">
                                                        {money(item.total_price || (item.quantity * Number(item.unit_price)))}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    {/* Mobile List view */}
                                    <div className="sm:hidden divide-y divide-gray-50">
                                        {viewingInvoice.line_items?.map((item, idx) => (
                                            <div key={idx} className="p-4 space-y-2">
                                                <div className="font-bold text-gray-900 text-sm leading-tight">{item.description}</div>
                                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
                                                    <span>{item.quantity} × {money(item.unit_price)}</span>
                                                    <span className="text-gray-900">{money(item.total_price || (item.quantity * Number(item.unit_price)))}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex justify-between items-center py-6 px-4 bg-gray-900 rounded-3xl text-white shadow-xl shadow-gray-200">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">{tr('totalBalanceDue')}</p>
                                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/10 border border-white/20`}>
                                            <span className={viewingInvoice.payment_status === 'paid' ? 'text-green-400' : viewingInvoice.payment_status === 'overdue' ? 'text-red-400' : 'text-yellow-400'}>
                                                {viewingInvoice.payment_status === 'pending' ? 'Ausstehend' : viewingInvoice.payment_status === 'paid' ? 'Bezahlt' : viewingInvoice.payment_status === 'overdue' ? 'Überfällig' : 'Storniert'}
                                            </span>
                                        </div>
                                        {viewingInvoice.stripe_transaction_id && (
                                            <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mt-1">
                                                Buchungsreferenz: {viewingInvoice.stripe_transaction_id.slice(0, 16)}...
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <span className="text-4xl font-black tracking-tight">{money(viewingInvoice.payment_remaining)}</span>
                                        
                                    </div>
                                </div>
                            </div>
                        </DialogContent>
                        <DialogFooter className="print:hidden">
                            {isAdmin && viewingInvoice.status !== 'draft' && viewingInvoice.status !== 'cancelled' && (
                                <Button variant="outline" onClick={() => void handleShareInvoice(viewingInvoice)}
                                    title="PDF im Teilen-Menü versenden (z. B. WhatsApp)">
                                    <Share2 className="w-4 h-4" /> Teilen
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                onClick={() => handleDownloadInvoice(viewingInvoice)}
                                className="flex-1 gap-2"
                            >
                                <Download className="w-4 h-4" />
                                {tr('downloadPDF')}
                            </Button>
                            {isAdmin && viewingInvoice.payment_status !== 'paid' && viewingInvoice.payment_status !== 'cancelled' && (
                                <Button
                                    onClick={() => handleMarkPaid(viewingInvoice)}
                                    className="flex-1 gap-2"
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    Als bezahlt markieren
                                </Button>
                            )}
                            {isAdmin && viewingInvoice.payment_status === 'paid' && (
                                <Button
                                    onClick={() => handleMarkPending(viewingInvoice)}
                                    variant="outline"
                                    className="flex-1 gap-2"
                                >
                                    <Clock className="w-4 h-4" />
                                    Zahlung zurücknehmen
                                </Button>
                            )}
                            {isAdmin && viewingInvoice.status !== 'cancelled' && (
                                <Button
                                    onClick={() => handleSendInvoice(viewingInvoice.id)}
                                    className="flex-1 gap-2"
                                >
                                    <Mail className="w-4 h-4" />
                                    {viewingInvoice.email_sent ? 'Erneut senden' : 'Rechnung senden'}
                                </Button>
                            )}
                        </DialogFooter>
                    </>
                )}
            </Dialog>
        </div >
    )
}

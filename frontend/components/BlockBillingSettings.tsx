'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'react-hot-toast'
import api from '@/services/api'

type Plan = { enabled: boolean; starts_on: string; units_per_block: number; block_amount: string; test_only: boolean }
type Status = { plan: Plan | null; open_units: number; unbilled_units: number; bills: { id: string; number: string; status: string; sent: boolean; error: string; attempted: boolean }[] }
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const defaults = (): Plan => ({ enabled: false, starts_on: localToday(), units_per_block: 4, block_amount: '', test_only: true })

export default function BlockBillingSettings({ studentId }: { studentId: string }) {
  const t = useTranslations('BlockBilling')
  const [data, setData] = useState<Status | null>(null)
  const [form, setForm] = useState<Plan>(defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const endpoint = '/students/' + encodeURIComponent(studentId) + '/block-billing/'
  const refresh = useCallback(async (hydrate = false) => {
    try {
      const { data: result } = await api.get<Status>(endpoint)
      setData(result)
      if (hydrate) setForm(result.plan || defaults())
      setError('')
    } catch { setError(t('loadFailed')) }
  }, [endpoint, t])
  useEffect(() => {
    void refresh(true)
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 30000)
    return () => window.clearInterval(timer)
  }, [refresh])
  function showError(err: any) {
    const response = err?.response?.data
    const message = typeof response?.detail === 'string' ? response.detail : response && typeof response === 'object' ? Object.values(response).flat().filter(x => typeof x === 'string').join(' ') : ''
    toast.error(message || t('saveFailed'))
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const { data: result } = await api.put<Status>(endpoint, { ...form, block_amount: form.block_amount.replace(',', '.') })
      setData(result)
      if (result.plan) setForm(result.plan)
      toast.success(t('saved'))
    } catch (err) { showError(err) } finally { setBusy(false) }
  }
  async function reset() {
    setBusy(true)
    try {
      const { data: result } = await api.post<Status>(endpoint, { action: 'reset' })
      setData(result)
      setConfirmReset(false)
      toast.success(t('resetDone'))
    } catch (err) { showError(err) } finally { setBusy(false) }
  }
  const field = 'w-full rounded-lg border border-input bg-background text-foreground px-3 py-2'
  return <div className="rounded-xl border border-border p-4 space-y-4">
    <h3 className="font-bold text-card-foreground">{t('heading')}</h3>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {!data ? <p className="text-sm text-muted-foreground">{t('loading')}</p> : <>
      <form onSubmit={save} className="space-y-3">
        <label className="block space-y-1 text-sm">{t('model')}
          <select className={field} value={form.enabled ? 'block' : 'monthly'} onChange={e => setForm(p => ({ ...p, enabled: e.target.value === 'block' }))}>
            <option value="monthly">{t('monthly')}</option><option value="block">{t('block')}</option>
          </select>
        </label>
        {(form.enabled || data.plan) && <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1 text-sm">{t('startsOn')}<input className={field} type="date" required value={form.starts_on} onChange={e => setForm(p => ({ ...p, starts_on: e.target.value }))}/></label>
            <label className="block space-y-1 text-sm">{t('units')}<input className={field} type="number" required min={1} max={100} value={form.units_per_block} onChange={e => setForm(p => ({ ...p, units_per_block: Number(e.target.value) }))}/></label>
            <label className="block space-y-1 text-sm">{t('amount')}<input className={field} required inputMode="decimal" value={form.block_amount} onChange={e => setForm(p => ({ ...p, block_amount: e.target.value }))}/></label>
          </div>
          <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={form.test_only} onChange={e => setForm(p => ({ ...p, test_only: e.target.checked }))}/>{t('testOnly')}</label>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground font-semibold disabled:opacity-50">{t('save')}</button>
        </>}
      </form>
      {data.plan?.enabled && <div className="border-t border-border pt-3 space-y-2">
        <p className="text-sm text-muted-foreground">{t('openUnits')}</p>
        <p className="text-2xl font-bold tabular-nums">{data.open_units} / {data.plan.units_per_block} UE</p>
        <p className="text-sm">{t('unbilledUnits', { count: data.unbilled_units })}</p>
        {data.bills.filter(b => b.status !== 'paid' || b.error).map(b => <div key={b.id} className="text-sm border border-border rounded-lg p-2">
          <div className="font-medium">{b.number} · {b.sent ? t('sent') : b.attempted ? t('checkDelivery') : t('draft')}</div>
          {b.error && <p className="text-red-600">{b.error}</p>}
        </div>)}
        {confirmReset ? <div className="space-y-2"><p className="text-sm">{t('resetWarning')}</p><div className="flex gap-2"><button type="button" disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-primary-foreground" onClick={reset}>{t('confirm')}</button><button type="button" onClick={() => setConfirmReset(false)} className="rounded-lg border px-3 py-2">{t('cancel')}</button></div></div> : <button type="button" disabled={busy || data.open_units === 0} onClick={() => setConfirmReset(true)} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">{t('reset')}</button>}
      </div>}
    </>}
  </div>
}

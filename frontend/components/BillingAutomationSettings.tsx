'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'react-hot-toast'
import api from '@/services/api'

type Config = {
  monthly_enabled: boolean; monthly_from: string | null; monthly_day: number; monthly_time: string; monthly_send: boolean
  test_enabled: boolean; test_at: string | null; test_month: string | null; test_send: boolean
}
type Run = { id: number; kind: string; service_month: string; scheduled_for: string; status: string; skipped: { student: string; code: string; name?: string }[]; error: string; items: { number: string; recipient: string; amount: string; state: string; error: string }[] }
type Payload = { settings: Config; runs: Run[] }
const endpoint = '/billing/invoices/automation/'
const dateLocal = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)
  const p = (type: string) => parts.find(part => part.type === type)?.value || ''
  return p('year') + '-' + p('month') + '-' + p('day') + 'T' + p('hour') + ':' + p('minute')
}
const displayDate = (value: string) => new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value))
const euro = (value: string) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value))
const defaults: Config = {
  monthly_enabled: false, monthly_from: '2027-01-01', monthly_day: 1, monthly_time: '08:00', monthly_send: true,
  test_enabled: false, test_at: null, test_month: '2026-12-01', test_send: true
}

export default function BillingAutomationSettings() {
  const t = useTranslations('BillingAutomation')
  const [form, setForm] = useState<Config>(defaults)
  const [testLocal, setTestLocal] = useState('2026-11-29T12:00')
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async (hydrate = false) => {
    try {
      const { data } = await api.get<Payload>(endpoint)
      setRuns(data.runs)
      if (hydrate) {
        setForm({ ...data.settings, monthly_from: data.settings.monthly_from || defaults.monthly_from, test_month: data.settings.test_month || defaults.test_month })
        if (data.settings.test_at) setTestLocal(dateLocal(data.settings.test_at))
      }
      setError('')
    } catch { setError(t('loadFailed')) } finally { setLoading(false) }
  }, [t])
  useEffect(() => {
    void refresh(true)
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 30000)
    return () => window.clearInterval(timer)
  }, [refresh])
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const { data } = await api.put<Payload>(endpoint, {
        ...form,
        monthly_time: form.monthly_time.slice(0, 5),
        test_at: testLocal ? testLocal + ':00' : null,
      })
      setForm(data.settings)
      if (data.settings.test_at) setTestLocal(dateLocal(data.settings.test_at))
      setRuns(data.runs)
      toast.success(t('saved'))
    } catch (err: any) {
      const response = err?.response?.data
      const details = response && typeof response === 'object' ? Object.values(response).flat().filter(x => typeof x === 'string').join(' ') : ''
      toast.error(details || t('saveFailed'))
    } finally { setBusy(false) }
  }
  const field = 'block w-full rounded-lg border border-input bg-background text-foreground px-3 py-2'
  const stateLabel = (value: string) => {
    const states = ['preparing', 'ready', 'finished', 'review', 'error', 'pending', 'attempted', 'sent', 'draft']
    return states.includes(value) ? t('state_' + value) : value
  }
  return <div className="space-y-6">
    <div><h3 className="text-lg font-semibold">{t('heading')}</h3><p className="text-sm text-muted-foreground">{t('hint')}</p></div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {loading ? <p>{t('loading')}</p> : <form className="space-y-5" onSubmit={save}>
      <section className="rounded-xl border border-border p-4 space-y-3">
        <h4 className="font-bold">{t('monthly')}</h4>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.monthly_enabled} onChange={e => setForm(p => ({ ...p, monthly_enabled: e.target.checked }))}/>{t('monthlyEnabled')}</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm space-y-1">{t('firstMonth')}<input type="month" required={form.monthly_enabled} className={field} value={form.monthly_from?.slice(0, 7) || ''} onChange={e => setForm(p => ({ ...p, monthly_from: e.target.value ? e.target.value + '-01' : null }))}/></label>
          <label className="text-sm space-y-1">{t('day')}<input type="number" min={1} max={28} required className={field} value={form.monthly_day} onChange={e => setForm(p => ({ ...p, monthly_day: Number(e.target.value) }))}/></label>
          <label className="text-sm space-y-1">{t('time')}<input type="time" required className={field} value={form.monthly_time.slice(0, 5)} onChange={e => setForm(p => ({ ...p, monthly_time: e.target.value }))}/></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.monthly_send} onChange={e => setForm(p => ({ ...p, monthly_send: e.target.checked }))}/>{t('autoSend')}</label>
        {form.monthly_enabled && <p className="text-sm text-amber-700">{t('liveWarning')}</p>}
      </section>
      <section className="rounded-xl border border-border p-4 space-y-3">
        <h4 className="font-bold">{t('test')}</h4>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.test_enabled} onChange={e => setForm(p => ({ ...p, test_enabled: e.target.checked }))}/>{t('testEnabled')}</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">{t('testAt')}<input type="datetime-local" required={form.test_enabled} className={field} value={testLocal} onChange={e => setTestLocal(e.target.value)}/></label>
          <label className="text-sm space-y-1">{t('serviceMonth')}<input type="month" required={form.test_enabled} className={field} value={form.test_month?.slice(0, 7) || ''} onChange={e => setForm(p => ({ ...p, test_month: e.target.value ? e.target.value + '-01' : null }))}/></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.test_send} onChange={e => setForm(p => ({ ...p, test_send: e.target.checked }))}/>{t('testSend')}</label>
        <p className="text-sm text-muted-foreground">{t('testHint')}</p>
      </section>
      <p className="text-sm text-muted-foreground">{t('blockHint')}</p>
      <button type="submit" disabled={busy || !!error} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground font-semibold disabled:opacity-50">{t('save')}</button>
    </form>}
    <section className="space-y-3">
      <div className="flex justify-between items-center"><h4 className="font-bold">{t('history')}</h4><button type="button" className="text-sm border rounded-lg px-3 py-1" onClick={() => void refresh(true)}>{t('refresh')}</button></div>
      {!runs.length && <p className="text-sm text-muted-foreground">{t('noRuns')}</p>}
      {runs.map(run => <div key={run.id} className="rounded-xl border border-border p-3 space-y-2">
        <div className="font-semibold text-sm">{run.kind === 'test' ? t('test') : t('monthly')} · {displayDate(run.scheduled_for)} · {run.service_month.slice(0,7)} · {stateLabel(run.status)}</div>
        {run.error && <p className="text-sm text-red-600">{run.error}</p>}
        {run.skipped.length > 0 && <div className="text-sm text-muted-foreground">{t('skipped', { count: run.skipped.length })}: {run.skipped.map(s => (s.name || s.student) + ' (' + (s.code === 'already_billed' ? t('alreadyBilled') : s.code === 'partial_start' ? t('partialStart') : s.code) + ')').join(', ')}</div>}
        {run.items.map(item => <div key={item.number} className="border-t border-border pt-2 text-sm">
          <div className="flex flex-wrap justify-between gap-1"><span>{item.number} · {item.recipient || '–'}</span><span>{euro(item.amount)} · {stateLabel(item.state)}</span></div>
          {item.error && <p className="text-red-600">{item.error}</p>}
        </div>)}
      </div>)}
    </section>
  </div>
}

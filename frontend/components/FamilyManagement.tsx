'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Users, Save, ArrowLeft, Loader2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { Button } from '@/components/ui/button'

type Contact = { name: string; relation: string; email: string; phone: string }
type Member = { id: string; name: string; instrument: string; monthly_amount?: string | null; is_active?: boolean }
type Family = {
    id: string; name: string; display_name: string; address_line1: string; postal_code: string; city: string;
    address: string; ha_zone_entity_id: string; contacts: Contact[]; billing_recipient_name: string;
    billing_email: string; payment_method: string; students: Member[]
}
type Draft = Pick<Family, 'name' | 'address_line1' | 'postal_code' | 'city' | 'ha_zone_entity_id' | 'contacts' | 'billing_recipient_name' | 'billing_email' | 'payment_method'>
const empty: Draft = { name: '', address_line1: '', postal_code: '', city: '', ha_zone_entity_id: '', contacts: [], billing_recipient_name: '', billing_email: '', payment_method: 'bank_transfer' }
const toDraft = (f: Family): Draft => ({ name: f.name || f.display_name, address_line1: f.address_line1, postal_code: f.postal_code, city: f.city, ha_zone_entity_id: f.ha_zone_entity_id, contacts: f.contacts || [], billing_recipient_name: f.billing_recipient_name, billing_email: f.billing_email, payment_method: f.payment_method })
const money = (value: number) => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900'
const err = (e: any) => {
    const data = e?.response?.data
    if (typeof data?.detail === 'string') return data.detail
    if (data && typeof data === 'object') return Object.values(data).flat().map(String).join(' ')
    return 'Änderung konnte nicht gespeichert werden.'
}

export default function FamilyManagement() {
    const router = useRouter()
    const [families, setFamilies] = useState<Family[]>([])
    const [selected, setSelected] = useState<Family | null>(null)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [tab, setTab] = useState('overview')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [available, setAvailable] = useState<Member[]>([])
    const [memberIds, setMemberIds] = useState<string[]>([])
    const [search, setSearch] = useState('')
    const [memberLoading, setMemberLoading] = useState(false)
    const [memberError, setMemberError] = useState(false)
    const [loadError, setLoadError] = useState(false)

    const load = async () => {
        setLoading(true); setLoadError(false)
        try { const { data } = await api.get('/students/families/'); setFamilies(data.results || data) }
        catch { setLoadError(true); toast.error('Familien konnten nicht geladen werden.') }
        finally { setLoading(false) }
    }
    useEffect(() => { void load() }, [])
    useEffect(() => {
        if (!selected || tab !== 'members') return
        let live = true
        setAvailable([]); setMemberLoading(true); setMemberError(false)
        api.get('/students/families/' + selected.id + '/available-students/')
            .then(({ data }) => { if (live) setAvailable(data) })
            .catch(() => { if (live) { setMemberError(true); toast.error('Schüler konnten nicht geladen werden.') } })
            .finally(() => { if (live) setMemberLoading(false) })
        return () => { live = false }
    }, [selected?.id, tab])
    const open = (f: Family) => { setSelected(f); setDraft(toDraft(f)); setMemberIds(f.students.map(s => s.id)); setTab('overview') }
    const create = () => { setSelected(null); setDraft({ ...empty, contacts: [] }); setMemberIds([]); setTab('overview') }
    const change = (key: keyof Draft, value: any) => setDraft(old => old ? { ...old, [key]: value } : old)
    const save = async () => {
        if (!draft || !draft.name.trim()) { toast.error('Bitte einen Familiennamen eingeben.'); return }
        setSaving(true)
        try {
            const response = selected ? await api.patch('/students/families/' + selected.id + '/', draft) : await api.post('/students/families/', draft)
            const f: Family = response.data
            setFamilies(old => [...old.filter(x => x.id !== f.id), f].sort((a,b) => a.display_name.localeCompare(b.display_name,'de')))
            setSelected(f); setDraft(toDraft(f)); setMemberIds(f.students.map(s => s.id))
            toast.success('Familie gespeichert.')
        } catch (e) { toast.error(err(e)) } finally { setSaving(false) }
    }
    const saveMembers = async () => {
        if (!selected) return
        setSaving(true)
        try {
            const { data: f } = await api.put('/students/families/' + selected.id + '/members/', { student_ids: memberIds })
            setSelected(f); setFamilies(old => old.map(x => x.id === f.id ? f : x))
            setMemberIds(f.students.map((s: Member) => s.id))
            const { data } = await api.get('/students/families/' + f.id + '/available-students/')
            setAvailable(data); toast.success('Familienzuordnung gespeichert.')
        } catch (e) { toast.error(err(e)) } finally { setSaving(false) }
    }
    const field = (label: string, key: keyof Draft, type = 'text') => <label className="block space-y-1"><span className="text-sm font-semibold text-gray-700">{label}</span><input type={type} className={inputClass} value={String(draft?.[key] ?? '')} onChange={e => change(key,e.target.value)} /></label>

    if (loading) return <div className="p-8 flex gap-3 text-gray-500"><Loader2 className="animate-spin" /> Familien werden geladen…</div>
    if (loadError) return <div className="p-8"><p>Familien konnten nicht geladen werden.</p><Button onClick={() => void load()}>Erneut versuchen</Button></div>
    if (!draft) return <section className="space-y-5">
        <div className="flex flex-wrap justify-between items-center gap-3"><div><h2 className="text-2xl font-bold">Familien</h2><p className="text-sm text-gray-500">Gemeinsame Kontaktdaten und Schülerzuordnungen verwalten.</p></div><Button onClick={create}><Plus className="w-4 h-4 mr-2"/>Familie anlegen</Button></div>
        <input className={inputClass} placeholder="Familie oder Schüler suchen…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {families.filter(f => (f.display_name + ' ' + f.students.map(s=>s.name).join(' ')).toLowerCase().includes(search.toLowerCase())).map(f =>
                <button key={f.id} onClick={()=>open(f)} className="text-left rounded-2xl bg-white border border-gray-200 p-5 space-y-3 hover:border-primary">
                    <div className="flex gap-3 items-center"><Users className="w-6 h-6 text-primary"/><div><strong>{f.display_name}</strong><p className="text-sm text-gray-500">{f.students.length} Schüler</p></div></div>
                    <p className="text-sm text-gray-600">{f.students.map(s=>s.name).join(', ') || 'Noch keine Schüler zugeordnet'}</p>
                    <p className="text-sm">{f.ha_zone_entity_id || 'Keine HA-Zone hinterlegt'}</p>
                    <p className="font-semibold">{money(f.students.filter(s=>s.is_active).reduce((sum,s)=>sum+Number(s.monthly_amount||0),0))} / Monat (hinterlegte Verträge)</p>
                </button>)}
        </div>
        {!families.length && <p className="text-gray-500">Noch keine Familien angelegt.</p>}
    </section>
    const tabs = [['overview','Übersicht'],['members','Familienmitglieder'],['contacts','Ansprechpartner'],['billing','Rechnungsdaten'],['accounts','Abrechnung'],['communication','Kommunikation']]
    const choices = [...new Map([...(selected?.students || []),...available].map(s=>[s.id,s])).values()]
    return <section className="space-y-5">
        <button className="flex items-center gap-2 text-sm text-gray-600" onClick={()=>{setDraft(null);setSelected(null)}}><ArrowLeft className="w-4 h-4"/>Zurück zu Familien</button>
        <h2 className="text-2xl font-bold">{selected?.display_name || 'Familie anlegen'}</h2>
        <nav className="flex flex-wrap gap-2 border-b border-gray-200" aria-label="Familienprofil">{tabs.map(([id,label])=><button key={id} disabled={!selected && id!=='overview'} onClick={()=>setTab(id)} className={'px-3 py-2 text-sm font-semibold border-b-2 '+(tab===id?'border-primary text-primary':'border-transparent text-gray-500')+' disabled:opacity-40'}>{label}</button>)}</nav>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
            {tab==='overview' && <><div className="grid gap-4 md:grid-cols-2">{field('Familienname','name')}{field('Straße und Hausnummer','address_line1')}{field('Postleitzahl','postal_code')}{field('Ort','city')}{field('HA-Zonen-ID (z. B. zone.familie_mueller)','ha_zone_entity_id')}</div>{selected?.address && <p className="text-sm text-gray-500">Bisherige Anschrift: {selected.address}</p>}<p className="text-sm text-gray-500">Die HA-Zone wird zunächst gespeichert. Die automatische Familienprüfung folgt im nächsten Schritt.</p></>}
            {tab==='members' && <><p className="text-sm text-gray-600">Bestehende Schüler ausdrücklich zuordnen. Verträge und Kontingente bleiben unverändert.</p>{memberLoading ? <Loader2 className="animate-spin"/> : memberError ? <p>Schülerliste konnte nicht geladen werden.</p> : <div className="space-y-2">{choices.map(s=><div key={s.id} className="flex items-center justify-between gap-3 p-3 border rounded-lg"><label className="flex gap-3 items-center"><input type="checkbox" checked={memberIds.includes(s.id)} onChange={e=>setMemberIds(old=>e.target.checked?[...old,s.id]:old.filter(x=>x!==s.id))}/><span>{s.name} <small className="text-gray-500">{s.instrument}</small></span></label><Link className="text-sm text-primary" href={'/dashboard/students/'+s.id}>Profil</Link></div>)}{!choices.length && <p className="text-sm text-gray-500">Keine verfügbaren Schüler.</p>}</div>}<div className="flex flex-wrap gap-3"><Button disabled={saving||memberLoading||memberError} onClick={()=>void saveMembers()}>Zuordnung speichern</Button><Button variant="outline" onClick={()=>router.push('/dashboard/students/add')}>Neuen Schüler anlegen</Button></div></>}
            {tab==='contacts' && <>{draft.contacts.map((contact,i)=><div key={i} className="border rounded-lg p-4 grid gap-3 md:grid-cols-2"><div className="flex justify-between md:col-span-2"><strong>Ansprechpartner {i+1}</strong><button aria-label="Ansprechpartner entfernen" onClick={()=>change('contacts',draft.contacts.filter((_,j)=>i!==j))}><X className="w-4 h-4"/></button></div>{([['name','Name'],['relation','Beziehung zum Schüler'],['email','E-Mail'],['phone','Telefon']] as const).map(([k,label])=><label key={k} className="space-y-1 text-sm"><span>{label}</span><input className={inputClass} type={k==='email'?'email':'text'} value={contact[k]} onChange={e=>change('contacts',draft.contacts.map((x,j)=>i===j?{...x,[k]:e.target.value}:x))}/></label>)}</div>)}<Button variant="outline" onClick={()=>change('contacts',[...draft.contacts,{name:'',relation:'',email:'',phone:''}])}><Plus className="w-4 h-4 mr-2"/>Ansprechpartner hinzufügen</Button></>}
            {tab==='billing' && <><div className="grid md:grid-cols-2 gap-4">{field('Rechnungsempfänger','billing_recipient_name')}{field('Rechnungs-E-Mail','billing_email','email')}<label className="space-y-1 text-sm font-semibold">Zahlungsart<select className={inputClass} value={draft.payment_method} onChange={e=>change('payment_method',e.target.value)}><option value="bank_transfer">Banküberweisung</option><option value="paypal">PayPal</option><option value="cash">Barzahlung</option></select></label></div><p className="text-sm text-gray-500">Gemeinsame Rechnungsanschrift: Familienanschrift. Sammelrechnungen werden erst in der nächsten Abrechnungs-Ausbaustufe aktiviert.</p></>}
            {tab==='accounts' && <><p className="text-sm text-gray-500">Sammelabrechnung noch nicht aktiv. Die bestehenden Einzelrechnungen bleiben unverändert.</p>{selected?.students.map(s=><div key={s.id} className="flex justify-between border-b py-2"><Link href={'/dashboard/students/'+s.id}>{s.name}</Link><span>{s.monthly_amount ? money(Number(s.monthly_amount)) : 'Kein Vertrag'}</span></div>)}</>}
            {tab==='communication' && <p className="text-sm text-gray-500">Die familienbezogene Mailzuordnung folgt in einer späteren Ausbaustufe. Bestehender Schriftverkehr bleibt bei den Schülern verfügbar.</p>}
            {['overview','contacts','billing'].includes(tab) && <Button disabled={saving} onClick={()=>void save()}><Save className="w-4 h-4 mr-2"/>Speichern</Button>}
        </div>
    </section>
}

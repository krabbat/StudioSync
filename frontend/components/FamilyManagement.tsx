'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import FamilyBillingPanel from '@/components/FamilyBillingPanel'
import FamilyCommunicationPanel from '@/components/FamilyCommunicationPanel'
import FamilyAccessPanel from '@/components/FamilyAccessPanel'
import { Plus, Users, Save, ArrowLeft, Loader2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { fetchAllLibraryPages } from '@/lib/materialLibrary.mjs'

type AddressStudent = { id:string; name:string; address_line1:string; postal_code:string; city:string }
type Contact = { name: string; first_name?: string; last_name?: string; relation: string; email: string; phone: string }
type BillingImport = {recipient_name:string;recipient_email:string;payment_method:string}
type GuardianSource = {id:string;name:string;billing:BillingImport}
type ImportSource = { id:string; name:string; person?:Contact; contacts:Contact[]; billing:BillingImport|null; guardian_sources?:GuardianSource[] }
type Member = { id: string; user_id: string; birth_date?:string|null; name: string; instrument: string; monthly_amount?: string | null; is_active?: boolean }
type Family = {
    id: string; name: string; display_name: string; address_line1: string; postal_code: string; city: string;
    address: string; ha_zone_entity_id: string; contacts: Contact[]; billing_recipient_name: string;
    billing_email: string; payment_method: string; individual_billing: boolean; students: Member[]
}
type Draft = Pick<Family, 'name' | 'address_line1' | 'postal_code' | 'city' | 'ha_zone_entity_id' | 'contacts' | 'billing_recipient_name' | 'billing_email' | 'payment_method' | 'individual_billing'>
const empty: Draft = { name: '', address_line1: '', postal_code: '', city: '', ha_zone_entity_id: '', contacts: [], billing_recipient_name: '', billing_email: '', payment_method: 'bank_transfer', individual_billing: false }
const toDraft = (f: Family): Draft => ({ name: f.name || f.display_name, address_line1: f.address_line1, postal_code: f.postal_code, city: f.city, ha_zone_entity_id: f.ha_zone_entity_id, contacts: (f.contacts || []).map(c=>({...c,first_name:c.first_name??(c.name.includes(' ')?c.name.split(' ')[0]:''),last_name:c.last_name??(c.name.includes(' ')?c.name.substring(c.name.indexOf(' ')+1):c.name)})), billing_recipient_name: f.billing_recipient_name, billing_email: f.billing_email, payment_method: f.payment_method, individual_billing: f.individual_billing ?? false })
const money = (value: number) => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900'
const err = (e: any) => {
    const data = e?.response?.data
    if (typeof data?.detail === 'string') return data.detail
    if (data && typeof data === 'object') {
        const labels: Record<string,string> = {name:'Familienname', primary_parent:'Elternkonto', secondary_parent:'Zweites Elternkonto', ha_zone_entity_id:'HA-Zone', address_line1:'Straße', postal_code:'Postleitzahl', city:'Ort', billing_email:'Rechnungs-E-Mail', contacts:'Ansprechpartner', non_field_errors:'Formular'}
        return Object.entries(data).map(([key,value]) => (labels[key] || key) + ': ' + [value].flat().map(v=>v === 'This field is required.' ? 'Pflichtfeld.' : String(v)).join(' ')).join(' · ')
    }
    return 'Änderung konnte nicht gespeichert werden.'
}

export default function FamilyManagement() {
    const router = useRouter()
    const billingT = useTranslations('FamilyBilling')
    const accessT = useTranslations('FamilyAccess')
    const contactT = useTranslations('FamilyContactImport')
    const [families, setFamilies] = useState<Family[]>([])
    const [selected, setSelected] = useState<Family | null>(null)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [tab, setTab] = useState('overview')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [available, setAvailable] = useState<Member[]>([])
    const [memberIds, setMemberIds] = useState<string[]>([])
    const [memberDropdown, setMemberDropdown] = useState(false)
    const [memberSearch, setMemberSearch] = useState('')
    const [importSources, setImportSources] = useState<ImportSource[]>([])
    const [importId, setImportId] = useState('')
    const billingSources = importSources.flatMap(s => [
        {id:s.id, name:s.name, billing:s.billing, guardian:false},
        ...(s.guardian_sources || []).map(g => ({...g, name:g.name+' (Ansprechpartner: '+s.name+')', guardian:true})),
    ])
    const [importLoading, setImportLoading] = useState(false)
    const [importError, setImportError] = useState(false)
    useEffect(() => {
        if (!selected || !['contacts','billing'].includes(tab)) return
        let live = true
        setImportSources([]); setImportId(''); setImportLoading(true); setImportError(false)
        api.get('/students/families/'+selected.id+'/member-data/')
            .then(({data})=>{if(live){setImportSources(data);if(data.length===1)setImportId(data[0].id)}})
            .catch(()=>{if(live)setImportError(true)})
            .finally(()=>{if(live)setImportLoading(false)})
        return ()=>{live=false}
    },[selected?.id,tab])
    const importContactData = (ownPerson=false) => {
        const source=importSources.find(s=>s.id===importId)
        const incoming=ownPerson?(source?.person?[source.person]:[]):(source?.contacts||[])
        if(!incoming.length)return
        setDraft(old=>{
            if(!old)return old
            const contacts=[...old.contacts]
            for(const contact of incoming){
                const i=contacts.findIndex(c=>c.name.trim().toLowerCase()===contact.name.trim().toLowerCase())
                if(i<0)contacts.push(contact)
                else contacts[i]={...contacts[i],phone:contacts[i].phone||contact.phone,email:contacts[i].email||contact.email,relation:contacts[i].relation||contact.relation}
            }
            return {...old,contacts}
        })
        toast.success(contactT('imported'))
    }
    const importBillingData = () => {
        const selectedSource=billingSources.find(s=>s.id===importId)
        const b=selectedSource?.billing
        if(!selectedSource||!b)return
        setDraft(old=>old?{...old,billing_recipient_name:b.recipient_name||old.billing_recipient_name,billing_email:selectedSource.guardian?b.recipient_email:(b.recipient_email||old.billing_email),payment_method:selectedSource.guardian?old.payment_method:(b.payment_method||old.payment_method)}:old)
        toast.success(selectedSource.guardian&&!b.recipient_email?'Name übernommen. Bitte Rechnungs-E-Mail ergänzen und speichern.':'Rechnungsdaten übernommen. Bitte speichern.')
    }
    const [search, setSearch] = useState('')
    const [memberLoading, setMemberLoading] = useState(false)
    const [memberError, setMemberError] = useState(false)
    const [loadError, setLoadError] = useState(false)
    const [addressStudents, setAddressStudents] = useState<AddressStudent[]>([])
    const [addressSource, setAddressSource] = useState('')
    const [addressLoading, setAddressLoading] = useState(false)
    const [addressError, setAddressError] = useState(false)
    useEffect(() => {
        if (!draft || tab !== 'overview') return
        let live = true
        setAddressLoading(true); setAddressError(false)
        fetchAllLibraryPages(async (page:number) => (await api.get('/students/', {params:{page}})).data)
            .then((rows:AddressStudent[]) => { if(live) setAddressStudents(rows.filter(s=>s.address_line1 || s.postal_code || s.city)) })
            .catch(()=>{if(live) setAddressError(true)})
            .finally(()=>{if(live) setAddressLoading(false)})
        return ()=>{live=false}
    }, [Boolean(draft), tab])
    const copyAddress = () => {
        const s = addressStudents.find(x=>x.id===addressSource)
        if (!s) return
        setDraft(old=>old ? {...old,address_line1:s.address_line1||'',postal_code:s.postal_code||'',city:s.city||''}:old)
        toast.success('Schüleranschrift übernommen.')
    }

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
    const open = (f: Family) => { setMemberDropdown(false); setMemberSearch(''); setAddressSource(''); setSelected(f); setDraft(toDraft(f)); setMemberIds(f.students.map(s => s.id)); setTab('overview') }
    const create = () => { setMemberDropdown(false); setMemberSearch(''); setAddressSource(''); setSelected(null); setDraft({ ...empty, contacts: [] }); setMemberIds([]); setTab('overview') }
    const change = (key: keyof Draft, value: any) => setDraft(old => old ? { ...old, [key]: value } : old)
    const save = async () => {
        if (!draft || !draft.name.trim()) { toast.error('Bitte einen Familiennamen eingeben.'); return }
        setSaving(true)
        try {
            const payload = {...draft, ha_zone_entity_id: draft.ha_zone_entity_id.trim()}
            const response = selected ? await api.patch('/students/families/' + selected.id + '/', payload) : await api.post('/students/families/', payload)
            const f: Family = response.data
            setFamilies(old => [...old.filter(x => x.id !== f.id), f].sort((a,b) => a.display_name.localeCompare(b.display_name,'de')))
            setSelected(f); setDraft(toDraft(f)); setMemberIds(f.students.map(s => s.id))
            toast.success('Familie gespeichert.')
        } catch (e) { toast.error(err(e)) } finally { setSaving(false) }
    }
    const archive = async () => {
        if(!selected||!window.confirm(accessT('confirmArchive',{name:selected.display_name})))return
        setSaving(true)
        try{await api.post('/students/families/'+selected.id+'/archive/');setSelected(null);setDraft(null);await load();toast.success(accessT('archived'))}
        catch{toast.error(accessT('error.generic'))}finally{setSaving(false)}
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
    const field = (label: string, key: keyof Draft, type = 'text') => <label className="block space-y-1"><span className="text-sm font-semibold text-gray-700">{label}</span><input type={type==='email'?'text':type} inputMode={type==='email'?'email':undefined} className={inputClass} value={String(draft?.[key] ?? '')} onChange={e => change(key,e.target.value)} /></label>

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
    const tabs = [['overview','Übersicht'],['members','Familienmitglieder'],['contacts','Ansprechpartner'],['billing','Rechnungsdaten'],['accounts','Abrechnung'],['communication','Kommunikation'],['access',accessT('title')]]
    const choices = [...new Map([...(selected?.students || []),...available].map(s=>[s.id,s])).values()]
    const chosen=choices.filter(s=>memberIds.includes(s.id))
    const source=importSources.find(s=>s.id===importId)
    const billingSource=billingSources.find(s=>s.id===importId)
    const importPanel=(kind:'contacts'|'billing')=><div className="min-w-0 space-y-2">
        <label className="block text-sm font-semibold" htmlFor="family-import-source">Daten eines Familienmitglieds übernehmen</label>
        <div className="flex flex-wrap gap-2">
            <select id="family-import-source" className={inputClass+' min-w-0 flex-1'} value={importId} disabled={importLoading||importError} onChange={e=>setImportId(e.target.value)}>
                <option value="">{importLoading?'Schüler werden geladen…':'Schüler auswählen'}</option>
                {(kind==='billing'?billingSources:importSources).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {kind==='contacts'?<Button variant="outline" disabled={saving||importLoading||!source?.person} onClick={()=>importContactData(true)}>{contactT('importPerson')}</Button>:<Button variant="outline" disabled={saving||importLoading||!billingSource?.billing} onClick={importBillingData}>Daten übernehmen</Button>}
        </div>
        {importError&&<p className="text-sm text-red-600">Schülerdaten konnten nicht geladen werden.</p>}
        {!importLoading&&!importError&&!importSources.length&&<p className="text-sm text-gray-500">Bitte zuerst Familienmitglieder zuordnen und speichern.</p>}
        {kind==='contacts'&&source&&source.contacts.length>0&&<Button variant="outline" disabled={saving||importLoading} onClick={()=>importContactData(false)}>{contactT('importEmergency')}</Button>}
        {kind==='billing'&&billingSource&&!billingSource.billing&&<p className="text-sm text-gray-500">Bei diesem Schüler sind keine entsprechenden Daten hinterlegt.</p>}
        {kind==='billing'&&billingSource?.guardian&&!billingSource.billing?.recipient_email&&<p className="text-sm text-gray-500">Bei diesem Ansprechpartner ist keine E-Mail hinterlegt. Bitte nach der Übernahme ergänzen.</p>}
        <p className="text-xs text-gray-500">{kind==='contacts'?contactT('hint'):'Übernimmt Rechnungsempfänger und Rechnungs-E-Mail; beim Schüler auch die Zahlungsart. Die Familienanschrift bleibt unverändert.'}</p>
    </div>
    return <section className="space-y-5">
        <button className="flex items-center gap-2 text-sm text-gray-600" onClick={()=>{setDraft(null);setSelected(null)}}><ArrowLeft className="w-4 h-4"/>Zurück zu Familien</button>
        <h2 className="text-2xl font-bold">{selected?.display_name || 'Familie anlegen'}</h2>
        <nav className="flex flex-wrap gap-2 border-b border-gray-200" aria-label="Familienprofil">{tabs.map(([id,label])=><button key={id} disabled={!selected && id!=='overview'} onClick={()=>setTab(id)} className={'px-3 py-2 text-sm font-semibold border-b-2 '+(tab===id?'border-primary text-primary':'border-transparent text-gray-500')+' disabled:opacity-40'}>{label}</button>)}</nav>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
            {tab==='overview' && <>
                <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
                    <div className="grid gap-4 sm:grid-cols-2">
                        {field('Familienname','name')}
                        {field('Straße und Hausnummer','address_line1')}
                    </div>
                    <div className="min-w-0 space-y-1">
                        <label className="block text-sm font-semibold text-gray-700" htmlFor="family-address-source">Anschrift eines Schülers übernehmen</label>
                        <div className="flex flex-wrap items-center gap-2">
                            <select id="family-address-source" className={inputClass+' min-w-0 flex-1'} value={addressSource} disabled={addressLoading||addressError} onChange={e=>setAddressSource(e.target.value)}>
                                <option value="">{addressLoading?'Schüler werden geladen…':'Schüler auswählen'}</option>
                                {addressStudents.map(s=><option key={s.id} value={s.id}>{s.name} – {s.address_line1}, {s.postal_code} {s.city}</option>)}
                            </select>
                            <Button variant="outline" disabled={!addressSource||addressLoading||addressError} onClick={copyAddress}>Übernehmen</Button>
                        </div>
                        {addressError && <p className="text-sm text-red-600">Schüleranschriften konnten nicht geladen werden.</p>}
                    </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,3fr)] items-start">
                    {field('Postleitzahl','postal_code')}
                    {field('Ort','city')}
                    <div className="sm:col-span-2 lg:col-span-1 lg:ml-6 lg:pl-6 lg:border-l lg:border-gray-200">
                        {field('HA-Zonenname','ha_zone_entity_id')}
                    </div>
                </div>
                {selected?.address && <p className="text-sm text-gray-500">Bisherige Anschrift: {selected.address}</p>}
                <p className="text-sm text-gray-500">Die HA-Zone wird zunächst gespeichert. Die automatische Familienprüfung folgt im nächsten Schritt.</p>
            </>}
            {tab==='members' && <><h3 className="text-base font-semibold">Zugeordnete Schüler ({memberIds.length})</h3>
                {memberLoading ? <Loader2 className="animate-spin"/> : memberError ? <p>Schülerliste konnte nicht geladen werden.</p> : <>
                    <div className="space-y-2">{chosen.map(s=><div key={s.id} className="flex items-center justify-between gap-3 p-3 border rounded-lg"><span>{s.name} <small className="ml-3 text-gray-500">{s.instrument}</small></span><div className="flex items-center gap-4"><Link className="text-sm text-primary" href={'/dashboard/students/'+s.id}>Profil</Link><button aria-label={s.name+' entfernen'} onClick={()=>setMemberIds(old=>old.filter(x=>x!==s.id))}><X className="w-4 h-4"/></button></div></div>)}{!chosen.length&&<p className="text-sm text-gray-500">Noch keine Schüler ausgewählt.</p>}</div>
                    <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-gray-200">
                    <div className="relative w-full sm:max-w-md">
                        <button type="button" aria-expanded={memberDropdown} onClick={()=>setMemberDropdown(v=>!v)} className={inputClass+' flex justify-between items-center text-left'}><span>Schüler auswählen ({memberIds.length})</span><span aria-hidden="true">⌄</span></button>
                        {memberDropdown&&<div className="absolute z-20 bottom-full mb-1 w-full rounded-xl border bg-white shadow-lg p-3 space-y-2">
                            <input className={inputClass} placeholder="Schüler suchen…" value={memberSearch} onChange={e=>setMemberSearch(e.target.value)}/>
                            <div className="max-h-64 overflow-y-auto space-y-1">
                                {choices.filter(s=>s.name.toLowerCase().includes(memberSearch.toLowerCase())).map(s=><label key={s.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg"><input type="checkbox" checked={memberIds.includes(s.id)} onChange={e=>setMemberIds(old=>e.target.checked?[...old,s.id]:old.filter(x=>x!==s.id))}/><span>{s.name} <small className="text-gray-500">{s.instrument}</small></span></label>)}
                            </div>
                            <Button variant="outline" onClick={()=>setMemberDropdown(false)}>Auswahl übernehmen</Button>
                        </div>}
                    </div>
                    <Button variant="outline" onClick={()=>router.push('/dashboard/students/add?family='+selected?.id)}>Neuen Schüler anlegen</Button>
                    </div>
                </>}
                <div className="flex flex-wrap gap-3"><Button disabled={saving||memberLoading||memberError} onClick={()=>{setMemberDropdown(false);void saveMembers()}}>Zuordnung speichern</Button></div></>}
            {tab==='contacts' && <>{!draft.contacts.length&&<p className="text-sm text-gray-500">Noch keine Ansprechpartner hinterlegt.</p>}{draft.contacts.map((contact,i)=><div key={i} className="border rounded-lg p-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><div className="flex justify-between sm:col-span-2 xl:col-span-6"><strong>Ansprechpartner {i+1}</strong><button aria-label="Ansprechpartner entfernen" onClick={()=>change('contacts',draft.contacts.filter((_,j)=>i!==j))}><X className="w-4 h-4"/></button></div>{([['first_name','Vorname'],['last_name','Nachname'],['relation','Beziehung zum Schüler'],['email','E-Mail'],['phone','Telefon']] as const).map(([k,label])=><label key={k} className={'space-y-1 text-sm min-w-0 '+(k==='email'?'xl:col-span-3':k==='phone'?'xl:col-span-3':'xl:col-span-2')}><span>{label}</span><input className={inputClass} type="text" inputMode={k==='email'?'email':undefined} value={contact[k]} onChange={e=>change('contacts',draft.contacts.map((x,j)=>i===j?{...x,[k]:e.target.value,...(k==='first_name'||k==='last_name'?{name:[k==='first_name'?e.target.value:x.first_name,k==='last_name'?e.target.value:x.last_name].filter(Boolean).join(' ')}:{})}:x))}/></label>)}</div>)}<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end border-t border-gray-200 pt-4"><div><Button variant="outline" onClick={()=>change('contacts',[...draft.contacts,{name:'',first_name:'',last_name:'',relation:'',email:'',phone:''}])}><Plus className="w-4 h-4 mr-2"/>Ansprechpartner hinzufügen</Button></div>{importPanel('contacts')}</div></>}
            {tab==='billing' && <><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{field('Rechnungsempfänger','billing_recipient_name')}{field('Rechnungs-E-Mail','billing_email','email')}<label className="space-y-1 text-sm font-semibold">Zahlungsart<select className={inputClass} value={draft.payment_method} onChange={e=>change('payment_method',e.target.value)}><option value="bank_transfer">Banküberweisung</option><option value="paypal">PayPal</option><option value="cash">Barzahlung</option></select></label></div><p className="text-sm text-gray-500">{billingT('addressHint')}</p><label className="flex gap-3 items-start text-sm"><input type="checkbox" className="mt-1" checked={draft.individual_billing} onChange={e=>change('individual_billing',e.target.checked)}/><span><strong>{billingT('individual')}</strong><span className="block text-gray-500">{billingT('individualHint')}</span></span></label><div className="border-t border-gray-200 pt-4 flex justify-end"><div className="w-full lg:max-w-xl">{importPanel('billing')}</div></div></>}
            {tab==='accounts' && selected && <FamilyBillingPanel key={selected.id} familyId={selected.id} individualBilling={selected.individual_billing} members={selected.students}/>}
            {tab==='access' && selected && <FamilyAccessPanel key={selected.id} familyId={selected.id} members={selected.students} contacts={selected.contacts||[]}/>}
            {tab==='communication' && selected && <FamilyCommunicationPanel key={selected.id} familyId={selected.id} members={selected.students} contacts={selected.contacts || []}/>}
            {tab==='overview'&&selected&&<div className="border-t pt-4"><Button variant="outline" disabled={saving} onClick={()=>void archive()}>{accessT('archive')}</Button></div>}
            {['overview','contacts','billing'].includes(tab) && <Button disabled={saving} onClick={()=>void save()}><Save className="w-4 h-4 mr-2"/>Speichern</Button>}
        </div>
    </section>
}

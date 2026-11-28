'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { fetchAllLibraryPages } from '@/lib/materialLibrary.mjs'

type Member = {id:string;name:string;monthly_amount?:string|null;is_active?:boolean}
type Invoice = {id:string;family?:string|null;invoice_number:string;student_name:string;service_month:string|null;total_amount:string;payment_remaining:string;payment_status:string;email_sent:boolean;status:string;line_items:{id:string;student_name_snapshot:string;description:string;total_price:string;student?:string|null;allocated_paid:string}[]}

export default function FamilyBillingPanel({familyId,individualBilling,members}:{familyId:string;individualBilling:boolean;members:Member[]}) {
    const t=useTranslations('FamilyBilling')
    const locale=useLocale()
    const money=(v:string|number)=>Number(v).toLocaleString(locale,{style:'currency',currency:'EUR'})
    const [invoices,setInvoices]=useState<Invoice[]>([])
    const [month,setMonth]=useState(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')})
    const [paymentId,setPaymentId]=useState('')
    const [allocations,setAllocations]=useState<Record<string,string>>({})
    const [method,setMethod]=useState('bank_transfer')
    const [busy,setBusy]=useState(false)
    const [loading,setLoading]=useState(true)
    const [failed,setFailed]=useState(false)
    const [skipped,setSkipped]=useState<{student:string;code:string}[]>([])
    const [deliveryErrors,setDeliveryErrors]=useState<Record<string,string>>({})
    const load=useCallback(async()=>{
        setLoading(true);setFailed(false)
        try {
            const rows=await fetchAllLibraryPages(async(page:number)=>(await api.get('/billing/invoices/',{params:{family:familyId,page}})).data)
            setInvoices(rows)
        } catch {setFailed(true)} finally {setLoading(false)}
    },[familyId])
    useEffect(()=>{void load()},[load])
    const generate=async()=>{
        if(!/^\d{4}-\d{2}$/.test(month))return
        setBusy(true)
        try {
            const {data}=await api.post('/billing/invoices/generate-month/',{family:familyId,month:month+'-01',send_now:true})
            setSkipped(data.skipped||[])
            const rows: (Invoice & {email_error?:string})[] = data.invoices || []
            const sent=rows.filter(i=>i.email_sent).length
            const unsent=rows.filter(i=>!i.email_sent)
            setDeliveryErrors(old=>({...old,...Object.fromEntries(unsent.map(i=>[i.id,i.email_error||t('deliveryUnknown')]))}))
            if(unsent.length) toast.error(t('generationDeliveryError',{sent,failed:unsent.length}),{duration:7500})
            else if(sent) toast.success(t('generatedSent',{count:sent}))
            else toast.success(t('nothingGenerated'))
            await load()
        } catch (e:any) {toast.error(e?.response?.data?.detail||t('generationError'))} finally {setBusy(false)}
    }
    const action=async(id:string,kind:'send'|'mark-paid'|'mark-pending')=>{
        if(!window.confirm(t(kind==='send'?'confirmSend':kind==='mark-paid'?'confirmPaid':'confirmPending')))return
        setBusy(true)
        try {
            const {data}=await api.post('/billing/invoices/'+id+'/'+kind+'/')
            if(kind==='send') {
                setDeliveryErrors(old=>{const next={...old};delete next[id];return next})
                toast.success(data.detail||t('sent'))
            } else toast.success(t('saved'))
            await load()
        } catch (e:any) {
            const detail=e?.response?.data?.detail
            const message=typeof detail==='string'?detail:t('actionError')
            if(kind==='send')setDeliveryErrors(old=>({...old,[id]:message}))
            toast.error(message)
        } finally {setBusy(false)}
    }
    const book=async(i:Invoice)=>{
        if(!window.confirm(t('confirmPartial')))return
        const values=Object.fromEntries(Object.entries(allocations).filter(([,v])=>Number(v)>0))
        if(!Object.keys(values).length)return
        setBusy(true)
        try {await api.post('/billing/invoices/'+i.id+'/book-payment/',{allocations:values,payment_method:method});setPaymentId('');setAllocations({});await load();toast.success(t('saved'))}
        catch{toast.error(t('actionError'))}finally{setBusy(false)}
    }
    const discard=async(i:Invoice)=>{
        if(!window.confirm(t('confirmDiscard')))return
        setBusy(true)
        try{await api.delete('/billing/invoices/'+i.id+'/');await load();toast.success(t('saved'))}
        catch{toast.error(t('actionError'))}finally{setBusy(false)}
    }
    const pdf=async(i:Invoice)=>{
        try {
            const {data}=await api.get('/billing/invoices/'+i.id+'/pdf/',{responseType:'blob'})
            const url=URL.createObjectURL(data)
            const link=document.createElement('a');link.href=url;link.download=i.invoice_number+'.pdf';link.click()
            setTimeout(()=>URL.revokeObjectURL(url),1000)
        } catch {toast.error(t('actionError'))}
    }
    const total=members.filter(s=>s.is_active).reduce((sum,s)=>sum+Number(s.monthly_amount||0),0)
    return <section className="space-y-5">
        <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{t('monthlyTotal')}</h3><p className="text-2xl font-bold">{money(total)}</p></div><p className="text-sm text-gray-500">{t(individualBilling?'individual':'collective')}</p></div>
        <div className="divide-y">{members.map(s=><div key={s.id} className="flex justify-between py-2"><Link href={'/dashboard/students/'+s.id}>{s.name}</Link><span>{s.monthly_amount?money(s.monthly_amount):t('noContract')}</span></div>)}</div>
        <h3 className="font-semibold">{t('invoices')}</h3>
        {loading?<p>{t('loading')}</p>:failed?<div><p>{t('loadError')}</p><Button variant="outline" onClick={()=>void load()}>{t('retry')}</Button></div>:!invoices.length?<p className="text-sm text-gray-500">{t('empty')}</p>:invoices.map(i=><div key={i.id} className="border rounded-lg p-3 space-y-2">
            <div className="flex flex-wrap justify-between gap-3"><strong>{i.invoice_number} · {i.student_name}</strong><span>{i.service_month?.slice(0,7)} · {money(i.total_amount)}</span></div>
            {i.line_items.map(l=><div key={l.id} className="flex justify-between text-sm text-gray-600"><span>{l.description}</span><span>{money(l.total_price)}{l.student&&<small className="block text-right">{t('positionPaid',{amount:money(l.allocated_paid)})}</small>}</span></div>)}
            <p className="text-sm">{t('outstanding')}: {money(i.payment_remaining)} · {t(i.payment_status==='paid'?'paid':i.payment_status==='cancelled'?'cancelled':i.payment_status==='overdue'?'overdue':'pending')}</p>
            <p className="text-sm">{i.email_sent?t('sent'):t('notSent')}</p>
            {deliveryErrors[i.id]&&<p role="alert" className="text-sm text-red-700">{deliveryErrors[i.id]}</p>}
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={()=>void pdf(i)}>PDF</Button>
                {i.status!=='cancelled'&&<Button variant="outline" disabled={busy} onClick={()=>void action(i.id,'send')}>{t(i.email_sent?'resend':'send')}</Button>}
                {i.status!=='cancelled'&&i.payment_status!=='paid'&&<Button variant="outline" disabled={busy} onClick={()=>void action(i.id,'mark-paid')}>{t('markPaid')}</Button>}
                {i.line_items.some(l=>l.student)&&i.status!=='cancelled'&&i.payment_status!=='paid'&&<Button variant="outline" disabled={busy} onClick={()=>{setPaymentId(i.id);setAllocations({})}}>{t('partialPayment')}</Button>}
                {i.status==='draft'&&!i.email_sent&&Number(i.payment_remaining)===Number(i.total_amount)&&<Button variant="outline" disabled={busy} onClick={()=>void discard(i)}>{t('discard')}</Button>}
                {i.payment_status==='paid'&&<Button variant="outline" disabled={busy} onClick={()=>void action(i.id,'mark-pending')}>{t('markPending')}</Button>}
            </div>
            {paymentId===i.id&&<div className="border-t pt-3 space-y-2">
                {i.line_items.filter(l=>l.student&&Number(l.total_price)>Number(l.allocated_paid)).map(l=><label key={l.id} className="flex flex-wrap items-center gap-3 text-sm"><span>{l.description} · {t('paymentAmount')}</span><input type="number" min="0" max={Number(l.total_price)-Number(l.allocated_paid)} step="0.01" className="border rounded-lg p-2 w-28" value={allocations[l.id]||''} onChange={e=>setAllocations(old=>({...old,[l.id]:e.target.value}))}/></label>)}
                <label className="text-sm">{t('paymentMethod')}<select className="ml-2 border rounded p-2" value={method} onChange={e=>setMethod(e.target.value)}>{['bank_transfer','paypal','cash'].map(m=><option key={m} value={m}>{t(m)}</option>)}</select></label>
                <Button disabled={busy} onClick={()=>void book(i)}>{t('book')}</Button>
            </div>}
        </div>)}
        <div className="border-t pt-4 space-y-2">
            <div className="flex flex-wrap items-end gap-3"><label className="text-sm space-y-1"><span>{t('month')}</span><input type="month" className="block rounded-lg border px-3 py-2" value={month} onChange={e=>setMonth(e.target.value)}/></label><Button disabled={busy||loading||!month} onClick={()=>void generate()}>{t('generate')}</Button></div>
            <p className="text-xs text-gray-500">{t('generateHint')}</p>
            {skipped.map(s=><p key={s.student} className="text-sm">{members.find(m=>m.id===s.student)?.name||s.student}: {t(s.code==='partial_start'?'partialStart':'alreadyBilled')}</p>)}
        </div>
    </section>
}

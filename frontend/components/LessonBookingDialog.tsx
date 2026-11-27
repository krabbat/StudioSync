"use client";

import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useUser } from "@/contexts/UserContext";
import api from "@/services/api";
import LessonAttendancePanel from "@/components/LessonAttendancePanel";
import { Clock, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";

export interface LessonBookingData {
  student: string;
  teacher: string;
  band: string;
  group_source?: 'family' | 'group';
  group_id?: string;
  group_name?: string;
  group_ha_zone?: string;
  participant_ids?: string[];
  participant_names?: {id:string;name:string}[];
  participant_statuses?: Record<string,string>;
  room: string;
  date: string;
  time: string;
  duration: number;
  lesson_type: string;
  is_online: boolean;
  online_meeting_url: string;
  status: string;
  statusTouched?: boolean;
  cancellation_reason: string;
  cancellation_kind: "" | "student_cancelled" | "teacher_cancelled";
  summary: string;
  guest_name: string;
  guest_address: string;
  recurrence: "none" | "weekly" | "biweekly" | "monthly";
  recurrence_until: string;
}

export type LessonBookingMode = "individual" | "band" | "event" | "special";

interface LessonBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingLessonId: string | null;
  newBooking: LessonBookingData;
  setNewBooking: Dispatch<SetStateAction<LessonBookingData>>;
  bookingMode: LessonBookingMode;
  setBookingMode: Dispatch<SetStateAction<LessonBookingMode>>;
  bookingLoading: boolean;
  deletingLessonId: string | null;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onDelete: (id: string) => void;
  students: any[];
  teachers: any[];
  bands: any[];
  preferredTeacherId: string;
  use24Hour?: boolean;
}

// Shared, canonical booking form for Schedule and Unterricht & Planung.
export default function LessonBookingDialog({
  open, onOpenChange, editingLessonId, newBooking, setNewBooking,
  bookingMode, setBookingMode, bookingLoading, deletingLessonId,
  onSubmit: handleBooking, onDelete, students, teachers, bands,
  preferredTeacherId, use24Hour = true,
}: LessonBookingDialogProps) {
  const { currentUser } = useUser();
  const tr = useTranslations("Schedule");
  const groupT = useTranslations("TeachingGroups");
  const [groupChoices,setGroupChoices]=useState<{id:string;name:string;members:{id:string;name:string;is_active?:boolean}[];address?:string}[]>([]);
  const [groupLoading,setGroupLoading]=useState(false);
  const [groupError,setGroupError]=useState(false);
  const [zones,setZones]=useState<string[]>([]);
  const [zonesFailed,setZonesFailed]=useState(false);
  useEffect(()=>{
    if(!open||bookingMode!=="band"||newBooking.group_source!=="group"||currentUser?.role!=="admin")return;
    let active=true;setZonesFailed(false);
    api.get("/core/home-assistant/connection/").then(({data})=>{if(active){setZones((data.zones||[]).map((z:{name:string})=>z.name).filter((n:string,i:number,a:string[])=>a.indexOf(n)===i));setZonesFailed(!data.connected)}}).catch(()=>{if(active)setZonesFailed(true)});
    return()=>{active=false};
  },[open,bookingMode,newBooking.group_source,currentUser?.role]);
  const teacherManuallyChanged = useRef(false);
  const durationManuallyChanged = useRef(false);

  // The same teacher and contract-based default durations in both views.
  useEffect(() => {
    if (!open) {
      teacherManuallyChanged.current = false;
      durationManuallyChanged.current = false;
    } else if (!editingLessonId && preferredTeacherId && !teacherManuallyChanged.current) {
      setNewBooking(prev => prev.teacher ? prev : { ...prev, teacher: preferredTeacherId });
    }
  }, [open, editingLessonId, preferredTeacherId, setNewBooking]);

  useEffect(() => {
    if (!open || editingLessonId || bookingMode !== "individual" || !newBooking.student) return;
    let active = true;
    const studentId = newBooking.student;
    void api.get<{ contract: { lesson_minutes: number } | null }>(
      "/students/" + encodeURIComponent(studentId) + "/contract/"
    ).then(({ data }) => {
      if (!active || durationManuallyChanged.current) return;
      const minutes = data.contract?.lesson_minutes;
      if (minutes === 30 || minutes === 45 || minutes === 60) {
        setNewBooking(prev => prev.student === studentId ? { ...prev, duration: minutes } : prev);
      }
    }).catch(() => { /* No contract: retain the duration selected in the form. */ });
    return () => { active = false };
  }, [open, editingLessonId, bookingMode, newBooking.student, setNewBooking]);

  useEffect(()=>{
    if(!open || bookingMode!=="band" || currentUser?.role!=="admin")return;
    let alive=true;
    setGroupLoading(true);setGroupError(false);setGroupChoices([]);
    const family=newBooking.group_source!=="group";
    api.get(family?'/students/families/':'/students/groups/').then(({data})=>{
      if(alive)setGroupChoices(data.map((g:any)=>({id:g.id,name:family?g.display_name:g.name,members:family?g.students:g.members,address:family?[g.address_line1,[g.postal_code,g.city].filter(Boolean).join(' ')].filter(Boolean).join(', '):''})));
    }).catch(()=>{if(alive)setGroupError(true)}).finally(()=>{if(alive)setGroupLoading(false)});
    return()=>{alive=false};
  },[open,bookingMode,currentUser?.role,newBooking.group_source]);
  const groupChoice=groupChoices.find(g=>g.id===newBooking.group_id);
  const selectedParticipants=newBooking.participant_ids||[];
  const groupMembers=editingLessonId&&newBooking.participant_names
    ? [...newBooking.participant_names,...(newBooking.group_source==='group'?[]:(groupChoice?.members||[]).filter(m=>m.is_active!==false&&!newBooking.participant_names?.some(p=>p.id===m.id)))]
    : (groupChoice?.members||[]).filter(m=>m.is_active!==false);
  const historicalGroup=Boolean(editingLessonId&&newBooking.group_id&&newBooking.status!=="scheduled"&&newBooking.status!=="in_progress");
  const bookingStudent = students.find((student: any) => student.id === newBooking.student);
  const cityLine = [bookingStudent?.postal_code, bookingStudent?.city].filter(Boolean).join(" ");
  const bookingAddress = bookingMode==="band"&&newBooking.group_id ? groupChoice?.address||"" : [bookingStudent?.address_line1, cityLine].filter(Boolean).join(", ");

  const timeOptions = Array.from({ length: (22 - 13) * 4 }, (_, i) => {
    const hour = 13 + Math.floor(i / 4);
    return `${String(hour).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
  });
  const formatTime = (timeStr: string) => {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":").map(Number);
    const value = new Date();
    value.setHours(h, m, 0, 0);
    return format(value, use24Hour ? "HH:mm" : "h:mm a");
  };

  return (
<Dialog
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
      >
        <DialogHeader title={editingLessonId ? tr('editBooking') : tr('newBooking')} />
        <DialogContent>
          <form id="booking-form" onSubmit={handleBooking} noValidate className="space-y-6">
            {/* Booking Mode Selector */}
            <div className="flex p-1 bg-gray-50 rounded-2xl border border-gray-100 mb-2">
              {(["individual", "band", "event", "special"] as const)
                .filter((mode) => (mode !== "special" || ['admin', 'teacher'].includes(currentUser?.role || '')) && (mode!=="band" || currentUser?.role==="admin" || (editingLessonId&&newBooking.band)))
                .map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  disabled={Boolean(editingLessonId&&newBooking.group_id&&mode!=="band")}
                  onClick={() => {
                    setBookingMode(mode);
                    if (mode === "band")
                      setNewBooking((prev) => ({ ...prev, lesson_type: "group",student:"",band:editingLessonId?prev.band:"",group_source:prev.group_source||"family",recurrence:"none" }));
                    if (mode === "individual")
                      setNewBooking((prev) => ({ ...prev, lesson_type: "private" }));
                    if (mode === "event")
                      setNewBooking((prev) => ({ ...prev, lesson_type: "workshop" }));
                    if (mode === "special")
                      setNewBooking((prev) => ({
                        ...prev, lesson_type: "private", student: "", band: "", room: "", recurrence: "none",
                      }));
                  }}
                  variant={bookingMode === mode ? "default" : "ghost"}
                  size="sm"
                  className={`flex-1 text-[10px] uppercase tracking-widest ${bookingMode !== mode ? "text-gray-400" : ""}`}
                  style={
                    bookingMode === mode
                      ? {
                        backgroundColor: "var(--color-primary-dark)",
                        color: "white",
                      }
                      : undefined
                  }
                >
                  {mode === "individual" ? tr("modeIndividual") : mode === "band" ? groupT("groupLesson") : mode === "special" ? "Sondertermin" : tr("modeEvent")}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {currentUser?.role !== "student" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      {tr("instructor")}{" "}
                      <span className="normal-case font-medium text-gray-400">{tr('optional')}</span>
                    </label>
                    <select
                      value={newBooking.teacher}
                      onChange={(e) => {
                       teacherManuallyChanged.current = true;
                       setNewBooking({ ...newBooking, teacher: e.target.value });
                     }}
                      className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                    >
                      <option value="">
                        {teachers.length === 0 ? "No instructors found" : "Select Instructor..."}
                      </option>
                      {teachers.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.first_name} {t.last_name}
                        </option>
                      ))}
                    </select>
                    {teachers.length === 0 && (
                      <p className="text-xs text-amber-600 font-medium">
                        {tr('addInstructorsInTheTeachersSectionFirst')}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      {bookingMode === "band"
                        ? groupT("source")
                        : bookingMode === "special" ? "Name"
                        : bookingMode === "individual"
                          ? tr("student")
                          : tr("targetOptional")}
                    </label>

                    {bookingMode === "special" ? (
                      <input
                        type="text"
                        required
                        placeholder="Vorname und Nachname"
                        value={newBooking.guest_name}
                        onChange={(e) => setNewBooking({ ...newBooking, guest_name: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700"
                      />
                    ) : bookingMode === "band" ? (
                      <div className="space-y-3">
                        {editingLessonId&&newBooking.band&&!newBooking.group_id ? <p className="text-sm text-gray-600">{bands.find(b=>b.id===newBooking.band)?.name||groupT('legacy')}</p> : <>
                          <div className="flex gap-3">
                            {(['family','group'] as const).map(source=><label key={source} className="flex items-center gap-2 text-sm"><input type="radio" name="group-source" disabled={Boolean(editingLessonId&&newBooking.group_id)} checked={(newBooking.group_source||'family')===source} onChange={()=>setNewBooking(prev=>({...prev,group_source:source,group_id:'',group_name:'',group_ha_zone:'',participant_ids:[],participant_names:undefined,participant_statuses:{},band:'',student:''}))}/>{groupT(source==='family'?'family':'group')}</label>)}
                          </div>
                          <select disabled={Boolean(editingLessonId&&newBooking.group_id)||groupLoading} value={newBooking.group_id||''} className="w-full rounded-xl border px-3 py-3" onChange={e=>{
                            const choice=groupChoices.find(g=>g.id===e.target.value);
                            const active=(choice?.members||[]).filter(m=>m.is_active!==false);
                            setNewBooking(prev=>({...prev,group_id:e.target.value,group_name:choice?.name||'',group_ha_zone:'',participant_ids:prev.group_source==='group'?active.map(m=>m.id):[],participant_names:undefined,participant_statuses:{},band:'',student:''}));
                          }}>
                            <option value="">{groupT(groupLoading?'loading':'choose')}</option>
                            {newBooking.group_id&&!groupChoice&&<option value={newBooking.group_id}>{newBooking.group_name||newBooking.group_id}</option>}
                            {groupChoices.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                          {newBooking.group_source==='group'&&newBooking.group_id&&!newBooking.is_online&&<label className="block text-sm">{groupT('haZone')}<select className="block w-full rounded-lg border p-2" value={newBooking.group_ha_zone||''} onChange={e=>setNewBooking(prev=>({...prev,group_ha_zone:e.target.value}))}><option value="">{groupT('chooseZone')}</option>{newBooking.group_ha_zone&&!zones.includes(newBooking.group_ha_zone)&&<option>{newBooking.group_ha_zone}</option>}{zones.map(zone=><option key={zone} value={zone}>{zone}</option>)}</select>{zonesFailed&&<span className="text-xs text-amber-700">{groupT('zonesUnavailable')}</span>}</label>}
                          {groupError&&<p className="text-sm text-red-600">{groupT('loadError')}</p>}
                          {newBooking.group_id&&<fieldset className="space-y-2 border rounded-lg p-3"><legend className="text-sm font-medium">{groupT('participants')}</legend>
                            {groupMembers.map(member=><label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedParticipants.includes(member.id)} disabled={newBooking.group_source==='group'||historicalGroup} onChange={e=>setNewBooking(prev=>({...prev,participant_ids:e.target.checked?[...(prev.participant_ids||[]),member.id]:(prev.participant_ids||[]).filter(id=>id!==member.id)}))}/>{member.name}</label>)}
                            <p className="text-xs text-gray-500">{groupT('participantCount',{count:selectedParticipants.length})}</p>
                          </fieldset>}
                        </>}
                      </div>
                    ) : bookingMode === "individual" ? (
                      <select
                        required
                        value={newBooking.student}
                        onChange={(e) => {
                           durationManuallyChanged.current = false;
                           const nextStudent = students.find((s: any) => s.id === e.target.value);
                           const oldStudent = students.find((s: any) => s.id === newBooking.student);
                           const previousInstrument = oldStudent?.instrument || "";
                           const keepNotes = newBooking.summary.trim() && newBooking.summary !== previousInstrument;
                           setNewBooking({ ...newBooking, student: e.target.value,
                             band: "", duration: 60,
                             summary: keepNotes ? newBooking.summary : nextStudent?.instrument || "",
                           });
                         }}
                        className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                      >
                        <option value="">{tr('selectStudent')}</option>
                        {students.map((s: any) => (
                          <option key={s.id} value={s.id}>
                            {s.name || s.user?.email || "Student"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={newBooking.student || newBooking.band}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) {
                            setNewBooking({ ...newBooking, student: "", band: "" });
                          } else if (students.find((s) => s.id === val)) {
                            durationManuallyChanged.current = false;
                             setNewBooking({ ...newBooking, student: val, band: "", duration: 60 });
                          } else {
                            setNewBooking({ ...newBooking, band: val, student: "" });
                          }
                        }}
                        className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                      >
                        <option value="">{groupT('noSpecificStudent')}</option>
                        <optgroup label="Students">
                          {students.map((s: any) => (
                            <option key={s.id} value={s.id}>
                              {s.name || s.user?.email}
                            </option>
                          ))}
                        </optgroup>
                        {editingLessonId&&newBooking.band&&<optgroup label={groupT("legacy")}>
                          {bands.filter(b=>b.id===newBooking.band).map((b: any) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </optgroup>}
                      </select>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                    Instructor{" "}
                    <span className="normal-case font-medium text-gray-400">{tr('optional')}</span>
                  </label>
                  <select
                    value={newBooking.teacher}
                    onChange={(e) => {
                       teacherManuallyChanged.current = true;
                       setNewBooking({ ...newBooking, teacher: e.target.value });
                     }}
                    className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                  >
                    <option value="">
                      {teachers.length === 0 ? "No instructors found" : "Select Instructor..."}
                    </option>
                    {teachers.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.first_name} {t.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  {tr('teachingAddress')}
                </label>
                {bookingMode === "special" ? (
                  <input
                    type="text"
                    placeholder="Straße, Hausnummer, PLZ, Ort"
                    value={newBooking.guest_address}
                    onChange={(e) => setNewBooking({ ...newBooking, guest_address: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary rounded-xl font-medium text-gray-700"
                  />
                ) : (
                  <div className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-gray-700 min-h-[48px]">
                    {bookingAddress || tr('addressMissing')}
                  </div>
                )}
                <label className="flex gap-2 items-center text-sm font-medium text-gray-600">
                  <input type="checkbox" checked={newBooking.is_online}
                    onChange={(e) => setNewBooking({ ...newBooking, is_online: e.target.checked })} />
                  {tr('onlineLesson')}
                </label>
              </div>
            </div>

            {newBooking.is_online && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  {tr('onlineMeetingLinkPlatform')}
                </label>
                <input
                  type="text"
                  placeholder={tr('zoomGoogleMeetOrMeetingURL')}
                  value={newBooking.online_meeting_url}
                  onChange={(e) =>
                    setNewBooking({ ...newBooking, online_meeting_url: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  {tr('date')}
                </label>
                <input
                  type="date"
                  required
                  value={newBooking.date}
                  onChange={(e) => setNewBooking({ ...newBooking, date: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  {tr('time')}
                </label>
                <div className="relative">
                  <select
                    required
                    value={newBooking.time}
                    onChange={(e) => setNewBooking({ ...newBooking, time: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                  >
                    {editingLessonId && newBooking.time && !timeOptions.includes(newBooking.time) && (
                      <option value={newBooking.time}>{formatTime(newBooking.time)}</option>
                    )}
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>
                        {formatTime(t)}
                      </option>
                    ))}
                  </select>
                  <Clock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  {tr('durationMin')}
                </label>
                <input
                  type="number"
                  required
                  min="15"
                  step="15"
                  value={newBooking.duration}
                  onChange={(e) => {
                     durationManuallyChanged.current = true;
                     setNewBooking({ ...newBooking, duration: parseInt(e.target.value) });
                   }}
                  className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  {tr('lessonEventType')}
                </label>
                <select
                  value={newBooking.lesson_type}
                  disabled={bookingMode==="band"}
                  onChange={(e) => setNewBooking({ ...newBooking, lesson_type: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary-dark rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                >
                  <option value="private">{tr('privateLesson')}</option>
                  {bookingMode==="band"&&<option value="group">{groupT('groupLesson')}</option>}
                  <option value="workshop">{tr('workshop')}</option>
                  <option value="recital">{tr('recital')}</option>
                  <option value="makeup">{tr('makeupLesson')}</option>
                  <option value="other">{tr('otherEvent')}</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                Notizen / Terminbeschreibung
              </label>
              <textarea
                rows={3}
                placeholder="z. B. Probestunde, Ersatztermin, Unterrichtsmaterial oder weitere Hinweise"
                value={newBooking.summary}
                onChange={(e) => setNewBooking({ ...newBooking, summary: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent rounded-xl font-medium text-gray-700 outline-none focus:bg-white focus:border-primary resize-y"
              />
            </div>

            {!editingLessonId && currentUser?.role === 'admin' && (bookingMode === 'individual' || (bookingMode==='band'&&newBooking.group_id)) &&
              currentUser?.preferences?.technical?.icloud_calendar_url && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-700">Wiederholung (Apple-Kalender)</label>
                  <select value={newBooking.recurrence}
                    onChange={e => setNewBooking({ ...newBooking, recurrence: e.target.value as LessonBookingData['recurrence'] })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                    <option value="none">Einmaliger Termin</option>
                    <option value="weekly">Jede Woche</option>
                    <option value="biweekly">Alle zwei Wochen</option>
                    <option value="monthly">Jeden Monat</option>
                  </select>
                </div>
                {newBooking.recurrence !== 'none' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-700">Wiederholen bis (optional)</label>
                    <input type="date" value={newBooking.recurrence_until}
                      min={newBooking.date || undefined}
                      onChange={e => setNewBooking({ ...newBooking, recurrence_until: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                  </div>
                )}
              </div>
            )}

            {editingLessonId && (
              <div className="pt-4 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      {tr('status')}
                    </label>
                    <select
                      value={newBooking.status}
                      onChange={(e) => setNewBooking({ ...newBooking, status: e.target.value, statusTouched: true })}
                      className={`w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 rounded-xl font-bold outline-none transition-all appearance-none ${newBooking.status === 'cancelled' ? 'text-red-600 focus:border-red-400' : 'text-gray-700 focus:border-primary'
                        }`}
                    >
                      <option value="scheduled">{tr('scheduled')}</option>
                      <option value="in_progress">Läuft</option>
                      <option value="completed">{tr('completed')}</option>
                      <option value="cancelled">{tr('cancelled')}</option>
                      <option value="no_show">{tr('noShow')}</option>
                    </select>
                  </div>

                  {bookingMode==="band"&&newBooking.group_id&&<div className="space-y-2"><h4 className="text-sm font-semibold">{groupT('individualAttendance')}</h4>
                    {selectedParticipants.map(id=><label key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{groupMembers.find(m=>m.id===id)?.name||id}</span><select className="rounded-lg border p-2" value={newBooking.participant_statuses?.[id]||'inherit'} onChange={e=>setNewBooking(prev=>({...prev,participant_statuses:{...prev.participant_statuses,[id]:e.target.value}}))}>
                      {['inherit','completed','student_cancelled','teacher_cancelled','no_show'].map(status=><option key={status} value={status}>{groupT('attendance.'+status)}</option>)}
                    </select></label>)}
                  </div>}
                  {open && currentUser?.role === "admin" && editingLessonId && <LessonAttendancePanel key={editingLessonId} lessonId={editingLessonId} />}

                  {newBooking.status === "cancelled" && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                      {(bookingMode === "individual" || (bookingMode==="band"&&newBooking.group_id)) && (
                        <>
                          <label htmlFor="lesson-cancellation-kind" className="text-xs font-black text-red-400 uppercase tracking-widest">
                            {tr('cancellationKind')}
                          </label>
                          <select
                            id="lesson-cancellation-kind"
                            required
                            value={newBooking.cancellation_kind}
                            onChange={e => setNewBooking({
                              ...newBooking,
                              cancellation_kind: e.target.value as LessonBookingData["cancellation_kind"],
                            })}
                            className="w-full rounded-lg border border-red-200 bg-red-50/50 px-3 py-2.5 font-semibold text-gray-800"
                          >
                            <option value="">{tr('chooseCancellationKind')}</option>
                            <option value="student_cancelled">{tr('studentCancelledCredited')}</option>
                            <option value="teacher_cancelled">{tr('teacherCancelledNotCredited')}</option>
                          </select>
                          {newBooking.cancellation_kind && (
                            <p className="text-xs text-gray-600">
                              {tr(newBooking.cancellation_kind === 'teacher_cancelled'
                                ? 'teacherCancellationQuotaNote' : 'studentCancellationQuotaNote')}
                            </p>
                          )}
                        </>
                      )}
                      <label className="text-xs font-black text-red-400 uppercase tracking-widest">
                        {tr('cancellationReason')}
                      </label>
                      <textarea
                        placeholder={tr('whyWasThisLessonCancelled')}
                        value={newBooking.cancellation_reason}
                        onChange={(e) =>
                          setNewBooking({ ...newBooking, cancellation_reason: e.target.value })
                        }
                        className="w-full px-4 py-3 bg-red-50/50 border-transparent focus:bg-white border-2 focus:border-red-400 rounded-xl font-medium text-gray-700 outline-none transition-all resize-none h-24"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

          </form>
        </DialogContent>
        <DialogFooter>
          {editingLessonId && ['admin', 'teacher'].includes(currentUser?.role || '') && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onDelete(editingLessonId)}
              disabled={bookingLoading || deletingLessonId !== null}
              className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
            >
              {deletingLessonId === editingLessonId
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Trash2 className="w-4 h-4" />}
              Termin löschen
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            {tr('cancel')}
          </Button>
          <Button
            type="submit"
            form="booking-form"
            disabled={bookingLoading}
            className="flex-[2] gap-2"
          >
            {bookingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : tr("confirmBooking")}
          </Button>
        </DialogFooter>
      </Dialog>
  );
}

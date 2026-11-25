"use client";

import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useRef } from "react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useUser } from "@/contexts/UserContext";
import api from "@/services/api";
import { Clock, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";

export interface LessonBookingData {
  student: string;
  teacher: string;
  band: string;
  room: string;
  date: string;
  time: string;
  duration: number;
  lesson_type: string;
  is_online: boolean;
  online_meeting_url: string;
  status: string;
  cancellation_reason: string;
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
  const tr = useTranslations("Schedule");
  const { currentUser } = useUser();
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

  const bookingStudent = students.find((student: any) => student.id === newBooking.student);
  const cityLine = [bookingStudent?.postal_code, bookingStudent?.city].filter(Boolean).join(" ");
  const bookingAddress = [bookingStudent?.address_line1, cityLine].filter(Boolean).join(", ");

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
                .filter((mode) => mode !== "special" || ['admin', 'teacher'].includes(currentUser?.role || ''))
                .map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setBookingMode(mode);
                    if (mode === "band")
                      setNewBooking((prev) => ({ ...prev, lesson_type: "group" }));
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
                  {mode === "individual" ? tr("modeIndividual") : mode === "band" ? tr("modeBand") : mode === "special" ? "Sondertermin" : tr("modeEvent")}
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
                        ? tr("bandGroup")
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
                      <select
                        required
                        value={newBooking.band}
                        onChange={(e) =>
                          setNewBooking({ ...newBooking, band: e.target.value, student: "" })
                        }
                        className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                      >
                        <option value="">{tr('selectBand')}</option>
                        {bands.map((b: any) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
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
                        <option value="">{tr('noSpecificStudentBand')}</option>
                        <optgroup label="Students">
                          {students.map((s: any) => (
                            <option key={s.id} value={s.id}>
                              {s.name || s.user?.email}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Bands">
                          {bands.map((b: any) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </optgroup>
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
                  onChange={(e) => setNewBooking({ ...newBooking, lesson_type: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary-dark rounded-xl font-bold text-gray-700 outline-none transition-all appearance-none"
                >
                  <option value="private">{tr('privateLesson')}</option>
                  <option value="group">{tr('groupLessonBand')}</option>
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

            {!editingLessonId && currentUser?.role === 'admin' && bookingMode === 'individual' &&
              currentUser?.preferences?.technical?.icloud_calendar_url && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-700">Wiederholung (Apple-Kalender)</label>
                  <select value={newBooking.recurrence}
                    onChange={e => setNewBooking({ ...newBooking, recurrence: e.target.value as LessonBooking['recurrence'] })}
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
                      onChange={(e) => setNewBooking({ ...newBooking, status: e.target.value })}
                      className={`w-full px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 rounded-xl font-bold outline-none transition-all appearance-none ${newBooking.status === 'cancelled' ? 'text-red-600 focus:border-red-400' : 'text-gray-700 focus:border-primary'
                        }`}
                    >
                      <option value="scheduled">{tr('scheduled')}</option>
                      <option value="in_progress">{tr('inProgress')}</option>
                      <option value="completed">{tr('completed')}</option>
                      <option value="cancelled">{tr('cancelled')}</option>
                      <option value="no_show">{tr('noShow')}</option>
                    </select>
                  </div>

                  {newBooking.status === "cancelled" && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
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

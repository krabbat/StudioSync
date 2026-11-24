"use client";

import { useTranslations, useLocale } from 'next-intl'
import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "@/contexts/UserContext";
import {
  useLessons,
  useStudents,
  useTeachers,
  useBands,
  useStudios,
} from "@/hooks/useDashboardData";
import api from "@/services/api";
import LessonDeleteDialog, { type LessonDeleteScope, type LessonDeleteTarget } from "@/components/LessonDeleteDialog";
import { toast } from "react-hot-toast";
import {
  format,
  addDays,
  startOfWeek,
  addMinutes,
  setHours,
  setMinutes,
  parseISO,
  isSameDay,
  getHours,
  getMinutes,
  startOfMonth,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  addMonths,
} from "date-fns";
import {
  Printer,
  Plus,
  Link,
  X,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  Info,
  RefreshCw,
  Loader2,
  Globe,
  Trash2,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogContent, DialogFooter } from "@/components/ui/dialog";

interface ExternalFeed {
  id: string;
  name: string;
  url: string;
  color: string;
  is_enabled: boolean;
  last_synced_at: string | null;
  last_error: string;
  event_count: number;
}

interface ExternalEvent {
  id: string;
  feed: string;
  feed_name: string;
  feed_color: string;
  title: string;
  description: string;
  location: string;
  start_dt: string;
  end_dt: string;
}

// One hour always occupies exactly 96px in the weekly timetable.
// The labels and appointment offsets must use this same scale.
const WEEK_HOUR_HEIGHT = 96;

interface LessonBooking {
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

export default function SchedulePage() {
  const tr = useTranslations('Schedule')
  const locale = useLocale()
  const { currentUser } = useUser();
  const hasIcloudCalendar = currentUser?.role === "admin" && Boolean(currentUser?.preferences?.technical?.icloud_calendar_url);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [colorMode, setColorMode] = useState<"status" | "student" | "instrument">("status");
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [use24Hour, setUse24Hour] = useState(locale === "de");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [deletingLessonId, setDeletingLessonId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LessonDeleteTarget | null>(null);
  const [icloudBusy, setIcloudBusy] = useState(false);
  const [icloudIssues, setIcloudIssues] = useState<{ title: string; error: string }[]>([]);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);

  const queryStartDate = viewMode === "week"
    ? format(weekStart, "yyyy-MM-dd")
    : format(startOfWeek(monthStart, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const queryEndDate = viewMode === "week"
    ? format(addDays(weekStart, 7), "yyyy-MM-dd")
    : format(addDays(endOfWeek(monthEnd, { weekStartsOn: 1 }), 1), "yyyy-MM-dd");

  const {
    lessons,
    loading: lessonsLoading,
    refetch: refetchLessons,
  } = useLessons({
    start_date: queryStartDate,
    end_date: queryEndDate,
  });
  const { students } = useStudents();
  const { teachers } = useTeachers();
  const { bands } = useBands();
  const { studios } = useStudios();

  const currentStudio = studios?.[0];
  // MUSart calendar hours: 13:00 to 22:00; do not alter studio settings.
  const businessStart = 13;
  const businessEnd = 22;

  // Resolve the teacher by name rather than relying on a fixed database ID.
  const preferredTeacherId = teachers.find((teacher: any) =>
    [teacher.first_name, teacher.last_name].filter(Boolean)
      .join(" ").trim().toLocaleLowerCase("de-DE") === "peter sartori"
  )?.id || (currentUser?.role === "teacher"
    ? currentUser?.teacher_profile?.id || "" : "");

  const isOvernight = businessEnd < businessStart;
  const [bookingDefaults, setBookingDefaults] = useState({
    time: `${businessStart.toString().padStart(2, "0")}:00`,
  });

  // ── External Calendars state ──────────────────────────────────────────────
  const [externalFeeds, setExternalFeeds] = useState<ExternalFeed[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(false);
  const [showExternalPanel, setShowExternalPanel] = useState(false);
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newFeedColor, setNewFeedColor] = useState("#6366f1");
  const [addingFeed, setAddingFeed] = useState(false);
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);

  const fetchExternalFeeds = useCallback(async () => {
    try {
      setFeedsLoading(true);
      const resp = await api.get("/lessons/external-feeds/");
      const data = resp.data?.results ?? resp.data;
      setExternalFeeds(Array.isArray(data) ? data : []);
    } catch (e) {
      // silently ignore if unauthenticated
    } finally {
      setFeedsLoading(false);
    }
  }, []);

  const fetchExternalEvents = useCallback(async () => {
    try {
      const resp = await api.get("/lessons/external-events/", {
        params: {
          start: new Date(queryStartDate).toISOString(),
          end: new Date(queryEndDate).toISOString(),
        },
      });
      const data = resp.data?.results ?? resp.data;
      setExternalEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      // silently ignore
    }
  }, [queryStartDate, queryEndDate]);

  useEffect(() => {
    fetchExternalFeeds();
  }, [fetchExternalFeeds]);

  useEffect(() => {
    fetchExternalEvents();
  }, [fetchExternalEvents]);

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeedUrl.trim()) { toast.error(tr('messagePleaseEnterAFeedURL')); return; }
    if (!newFeedName.trim()) { toast.error(tr('messagePleaseEnterAName')); return; }
    setAddingFeed(true);
    try {
      await api.post("/lessons/external-feeds/", {
        name: newFeedName,
        url: newFeedUrl,
        color: newFeedColor,
      });
      toast.success(tr('messageCalendarAddedAndSynced'));
      setNewFeedName("");
      setNewFeedUrl("");
      setNewFeedColor("#6366f1");
      await fetchExternalFeeds();
      await fetchExternalEvents();
    } catch (err: any) {
      const detail = err?.response?.data?.url?.[0] || err?.response?.data?.detail || tr('messageFailedToAddCalendar');
      toast.error(typeof detail === "string" ? detail : tr("messageFailedToAddCalendar"));
    } finally {
      setAddingFeed(false);
    }
  };

  const handleRefreshFeed = async (feedId: string) => {
    setRefreshingFeedId(feedId);
    try {
      const resp = await api.post(`/lessons/external-feeds/${feedId}/refresh/`);
      toast.success(tr("syncedEvents", {count: resp.data.events_synced}));
      await fetchExternalFeeds();
      await fetchExternalEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('messageRefreshFailed'));
    } finally {
      setRefreshingFeedId(null);
    }
  };

  const handleToggleFeed = async (feed: ExternalFeed) => {
    try {
      await api.patch(`/lessons/external-feeds/${feed.id}/`, { is_enabled: !feed.is_enabled });
      await fetchExternalFeeds();
      await fetchExternalEvents();
    } catch { toast.error(tr('messageCouldNotUpdateCalendar')); }
  };

  const handleDeleteFeed = async (feedId: string) => {
    try {
      await api.delete(`/lessons/external-feeds/${feedId}/`);
      toast.success(tr('messageCalendarRemoved'));
      await fetchExternalFeeds();
      await fetchExternalEvents();
    } catch { toast.error(tr('messageCouldNotRemoveCalendar')); }
  };

  // Get external events for a given day + hour slot
  const getExternalEventsForSlot = (dayIdx: number, hour: number) => {
    let targetDate = weekDays[dayIdx];
    if (isOvernight && hour <= businessEnd) targetDate = addDays(targetDate, 1);
    return externalEvents.filter((evt) => {
      const start = parseISO(evt.start_dt);
      return isSameDay(start, targetDate) && getHours(start) === hour;
    });
  };

  const getExternalEventsForDay = (targetDate: Date) =>
    externalEvents.filter((evt) => isSameDay(parseISO(evt.start_dt), targetDate));

  // Check if a lesson conflicts with any enabled external event
  const hasExternalConflict = (lesson: any) => {
    const lStart = parseISO(lesson.scheduled_start).getTime();
    const lEnd = parseISO(lesson.scheduled_end).getTime();
    return externalEvents.some((evt) => {
      const eStart = parseISO(evt.start_dt).getTime();
      const eEnd = parseISO(evt.end_dt).getTime();
      return eStart < lEnd && eEnd > lStart;
    });
  };

  const [newBooking, setNewBooking] = useState<LessonBooking>({
    student: "",
    teacher: preferredTeacherId,
    band: "",
    room: "",
    date: "",
    time: bookingDefaults.time,
    duration: 60,
    lesson_type: "private",
    is_online: false,
    online_meeting_url: "",
    status: "scheduled",
    cancellation_reason: "",
    summary: "",
    guest_name: "",
    guest_address: "",
    recurrence: "none",
    recurrence_until: "",
  });

  const [bookingMode, setBookingMode] = useState<"individual" | "band" | "event" | "special">("individual");
  const teacherManuallyChanged = useRef(false);
  const durationManuallyChanged = useRef(false);

  // Teachers load asynchronously. Apply this default only for new events.
  useEffect(() => {
    if (showBookingModal && !editingLessonId && preferredTeacherId &&
        !teacherManuallyChanged.current) {
      setNewBooking((previous) => previous.teacher
        ? previous : { ...previous, teacher: preferredTeacherId });
    }
  }, [showBookingModal, editingLessonId, preferredTeacherId]);

  // Reuse the contract endpoint already used by the student's Vertrag tab.
  // Delayed responses must never override manual duration changes or edits.
  useEffect(() => {
    if (!showBookingModal || editingLessonId || bookingMode !== "individual" ||
        !newBooking.student) return;
    let active = true;
    const studentId = newBooking.student;
    void api.get<{ contract: { lesson_minutes: number } | null }>(
      "/students/" + encodeURIComponent(studentId) + "/contract/"
    ).then(({ data }) => {
      if (!active || durationManuallyChanged.current) return;
      const minutes = data.contract?.lesson_minutes;
      if (minutes === 30 || minutes === 45 || minutes === 60) {
        setNewBooking((previous) => previous.student === studentId
          ? { ...previous, duration: minutes } : previous);
      }
    }).catch(() => {
      // No contract: retain the existing 60-minute fallback.
    });
    return () => { active = false; };
  }, [showBookingModal, editingLessonId, bookingMode, newBooking.student]);
  const bookingStudent = students.find((student: any) => student.id === newBooking.student);
  const bookingCityLine = [bookingStudent?.postal_code, bookingStudent?.city].filter(Boolean).join(" ");
  const bookingAddress = [bookingStudent?.address_line1, bookingCityLine].filter(Boolean).join(", ");

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const resetBooking = () => {
    teacherManuallyChanged.current = false;
    durationManuallyChanged.current = false;
    setNewBooking({
      student: "",
      teacher: preferredTeacherId,
      band: "",
      room: "",
      date: "",
      time: bookingDefaults.time,
      duration: 60,
      lesson_type: "private",
      is_online: false,
      online_meeting_url: "",
      status: "scheduled",
      cancellation_reason: "",
    summary: "",
    guest_name: "",
    guest_address: "",
    recurrence: "none",
    recurrence_until: "",
    });
    setEditingLessonId(null);
  };

  const handleOpenEditModal = (lesson: any) => {
    const start = parseISO(lesson.scheduled_start);
    setNewBooking({
      student: lesson.student || "",
      teacher: lesson.teacher || "",
      band: lesson.band || "",
      room: lesson.room || (lesson.is_online ? "external" : ""),
      date: format(start, "yyyy-MM-dd"),
      time: format(start, "HH:mm"),
      duration: lesson.duration_minutes,
      lesson_type: lesson.lesson_type,
      is_online: lesson.is_online,
      online_meeting_url: lesson.online_meeting_url || "",
      status: lesson.status || "scheduled",
      cancellation_reason: lesson.cancellation_reason || "",
      summary: lesson.summary || "",
      guest_name: lesson.guest_name || "",
      guest_address: lesson.guest_address || "",
      recurrence: "none",
      recurrence_until: "",
    });
    setEditingLessonId(lesson.id);

    if (lesson.guest_name) setBookingMode("special");
    else if (lesson.band) setBookingMode("band");
    else if (lesson.lesson_type === "workshop" || lesson.lesson_type === "recital")
      setBookingMode("event");
    else setBookingMode("individual");

    setShowBookingModal(true);
  };

  // Time slots generation
  const timeSlots = (() => {
    if (!isOvernight) {
      // Each row represents one full hour. Last row 21:00–22:00.
      return Array.from({ length: businessEnd - businessStart }, (_, i) => i + businessStart);
    } else {
      // Example: Start 16, End 2 -> [16...23, 0...2]
      const pmSlots = Array.from({ length: 24 - businessStart }, (_, i) => i + businessStart);
      const amSlots = Array.from({ length: businessEnd + 1 }, (_, i) => i);
      return [...pmSlots, ...amSlots];
    }
  })();

  // Accurate time dropdown options (15 min intervals)
  const timeOptions = (() => {
    const options: string[] = [];

    timeSlots.forEach((hour) => {
      const date = new Date();
      date.setHours(hour, 0, 0, 0);

      for (let i = 0; i < 4; i++) {
        options.push(format(addMinutes(date, i * 15), "HH:mm"));
      }
    });
    return options;
  })();

  // Color Helpers
  const getColorForString = (str: string) => {
    if (!str) return { bg: '#f3f4f6', border: '#9ca3af', text: '#374151', textDark: '#111827', textLight: '#4b5563' };
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return {
      bg: `hsl(${hue}, 85%, 95%)`,
      border: `hsl(${hue}, 80%, 45%)`,
      text: `hsl(${hue}, 85%, 25%)`,
      textDark: `hsl(${hue}, 85%, 20%)`,
      textLight: `hsl(${hue}, 80%, 35%)`,
    };
  };

  const getLessonColorStyles = (lesson: any) => {
    if (colorMode === "status") return {};

    let textToHash = "";
    if (colorMode === "student") {
      textToHash = lesson.student_name || lesson.band_name || "Unknown";
    } else if (colorMode === "instrument") {
      textToHash = lesson.student_instrument || "Unknown";
    }

    const { bg, border, text, textDark, textLight } = getColorForString(textToHash);
    return {
      backgroundColor: bg,
      borderColor: border,
      '--dynamic-text-dark': textDark,
      '--dynamic-text': text,
      '--dynamic-text-light': textLight,
    } as React.CSSProperties;
  };

  // Helpers
  const formatTime = (timeStr: string) => {
    if (!timeStr) return "";
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes);
    return use24Hour ? format(date, "HH:mm") : format(date, "h:mm a");
  };

  const formatGridHour = (hour: number) => {
    const date = new Date();
    date.setHours(hour, 0);
    return use24Hour ? format(date, "HH:mm") : format(date, "h a");
  };

  const previousPeriod = () => {
    if (viewMode === "week") {
      setCurrentDate(addDays(currentDate, -7));
    } else {
      setCurrentDate(addMonths(currentDate, -1));
    }
  };
  const nextPeriod = () => {
    if (viewMode === "week") {
      setCurrentDate(addDays(currentDate, 7));
    } else {
      setCurrentDate(addMonths(currentDate, 1));
    }
  };

  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shortTimeZone = new Date().toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ')[2] || localTimeZone;

  const getLessonsForDay = (targetDate: Date) => {
    return lessons.filter((lesson: any) => {
      const lessonUserDate = parseISO(lesson.scheduled_start);
      return isSameDay(lessonUserDate, targetDate);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const syncAppleNow = async () => {
    setIcloudBusy(true);
    try {
      const { data } = await api.post('/core/calendar/icloud/sync/');
      refetchLessons();
      setIcloudIssues((data.series || [])
        .filter((row: any) => Boolean(row.error) && row.error !== 'Schüler zuordnen')
        .map((row: any) => ({ title: row.title, error: row.error })));
      toast.success('iCloud abgeglichen: ' + data.imported + ' importiert, ' + data.exported + ' exportiert.');
      if (data.unassigned) toast('Nicht zugeordnete Serien: ' + data.unassigned + '. Bitte unter Einstellungen → Technik zuordnen.');
      if (data.conflicts) toast.error('Kalenderkonflikte: ' + data.conflicts + '. Die Einzelheiten stehen unter der Kalenderleiste.');
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'iCloud-Abgleich fehlgeschlagen.');
    } finally {
      setIcloudBusy(false);
    }
  };

  const requestDeleteBooking = (lessonId: string) => {
    const selected = lessons.find((item: any) => item.id === lessonId);
    if (!selected) return;
    setDeleteTarget({
      id: lessonId,
      label: `${selected.student_name || selected.band_name || 'Unterricht'} am ${format(parseISO(selected.scheduled_start), 'dd.MM.yyyy HH:mm')}`,
      isRecurring: Boolean(selected.is_recurring),
    });
  };

  const deleteBooking = async (scope: LessonDeleteScope) => {
    if (!deleteTarget) return;
    const lessonId = deleteTarget.id;
    setDeletingLessonId(lessonId);
    try {
      const response = await api.delete(`/lessons/${lessonId}/`, { params: { scope } });
      toast.success(response.data?.detail || 'Unterrichtstermin gelöscht.');
      if (response.data?.icloud_synced === false) {
        toast.error('iCloud ist noch nicht aktualisiert. Bitte den Kalenderabgleich prüfen.');
      }
      setDeleteTarget(null);
      setShowBookingModal(false);
      resetBooking();
      await refetchLessons();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Unterrichtstermin konnte nicht gelöscht werden.');
    } finally {
      setDeletingLessonId(null);
    }
  };

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();

    // Manual validation with user-friendly toasts
    if (!newBooking.date) {
      toast.error(tr('messagePleaseSelectADate'));
      return;
    }
    if (!newBooking.time) {
      toast.error(tr('messagePleaseSelectATime'));
      return;
    }
    if (currentUser?.role !== "student" && bookingMode === "special" && !newBooking.guest_name.trim()) {
      toast.error('Bitte einen Namen für den Sondertermin eintragen.');
      return;
    }
    if (currentUser?.role !== "student" && bookingMode === "individual" && !newBooking.student) {
      toast.error(tr('messagePleaseSelectAStudent'));
      return;
    }
    if (currentUser?.role !== "student" && bookingMode === "band" && !newBooking.band) {
      toast.error(tr('messagePleaseSelectABand'));
      return;
    }

    setBookingLoading(true);

    try {
      const startDateTime = new Date(`${newBooking.date}T${newBooking.time}`);
      const endDateTime = addMinutes(startDateTime, newBooking.duration);

      const payload: any = {
        scheduled_start: startDateTime.toISOString(),
        scheduled_end: endDateTime.toISOString(),
        lesson_type: newBooking.lesson_type,
        status: newBooking.status,
        summary: newBooking.summary,
        studio: currentUser?.studio?.id || studios?.[0]?.id,
      };

      if (newBooking.status === "cancelled") {
        payload.cancellation_reason = newBooking.cancellation_reason;
      }

      if (currentUser?.role === "student") {
        if (newBooking.teacher) payload.teacher = newBooking.teacher;
        payload.student = currentUser.student_profile?.id;
      } else {
        payload.teacher = newBooking.teacher || currentUser?.teacher_profile?.id;

        if (bookingMode === "special") {
          payload.guest_name = newBooking.guest_name.trim();
          payload.guest_address = newBooking.guest_address.trim();
          payload.student = null;
          payload.band = null;
          payload.room = null;
        } else if (bookingMode === "band" && newBooking.band) {
          payload.band = newBooking.band;
          payload.student = null;
        } else if (bookingMode === "individual" && newBooking.student) {
          payload.student = newBooking.student;
          payload.band = null;
        }

        // New house-call lessons do not need a room. Existing room references
        // are left untouched when editing legacy appointments.
        payload.is_online = newBooking.is_online;
        payload.online_meeting_url = newBooking.is_online ? newBooking.online_meeting_url : "";
      }

      if (!editingLessonId && newBooking.recurrence !== "none") {
        if (bookingMode !== "individual" || !newBooking.student || currentUser?.role !== "admin") {
          toast.error('Wiederholungen sind hier zunächst für einzelne Schüler und Administratoren vorgesehen.');
          return;
        }
        await api.post('/core/calendar/icloud/series/create/', {
          ...payload, frequency: newBooking.recurrence,
          until: newBooking.recurrence_until || null,
        });
        toast.success('Wiederholungstermin in iCloud und StudioSync angelegt.');
      } else if (editingLessonId) {
        await api.patch(`/lessons/${editingLessonId}/`, payload);
        toast.success(tr('messageLessonUpdatedSuccessfully'));
      } else {
        await api.post("/lessons/", payload);
        toast.success(tr('messageLessonBookedSuccessfully'));
      }

      setShowBookingModal(false);
      resetBooking();
      refetchLessons();
      if (currentUser?.role === 'admin' && currentUser?.preferences?.technical?.icloud_calendar_url) {
        void api.post('/core/calendar/icloud/sync/').then(() => refetchLessons()).catch(() => {
          toast.error('Der automatische iCloud-Abgleich ist fehlgeschlagen.');
        });
      }
    } catch (error: any) {
      console.error(error);
      const detail =
        error?.response?.data?.detail || Object.values(error?.response?.data || {})?.[0];
      toast.error(typeof detail === "string" ? detail : tr(editingLessonId ? "bookingUpdateFailed" : "bookingCreateFailed"));
    } finally {
      setBookingLoading(false);
    }
  };

  const getLessonsForSlot = (dayIdx: number, hour: number) => {
    let targetDate = weekDays[dayIdx];

    // Handle overnight logic: if it's an overnight schedule and the hour is in the early morning (<= end),
    // it belongs to the "next day" physically, but same "schedule column".
    if (isOvernight && hour <= businessEnd) {
      targetDate = addDays(targetDate, 1);
    }

    return lessons.filter((lesson: any) => {
      const lessonUserDate = parseISO(lesson.scheduled_start);
      return isSameDay(lessonUserDate, targetDate) && getHours(lessonUserDate) === hour;
    });
  };

  if (lessonsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 animate-in fade-in duration-500">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          {tr('synchronizingSchedule')}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 print:space-y-2">
      <style jsx global>{`
        @media print {
          nav,
          aside,
          header button,
          .no-print {
            display: none !important;
          }
          main {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          .print-full-width {
            width: 100% !important;
            overflow: visible !important;
          }
          table {
            border-collapse: collapse !important;
          }
          td,
          th {
            border: 1px solid #ddd !important;
          }
        }
      `}</style>

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight">{tr('schedule')}</h1>
          <p className="text-gray-500 font-medium max-w-lg">
            {tr('orchestrateYourWeeklyLessonCalendar')}
          </p>
        </div>
        <div className={`grid ${hasIcloudCalendar ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4"} gap-2 sm:gap-3 no-print`}>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetchLessons()}
            title={tr('refresh')}
            className="w-full"
          >
            <RefreshCw className={`w-4 h-4 ${lessonsLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="outline"
            onClick={() => setUse24Hour(!use24Hour)}
            className="gap-2 w-full"
            title={tr("timezoneLabel", {timezone: localTimeZone})}
          >
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">
              {use24Hour ? "24h" : "12h"} <span className="text-[9px] text-gray-400 font-bold ml-1">{shortTimeZone}</span>
            </span>
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowSubscribeModal(true)}
            className="gap-2 w-full"
          >
            <Link className="w-4 h-4" />
            <span className="hidden sm:inline">{tr('subscribe')}</span>
          </Button>
          {hasIcloudCalendar && (
            <Button type="button" variant="outline" onClick={() => void syncAppleNow()}
              disabled={icloudBusy} className="gap-2 w-full" title="Bidirektional mit iCloud synchronisieren">
              <RefreshCw className={`w-4 h-4 ${icloudBusy ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">iCloud-Abgleich</span>
            </Button>
          )}
          <Button
            variant="default" // Changed from outline with inline style
            onClick={handlePrint}
            className="gap-2 w-full"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">{tr('print')}</span>
          </Button>
          {["admin", "teacher", "student"].includes(currentUser?.role || "") && (
            <Button
              onClick={() => {
                resetBooking();
                setShowBookingModal(true);
              }}
              className={`gap-2 hover:scale-105 w-full ${hasIcloudCalendar ? "col-span-3 sm:col-span-5" : "col-span-2 sm:col-span-4"}`}
            >
              <Plus className="w-4 h-4" />
              {tr('newBooking')}
            </Button>
          )}
        </div>
      </header>

      {icloudIssues.length > 0 && (
        <section role="alert" className="no-print rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-bold">iCloud-Kalender: Konflikte und Hinweise</h2>
            <button type="button" onClick={() => setIcloudIssues([])}
              className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold">
              Schließen
            </button>
          </div>
          {icloudIssues.map((item, index) => (
            <div key={index} className="mt-2 rounded-lg bg-white/75 p-3">
              <strong>{item.title}</strong>
              <p className="mt-1 whitespace-pre-line">{item.error}</p>
            </div>
          ))}
        </section>
      )}

      {/* View & Color Toggles */}
      <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-2 no-print">
        <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setViewMode("week")}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === "week" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {tr('week')}
          </button>
          <button
            onClick={() => setViewMode("month")}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === "month" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {tr('month')}
          </button>
        </div>

        <div className="flex justify-center items-center gap-2">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest hidden sm:inline">{tr('colorBy')}</span>
          <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setColorMode("status")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${colorMode === "status" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              {tr('status')}
            </button>
            <button
              onClick={() => setColorMode("student")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${colorMode === "student" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              {tr('student')}
            </button>
            <button
              onClick={() => setColorMode("instrument")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${colorMode === "instrument" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              {tr('instrument')}
            </button>
          </div>
        </div>
      </div>

      {/* Period Navigation */}
      <div className="flex justify-between items-center bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 shadow-sm no-print mb-6">
        <Button variant="ghost" size="icon" onClick={previousPeriod} className="text-gray-600">
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <div className="text-center">
          <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
            {new Intl.DateTimeFormat(locale, {month: "long", year: "numeric"}).format(viewMode === "week" ? weekStart : monthStart)}
          </h2>
          {viewMode === "week" && (
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">
              {new Intl.DateTimeFormat(locale, {day: "numeric", month: "short"}).format(weekStart)} — {new Intl.DateTimeFormat(locale, {day: "numeric", month: "short"}).format(addDays(weekStart, 6))}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={nextPeriod} className="text-gray-600">
          <ChevronRight className="w-6 h-6" />
        </Button>
      </div>

      {/* Print Header */}
      <div className="hidden print:block text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          {viewMode === "week"
            ? tr("printWeekTitle", {from: new Intl.DateTimeFormat(locale, {day: "numeric", month: "long"}).format(weekStart), to: new Intl.DateTimeFormat(locale, {day: "numeric", month: "long", year: "numeric"}).format(addDays(weekStart, 6))})
            : tr("printMonthTitle", {month: new Intl.DateTimeFormat(locale, {month: "long", year: "numeric"}).format(monthStart)})}
        </h2>
      </div>

      {/* Schedule Grid */}
      <div className="bg-white rounded-[2rem] border border-gray-100 shadow-xl overflow-hidden print-full-width flex flex-col h-[70vh]">
        <div className="overflow-auto custom-scrollbar flex-1 relative">
          {viewMode === "week" ? (
            <table className="w-full min-w-full md:min-w-[1000px] border-separate border-spacing-0">
              <thead className="bg-gray-50/80 backdrop-blur-sm sticky top-0 z-20">
                <tr>
                  <th className="px-2 py-3 sm:px-6 sm:py-4 text-center text-[9px] sm:text-[10px] font-black text-gray-400 uppercase tracking-widest w-24 sticky left-0 z-30 bg-gray-50 border-r border-b border-gray-100">
                    {tr('time')}
                  </th>
                  {weekDays.map((day, idx) => (
                    <th
                      key={idx}
                      className={`px-2 py-3 sm:px-4 sm:py-4 text-center min-w-[100px] sm:min-w-[140px] border-b border-gray-100 ${idx < 6 ? "border-r" : ""}`}
                    >
                      <div
                        className={`text-[9px] sm:text-[10px] font-black uppercase tracking-widest mb-1 ${isSameDay(day, new Date()) ? "text-primary" : "text-gray-400"}`}
                      >
                        {new Intl.DateTimeFormat(locale, {weekday: "short"}).format(day)}
                      </div>
                      <div
                        className={`text-xl sm:text-2xl font-black ${isSameDay(day, new Date()) ? "text-primary" : "text-gray-900"}`}
                      >
                        {format(day, "d")}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {timeSlots.map((hour) => (
                  <tr key={hour} className="group h-24">
                    <td className="h-24 p-0 text-xs font-bold text-gray-400 border-r border-gray-100 bg-gray-50/30 sticky left-0 z-10 text-center align-top">
                      <div className="relative h-24">
                        <span className="absolute inset-x-0 top-1">{formatGridHour(hour)}</span>
                      </div>
                    </td>
                    {weekDays.map((day, dayIdx) => {
                      const slotLessons = getLessonsForSlot(dayIdx, hour);
                      return (
                        <td
                          key={dayIdx}
                          onDoubleClick={() => {
                            if (slotLessons.length === 0) {
                              const dateStr = format(weekDays[dayIdx], "yyyy-MM-dd");
                              const hourStr = `${hour.toString().padStart(2, "0")}:00`;
                              resetBooking();
                              setNewBooking((previous) => ({
                                ...previous,
                                date: dateStr,
                                time: hourStr,
                              }));
                              setEditingLessonId(null);
                              setBookingMode("individual");
                              setShowBookingModal(true);
                            }
                          }}
                          className={`h-24 p-0 border-gray-50 align-top transition-colors hover:bg-gray-50/50 ${dayIdx < 6 ? "border-r" : ""}`}
                        >
                          <div className="relative h-24 overflow-visible">
                              {slotLessons.map((lesson: any) => (
                                <div
                                  key={lesson.id}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenEditModal(lesson);
                                  }}
                                  style={{
                                    ...getLessonColorStyles(lesson),
                                    top: (getMinutes(parseISO(lesson.scheduled_start)) / 60) * WEEK_HOUR_HEIGHT,
                                    height: Math.max(24, (lesson.duration_minutes / 60) * WEEK_HOUR_HEIGHT),
                                  }}
                                  title={`${format(parseISO(lesson.scheduled_start), "HH:mm")} – ${format(parseISO(lesson.scheduled_end), "HH:mm")} · ${lesson.student_name || lesson.band_name || "Unterricht"}`}
                                  className={`
                                    absolute inset-x-1 z-10 overflow-hidden p-1 rounded-lg border-l-[3px] shadow-sm hover:shadow-md transition-all cursor-pointer group/card
                                    ${colorMode === "status" ? (
                                      lesson.status === "scheduled" ? "bg-primary/10 border-primary cursor-pointer hover:bg-primary/20" :
                                        lesson.status === "completed" ? "bg-gray-100 border-gray-400" :
                                          lesson.status === "cancelled" ? "bg-red-50 border-red-400" : ""
                                    ) : ""}
                                  `}
                                >
                                  <div className="flex justify-between items-start gap-0.5 sm:gap-1">
                                    <div
                                      className={`font-bold text-[10px] sm:text-xs truncate leading-tight ${colorMode !== "status" ? "" : "text-gray-900"}`}
                                      style={colorMode !== "status" ? { color: "var(--dynamic-text-dark)" } : {}}
                                    >
                                      {lesson.band_name ||
                                        lesson.student_name ||
                                        (lesson.lesson_type
                                          ? lesson.lesson_type.charAt(0).toUpperCase() +
                                          lesson.lesson_type.slice(1)
                                          : "Event")}
                                    </div>
                                    <div className="flex items-center gap-0.5 sm:gap-1">
                                      {hasExternalConflict(lesson) && (
                                        <span title={tr('overlapsWithAnExternalCalendarEvent')} className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                                      )}
                                      {lesson.duration_minutes !== 60 && (
                                        <span
                                          className={`text-[8px] sm:text-[9px] font-black uppercase px-0.5 sm:px-1 rounded ${colorMode !== "status" ? "" : "bg-white/50 text-gray-500"}`}
                                          style={colorMode !== "status" ? { backgroundColor: "rgba(255,255,255,0.7)", color: "var(--dynamic-text)" } : {}}
                                        >
                                          {lesson.duration_minutes}m
                                        </span>
                                      )}
                                      {lesson.is_online ? (
                                        <span
                                          className={`text-[8px] sm:text-[9px] font-black uppercase px-0.5 sm:px-1 rounded truncate max-w-[35px] sm:max-w-[50px] ${colorMode !== "status" ? "" : "bg-purple-50 text-purple-500"}`}
                                          style={colorMode !== "status" ? { backgroundColor: "rgba(255,255,255,0.7)", color: "var(--dynamic-text)" } : {}}
                                        >
                                          {tr('online')}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <p
                                    className={`text-[9px] sm:text-[10px] font-medium mt-0.5 truncate ${colorMode !== "status" ? "" : "text-gray-500 group-hover/card:text-gray-700"}`}
                                    style={colorMode !== "status" ? { color: "var(--dynamic-text-light)" } : {}}
                                  >
                                    {lesson.student_instrument}
                                  </p>
                                  {!lesson.is_online && lesson.student_address && (
                                    <p className="text-[9px] sm:text-[10px] mt-0.5 truncate text-gray-600"
                                       title={lesson.student_address}>
                                      {lesson.student_address}
                                    </p>
                                  )}
                                </div>
                              ))}
                              {/* External events use the same minute scale as lessons. */}
                              {getExternalEventsForSlot(dayIdx, hour).map((evt) => (
                                <div
                                  key={evt.id}
                                  title={`${evt.feed_name}: ${evt.title}${evt.location ? ` @ ${evt.location}` : ""}`}
                                  className="absolute inset-x-1 z-20 overflow-hidden p-1 rounded-lg border border-dashed shadow-sm text-[10px] truncate"
                                  style={{
                                    top: (getMinutes(parseISO(evt.start_dt)) / 60) * WEEK_HOUR_HEIGHT,
                                    height: Math.max(24, ((parseISO(evt.end_dt).getTime() - parseISO(evt.start_dt).getTime()) / 3600000) * WEEK_HOUR_HEIGHT),
                                    borderColor: evt.feed_color,
                                    color: evt.feed_color,
                                    backgroundColor: evt.feed_color + "18",
                                  }}
                                >
                                  <Globe className="inline w-2.5 h-2.5 mr-0.5 shrink-0" />
                                  {evt.title || evt.feed_name}
                                </div>
                              ))}
                            </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* The lower boundary is 22:00, not another bookable 22:00–23:00 slot. */}
                <tr aria-hidden="true">
                  <td className="px-2 py-2 text-xs font-bold text-gray-400 border-r border-gray-100 bg-gray-50/30 sticky left-0 text-center">
                    {formatGridHour(businessEnd)}
                  </td>
                  <td colSpan={7} className="border-t border-gray-100" />
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col h-full min-w-[700px]">
              <div className="grid grid-cols-7 bg-gray-50/80 backdrop-blur-sm sticky top-0 z-20 border-b border-gray-100 shrink-0">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dayName) => (
                  <div key={dayName} className="py-3 px-2 text-center text-[10px] sm:text-xs font-black text-gray-400 uppercase tracking-widest border-r border-gray-100 last:border-0">
                    {dayName}
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-7 auto-rows-fr">
                {eachDayOfInterval({
                  start: startOfWeek(monthStart, { weekStartsOn: 1 }),
                  end: endOfWeek(monthEnd, { weekStartsOn: 1 })
                }).map((day, idx) => {
                  const isCurrentMonth = isSameMonth(day, monthStart);
                  const isToday = isSameDay(day, new Date());
                  const dayLessons = getLessonsForDay(day);

                  return (
                    <div
                      key={day.toISOString()}
                      onDoubleClick={() => {
                        const dateStr = format(day, "yyyy-MM-dd");
                        const hourStr = bookingDefaults.time;
                        resetBooking();
                        setNewBooking((previous) => ({
                          ...previous,
                          date: dateStr,
                          time: hourStr,
                        }));
                        setEditingLessonId(null);
                        setBookingMode("individual");
                        setShowBookingModal(true);
                      }}
                      className={`min-h-[100px] border-b border-r border-gray-100 p-1 sm:p-2 hover:bg-gray-50/50 transition-colors ${!isCurrentMonth ? "bg-gray-50/40" : ""} flex flex-col`}
                    >
                      <div className="flex justify-end mb-1">
                        <span className={`text-xs sm:text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-white" : isCurrentMonth ? "text-gray-900" : "text-gray-400"}`}>
                          {format(day, "d")}
                        </span>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                        {dayLessons.map((lesson: any) => (
                          <div
                            key={lesson.id}
                            title={lesson.student_address || undefined}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditModal(lesson);
                            }}
                            style={getLessonColorStyles(lesson)}
                            className={`
                              px-1.5 py-1 rounded w-full truncate border-l-2 shadow-sm hover:shadow-md cursor-pointer text-left relative
                              ${colorMode === "status" ? (
                                lesson.status === "scheduled" ? "bg-primary/10 border-primary text-primary-dark" :
                                  lesson.status === "completed" ? "bg-gray-100 border-gray-400 text-gray-700" :
                                    lesson.status === "cancelled" ? "bg-red-50 border-red-400 text-red-700" : ""
                              ) : ""}
                            `}
                          >
                            {hasExternalConflict(lesson) && (
                              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" title={tr('conflictsWithExternalCalendarEvent')} />
                            )}
                            <span
                              className={`text-[9px] sm:text-[10px] font-bold ${colorMode !== "status" ? "" : ""}`}
                              style={colorMode !== "status" ? { color: "var(--dynamic-text-dark)" } : {}}
                            >
                              {new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", hour12: !use24Hour}).format(parseISO(lesson.scheduled_start))}
                            </span>
                            <span
                              className={`text-[9px] sm:text-[10px] font-medium ml-1 ${colorMode !== "status" ? "" : ""}`}
                              style={colorMode !== "status" ? { color: "var(--dynamic-text)" } : {}}
                            >
                              {lesson.band_name || lesson.student_name || (lesson.lesson_type ? lesson.lesson_type.charAt(0).toUpperCase() + lesson.lesson_type.slice(1) : "Event")}
                            </span>
                          </div>
                        ))}
                        {/* External events in month view */}
                        {getExternalEventsForDay(day).map((evt) => (
                          <div
                            key={evt.id}
                            title={`${evt.feed_name}: ${evt.title}`}
                            className="px-1.5 py-1 rounded w-full truncate border border-dashed text-[9px] sm:text-[10px]"
                            style={{
                              borderColor: evt.feed_color,
                              color: evt.feed_color,
                              backgroundColor: evt.feed_color + "18",
                            }}
                          >
                            <Globe className="inline w-2 h-2 mr-0.5" />
                            {evt.title || evt.feed_name}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── External Calendars Panel ─────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden no-print">
        <button
          onClick={() => setShowExternalPanel(!showExternalPanel)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Globe className="w-4 h-4 text-indigo-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">{tr('externalCalendars')}</h3>
              <p className="text-xs text-gray-400">
                {externalFeeds.length === 0
                  ? tr("importFeedsInfo")
                  : tr("activeFeedsCount", {active: externalFeeds.filter(f => f.is_enabled).length, total: externalFeeds.length})}
              </p>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${showExternalPanel ? "rotate-90" : ""}`} />
        </button>

        {showExternalPanel && (
          <div className="border-t border-gray-100 p-6 space-y-6">

            {/* Feed List */}
            {feedsLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                {tr('loadingCalendars')}
              </div>
            ) : externalFeeds.length > 0 ? (
              <div className="space-y-2">
                {externalFeeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors bg-gray-50/50"
                  >
                    {/* Color swatch */}
                    <div
                      className="w-3 h-3 rounded-full shrink-0 border-2"
                      style={{ backgroundColor: feed.color, borderColor: feed.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${!feed.is_enabled ? "text-gray-400" : "text-gray-800"}`}>
                        {feed.name}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {feed.last_synced_at
                          ? tr("feedSyncInfo", {count: feed.event_count, date: new Intl.DateTimeFormat(locale, {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}).format(parseISO(feed.last_synced_at))})
                          : tr("notYetSynced")}
                        {feed.last_error && (
                          <span className="ml-1 text-red-400">· {tr("feedError")}: {feed.last_error.slice(0, 40)}</span>
                        )}
                      </p>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRefreshFeed(feed.id)}
                        disabled={refreshingFeedId === feed.id}
                        title={tr('syncNow')}
                        className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshingFeedId === feed.id ? "animate-spin" : ""}`} />
                      </button>
                      <button
                        onClick={() => handleToggleFeed(feed)}
                        title={feed.is_enabled ? tr("hideEvents") : tr("showEvents")}
                        className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        {feed.is_enabled
                          ? <ToggleRight className="w-4 h-4 text-indigo-500" />
                          : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                      </button>
                      <button
                        onClick={() => handleDeleteFeed(feed.id)}
                        title={tr('removeCalendar')}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                {tr('noExternalCalendarsYetAddOneBelow')}
              </p>
            )}

            {/* Add feed form */}
            <form onSubmit={handleAddFeed} className="space-y-3">
              <p className="text-xs font-black text-gray-400 uppercase tracking-widest">{tr('addCalendar')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2">
                <input
                  type="text"
                  placeholder={tr('nameEGMyGoogleCalendar')}
                  value={newFeedName}
                  onChange={(e) => setNewFeedName(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 outline-none focus:border-indigo-300 focus:bg-white transition-colors"
                />
                <input
                  type="text"
                  placeholder={tr('icalURLHttpsOrWebcal')}
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 font-mono outline-none focus:border-indigo-300 focus:bg-white transition-colors"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 shrink-0">{tr('color')}</label>
                  <input
                    type="color"
                    value={newFeedColor}
                    onChange={(e) => setNewFeedColor(e.target.value)}
                    className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white"
                  />
                </div>
                <Button type="submit" disabled={addingFeed} className="gap-2 whitespace-nowrap">
                  {addingFeed ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </Button>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 flex gap-2 items-start">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">
                  {tr('worksWith')} <strong>{tr('googleCalendar')}</strong>, <strong>{tr('appleICal')}</strong>, <strong>{tr('outlook')}</strong>, and any
                  service that offers a public <code>.ics</code> feed URL. Events appear as overlays on your schedule.
                </p>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Booking Modal */}
      <Dialog
        open={showBookingModal}
        onOpenChange={(open) => {
          setShowBookingModal(open);
          if (!open) resetBooking();
        }}
        size="lg"
      >
        <DialogHeader title={editingLessonId ? tr('editBooking') : tr('newBooking')} />
        <DialogContent>
          <form id="booking-form" onSubmit={handleBooking} noValidate className="space-y-6">
            {/* Booking Mode Selector */}
            <div className="flex p-1 bg-gray-50 rounded-2xl border border-gray-100 mb-2">
              {(["individual", "band", "event", "special"] as const).map((mode) => (
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
              onClick={() => requestDeleteBooking(editingLessonId)}
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
            onClick={() => setShowBookingModal(false)}
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

      <LessonDeleteDialog
        target={deleteTarget}
        busy={deletingLessonId !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(scope) => void deleteBooking(scope)}
      />

      {/* Subscribe Modal */}
      <Dialog open={showSubscribeModal} onOpenChange={setShowSubscribeModal} size="md">
        <DialogHeader title={tr('subscribe')} />
        <DialogContent>
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3">
              <Info className="w-5 h-5 text-blue-600 shrink-0" />
              <p className="text-sm text-blue-800 font-medium">
                {tr('useThisLinkToSubscribeInYourCalendarAppGoogleCalendarICalEtc')}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                {tr('feedURL')}
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/calendar/my/lessons.ics`}
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono text-gray-600 outline-none"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${window.location.origin}/api/calendar/my/lessons.ics`
                    );
                    toast.success(tr('messageCopied'));
                  }}
                >
                  {tr('copy')}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setShowSubscribeModal(false)}
            className="w-full"
          >
            {tr('close')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

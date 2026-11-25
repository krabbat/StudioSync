import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8')

const page = source('app/dashboard/schedule/page.tsx')
const list = source('app/dashboard/lessons/page.tsx')
const editor = source('components/LessonBookingDialog.tsx')

test('MUSart weekly timetable stays fixed at 13:00–22:00', () => {
    assert.match(page, /const businessStart = 13;/)
    assert.match(page, /const businessEnd = 22;/)
    assert.match(page, /time: bookingDefaults\.time/)
    assert.match(page, /businessStart\.toString\(\)\.padStart\(2, "0"\)/)
    assert.match(page, /length: businessEnd - businessStart \}/)
    assert.doesNotMatch(page, /businessEnd - businessStart \+ 1/)
    assert.match(page, /formatGridHour\(businessEnd\)/)
    assert.match(editor, /editingLessonId && newBooking\.time && !timeOptions\.includes\(newBooking\.time\)/)
    assert.doesNotMatch(page, /currentStudio\?\.settings\?\.business_start_hour \?\? 8/)
})

test('schedule and teaching planning use exactly the same booking component', () => {
    assert.match(page, /import LessonBookingDialog.*from "@\/components\/LessonBookingDialog"/)
    assert.match(list, /import LessonBookingDialog.*from '@\/components\/LessonBookingDialog'/)
    assert.match(page, /<LessonBookingDialog\s/)
    assert.match(list, /<LessonBookingDialog\s/)
    assert.match(page, /onSubmit=\{handleBooking\}/)
    assert.match(list, /onSubmit=\{saveLessonBooking\}/)
    assert.doesNotMatch(list, /lessonData|setLessonData|isSpecialBooking/)
    assert.match(editor, /Notizen \/ Terminbeschreibung/)
    assert.match(editor, /Sondertermin/)
    assert.match(editor, /newBooking\.cancellation_reason/)
})

test('new appointments default to the real Peter Sartori teacher record', () => {
    assert.match(page, /toLocaleLowerCase\("de-DE"\) === "peter sartori"/)
    assert.match(list, /toLocaleLowerCase\('de-DE'\) === 'peter sartori'/)
    assert.match(editor, /teacherManuallyChanged\.current = false/)
    assert.match(editor, /!teacherManuallyChanged\.current/)
    assert.match(editor, /teacherManuallyChanged\.current = true/)
    assert.match(editor, /!editingLessonId && preferredTeacherId/)
})

test('student selection uses the same contract-based lesson length everywhere', () => {
    assert.match(editor, /"\/students\/" \+ encodeURIComponent\(studentId\) \+ "\/contract\/"/)
    assert.match(editor, /data\.contract\?\.lesson_minutes/)
    assert.match(editor, /minutes === 30 \|\| minutes === 45 \|\| minutes === 60/)
    assert.match(editor, /prev\.student === studentId/)
    assert.match(editor, /!open \|\| editingLessonId \|\| bookingMode !== "individual"/)
})

test('editing existing lessons preserves their teacher, duration and notes', () => {
    assert.match(page, /teacher: lesson\.teacher \|\| ""/)
    assert.match(page, /duration: lesson\.duration_minutes/)
    assert.match(list, /duration: lesson\.duration_minutes \|\| Math\.round/)
    assert.match(list, /summary: lesson\.summary \|\| ''/)
    assert.match(editor, /durationManuallyChanged\.current = true/)
    assert.match(editor, /if \(!active \|\| durationManuallyChanged\.current\) return/)
})

test('new appointments from both weekly and monthly views clear edit state', () => {
    const uses = page.match(/resetBooking\(\);\s*setNewBooking\(\(previous\) => \(\{/g) || []
    assert.equal(uses.length, 2)
    assert.match(page, /setEditingLessonId\(null\)/)
    assert.match(list, /const openNewLesson = \(\) => \{/)
})

test('alternating hourly backgrounds remain visible in all seven days', () => {
    assert.match(page, /hour % 2 === 0 \? "bg-slate-100\/80" : "bg-white"/)
    assert.match(page, /border-b border-slate-200\/70/)
    assert.match(page, /weekDays\.map\(\(day, dayIdx\) => \{/)
    assert.match(page, /getMinutes\(parseISO\(lesson\.scheduled_start\)\)/)
    assert.match(page, /WEEK_HOUR_HEIGHT/)
})


test('time rail and all seven weekday headers use the same fully opaque grey', () => {
    assert.match(page, /<thead className="bg-slate-200 sticky top-0/)
    assert.match(page, /z-30 bg-slate-200 border-r/)
    assert.match(page, /min-w-\[140px\] bg-slate-200 border-b/)
    assert.match(page, /border-r border-slate-300\/60 bg-slate-200 sticky left-0/)
    assert.doesNotMatch(page, /bg-slate-200\/80/)
    assert.equal((page.match(/bg-slate-200(?=[\s"])/g) || []).length, 5)
})


test('cancelled appointments stay red regardless of current color grouping', () => {
    assert.match(page, /if \(colorMode === "status" \|\| lesson\.status === "scheduled" \|\| lesson\.status === "cancelled" \|\| lesson\.status === "completed"\) return \{\};/)
    assert.equal(
        (page.match(/\(colorMode === "status" \|\| lesson\.status === "scheduled" \|\| lesson\.status === "cancelled" \|\| lesson\.status === "completed"\)/g) || []).length,
        3
    )
    assert.match(page, /lesson\.status === "cancelled" \? "bg-red-50 border-red-400"/)
})

test('weekday header and time rail share one opaque color value', () => {
    assert.match(page, /const WEEK_CHROME_COLOR = "#e2e8f0";/)
    assert.equal((page.match(/style=\{\{ backgroundColor: WEEK_CHROME_COLOR \}\}/g) || []).length, 5)
    assert.doesNotMatch(page, /bg-slate-200\/80/)
})

test('only the calendar colors completed lessons green; planning list styling stays unchanged', () => {
    assert.match(page, /lesson\.status === "completed" \? "bg-emerald-50 border-emerald-400"/)
    assert.match(page, /lesson\.status === "completed" \? "bg-emerald-50 border-emerald-400 text-emerald-800"/)
    assert.match(page, /lesson\.status === "scheduled" \? "bg-blue-50 border-blue-200 text-blue-700/)
    assert.match(page, /lesson\.status === "cancelled" \? "bg-red-50 border-red-400"/)
    assert.match(list, /completed: 'bg-green-50 text-green-700 border-green-200'/)
    assert.doesNotMatch(list, /bg-emerald-50\/60 hover:bg-emerald-50/)
})

test('scheduled lessons use the planning-list blue in week and month calendar only', () => {
    assert.match(page, /lesson\.status === "scheduled" \? "bg-blue-50 border-blue-200 text-blue-700 cursor-pointer hover:bg-blue-100"/)
    assert.match(page, /lesson\.status === "scheduled" \? "bg-blue-50 border-blue-200 text-blue-700"/)
    assert.match(list, /scheduled: 'bg-blue-50 text-blue-700 border-blue-200'/)
    assert.match(page, /lesson\.status === "completed" \? "bg-emerald-50 border-emerald-400"/)
    assert.match(page, /lesson\.status === "cancelled" \? "bg-red-50 border-red-400"/)
})

test('calendar cancellation origin is chosen in both entry points and translated', () => {
    const de = JSON.parse(source('messages/de.json')).Schedule
    const en = JSON.parse(source('messages/en.json')).Schedule
    for (const lang of [de, en]) {
        for (const key of [
            'cancellationKind', 'chooseCancellationKind',
            'studentCancelledCredited', 'teacherCancelledNotCredited',
            'studentCancellationQuotaNote', 'teacherCancellationQuotaNote',
            'cancellationKindRequired',
        ]) assert.ok(lang[key], 'Missing cancellation translation: ' + key)
    }
    assert.match(editor, /cancellation_kind: "" \| "student_cancelled" \| "teacher_cancelled"/)
    assert.match(editor, /value=\{newBooking\.cancellation_kind\}/)
    assert.match(editor, /<option value="teacher_cancelled">/)
    assert.match(editor, /<option value="student_cancelled">/)
    assert.match(page, /payload\.cancellation_kind = bookingMode === "individual"/)
    assert.match(list, /payload\.cancellation_kind = bookingMode === 'individual'/)
    assert.match(page, /cancellation_kind: lesson\.cancellation_kind \|\| ""/)
    assert.match(list, /cancellation_kind: lesson\.cancellation_kind \|\| ''/)
    assert.match(page, /requiresCancellationKind:/)
    assert.match(list, /requiresCancellationKind:/)
    assert.match(page, /cancellation_kind: cancellationKind/)
    assert.match(list, /cancellation_kind: cancellationKind/)
})

test('running status is not offered in the shared lesson editor', () => {
    assert.doesNotMatch(editor, /<option value="in_progress">/)
    for (const status of ['scheduled', 'completed', 'cancelled', 'no_show']) {
        assert.match(editor, new RegExp('<option value="' + status + '">'))
    }
})

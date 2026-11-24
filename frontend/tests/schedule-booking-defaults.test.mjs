import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(
    new URL('../app/dashboard/schedule/page.tsx', import.meta.url), 'utf8',
)

test('MUSart calendar displays 13:00 to 22:00 without rewriting studio settings', () => {
    assert.match(page, /const businessStart = 13;/)
    assert.match(page, /const businessEnd = 22;/)
    assert.match(page, /time: bookingDefaults\.time/)
    assert.match(page, /businessStart\.toString\(\)\.padStart\(2, "0"\)/)
    assert.doesNotMatch(page, /currentStudio\?\.settings\?\.business_start_hour \?\? 8/)
})

test('new appointments default to the actual Peter Sartori teacher record', () => {
    assert.match(page, /toLocaleLowerCase\("de-DE"\) === "peter sartori"/)
    assert.match(page, /teacher: preferredTeacherId/g)
    assert.match(page, /teacherManuallyChanged\.current = false/)
    assert.match(page, /!teacherManuallyChanged\.current/)
    assert.match(page, /teacherManuallyChanged\.current = true/g)
    assert.match(page, /showBookingModal && !editingLessonId && preferredTeacherId/)
})

test('selecting an individual student reads the existing contract length', () => {
    assert.match(page, /"\/students\/" \+ encodeURIComponent\(studentId\) \+ "\/contract\/"/)
    assert.match(page, /data\.contract\?\.lesson_minutes/)
    assert.match(page, /minutes === 30 \|\| minutes === 45 \|\| minutes === 60/)
    assert.match(page, /previous\.student === studentId/)
    assert.match(page, /!showBookingModal \|\| editingLessonId \|\| bookingMode !== "individual"/)
})

test('editing existing appointments preserves their teacher and duration', () => {
    assert.match(page, /teacher: lesson\.teacher \|\| ""/)
    assert.match(page, /duration: lesson\.duration_minutes/)
    assert.match(page, /durationManuallyChanged\.current = true/)
    assert.match(page, /if \(!active \|\| durationManuallyChanged\.current\) return/)
})

test('new appointments from weekly and monthly grid reset stale editing values', () => {
    const uses = page.match(/resetBooking\(\);\s*setNewBooking\(\(previous\) => \(\{/g) || []
    assert.equal(uses.length, 2)
    assert.match(page, /setEditingLessonId\(null\)/)
})

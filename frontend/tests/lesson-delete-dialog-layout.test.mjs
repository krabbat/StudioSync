import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const dialog = source('components/LessonDeleteDialog.tsx')
const de = JSON.parse(source('messages/de.json')).LessonCancellation
const en = JSON.parse(source('messages/en.json')).LessonCancellation

test('all delete-dialog explanations and buttons are fully localized', () => {
    assert.match(dialog, /useTranslations\('LessonCancellation'\)/)
    const keys = [
        'title', 'recurringExplanation', 'singleExplanation', 'seriesExplanation',
        'permanentExplanation', 'cancellationKind', 'chooseCancellationKind',
        'studentCancelledCredited', 'teacherCancelledNotCredited',
        'studentCancellationQuotaNote', 'teacherCancellationQuotaNote',
        'onlyForSingleCancellation', 'deleteThis', 'deleteSingle',
        'deleteFuture', 'deletePermanent', 'cancel',
    ]
    for (const key of keys) {
        assert.ok(de[key], 'Missing German translation: ' + key)
        assert.ok(en[key], 'Missing English translation: ' + key)
    }
    assert.match(de.recurringExplanation, /Wähle, welche Termine entfernt werden sollen/)
    assert.match(de.seriesExplanation, /Bereits erteilte oder bezahlte Unterrichtsstunden/)
})

test('destructive buttons never overflow narrow dialog and remain stacked', () => {
    assert.match(dialog, /<DialogFooter className="!flex !flex-col !items-stretch gap-3">/)
    assert.equal((dialog.match(/className="w-full min-w-0 h-auto min-h-11/g) || []).length, 3)
    assert.match(dialog, /whitespace-normal text-center leading-snug/)
    assert.match(dialog, /break-words/)
})

test('single cancellation explicitly chooses between teacher and student responsibility', () => {
    assert.match(dialog, /requiresCancellationKind/)
    assert.match(dialog, /cancellationKind/)
    assert.match(dialog, /<option value="student_cancelled">/)
    assert.match(dialog, /<option value="teacher_cancelled">/)
    assert.match(dialog, /Boolean\(target\?\.requiresCancellationKind\) && !cancellationKind/)
    assert.match(dialog, /onConfirm\('this', cancellationKind \|\| undefined\)/)
    assert.match(dialog, /onConfirm\('future'\)/)
    assert.match(dialog, /onConfirm\('permanent'\)/)
    assert.match(dialog, /onClick=\{onClose\} disabled=\{busy\}/)
})

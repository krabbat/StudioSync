import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../app/dashboard/students/[id]/page.tsx', import.meta.url), 'utf8')
test('student photo opens an in-page accessible viewer without a browser popup', () => {
    assert.doesNotMatch(page, /window\.open\(/)
    assert.match(page, /<Dialog open=\{photoOpen && Boolean\(photoUrl\)\} onClose=\{setPhotoOpen\}/)
    assert.match(page, /setPhotoOpen\(true\)/)
    assert.match(page, /setPhotoOpen\(false\)/)
    assert.match(page, /aria-label=\{tr\('closePhoto'\)\}/)
    assert.match(page, /max-h-\[calc\(100dvh-7rem\)\].*object-contain/)
})

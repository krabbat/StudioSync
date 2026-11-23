import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('mail screen is the two-pane workspace, preserving the old chat for other roles', () => {
    const page = source('app/dashboard/messages/page.tsx')
    assert.match(page, /<MailWorkspace\s*\/>/)
    assert.match(page, /currentUser\.role !== 'admin'/)
    assert.match(page, /<MessagingCenter\s*\/>/)
})

test('dashboard menu is an overlay instead of permanent reserved width', () => {
    const layout = source('app/dashboard/layout.tsx')
    const sidebar = source('components/Sidebar.tsx')
    assert.doesNotMatch(layout, /md:ml-64/)
    assert.match(sidebar, /className="studiosync-sidebar fixed/)
    assert.doesNotMatch(sidebar, /hidden md:flex fixed/)
    assert.match(layout, /compact=\{isMailPage\}/)
})

test('mail page splits the list and reader with movable divider', () => {
    const jsx = source('components/mail/MailWorkspace.tsx')
    const css = source('app/dashboard/messages/mail.css')
    assert.match(jsx, /role="separator"/)
    assert.match(jsx, /onPointerDown=\{startResizing\}/)
    assert.match(css, /grid-template-columns:\s*minmax\(var\(--mail-min-list-width\), var\(--mail-list-width\)\)/)
})

test('mail design uses shared template tokens instead of a separate theme', () => {
    const globals = source('app/globals.css')
    const css = source('app/dashboard/messages/mail.css')
    for (const token of [
        '--mail-list-width', '--mail-page-background', '--mail-panel-background',
        '--mail-border-color', '--mail-panel-shadow', '--dashboard-content-gap',
    ]) assert.ok(globals.includes(token), token)
    assert.match(css, /var\(--mail-panel-background\)/)
})

test('preview is visibly identified and cannot send real mail', () => {
    const jsx = source('components/mail/MailWorkspace.tsx')
    assert.match(jsx, /Vorschau · Beispieldaten/)
    assert.match(jsx, /Noch kein Versand und keine dauerhafte Entwurfsspeicherung/)
    assert.match(jsx, /className="mail-send-button" disabled/)
    assert.match(jsx, /example\.invalid/)
})

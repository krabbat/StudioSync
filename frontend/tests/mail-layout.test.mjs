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

test('sidebar is a stable icon rail with an expanding overlay and no scroll locking', () => {
    const layout = source('app/dashboard/layout.tsx')
    const sidebar = source('components/Sidebar.tsx')
    const css = source('app/globals.css')
    assert.doesNotMatch(layout, /md:ml-64/)
    assert.match(layout, /dashboard-content-column/)
    assert.match(sidebar, /studiosync-sidebar.*is-expanded.*is-collapsed/)
    assert.match(sidebar, /studiosync-sidebar-icon/)
    assert.doesNotMatch(sidebar, /document\.body\.style\.overflow/)
    assert.doesNotMatch(sidebar, /AnimatePresence|motion\.aside/)
    assert.match(css, /--dashboard-sidebar-rail-width:\s*60px/)
    assert.match(css, /--dashboard-sidebar-expanded-width/)
    assert.match(css, /\.dashboard-content-column\s*\{\s*padding-left:/)
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


test('visible messages can be multi-selected and batched without changing hidden mail', () => {
    const jsx = source('components/mail/MailWorkspace.tsx')
    const css = source('app/dashboard/messages/mail.css')
    assert.match(jsx, /selectedMailIds/)
    assert.match(jsx, /visibleIds\.filter\(\(id\) => selectedMailIds\.includes\(id\)\)/)
    assert.match(jsx, /checked=\{allVisibleSelected\}/)
    assert.match(jsx, /indeterminate = partiallySelected/)
    assert.match(jsx, /onChange=\{toggleAllVisible\}/)
    assert.match(jsx, /onChange=\{\(\) => toggleMessageSelection\(message\.id\)\}/)
    assert.match(jsx, /bulkMarkRead\(true\)/)
    assert.match(jsx, /bulkMarkRead\(false\)/)
    assert.match(jsx, /bulkMove\('spam'\)/)
    assert.match(jsx, /bulkMove\('archive'\)/)
    assert.match(jsx, /new Set\(selectedVisibleIds\)/)
    assert.match(css, /\.mail-bulk-toolbar/)
    assert.match(css, /\.mail-message-select/)
})

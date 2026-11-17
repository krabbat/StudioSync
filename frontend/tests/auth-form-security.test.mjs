import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// React may not be hydrated when a form is submitted, e.g. during a hot
// reload. Never let native HTML form submission put credentials into a URL.
for (const page of ['login', 'signup', 'forgot-password', 'reset-password']) {
    test(`${page} form cannot submit sensitive fields via native GET`, () => {
        const source = readFileSync(new URL(`../app/${page}/page.tsx`, import.meta.url), 'utf8')
        assert.match(source, /<form\s+method="post"/)
        assert.match(source, /disabled=\{!isHydrated\s*\|\|/)
        assert.match(source, /setIsHydrated\(true\)/)
    })
}

test('login API sends credentials in POST body, not URL query parameters', () => {
    const source = readFileSync(new URL('../contexts/UserContext.tsx', import.meta.url), 'utf8')
    assert.match(source, /fetch\(\x60\$\{API_URL\}\/auth\/token\/\x60,[\s\S]*?method:\s*'POST'/)
    assert.match(source, /body:\s*JSON\.stringify\(\{\s*email,\s*password:\s*pass\s*\}\)/)
})

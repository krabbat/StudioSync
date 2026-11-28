import test from 'node:test'
import assert from 'node:assert/strict'
import { createTokenRefresher } from '../services/tokenRefresh.mjs'

function session() {
    const values = new Map([['accessToken', 'access-0'], ['refreshToken', 'refresh-0']])
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
    let calls = 0
    const refresh = createTokenRefresher({ storage, request: async token => {
        assert.equal(token, 'refresh-' + calls)
        calls++
        return { access: 'access-' + calls, refresh: 'refresh-' + calls }
    } })
    return { storage, refresh, calls: () => calls }
}

test('stores rotated refresh token and uses it at the next expiration', async () => {
    const s = session()
    assert.equal(await s.refresh('access-0'), 'access-1')
    assert.equal(s.storage.getItem('refreshToken'), 'refresh-1')
    assert.equal(await s.refresh('access-1'), 'access-2')
    assert.equal(s.storage.getItem('refreshToken'), 'refresh-2')
    assert.equal(s.calls(), 2)
})

test('parallel failures share one refresh and delayed failures reuse newest access', async () => {
    const s = session()
    assert.deepEqual(await Promise.all([s.refresh('access-0'), s.refresh('access-0'), s.refresh('access-0')]), ['access-1','access-1','access-1'])
    assert.equal(await s.refresh('access-0'), 'access-1')
    assert.equal(s.calls(), 1)
})

test('failed rotation does not replace stored tokens', async () => {
    const s = session()
    const refresh = createTokenRefresher({ storage: s.storage, request: async () => { throw new Error('network') } })
    await assert.rejects(refresh('access-0'), /network/)
    assert.equal(s.storage.getItem('refreshToken'), 'refresh-0')
    assert.equal(s.storage.getItem('accessToken'), 'access-0')
})

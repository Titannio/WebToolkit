import { describe, it, expect, vi } from 'vitest'
import { fetchWithTimeout } from '@src/network/http.js'

describe('HTTP Utils', () => {
    describe('fetchWithTimeout', () => {
        it('should call fetch with an abort signal', async () => {
            const response = new Response('ok')
            const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

            await expect(fetchWithTimeout('https://example.com')).resolves.toBe(response)
            expect(fetchMock).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
                signal: expect.any(AbortSignal),
            }))

            fetchMock.mockRestore()
        })

        it('should abort when the upstream signal aborts', async () => {
            const upstream = new AbortController()
            let receivedSignal: AbortSignal | undefined
            const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
                receivedSignal = init?.signal ?? undefined
                upstream.abort()
                return new Response('ok')
            })

            await fetchWithTimeout('https://example.com', { signal: upstream.signal })
            expect(receivedSignal?.aborted).toBe(true)

            fetchMock.mockRestore()
        })

        it('should abort immediately when upstream signal is already aborted', async () => {
            const upstream = new AbortController()
            upstream.abort()

            let receivedSignal: AbortSignal | undefined
            const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
                receivedSignal = init?.signal ?? undefined
                return new Response('ok')
            })

            await fetchWithTimeout('https://example.com', { signal: upstream.signal })
            expect(receivedSignal?.aborted).toBe(true)

            fetchMock.mockRestore()
        })

        it('should trigger timeout abort callback', async () => {
            vi.useFakeTimers()

            const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
                async (_input, init) =>
                    new Promise((resolve) => {
                        init?.signal?.addEventListener('abort', () => resolve(new Response('timeout-aborted')))
                    }),
            )

            const responsePromise = fetchWithTimeout('https://example.com', {}, { timeoutMs: 10 })
            await vi.advanceTimersByTimeAsync(20)
            const response = await responsePromise

            expect(await response.text()).toBe('timeout-aborted')

            fetchMock.mockRestore()
            vi.useRealTimers()
        })
    })
})










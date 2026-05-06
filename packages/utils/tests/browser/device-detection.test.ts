import { describe, it, expect } from 'vitest'
import { detectDeviceType, DEVICE_TYPE } from '@src/browser/device-detection.js'

describe('device detection utils', () => {
    describe('detectDeviceType', () => {
        it('should return null if userAgent is not provided', () => {
            expect(detectDeviceType(undefined)).toBeNull()
        })

        it('should detect tablet devices', () => {
            const ipad = 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)'
            const androidTablet = 'Mozilla/5.0 (Linux; Android 10; SM-T860)'
            const silk = 'Mozilla/5.0 (Linux; Android 4.4.2; Kindle Fire HDX 7" Build/KFTHWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/3.47 like Chrome/37.0.2062.94 Safari/537.36'
            
            expect(detectDeviceType(ipad)).toBe(DEVICE_TYPE.TABLET)
            expect(detectDeviceType(androidTablet)).toBe(DEVICE_TYPE.TABLET)
            expect(detectDeviceType(silk)).toBe(DEVICE_TYPE.TABLET)
        })

        it('should detect mobile devices', () => {
            const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
            const androidMobile = 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.101 Mobile Safari/537.36'
            const blackberry = 'Mozilla/5.0 (BlackBerry; U; BlackBerry 9800; en) AppleWebKit/534.1+ (KHTML, like Gecko) Version/6.0.0.141 Mobile Safari/534.1+'
            
            expect(detectDeviceType(iphone)).toBe(DEVICE_TYPE.MOBILE)
            expect(detectDeviceType(androidMobile)).toBe(DEVICE_TYPE.MOBILE)
            expect(detectDeviceType(blackberry)).toBe(DEVICE_TYPE.MOBILE)
        })

        it('should return desktop by default', () => {
            const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.101 Safari/537.36'
            const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:80.0) Gecko/20100101 Firefox/80.0'
            
            expect(detectDeviceType(chrome)).toBe(DEVICE_TYPE.DESKTOP)
            expect(detectDeviceType(firefox)).toBe(DEVICE_TYPE.DESKTOP)
        })

        it('should detect android without mobile string as tablet', () => {
             // Some tablets don't include "mobile" in their UA
            const androidNoMobile = 'Mozilla/5.0 (Linux; Android 9; SM-T510)'
            expect(detectDeviceType(androidNoMobile)).toBe(DEVICE_TYPE.TABLET)
        })
    })
})










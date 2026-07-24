import { describe, it, expect, vi } from 'vitest';
import { 
    formatCurrencyBRL, 
    toNumberFromBRL, 
    formatBRL, 
    toNumberBRL, 
    toBRLInput, 
    allowCurrencyKey 
} from '@src/countries/BR/finance.js';
import { BadRequestError } from '@src/core/errors.js';

describe('brazilian finance utils', () => {
    describe('formatCurrencyBRL', () => {
        it('should format numeric values as BRL currency', () => {
            // Use regex to handle non-breaking spaces and different formatting of BRL in different environments
            const formatted = formatCurrencyBRL(1234.56);
            expect(formatted).toMatch(/R\$\s?1\.234,56/);
        });

        it('should throw BadRequestError for null or undefined', () => {
            expect(() => formatCurrencyBRL(null)).toThrow(BadRequestError);
            expect(() => formatCurrencyBRL(undefined)).toThrow(BadRequestError);
        });

        it('should handle zero value', () => {
            const formatted = formatCurrencyBRL(0);
            expect(formatted).toMatch(/R\$\s?0,00/);
        });
    });

    describe('toNumberFromBRL', () => {
        it('should parse BRL currency string correctly', () => {
            expect(toNumberFromBRL('1.234,56')).toBe(1234.56);
            expect(toNumberFromBRL('R$ 1.234,56')).toBe(1234.56);
        });

        it('should handle integer values in BRL format', () => {
            expect(toNumberFromBRL('1.234')).toBe(1234);
            expect(toNumberFromBRL('1234')).toBe(1234);
        });

        it('should throw BadRequestError for invalid BRL strings', () => {
            expect(() => toNumberFromBRL('invalid')).toThrow(BadRequestError);
            expect(() => toNumberFromBRL(null)).toThrow(BadRequestError);
            expect(() => toNumberFromBRL('')).toThrow(BadRequestError);
        });
    });

    describe('formatBRL', () => {
        it('should format raw digits into BRL display format', () => {
            expect(formatBRL('123456')).toMatch(/R\$\s?1\.234,56/);
            expect(formatBRL('100')).toMatch(/R\$\s?1,00/);
            expect(formatBRL('50')).toMatch(/R\$\s?0,50/);
        });

        it('should handle empty or non-numeric input', () => {
            expect(formatBRL('')).toMatch(/R\$\s?0,00/);
            expect(formatBRL('abc')).toMatch(/R\$\s?0,00/);
        });
    });

    describe('toNumberBRL', () => {
        it('should convert BRL display string to number', () => {
            expect(toNumberBRL('1.234,56')).toBe(1234.56);
            expect(toNumberBRL('1,50')).toBe(1.5);
            expect(toNumberBRL('0,00')).toBe(0);
        });

        it('should return 0 for invalid inputs', () => {
            expect(toNumberBRL('')).toBe(0);
            expect(toNumberBRL('abc')).toBe(0);
        });
    });

    describe('toBRLInput', () => {
        it('should format number for BRL input field', () => {
            expect(toBRLInput(1234.56)).toBe('1.234,56');
            expect(toBRLInput(1000)).toBe('1.000,00');
            expect(toBRLInput(0.5)).toBe('0,50');
        });

        it('should handle zero and falsy values', () => {
            expect(toBRLInput(0)).toBe('0,00');
            expect(toBRLInput(null as any)).toBe('0,00');
            expect(toBRLInput(undefined as any)).toBe('0,00');
            expect(toBRLInput(NaN as any)).toBe('0,00');
        });
    });

    describe('allowCurrencyKey', () => {
        it('should allow numeric keys', () => {
            const preventDefault = vi.fn();
            const event = { key: '5', preventDefault };
            allowCurrencyKey(event);
            expect(preventDefault).not.toHaveBeenCalled();
        });

        it('should allow control keys', () => {
            const preventDefault = vi.fn();
            const event = { key: 'Backspace', preventDefault };
            allowCurrencyKey(event);
            expect(preventDefault).not.toHaveBeenCalled();
        });

        it('should allow comma key', () => {
            const preventDefault = vi.fn();
            const event = { key: ',', preventDefault };
            allowCurrencyKey(event);
            expect(preventDefault).not.toHaveBeenCalled();
        });

        it('should prevent non-numeric keys', () => {
            const preventDefault = vi.fn();
            const event = { key: 'a', preventDefault };
            allowCurrencyKey(event);
            expect(preventDefault).toHaveBeenCalled();
        });

        it('should allow ctrl+v', () => {
            const preventDefault = vi.fn();
            const event = { key: 'v', ctrlKey: true, preventDefault };
            allowCurrencyKey(event);
            expect(preventDefault).not.toHaveBeenCalled();
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard, shareContent } from '@src/browser/share.js';

describe('share utils', () => {
  beforeEach(() => {
    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
    // Mock navigator.share
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });
  });

  describe('copyToClipboard', () => {
    it('should copy text to clipboard', async () => {
      await expect(copyToClipboard('hello')).resolves.toBeUndefined();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
    });

    it('should throw error if clipboard is not available', async () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      await expect(copyToClipboard('hello')).rejects.toThrow('Clipboard API not available');
    });
  });

  describe('shareContent', () => {
    it('should call navigator.share if available', async () => {
      const content = { title: 't', text: 'd', url: 'u' };
      await shareContent(content);
      expect(navigator.share).toHaveBeenCalledWith(content);
    });

    it('should not throw if navigator.share fails', async () => {
      (navigator.share as any).mockRejectedValueOnce(new Error('fail'));
      await expect(shareContent({ title: 't', text: 'd', url: 'u' })).resolves.toBeUndefined();
    });

    it('should do nothing if navigator.share is not available', async () => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      await expect(shareContent({ title: 't', text: 'd', url: 'u' })).resolves.toBeUndefined();
    });
  });
});

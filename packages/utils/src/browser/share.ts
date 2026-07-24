/**
 * @module share
 * @description Utilities for sharing content via the Web Share API or clipboard.
 */

/**
 * Content to be shared using the Web Share API.
 */
export interface ShareContent {
  /** The title of the content to be shared. */
  title: string
  /** The descriptive text of the content to be shared. */
  text: string
  /** The URL of the content to be shared. */
  url: string
}

/**
 * Copies the given text to the clipboard.
 * 
 * @param {string} text - The text to be copied to the clipboard.
 * @returns {Promise<void>} A promise that resolves when the copy operation is successful.
 * 
 * @example
 * ```typescript
 * await copyToClipboard('https://example.com');
 * ```
 */
export const copyToClipboard = async (text: string): Promise<void> => {
  if (!navigator?.clipboard) {
    throw new Error('Clipboard API not available');
  }
  return navigator.clipboard.writeText(text);
}

/**
 * Shares content using the Web Share API if available.
 * 
 * If the browser doesn't support the Web Share API, no action is taken.
 * If the user cancels the share operation, the error is caught and ignored.
 * 
 * @param {ShareContent} content - An object containing the title, text, and URL to be shared.
 * @returns {Promise<void>} A promise that resolves when the share operation is completed or cancelled.
 * 
 */
export const shareContent = async (content: ShareContent): Promise<void> => {
  if (navigator?.share) {
    try {
      await navigator.share(content)
    } catch {
      // User cancelled share, or other error. Do nothing.
      void 0
    }
  }
}

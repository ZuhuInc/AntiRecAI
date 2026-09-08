/**
 * Gemini Web DOM Helper functions for AntiRecAI
 * Handles DOM element resolution and simulated input interactions.
 */

function findGeminiInput() {
  const selectors = [
    'div[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    'div[role="textbox"]',
    '.ql-editor',
    'textarea',
    'rich-textarea'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) {
      return el;
    }
  }
  return null;
}

function findSendButton() {
  const selectors = [
    'button[aria-label*="Send prompt"]',
    'button[aria-label*="Send message"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="Submit"]',
    'button.send-button',
    'button[mattooltip*="Send"]',
    'button:has(mat-icon[data-mat-icon-name="send"])',
    'button:has(svg)'
  ];

  for (const selector of selectors) {
    const btn = document.querySelector(selector);
    if (btn && btn.offsetParent !== null && !btn.disabled) {
      return btn;
    }
  }

  // Fallback: look for buttons with send-like text or icons
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('send') || label.includes('submit')) {
      return btn;
    }
  }

  return null;
}

function insertPromptText(targetEl, text) {
  targetEl.focus();

  // Try document.execCommand first for rich text editor compatibility
  const success = document.execCommand('insertText', false, text);

  if (!success) {
    if (targetEl.tagName.toLowerCase() === 'textarea' || targetEl.tagName.toLowerCase() === 'input') {
      targetEl.value += text;
    } else {
      const p = targetEl.querySelector('p') || targetEl;
      p.innerText = (p.innerText ? p.innerText + ' ' : '') + text;
    }

    targetEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }
}

module.exports = {
  findGeminiInput,
  findSendButton,
  insertPromptText
};

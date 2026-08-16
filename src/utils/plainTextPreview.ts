/** About 5–6 lines of 12px text at a typical Kanban card width. */
export const SHRINK_CARD_TOOLTIP_MAX_CHARS = 220;

export function htmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncatePlainText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function shrinkCardDescriptionPreview(html: string): string {
  return truncatePlainText(htmlToPlainText(html), SHRINK_CARD_TOOLTIP_MAX_CHARS);
}

/** Keep lists, breaks, and tables; stop after a plain-text character budget. */
export function truncateHtmlByChars(html: string, maxChars: number = SHRINK_CARD_TOOLTIP_MAX_CHARS): string {
  if (typeof document === 'undefined') return html;
  const root = document.createElement('div');
  root.innerHTML = html;
  const plain = (root.textContent || '').replace(/\s+/g, ' ').trim();
  if (plain.length <= maxChars) return root.innerHTML;

  let remaining = maxChars;
  let cut = false;

  const removeFollowing = (node: Node) => {
    let current: Node | null = node;
    while (current && current !== root) {
      let sib = current.nextSibling;
      while (sib) {
        const next = sib.nextSibling;
        sib.parentNode?.removeChild(sib);
        sib = next;
      }
      current = current.parentNode;
    }
  };

  const visit = (node: Node) => {
    if (cut) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text.length <= remaining) {
        remaining -= text.length;
        return;
      }
      node.textContent = `${text.slice(0, Math.max(0, remaining)).trimEnd()}…`;
      remaining = 0;
      cut = true;
      removeFollowing(node);
      return;
    }
    Array.from(node.childNodes).forEach(visit);
  };

  visit(root);
  return root.innerHTML;
}

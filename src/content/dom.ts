type Child = Node | string | number | null | undefined | false;
type Props = {
  className?: string;
  title?: string;
  [attr: `data-${string}`]: string;
  [attr: `aria-${string}`]: string;
  role?: string;
  dir?: string;
  type?: string;
  href?: string;
  target?: string;
  rel?: string;
  disabled?: boolean;
  open?: boolean;
  onClick?: (e: MouseEvent) => void;
};

/** Tiny element builder. Strings become text nodes (never HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'className') el.className = String(value);
    else if (key === 'onClick') el.addEventListener('click', value as (e: Event) => void);
    else if (key === 'disabled') (el as HTMLButtonElement).disabled = Boolean(value);
    else if (key === 'open') (el as HTMLDetailsElement).open = Boolean(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Octicon-style 16px icons, drawn inline so we don't depend on GitHub's sprite. */
const ICONS = {
  check: 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
  eye: 'M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z',
  triangleDown: 'm4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z',
  filter: 'M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.75A.75.75 0 0 1 3.75 7h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.75Zm3 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z',
} as const;

export function icon(name: keyof typeof ICONS, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.appendChild(path);
  return svg;
}

/**
 * Click handler that only runs for real user input (mouse, keyboard, assistive tech). Scripts on
 * the page can call .click() on our buttons; those synthetic clicks have isTrusted === false.
 */
export function userClick(fn: () => void): (e: MouseEvent) => void {
  return (e) => {
    if (e.isTrusted) fn();
  };
}

/** Calls fn at most once per `ms`, trailing. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** True if the user has typed something we'd lose by reloading (a review comment, a reply...). */
export function hasUnsavedText(): boolean {
  return [...document.querySelectorAll('textarea')].some((t) => t.value.trim().length > 0);
}

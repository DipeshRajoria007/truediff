// Uses GitHub's Primer CSS variables (with fallbacks) so light, dark and dimmed themes all match.
export const CSS = /* css */ `
.td-root {
  --td-fg: var(--fgColor-default, #1f2328);
  --td-muted: var(--fgColor-muted, #59636e);
  --td-border: var(--borderColor-default, #d1d9e0);
  --td-bg: var(--bgColor-default, #ffffff);
  --td-bg-muted: var(--bgColor-muted, #f6f8fa);
  --td-add: var(--fgColor-success, #1a7f37);
  --td-del: var(--fgColor-danger, #d1242f);
  --td-accent: var(--fgColor-accent, #0969da);
  font-size: 13px;
  line-height: 20px;
  color: var(--td-fg);
}
.td-add { color: var(--td-add); font-weight: 600; font-variant-numeric: tabular-nums; }
.td-del { color: var(--td-del); font-weight: 600; font-variant-numeric: tabular-nums; }
.td-muted { color: var(--td-muted); }
.td-num { font-variant-numeric: tabular-nums; }

.td-size {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 18px; padding: 0 5px; border-radius: 9px;
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
}
.td-size-XS, .td-size-S { background: var(--bgColor-success-muted, #dafbe1); color: var(--fgColor-success, #1a7f37); }
.td-size-M { background: var(--bgColor-accent-muted, #ddf4ff); color: var(--fgColor-accent, #0969da); }
.td-size-L { background: var(--bgColor-attention-muted, #fff8c5); color: var(--fgColor-attention, #9a6700); }
.td-size-XL { background: var(--bgColor-danger-muted, #ffebe9); color: var(--fgColor-danger, #d1242f); }

/* ---------- PR page strip ---------- */
.td-strip {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
  margin: 8px 0 12px; padding: 6px 6px 6px 12px;
  border: 1px solid var(--td-border); border-radius: 6px; background: var(--td-bg-muted);
}
.td-strip.td-floating {
  position: fixed; right: 16px; bottom: 16px; z-index: 100; margin: 0; max-width: min(720px, calc(100vw - 32px));
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140,149,159,.2)); background: var(--td-bg);
}
.td-brand { font-weight: 600; color: var(--td-muted); font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.td-group { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.td-label { font-weight: 600; }
.td-sep { width: 1px; align-self: stretch; background: var(--td-border); }
.td-spacer { flex: 1 1 auto; }
.td-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.td-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px;
  font: inherit; font-size: 12px; font-weight: 500; line-height: 1; cursor: pointer; white-space: nowrap;
  color: var(--button-default-fgColor-rest, var(--td-fg));
  background: var(--button-default-bgColor-rest, #f6f8fa);
  border: 1px solid var(--button-default-borderColor-rest, var(--td-border)); border-radius: 6px;
}
.td-btn:hover:not(:disabled) { background: var(--button-default-bgColor-hover, #eff2f5); }
.td-btn:disabled { cursor: default; opacity: .6; }
.td-btn-primary {
  color: var(--button-primary-fgColor-rest, #fff);
  background: var(--button-primary-bgColor-rest, #1f883d);
  border-color: var(--button-primary-borderColor-rest, rgba(31,35,40,.15));
}
.td-btn-primary:hover:not(:disabled) { background: var(--button-primary-bgColor-hover, #1c8139); }
.td-link { font: inherit; padding: 0; border: 0; background: none; color: var(--td-accent); cursor: pointer; }
.td-link:hover { text-decoration: underline; }
.td-done { color: var(--td-add); font-weight: 600; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.td-error { color: var(--td-del); }
.td-flash { color: var(--td-add); font-size: 12px; }

/* Noise breakdown dropdown */
.td-details { position: relative; }
.td-details > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.td-details > summary::-webkit-details-marker { display: none; }
.td-details > summary .td-caret { transition: transform .12s; color: var(--td-muted); }
.td-details[open] > summary .td-caret { transform: rotate(180deg); }
.td-panel {
  position: absolute; z-index: 101; top: calc(100% + 6px); left: 0;
  width: min(640px, calc(100vw - 48px)); max-height: 60vh; overflow: auto;
  padding: 8px 0; border: 1px solid var(--td-border); border-radius: 8px; background: var(--td-bg);
  box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140,149,159,.2));
}
.td-floating .td-panel { top: auto; bottom: calc(100% + 6px); }
.td-panel h4 {
  margin: 8px 12px 4px; font-size: 12px; font-weight: 600; color: var(--td-muted);
  display: flex; justify-content: space-between; gap: 8px;
}
.td-panel ul { list-style: none; margin: 0; padding: 0; }
.td-panel li {
  display: flex; align-items: center; gap: 8px; padding: 2px 12px; font-size: 12px;
}
.td-panel li:hover { background: var(--td-bg-muted); }
.td-panel .td-path {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.td-panel .td-state { width: 14px; flex: none; color: var(--td-add); }
.td-panel-foot {
  display: flex; gap: 12px; align-items: center; margin-top: 6px; padding: 8px 12px 2px;
  border-top: 1px solid var(--td-border); font-size: 12px;
}

/* ---------- PR list badges ---------- */
.td-badge {
  display: inline-flex; align-items: center; gap: 5px; vertical-align: middle;
  margin-left: 8px; padding: 0 7px 0 2px; height: 20px; border-radius: 10px;
  border: 1px solid var(--td-border); background: var(--td-bg-muted);
  font-size: 12px; font-weight: 400; line-height: 18px; white-space: nowrap;
}
.td-badge .td-size { height: 16px; min-width: 20px; font-size: 10px; }
.td-badge-loading { width: 64px; opacity: .5; border-style: dashed; }
.td-badge-error { padding: 0 7px; color: var(--td-del); }
.td-badge .td-hidden { color: var(--td-muted); }
`;

let injected = false;
export function injectStyles(): void {
  if (injected && document.getElementById('truediff-styles')) return;
  const style = document.createElement('style');
  style.id = 'truediff-styles';
  style.textContent = CSS;
  (document.head ?? document.documentElement).appendChild(style);
  injected = true;
}

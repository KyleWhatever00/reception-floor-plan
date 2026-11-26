import { h, svgIcon } from './dom';
import { ICONS } from './icons';

export interface DialogAction {
  label: string;
  kind?: 'primary' | 'danger' | 'ghost';
  /** Return false to keep the dialog open. */
  onClick?: () => void | boolean | Promise<void | boolean>;
}

let openCount = 0;

/** Accessible modal dialog. Resolves with the index of the action pressed (-1 if dismissed). */
export function openDialog(opts: { title: string; body: Node | string; actions?: DialogAction[]; wide?: boolean; dismissable?: boolean; className?: string }): Promise<number> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const dismissable = opts.dismissable !== false;
    const close = (i: number) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      openCount--;
      previous?.focus?.();
      resolve(i);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        close(-1);
      }
    };
    const actions = (opts.actions ?? [{ label: 'Close', kind: 'primary' }]).map((a, i) =>
      h(
        'button',
        {
          class: `btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-ghost'}`,
          onclick: async () => {
            const r = await a.onClick?.();
            if (r !== false) close(i);
          },
        },
        a.label,
      ),
    );
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const dialog = h(
      'div',
      { class: `dialog ${opts.wide ? 'dialog-wide' : ''} ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h(
        'header',
        { class: 'dialog-header' },
        h('h2', { id: titleId }, opts.title),
        dismissable ? h('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close', onclick: () => close(-1) }, svgIcon(ICONS.close)) : null,
      ),
      h('div', { class: 'dialog-body' }, opts.body),
      h('footer', { class: 'dialog-actions' }, actions),
    );
    const backdrop = h('div', { class: 'dialog-backdrop', onclick: (e: MouseEvent) => e.target === backdrop && dismissable && close(-1) }, dialog);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    openCount++;
    requestAnimationFrame(() => {
      const first = dialog.querySelector<HTMLElement>('input, textarea, select') ?? actions[actions.length - 1];
      first?.focus();
    });
  });
}

export function isDialogOpen(): boolean {
  return openCount > 0;
}

export async function confirmDialog(title: string, message: string | Node, confirmLabel = 'Continue', danger = false): Promise<boolean> {
  const r = await openDialog({
    title,
    body: typeof message === 'string' ? h('p', null, message) : message,
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: confirmLabel, kind: danger ? 'danger' : 'primary' }],
  });
  return r === 1;
}

export async function promptDialog(title: string, label: string, initial = '', confirmLabel = 'Save'): Promise<string | null> {
  const input = h('input', { type: 'text', class: 'input', value: initial, 'aria-label': label });
  let value: string | null = null;
  const body = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (document.querySelector('.dialog .btn-primary') as HTMLButtonElement | null)?.click();
  });
  const r = await openDialog({
    title,
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: confirmLabel,
        kind: 'primary',
        onClick: () => {
          value = input.value;
        },
      },
    ],
  });
  return r === 1 ? value : null;
}

let toastHost: HTMLElement | null = null;

/** Short, non-blocking notification. `action` adds a button (e.g. Undo). */
export function toast(message: string, opts: { kind?: 'info' | 'error' | 'success'; action?: { label: string; onClick: () => void }; ms?: number } = {}): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const el = h(
    'div',
    { class: `toast toast-${opts.kind ?? 'info'}` },
    opts.kind === 'error' ? svgIcon(ICONS.warn) : null,
    h('span', null, message),
    opts.action
      ? h(
          'button',
          {
            class: 'btn btn-link',
            onclick: () => {
              opts.action!.onClick();
              el.remove();
            },
          },
          opts.action.label,
        )
      : null,
  );
  toastHost.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, opts.ms ?? (opts.kind === 'error' ? 6000 : 3200));
}

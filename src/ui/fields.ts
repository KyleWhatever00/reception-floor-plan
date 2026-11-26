import { h, svgIcon } from './dom';
import { ICONS } from './icons';
import { formatFtIn, parseLength, parseDegrees, toDeg } from '../model/units';
import { toast } from './dialogs';

let fieldSeq = 0;
const nextId = () => `fld-${++fieldSeq}`;

/** Feet-and-inches text field with −/+ steppers. Accepts 5' 6", 66in, 1.7m … */
export function lengthField(opts: {
  label: string;
  value: number;
  onCommit: (m: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  allowNegative?: boolean;
  /** Omit the −/+ buttons (for tight rows). */
  compact?: boolean;
}): HTMLElement {
  const id = nextId();
  const input = h('input', {
    id,
    class: 'input input-length',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    spellcheck: false,
    value: formatFtIn(opts.value),
    'aria-describedby': opts.hint ? `${id}-hint` : undefined,
  });
  let current = opts.value;
  const commit = (v: number) => {
    const min = opts.min ?? (opts.allowNegative ? -Infinity : 0);
    const max = opts.max ?? Infinity;
    if (v < min || v > max) {
      toast(`${opts.label} must be between ${formatFtIn(Math.max(min, -1e6))} and ${formatFtIn(Math.min(max, 1e6))}.`, { kind: 'error' });
      input.value = formatFtIn(current);
      return;
    }
    current = v;
    input.value = formatFtIn(v);
    opts.onCommit(v);
  };
  const fromText = () => {
    const v = parseLength(input.value);
    if (v === null) {
      input.classList.add('invalid');
      toast(`Couldn't read "${input.value}". Try 5' 6", 66 in or 1.7 m.`, { kind: 'error' });
      setTimeout(() => input.classList.remove('invalid'), 1200);
      input.value = formatFtIn(current);
      return;
    }
    if (Math.abs(v - current) > 1e-6) commit(v);
    else input.value = formatFtIn(current);
  };
  input.addEventListener('change', fromText);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });
  input.addEventListener('focus', () => input.select());
  const step = opts.step ?? 0.0254 * 6;
  const stepBtn = (dir: number) =>
    h('button', { class: 'stepper-btn', type: 'button', 'aria-label': `${dir < 0 ? 'Decrease' : 'Increase'} ${opts.label}`, onclick: () => commit(Math.round((current + dir * step) / step) * step) }, dir < 0 ? '−' : '+');
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label', for: id }, opts.label),
    opts.compact ? h('div', { class: 'stepper' }, input) : h('div', { class: 'stepper' }, stepBtn(-1), input, stepBtn(1)),
    opts.hint ? h('div', { class: 'field-hint', id: `${id}-hint` }, opts.hint) : null,
  );
}

export function angleField(label: string, value: number, onCommit: (r: number) => void, step = 15): HTMLElement {
  const id = nextId();
  let current = value;
  const fmt = (r: number) => `${Math.round(toDeg(r) * 10) / 10}°`;
  const input = h('input', { id, class: 'input input-angle', type: 'text', inputmode: 'decimal', value: fmt(value) });
  const commit = (r: number) => {
    current = r;
    input.value = fmt(r);
    onCommit(r);
  };
  input.addEventListener('change', () => {
    const r = parseDegrees(input.value);
    if (r === null) {
      toast('Enter an angle in degrees, e.g. 45.', { kind: 'error' });
      input.value = fmt(current);
    } else commit(r);
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  const stepBtn = (dir: number) =>
    h('button', { class: 'stepper-btn', type: 'button', 'aria-label': `Rotate ${dir < 0 ? 'left' : 'right'} ${step} degrees`, onclick: () => commit(current + (dir * step * Math.PI) / 180) }, dir < 0 ? svgIcon(ICONS.rotL) : svgIcon(ICONS.rotR));
  return h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), h('div', { class: 'stepper' }, stepBtn(1), input, stepBtn(-1)));
}

export function countStepper(label: string, value: number, onChange: (n: number) => void, min = 0, max = 24): HTMLElement {
  const id = nextId();
  const out = h('output', { id, class: 'count-value', 'aria-live': 'polite' }, String(value));
  const btn = (dir: number) =>
    h(
      'button',
      {
        class: 'stepper-btn',
        type: 'button',
        disabled: dir < 0 ? value <= min : value >= max,
        'aria-label': `${dir < 0 ? 'Fewer' : 'More'} ${label.toLowerCase()}`,
        onclick: () => onChange(Math.max(min, Math.min(max, value + dir))),
      },
      dir < 0 ? '−' : '+',
    );
  return h('div', { class: 'field field-count' }, h('span', { class: 'field-label', id: `${id}-l` }, label), h('div', { class: 'stepper stepper-count', role: 'group', 'aria-labelledby': `${id}-l` }, btn(-1), out, btn(1)));
}

export function textField(label: string, value: string, onCommit: (v: string) => void, opts: { placeholder?: string; multiline?: boolean } = {}): HTMLElement {
  const id = nextId();
  const input = opts.multiline
    ? h('textarea', { id, class: 'input', rows: 3, placeholder: opts.placeholder ?? '' }, value)
    : h('input', { id, class: 'input', type: 'text', value, placeholder: opts.placeholder ?? '' });
  input.addEventListener('change', () => onCommit((input as HTMLInputElement).value));
  if (!opts.multiline) input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && (input as HTMLInputElement).blur());
  return h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), input);
}

export function selectField<T extends string>(label: string, value: T, options: { value: T; label: string }[], onChange: (v: T) => void): HTMLElement {
  const id = nextId();
  const sel = h('select', { id, class: 'input' }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value as T));
  return h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), sel);
}

export function toggleField(label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): HTMLElement {
  const id = nextId();
  const input = h('input', { id, type: 'checkbox', class: 'switch-input', checked: value, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return h(
    'label',
    { class: 'toggle', for: id },
    input,
    h('span', { class: 'switch', 'aria-hidden': 'true' }),
    h('span', { class: 'toggle-text' }, label, hint ? h('small', null, hint) : null),
  );
}

export function segmented<T extends string>(label: string, value: T, options: { value: T; label: string; icon?: string }[], onChange: (v: T) => void): HTMLElement {
  return h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    options.map((o) =>
      h(
        'button',
        { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), class: o.value === value ? 'active' : '', onclick: () => onChange(o.value) },
        o.icon ? svgIcon(o.icon) : null,
        h('span', null, o.label),
      ),
    ),
  );
}

export function section(title: string, ...children: (Node | null | false | undefined)[]): HTMLElement {
  return h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, title), ...children.filter(Boolean) as Node[]);
}

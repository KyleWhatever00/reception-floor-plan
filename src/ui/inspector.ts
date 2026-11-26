import type { AppContext } from './context';
import type { CenterpiecePreset, ChairFinish, DanceFloorMaterial, Furniture, Layout } from '../model/types';
import { clear, h, svgIcon } from './dom';
import { ICONS } from './icons';
import { angleField, countStepper, lengthField, section, selectField, textField, toggleField } from './fields';
import { BOUNDS, LINEN_COLORS, TYPE_NAMES, isGuestTable } from '../model/catalog';
import { applySideCounts, guestsDisplacedBy, perimeterPerSeat, resizeSeats, sideCountsOf } from '../model/seats';
import { assignGuestToSeat, clearSeat, findFurniture, guestById, seatStats, unassignedGuests } from '../model/commands';
import { formatFtIn, formatInches, inch, ft } from '../model/units';
import { confirmDialog } from './dialogs';
import { isRoundShape } from '../model/seats';

/** Right-hand property panel: the selected item, or layout-wide options when nothing is selected. */
export class Inspector {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private scrollMemo = new Map<string, number>();
  private lastKey = '';

  constructor(private ctx: AppContext) {
    this.body = h('div', { class: 'panel-body' });
    this.el = h('div', { class: 'inspector' }, this.body);
    ctx.store.subscribe((e) => {
      if (e.transient) {
        this.refreshLive();
        return;
      }
      if (['layout', 'selection', 'project', 'settings', 'history'].includes(e.kind)) this.render();
    });
    this.render();
  }

  private get layout(): Layout {
    return this.ctx.store.layout;
  }

  /** During drags only update the numbers instead of rebuilding the panel. */
  private refreshLive(): void {
    const f = findFurniture(this.layout, this.ctx.store.selection.furnitureId);
    if (!f) return;
    const pos = this.body.querySelectorAll<HTMLInputElement>('.pos-field input');
    if (pos.length === 2) {
      pos[0].value = formatFtIn(f.position.x);
      pos[1].value = formatFtIn(f.position.z);
    }
  }

  render(): void {
    const sel = this.ctx.store.selection;
    const key = `${sel.furnitureId ?? 'none'}`;
    const scroller = this.el;
    this.scrollMemo.set(this.lastKey, scroller.scrollTop);
    clear(this.body);
    const f = findFurniture(this.layout, sel.furnitureId);
    if (f) this.renderFurniture(f);
    else this.renderLayout();
    scroller.scrollTop = key === this.lastKey ? this.scrollMemo.get(key) ?? 0 : 0;
    this.lastKey = key;
  }

  private edit(label: string, fn: (f: Furniture) => void): void {
    const id = this.ctx.store.selection.furnitureId;
    this.ctx.store.apply(label, (l) => {
      const f = findFurniture(l, id);
      if (f) fn(f);
    });
  }

  private renderFurniture(f: Furniture): void {
    const { editor } = this.ctx;
    const header = h(
      'div',
      { class: 'inspector-header' },
      h('div', { class: 'eyebrow' }, TYPE_NAMES[f.type]),
      h('input', {
        class: 'title-input',
        value: f.label,
        'aria-label': 'Name',
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v) this.edit('Rename', (x) => (x.label = v.slice(0, 120)));
        },
        onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur(),
      }),
      h(
        'div',
        { class: 'action-row' },
        h('button', { class: 'chip-btn', onclick: () => editor.rotateSelected(Math.PI / 12), title: 'Rotate left 15° (Shift+R)' }, svgIcon(ICONS.rotL), '15° left'),
        h('button', { class: 'chip-btn', onclick: () => editor.rotateSelected(-Math.PI / 12), title: 'Rotate right 15° (R)' }, svgIcon(ICONS.rotR), '15° right'),
        h('button', { class: 'chip-btn', onclick: () => editor.duplicateSelected(), title: 'Duplicate (⌘D)' }, svgIcon(ICONS.copy), 'Duplicate'),
        h('button', { class: 'chip-btn chip-danger', onclick: () => editor.deleteSelected(), title: 'Delete' }, svgIcon(ICONS.trash), 'Delete'),
      ),
    );
    this.body.append(header);

    const warnings = this.ctx.sm.analysis.byFurniture.get(f.id) ?? [];
    if (warnings.length) {
      this.body.append(
        h(
          'div',
          { class: 'callout callout-warn', role: 'note' },
          svgIcon(ICONS.warn),
          h('ul', null, warnings.map((w) => h('li', null, w.severity === 'advice' ? h('span', { class: 'tag' }, 'Advice') : h('span', { class: 'tag tag-warn' }, 'Check'), ' ', w.message))),
        ),
      );
    }

    if (f.seats?.length) this.body.append(this.guestSection(f));

    // placement
    this.body.append(
      section(
        'Position',
        h(
          'div',
          { class: 'grid-2 pos-field' },
          lengthField({ label: 'Across (X)', value: f.position.x, allowNegative: true, min: -BOUNDS.maxCoord, max: BOUNDS.maxCoord, onCommit: (v) => this.edit('Move', (x) => (x.position = { ...x.position, x: v })) }),
          lengthField({ label: 'Down (Z)', value: f.position.z, allowNegative: true, min: -BOUNDS.maxCoord, max: BOUNDS.maxCoord, onCommit: (v) => this.edit('Move', (x) => (x.position = { ...x.position, z: v })) }),
        ),
        angleField('Rotation', f.rotation, (r) => this.edit('Rotate', (x) => (x.rotation = editor.snapAngle(r, true)))),
      ),
    );

    // size
    const round = isRoundShape(f);
    const sizeFields: HTMLElement[] = [];
    if (round) {
      sizeFields.push(lengthField({ label: 'Diameter', value: f.width, min: BOUNDS.minDim, max: BOUNDS.maxDim, step: inch(6), onCommit: (v) => this.edit('Resize', (x) => ((x.width = v), (x.depth = v))), hint: `${formatInches(f.width, 1)} across` }));
    } else {
      sizeFields.push(
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'Width', value: f.width, min: BOUNDS.minDim, max: BOUNDS.maxDim, step: inch(6), onCommit: (v) => this.edit('Resize', (x) => (x.width = v)) }),
          lengthField({ label: 'Depth', value: f.depth, min: BOUNDS.minDim, max: BOUNDS.maxDim, step: inch(6), onCommit: (v) => this.edit('Resize', (x) => (x.depth = v)) }),
        ),
      );
    }
    if (f.type !== 'danceFloor') sizeFields.push(lengthField({ label: 'Height', value: f.height, min: inch(1), max: BOUNDS.maxHeight, step: inch(1), onCommit: (v) => this.edit('Resize', (x) => (x.height = v)) }));
    this.body.append(section('Size', ...sizeFields, h('p', { class: 'muted small' }, 'Type sizes like 60", 5\' 6" or 1.5 m. Replace these demo sizes with your rental company’s measurements.')));

    // seating
    if (f.seats) this.body.append(this.seatingSection(f));

    // appearance
    const look: HTMLElement[] = [];
    const linenTypes = ['roundTable', 'rectTable', 'sweetheart', 'cake', 'buffet', 'gift', 'welcome'];
    if (linenTypes.includes(f.type)) {
      look.push(
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Linen'),
          h(
            'div',
            { class: 'swatches', role: 'radiogroup', 'aria-label': 'Linen colour' },
            LINEN_COLORS.map((c) =>
              h(
                'button',
                {
                  class: `swatch ${f.appearance?.linenColor === c.value ? 'active' : ''}`,
                  role: 'radio',
                  'aria-checked': String(f.appearance?.linenColor === c.value),
                  title: c.name,
                  style: `--swatch:${c.value}`,
                  onclick: () => this.edit('Change linen', (x) => (x.appearance = { ...x.appearance, linenColor: c.value })),
                },
                h('span', { class: 'sr-only' }, c.name),
              ),
            ),
          ),
        ),
      );
    }
    if (['roundTable', 'rectTable', 'sweetheart'].includes(f.type)) {
      look.push(
        selectField<CenterpiecePreset>('Centerpiece', f.appearance?.centerpiece ?? 'none', [
          { value: 'low-floral', label: 'Low blush florals' },
          { value: 'tall-floral', label: 'Tall florals on gold stand' },
          { value: 'candles', label: 'Candles & greenery' },
          { value: 'none', label: 'None' },
        ], (v) => this.edit('Change centerpiece', (x) => (x.appearance = { ...x.appearance, centerpiece: v }))),
        toggleField('Place settings', f.appearance?.placeSettings !== false, (v) => this.edit('Toggle place settings', (x) => (x.appearance = { ...x.appearance, placeSettings: v }))),
      );
    }
    if (f.type === 'danceFloor') {
      look.push(
        selectField<DanceFloorMaterial>('Floor finish', f.appearance?.floor ?? 'checker', [
          { value: 'checker', label: 'Black & white checker' },
          { value: 'white', label: 'White gloss' },
          { value: 'black', label: 'Black gloss' },
          { value: 'wood', label: 'Wood parquet' },
        ], (v) => this.edit('Change floor', (x) => (x.appearance = { ...x.appearance, floor: v }))),
        h('p', { class: 'muted small' }, 'The dance floor is walkable in the walkthrough.'),
      );
    }
    if (f.type === 'dj') look.push(toggleField('Speakers on stands', f.appearance?.speakers !== false, (v) => this.edit('Toggle speakers', (x) => (x.appearance = { ...x.appearance, speakers: v }))));
    if (f.type === 'cake') {
      look.push(
        selectField('Table shape', (f.variant === 'rect' ? 'rect' : 'round') as 'rect' | 'round', [
          { value: 'round', label: 'Round' },
          { value: 'rect', label: 'Rectangular' },
        ], (v) =>
          this.edit('Change shape', (x) => {
            x.variant = v;
            if (v === 'round') x.depth = x.width;
            else x.depth = Math.min(x.width, inch(30));
          }),
        ),
      );
    }
    if (f.type === 'bar') look.push(h('p', { class: 'muted small' }, 'The bartender side is the back (opposite the gold kick rail). Turn on Clearances to see the 36″ service zone.'));
    if (f.type === 'decoration' && f.variant === 'sign') look.push(h('p', { class: 'muted small' }, 'The sign shows its name. Rename it above to change the text.'));
    if (look.length) this.body.append(section('Look', ...look));

    if (isGuestTable(f)) {
      this.body.append(
        section(
          'Table number',
          countStepper('Number', f.number ?? 0, (n) =>
            this.edit('Renumber', (x) => {
              const wasDefault = x.label === `Table ${x.number}`;
              x.number = n;
              if (wasDefault) x.label = `Table ${n}`;
            }),
            0, 999,
          ),
        ),
      );
    }
    this.body.append(section('Notes', textField('Notes', f.notes ?? '', (v) => this.edit('Edit notes', (x) => (x.notes = v.slice(0, 2000) || undefined)), { multiline: true, placeholder: 'Rental details, decor ideas…' })));
  }

  private seatingSection(f: Furniture): HTMLElement {
    const els: HTMLElement[] = [];
    const confirmLoss = async (displaced: string[]): Promise<boolean> => {
      if (!displaced.length) return true;
      const names = displaced.map((id) => guestById(this.layout, id)?.name ?? 'Guest');
      return confirmDialog(
        'Remove occupied seats?',
        h('div', null, h('p', null, `${names.length === 1 ? 'This guest' : `These ${names.length} guests`} will move to the unassigned list (nobody is deleted):`), h('ul', null, names.map((n) => h('li', null, n)))),
        'Remove seats',
      );
    };
    if (f.type === 'roundTable') {
      els.push(
        countStepper('Chairs', f.seats!.length, async (n) => {
          if (!(await confirmLoss(guestsDisplacedBy(f, { count: n })))) return;
          this.edit('Change chairs', (x) => resizeSeats(x, n));
        }, 0, BOUNDS.maxSeats),
      );
    } else {
      const counts = sideCountsOf(f);
      const names = ['Far side', 'Right end', 'Near side', 'Left end'];
      const diagram = h(
        'div',
        { class: 'side-diagram', 'aria-hidden': 'true' },
        h('div', { class: 'side-table' }),
        counts.map((c, i) => h('span', { class: `side-count side-${i}` }, String(c))),
      );
      els.push(diagram);
      els.push(
        h(
          'div',
          { class: 'grid-2' },
          counts.map((c, i) =>
            countStepper(names[i], c, async (n) => {
              const next = [...counts] as [number, number, number, number];
              next[i] = n;
              if (!(await confirmLoss(guestsDisplacedBy(f, { sideCounts: next })))) return;
              this.edit('Change chairs', (x) => applySideCounts(x, next));
            }, 0, BOUNDS.maxSeats),
          ),
        ),
      );
    }
    const per = perimeterPerSeat(f);
    const advisory = this.ctx.store.settings.perimeterPerGuest;
    if (per !== null) {
      const tight = per + 1e-6 < advisory;
      els.push(
        h(
          'p',
          { class: `small ${tight ? 'text-warn' : 'muted'}` },
          tight ? svgIcon(ICONS.warn, 'icon icon-inline') : null,
          `About ${formatInches(per, 1)} of table edge per guest${tight ? ` — tighter than the ${formatInches(advisory, 1)} planning guideline` : ''}. Planning aid only.`,
        ),
      );
    }
    return section('Chairs', ...els);
  }

  private guestSection(f: Furniture): HTMLElement {
    const { store } = this.ctx;
    const l = this.layout;
    const pool = unassignedGuests(l).sort((a, b) => a.name.localeCompare(b.name));
    const seated = f.seats!.filter((s) => s.guestId).length;
    const rows = f.seats!.map((s, i) => {
      const g = guestById(l, s.guestId);
      const options = [h('option', { value: '' }, '— Open seat —')];
      if (g) options.push(h('option', { value: g.id, selected: true }, g.name));
      for (const p of pool) options.push(h('option', { value: p.id }, p.name));
      const sel = h('select', { class: 'input input-compact', 'aria-label': `Guest in seat ${i + 1}` }, options);
      sel.addEventListener('change', () => {
        const v = sel.value;
        store.apply(v ? 'Assign guest' : 'Clear seat', (layout) => (v ? assignGuestToSeat(layout, v, s.id) : clearSeat(layout, s.id)));
      });
      const active = store.selection.seatId === s.id;
      return h(
        'li',
        { class: `seat-row ${active ? 'active' : ''}` },
        h('button', { class: 'seat-num', title: 'Highlight this seat', onclick: () => store.select(f.id, s.id) }, String(i + 1)),
        sel,
        h('button', { class: 'icon-btn', title: 'View from this seat', 'aria-label': `View from seat ${i + 1}`, onclick: () => this.ctx.walk.enter({ seatId: s.id }) }, svgIcon(ICONS.eye)),
      );
    });
    return section(
      `Guests · ${seated}/${f.seats!.length}`,
      pool.length === 0 && seated < f.seats!.length && l.guests.length === 0
        ? h('p', { class: 'muted small' }, 'Add guests in the Guests tab, then seat them here.')
        : null,
      h('ol', { class: 'seat-list' }, rows),
    );
  }

  private renderLayout(): void {
    const { store, sm } = this.ctx;
    const l = this.layout;
    const s = store.settings;
    const st = seatStats(l);
    this.body.append(
      h(
        'div',
        { class: 'inspector-header' },
        h('div', { class: 'eyebrow' }, 'Layout'),
        h('input', {
          class: 'title-input',
          value: l.name,
          'aria-label': 'Layout name',
          onchange: (e: Event) => store.renameLayout(l.id, (e.target as HTMLInputElement).value),
          onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur(),
        }),
        h('p', { class: 'muted small' }, 'Tap any table or item on the plan to edit it. Drag to move. Use two fingers (or scroll) to pan and zoom.'),
      ),
      h(
        'div',
        { class: 'stat-grid' },
        stat(String(st.tables), 'tables'),
        stat(String(st.seats), 'seats'),
        stat(String(st.guests), 'guests'),
        stat(String(st.unassigned), 'unseated'),
      ),
    );
    const warnings = sm.analysis.warnings;
    if (warnings.length) {
      this.body.append(
        section(
          `Things to check (${warnings.length})`,
          h(
            'ul',
            { class: 'warning-list' },
            warnings.slice(0, 30).map((w) =>
              h(
                'li',
                null,
                h(
                  'button',
                  {
                    class: 'link-row',
                    onclick: () => {
                      const id = w.furnitureIds[0];
                      if (id) store.select(id);
                    },
                  },
                  h('span', { class: `tag ${w.severity === 'warning' ? 'tag-warn' : ''}` }, w.severity === 'warning' ? 'Check' : 'Advice'),
                  ' ',
                  w.message,
                ),
              ),
            ),
          ),
          h('p', { class: 'muted small' }, 'These are planning aids, not safety or accessibility certifications. Review final layout and egress with the venue.'),
        ),
      );
    }
    this.body.append(
      section(
        'Show on plan',
        toggleField('Grid (1 ft squares)', s.showGrid, (v) => store.updateSettings({ showGrid: v })),
        toggleField('Labels', s.showLabels, (v) => store.updateSettings({ showLabels: v })),
        toggleField('Guest names', s.showNames, (v) => store.updateSettings({ showNames: v }), 'Shown when zoomed in'),
        toggleField('Room dimensions', s.showDimensions, (v) => store.updateSettings({ showDimensions: v })),
        toggleField('Clearances', s.showClearance, (v) => store.updateSettings({ showClearance: v }), 'Chair zones, door and bar clearance'),
      ),
      section(
        'Snapping',
        toggleField('Snap to grid', s.snapEnabled, (v) => store.updateSettings({ snapEnabled: v }), 'Hold Option/Alt while dragging to place freely'),
        selectField('Grid step', String(s.snapInches), ['1', '3', '6', '12'].map((v) => ({ value: v, label: `${v}″` })), (v) => store.updateSettings({ snapInches: Number(v) })),
        selectField('Rotation step', String(s.rotationSnapDeg), ['5', '15', '45', '90'].map((v) => ({ value: v, label: `${v}°` })), (v) => store.updateSettings({ rotationSnapDeg: Number(v) })),
      ),
      section(
        'Chairs (all tables)',
        selectField<ChairFinish>('Chair style', l.seating.chairFinish, [
          { value: 'gold', label: 'Gold Chiavari' },
          { value: 'white', label: 'White Chiavari' },
          { value: 'black', label: 'Black Chiavari' },
          { value: 'clear', label: 'Clear (ghost) Chiavari' },
          { value: 'wood', label: 'Natural wood' },
        ], (v) => store.apply('Change chair style', (x) => (x.seating.chairFinish = v))),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'Chair width', value: l.seating.chairWidth, min: inch(12), max: inch(30), step: inch(0.5), onCommit: (v) => store.apply('Chair size', (x) => (x.seating.chairWidth = v)) }),
          lengthField({ label: 'Chair depth', value: l.seating.chairDepth, min: inch(12), max: inch(30), step: inch(0.5), onCommit: (v) => store.apply('Chair size', (x) => (x.seating.chairDepth = v)) }),
        ),
        lengthField({ label: 'Chair distance from table edge', value: l.seating.chairOffset, min: inch(0), max: ft(3), step: inch(1), onCommit: (v) => store.apply('Chair spacing', (x) => (x.seating.chairOffset = v)), hint: 'Measured to the chair centre.' }),
      ),
    );
  }
}

function stat(value: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('strong', null, value), h('span', null, label));
}

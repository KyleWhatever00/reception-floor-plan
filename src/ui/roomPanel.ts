import type { AppContext } from './context';
import type { CeilingZone, DimensionStatus, ExteriorView, Fixture, FloorFinish, FrameColor, Layout, Opening, Pilaster, Room, RoomFeatures, Vec2 } from '../model/types';
import { ceilingAt, chandelierHangHeight, isChandelier, newCeilingZone, newChandelier, newSconce, pointOnWall, sconcePlacement, overlappingZones, ridgeLeftRight, setRidge, setZoneExtents, zoneExtents, type ChandelierKind } from '../model/ceilings';
import { clear, h, svgIcon } from './dom';
import { ICONS } from './icons';
import { lengthField, section, selectField, toggleField } from './fields';
import { formatFeetShort, formatFtIn, ft, inch, parseLength, toFeet } from '../model/units';
import { dist, polygonArea, polygonBounds, polygonCentroid, wallLength } from '../model/geometry';
import { addPilaster, insertVertexAfter, parseOutline, rectangleRoom, removeVertex, moveVertex, tryRoom } from '../model/roomEdit';
import { confirmDialog, openDialog, promptDialog, toast } from './dialogs';
import { newId } from '../model/ids';
import { deleteAsset, normalizeImage, putAsset } from '../persistence/assets';

const STATUS_TEXT: Record<DimensionStatus, string> = {
  demo: 'Demo — invented placeholder, not the real venue',
  estimated: 'Estimated — from photos or rough measurements',
  measured: 'Measured — confirmed with a tape or venue plans',
};

const FOLD_KEY = 'wfp.ui.roomFolds';
/** Long item lists and rarely used sections start folded; the rest start open. */
const FOLD_DEFAULTS: Record<string, boolean> = { openings: false, pilasters: false, columns: false, ceilings: false, chandeliers: false, sconces: false, details: false, reference: false };

function loadFolds(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Room geometry editor: outline, doors & windows, columns, entrance and reference image. */
export class RoomPanel {
  readonly el: HTMLElement;
  private visible = false;
  editCorners = false;
  editCeilings = false;
  onEditCornersChange: (on: boolean) => void = () => {};
  onEditCeilingsChange: (on: boolean) => void = () => {};
  /** Which sections are folded open (remembered between visits) and which list items are expanded. */
  private folds: Record<string, boolean> = loadFolds();
  private openItems = new Set<string>();
  /** Item id → the section it is listed in (filled in while rendering). */
  private itemSection = new Map<string, string>();
  private renderingSection = '';

  constructor(private ctx: AppContext) {
    this.el = h('div', { class: 'room-panel' });
    ctx.store.subscribe((e) => {
      if (e.transient) return;
      if (e.kind === 'layout' || e.kind === 'project') this.render();
    });
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.render();
    else {
      if (this.editCorners) this.setEditCorners(false);
      if (this.editCeilings) this.setEditCeilings(false);
    }
  }

  /** Plan editing of walls/doors/windows. Only one plan editing mode is on at a time. */
  setEditCorners(on: boolean): void {
    this.editCorners = on;
    if (on && this.editCeilings) {
      this.editCeilings = false;
      this.onEditCeilingsChange(false);
    }
    this.onEditCornersChange(on);
    if (this.visible) this.render();
  }

  /** Plan editing of ceiling areas and chandeliers. */
  setEditCeilings(on: boolean): void {
    this.editCeilings = on;
    if (on && this.editCorners) {
      this.editCorners = false;
      this.onEditCornersChange(false);
    }
    this.onEditCeilingsChange(on);
    if (this.visible) this.render();
  }

  /** Open, scroll to and highlight an item's row (after tapping it on the plan or adding it). */
  focusItem(id: string): void {
    this.ctx.openLeft('room');
    if (!this.visible) return;
    const key = this.itemSection.get(id);
    if ((key && !this.isFolded(key)) || !this.openItems.has(id)) {
      if (key) this.setFold(key, true);
      this.openItems.add(id);
      this.render();
    }
    const row = this.el.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
    if (!row) return;
    // scroll only the panel (scrollIntoView would also scroll the page and hide the top bar)
    const box = row.closest<HTMLElement>('.panel-scroll') ?? this.el.parentElement;
    if (box) {
      const rr = row.getBoundingClientRect(), br = box.getBoundingClientRect();
      box.scrollTo({ top: box.scrollTop + rr.top - br.top - (br.height - rr.height) / 2, behavior: 'smooth' });
    }
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  private isFolded(key: string): boolean {
    return this.folds[key] ?? FOLD_DEFAULTS[key] ?? true;
  }

  private setFold(key: string, open: boolean): void {
    this.folds[key] = open;
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(this.folds));
    } catch {
      /* private mode: just don't remember */
    }
  }

  /** A section whose heading folds it open and closed. */
  private fold(key: string, title: string, ...children: (Node | null | false | undefined)[]): HTMLElement {
    const open = this.isFolded(key);
    const body = h('div', { class: 'fold-body', id: `fold-${key}` }, ...(children.filter(Boolean) as Node[]));
    body.hidden = !open;
    const btn = h(
      'button',
      { class: 'fold-head', 'aria-expanded': String(open), 'aria-controls': `fold-${key}` },
      h('span', { class: 'fold-chevron', 'aria-hidden': 'true' }, '›'),
      h('span', null, title),
    );
    btn.addEventListener('click', () => {
      const next = body.hidden !== false;
      body.hidden = !next;
      btn.setAttribute('aria-expanded', String(next));
      this.setFold(key, next);
    });
    return h('section', { class: 'panel-section foldable' }, h('h3', { class: 'section-title' }, btn), body);
  }

  /** One item in a list: a summary line that expands to its settings. */
  private itemRow(id: string, title: string, meta: string, ...body: (Node | null | false | undefined)[]): HTMLElement {
    this.itemSection.set(id, this.renderingSection);
    const open = this.openItems.has(id);
    const content = h('div', { class: 'item-body' }, ...(body.filter(Boolean) as Node[]));
    content.hidden = !open;
    const btn = h(
      'button',
      { class: 'item-head', 'aria-expanded': String(open) },
      h('span', { class: 'fold-chevron', 'aria-hidden': 'true' }, '›'),
      h('span', { class: 'item-title' }, title),
      h('span', { class: 'item-meta' }, meta),
    );
    btn.addEventListener('click', () => {
      const next = content.hidden !== false;
      content.hidden = !next;
      btn.setAttribute('aria-expanded', String(next));
      if (next) this.openItems.add(id);
      else this.openItems.delete(id);
    });
    return h('li', { class: 'opening-row item-row', 'data-item-id': id }, btn, content);
  }

  private get layout(): Layout {
    return this.ctx.store.layout;
  }

  /** Apply a room change only if the result is valid. */
  applyRoom(label: string, make: (r: Room) => Room | void): boolean {
    const current = this.layout.room;
    const draft: Room = JSON.parse(JSON.stringify(current));
    const next = make(draft) ?? draft;
    const errors = tryRoom(next);
    if (errors.length) {
      toast(errors[0], { kind: 'error' });
      return false;
    }
    this.ctx.store.apply(label, (l) => (l.room = next), { room: true });
    return true;
  }

  render(): void {
    if (!this.visible) return;
    const r = this.layout.room;
    const area = polygonArea(r.vertices) / (ft(1) * ft(1));
    const b = polygonBounds(r.vertices);
    clear(this.el);
    this.el.append(
      h(
        'div',
        { class: `callout ${r.dimensionStatus === 'measured' ? 'callout-ok' : 'callout-warn'}` },
        svgIcon(r.dimensionStatus === 'measured' ? ICONS.check : ICONS.info),
        h('div', null, h('strong', null, STATUS_TEXT[r.dimensionStatus]), h('p', { class: 'small' }, `${Math.round(area).toLocaleString()} sq ft · ${formatFeetShort(b.maxX - b.minX)} × ${formatFeetShort(b.maxZ - b.minZ)} overall`)),
      ),
      this.fold(
        'room',
        'Room',
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field-label', for: 'room-name' }, 'Name'),
          h('input', {
            id: 'room-name',
            class: 'input',
            value: r.name,
            onchange: (e: Event) => this.applyRoom('Rename room', (x) => void (x.name = (e.target as HTMLInputElement).value.slice(0, 200) || 'Reception hall')),
          }),
        ),
        selectField<DimensionStatus>('Dimensions are…', r.dimensionStatus, (['demo', 'estimated', 'measured'] as DimensionStatus[]).map((v) => ({ value: v, label: STATUS_TEXT[v].split(' — ')[0] })), (v) =>
          this.applyRoom('Change dimension status', (x) => void (x.dimensionStatus = v)),
        ),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'Wall height', value: r.wallHeight, min: ft(5), max: ft(60), step: inch(6), onCommit: (v) => this.applyRoom('Wall height', (x) => void (x.wallHeight = v)) }),
          lengthField({ label: 'Wall thickness', value: r.wallThickness, min: inch(1), max: ft(4), step: inch(1), onCommit: (v) => this.applyRoom('Wall thickness', (x) => void (x.wallThickness = v)) }),
        ),
      ),
      this.editSection(),
      this.outlineSection(r),
      this.inSection('openings', () => this.openingsSection(r)),
      this.inSection('pilasters', () => this.pilastersSection(r)),
      this.columnsSection(r),
      this.inSection('ceilings', () => this.ceilingsSection(r)),
      this.inSection('chandeliers', () => this.chandeliersSection(r)),
      this.inSection('sconces', () => this.sconcesSection(r)),
      this.entranceSection(r),
      this.detailsSection(r),
      this.referenceSection(r),
    );
  }

  private inSection(key: string, build: () => HTMLElement): HTMLElement {
    this.renderingSection = key;
    const el = build();
    this.renderingSection = '';
    return el;
  }

  /** The two plan editing switches, kept outside the folding sections so they are always at hand. */
  private editSection(): HTMLElement {
    return section(
      'Edit on the plan',
      toggleField('Walls, doors & windows', this.editCorners, (v) => this.setEditCorners(v), 'Drag corners, the ⇅ wall tabs, doors, windows, pilasters, wall lights and columns. Round end grips resize. Option/Alt skips snapping.'),
      toggleField('Ceilings & chandeliers', this.editCeilings, (v) => this.setEditCeilings(v), 'Drag a ceiling area’s label to move it or its edge tabs to resize it; drag chandeliers and wall lights. Tap anything to open its settings.'),
    );
  }

  private outlineSection(r: Room): HTMLElement {
    const rows = r.vertices.map((v, i) => {
      const next = r.vertices[(i + 1) % r.vertices.length];
      return h(
        'li',
        { class: 'corner-row' },
        h('span', { class: 'corner-num' }, String(i + 1)),
        lengthField({ label: 'X', compact: true, value: v.x, allowNegative: true, min: -1000, max: 1000, step: inch(6), onCommit: (x) => this.applyRoom('Move corner', (room) => moveVertex(room, i, { x, z: v.z })) }),
        lengthField({ label: 'Z', compact: true, value: v.z, allowNegative: true, min: -1000, max: 1000, step: inch(6), onCommit: (z) => this.applyRoom('Move corner', (room) => moveVertex(room, i, { x: v.x, z })) }),
        h(
          'div',
          { class: 'corner-actions' },
          h('span', { class: 'muted small', title: `Wall ${i + 1} length` }, `→ ${formatFeetShort(dist(v, next))}`),
          h('button', { class: 'icon-btn', title: 'Add a corner after this one (splits the wall)', 'aria-label': `Add corner after ${i + 1}`, onclick: () => {
            const res = insertVertexAfter(this.layout.room, i);
            if (this.applyRoom('Add corner', () => res.room) && res.dropped) toast(`${res.dropped} opening(s) crossed the split and were removed.`);
          } }, svgIcon(ICONS.plus)),
          h('button', { class: 'icon-btn', title: 'Remove this corner', 'aria-label': `Remove corner ${i + 1}`, disabled: r.vertices.length <= 3, onclick: () => {
            const res = removeVertex(this.layout.room, i);
            if (this.applyRoom('Remove corner', () => res.room) && res.dropped) toast(`${res.dropped} opening(s) on removed walls were deleted.`);
          } }, svgIcon(ICONS.trash)),
        ),
      );
    });
    return this.fold(
      'outline',
      `Outline (${r.vertices.length} corners)`,
      h('p', { class: 'muted small' }, 'Corners go around the room in order. X runs left→right across the plan, Z runs top→bottom. Measurements are in feet unless you type a unit.'),
      h('ol', { class: 'corner-list' }, rows),
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.rectangleDialog() }, 'Make a rectangle…'),
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.pasteOutline() }, 'Paste coordinates…'),
      ),
    );
  }

  private async rectangleDialog(): Promise<void> {
    const b = polygonBounds(this.layout.room.vertices);
    const w = await promptDialog('Rectangular room', 'Width (left to right), e.g. 60\' or 18.3 m', formatFtIn(b.maxX - b.minX, 1), 'Next');
    if (w === null) return;
    const wv = parseLength(w);
    const l = wv !== null ? await promptDialog('Rectangular room', 'Length (top to bottom)', formatFtIn(b.maxZ - b.minZ, 1), 'Make room') : null;
    const lv = l !== null && l !== undefined ? parseLength(l) : null;
    if (wv === null || lv === null || wv <= 0 || lv <= 0) {
      if (l !== null) toast('Please enter two positive lengths.', { kind: 'error' });
      return;
    }
    if (!(await confirmDialog('Replace the outline?', 'Doors and windows on walls 1–4 are kept where they fit; others are removed. You can undo this.', 'Replace outline'))) return;
    this.applyRoom('Rectangular room', (room) => rectangleRoom(room, wv, lv));
    this.ctx.sm.fitTopView();
  }

  private async pasteOutline(): Promise<void> {
    const ta = h('textarea', { class: 'input mono', rows: 9, placeholder: "0, 0\n80, 0\n80, 50\n0, 50", 'aria-label': 'Corner coordinates' });
    let parsed: Vec2[] = [];
    const r = await openDialog({
      title: 'Paste room corners',
      body: h(
        'div',
        null,
        h('p', { class: 'small' }, 'One corner per line as “x, z”, walking around the room in order. Plain numbers are feet; you can also write 12\' 6" or 3.8 m. Doors and windows will be cleared.'),
        ta,
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Use these corners',
          kind: 'primary',
          onClick: () => {
            const res = parseOutline(ta.value);
            if (res.errors.length) {
              toast(res.errors[0], { kind: 'error' });
              return false;
            }
            const draft: Room = { ...this.layout.room, vertices: res.vertices, openings: [] };
            const errors = tryRoom({ ...draft, spawn: polygonCentroid(res.vertices) });
            if (errors.length) {
              toast(errors[0], { kind: 'error' });
              return false;
            }
            parsed = res.vertices;
          },
        },
      ],
    });
    if (r !== 1 || !parsed.length) return;
    // centre the outline on the origin so the camera framing is pleasant
    const c = polygonCentroid(parsed);
    const verts = parsed.map((p) => ({ x: p.x - c.x, z: p.z - c.z }));
    this.applyRoom('Paste outline', (room) => {
      room.vertices = verts;
      room.openings = [];
      room.spawn = { x: 0, z: 0 };
      room.columns = [];
      if (room.dimensionStatus === 'demo') room.dimensionStatus = 'estimated';
    });
    this.ctx.sm.fitTopView();
  }

  private openingsSection(r: Room): HTMLElement {
    const wallOptions = r.vertices.map((_, i) => ({ value: String(i), label: `Wall ${i + 1} (${formatFeetShort(wallLength(r.vertices, i))})` }));
    const update = (id: string, label: string, fn: (o: Opening, room: Room) => void) =>
      this.applyRoom(label, (room) => {
        const o = room.openings.find((x) => x.id === id);
        if (o) fn(o, room);
      });
    const seen = { door: 0, window: 0 };
    const rows = r.openings.map((o) =>
      this.itemRow(
        o.id,
        `${o.kind === 'door' ? 'Door' : 'Window'} ${++seen[o.kind]}`,
        `Wall ${o.wallIndex + 1} · ${formatFtIn(o.offset)} from start · ${formatFtIn(o.width)} wide`,
        h(
          'div',
          { class: 'opening-head' },
          selectField(o.kind === 'door' ? 'Door' : 'Window', o.kind, [{ value: 'door', label: 'Door' }, { value: 'window', label: 'Window' }], (v) =>
            update(o.id, 'Change opening', (x, room) => {
              x.kind = v;
              if (v === 'door') x.sillHeight = 0;
              else {
                x.sillHeight = Math.min(ft(3), room.wallHeight - ft(2));
                x.height = Math.min(x.height, room.wallHeight - x.sillHeight);
              }
            }),
          ),
          selectField('On wall', String(o.wallIndex), wallOptions, (v) =>
            update(o.id, 'Move opening', (x, room) => {
              x.wallIndex = Number(v);
              const L = wallLength(room.vertices, x.wallIndex);
              x.width = Math.min(x.width, L);
              x.offset = Math.max(0, Math.min(x.offset, L - x.width));
            }),
          ),
          h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove opening', onclick: () => this.applyRoom('Remove opening', (room) => void (room.openings = room.openings.filter((x) => x.id !== o.id))) }, svgIcon(ICONS.trash)),
        ),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'From wall start', value: o.offset, min: 0, max: 1000, step: inch(6), onCommit: (v) => update(o.id, 'Move opening', (x) => (x.offset = v)) }),
          lengthField({ label: 'Width', value: o.width, min: inch(12), max: 1000, step: inch(6), onCommit: (v) => update(o.id, 'Resize opening', (x) => (x.width = v)) }),
          lengthField({ label: 'Height', value: o.height, min: inch(12), max: ft(40), step: inch(6), onCommit: (v) => update(o.id, 'Resize opening', (x) => (x.height = v)) }),
          o.kind === 'window' ? lengthField({ label: 'Sill height', value: o.sillHeight, min: 0, max: ft(30), step: inch(6), onCommit: (v) => update(o.id, 'Resize opening', (x) => (x.sillHeight = v)) }) : h('div'),
        ),
        this.styleControls(o, (label, fn) => update(o.id, label, (x) => fn((x.style = { ...(x.style ?? {}) })))),
      ),
    );
    const add = (kind: 'door' | 'window') => {
      const room = this.layout.room;
      let best = 0;
      for (let i = 1; i < room.vertices.length; i++) if (wallLength(room.vertices, i) > wallLength(room.vertices, best)) best = i;
      const L = wallLength(room.vertices, best);
      const width = Math.min(kind === 'door' ? ft(6) : ft(4), L * 0.8);
      const op: Opening = { id: newId('open'), wallIndex: best, offset: (L - width) / 2, width, height: kind === 'door' ? ft(8) : ft(6), sillHeight: kind === 'door' ? 0 : ft(3), kind };
      op.height = Math.min(op.height, room.wallHeight - op.sillHeight);
      this.applyRoom(`Add ${kind}`, (x) => void x.openings.push(op));
    };
    return this.fold(
      'openings',
      `Doors & windows (${r.openings.length})`,
      h('p', { class: 'muted small' }, '“From wall start” is measured along the wall from its first corner (see corner numbers on the plan). Doors are walkable gaps in the walkthrough.'),
      h('ul', { class: 'opening-list' }, rows),
      h('div', { class: 'button-row' }, h('button', { class: 'btn btn-ghost btn-small', onclick: () => add('door') }, svgIcon(ICONS.plus), 'Door'), h('button', { class: 'btn btn-ghost btn-small', onclick: () => add('window') }, svgIcon(ICONS.plus), 'Window')),
    );
  }

  private styleControls(o: Opening, set: (label: string, fn: (st: NonNullable<Opening['style']>) => void) => void): HTMLElement {
    const st = o.style ?? {};
    const frameOpts: { value: FrameColor; label: string }[] = [
      { value: 'white', label: 'White' },
      { value: 'black', label: 'Black' },
      { value: 'bronze', label: 'Dark bronze' },
      { value: 'wood', label: 'Wood' },
    ];
    if (o.kind === 'door') {
      return h(
        'div',
        { class: 'grid-2' },
        selectField<'double' | 'french' | 'single'>('Door type', st.leaves ?? 'double', [
          { value: 'double', label: 'Double glass' },
          { value: 'french', label: 'French (grid glass)' },
          { value: 'single', label: 'Single solid' },
        ], (v) => set('Door type', (x) => (x.leaves = v))),
        selectField<FrameColor>('Frame', st.frame ?? (st.leaves === 'single' ? 'wood' : 'bronze'), frameOpts, (v) => set('Door frame', (x) => (x.frame = v))),
        toggleField('EXIT sign', !!st.exitSign, (v) => set('Exit sign', (x) => (x.exitSign = v))),
      );
    }
    return h(
      'div',
      { class: 'grid-2' },
      selectField<FrameColor>('Frame', st.frame ?? 'white', frameOpts, (v) => set('Window frame', (x) => (x.frame = v))),
      selectField('Panes', String(st.panes ?? 1), ['1', '2', '3', '4'].map((v) => ({ value: v, label: v })), (v) => set('Window panes', (x) => (x.panes = Number(v)))),
      toggleField('Curtains', !!st.curtains, (v) => set('Curtains', (x) => (x.curtains = v))),
      toggleField('Transom bar', !!st.transom, (v) => set('Transom', (x) => (x.transom = v ? 0.62 : 0))),
    );
  }

  private detailsSection(r: Room): HTMLElement {
    const f = r.features ?? {};
    const fin = f.finish ?? {};
    const setFinish = (label: string, fn: (x: NonNullable<RoomFeatures['finish']>) => void) =>
      this.applyRoom(label, (room) => {
        room.features = room.features ?? {};
        room.features.finish = room.features.finish ?? {};
        fn(room.features.finish);
      });
    const walls = [
      { name: 'Warm cream', value: '#ece1cf' },
      { name: 'Ivory', value: '#f3ece0' },
      { name: 'Greige', value: '#d9cfc2' },
      { name: 'White', value: '#f7f5f0' },
    ];
    const counts = (kind: string) => (f.fixtures ?? []).filter((x) => x.kind === kind).length;
    const removeKind = (kind: string, label: string) =>
      h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.applyRoom(`Remove ${label}`, (room) => void (room.features && (room.features.fixtures = (room.features.fixtures ?? []).filter((x) => x.kind !== kind)))) }, svgIcon(ICONS.trash), `${counts(kind)} ${label}`);
    return this.fold(
      'details',
      'Finishes & details',
      selectField<FloorFinish>('Floor', fin.floor ?? 'honey-oak', [
        { value: 'dark-walnut', label: 'Dark walnut planks' },
        { value: 'honey-oak', label: 'Honey oak planks' },
        { value: 'light-oak', label: 'Light oak planks' },
      ], (v) => setFinish('Floor finish', (x) => (x.floor = v))),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Wall colour'),
        h('div', { class: 'swatches' }, walls.map((w) => h('button', { class: `swatch ${fin.wallColor === w.value ? 'active' : ''}`, title: w.name, style: `--swatch:${w.value}`, onclick: () => setFinish('Wall colour', (x) => (x.wallColor = w.value)) }, h('span', { class: 'sr-only' }, w.name)))),
      ),
      selectField<ExteriorView>('Outside the windows', fin.exterior ?? 'lawn', [
        { value: 'lake-hill-country', label: 'Patio, oaks & lake view' },
        { value: 'lawn', label: 'Plain lawn' },
      ], (v) => setFinish('Outside view', (x) => (x.exterior = v))),
      counts('duct') ? h('div', { class: 'button-row' }, removeKind('duct', 'ducts')) : null,
      counts('duct') ? h('p', { class: 'muted small' }, 'Ducts come from imported venue files; undo restores them if removed.') : null,
      r.notes ? h('p', { class: 'small callout callout-warn' }, r.notes) : null,
    );
  }

  private pilastersSection(r: Room): HTMLElement {
    const list = r.features?.pilasters ?? [];
    const wallOptions = r.vertices.map((_, i) => ({ value: String(i), label: `Wall ${i + 1} (${formatFeetShort(wallLength(r.vertices, i))})` }));
    const update = (id: string, label: string, fn: (p: Pilaster, L: number) => void) =>
      this.applyRoom(label, (room) => {
        const p = room.features?.pilasters?.find((x) => x.id === id);
        if (!p) return;
        fn(p, wallLength(room.vertices, p.wallIndex));
        // keep it on its wall
        const L = wallLength(room.vertices, p.wallIndex);
        p.width = Math.min(p.width, L, ft(20));
        p.offset = Math.max(0, Math.min(p.offset, L - p.width));
      });
    const rows = list.map((p, i) =>
      this.itemRow(
        p.id,
        `${p.material === 'plaster' ? 'Plaster' : 'Stone'} pilaster ${i + 1}`,
        `Wall ${p.wallIndex + 1} · ${formatFtIn(p.offset)} from start · ${formatFtIn(p.width)} wide`,
        h(
          'div',
          { class: 'opening-head' },
          selectField<Pilaster['material']>('Pilaster', p.material, [{ value: 'stone', label: 'Stone' }, { value: 'plaster', label: 'Painted plaster' }], (v) =>
            update(p.id, 'Pilaster material', (x) => (x.material = v)),
          ),
          selectField('On wall', String(p.wallIndex), wallOptions, (v) => update(p.id, 'Move pilaster', (x) => (x.wallIndex = Number(v)))),
          h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove pilaster', onclick: () => this.applyRoom('Remove pilaster', (room) => void (room.features!.pilasters = room.features!.pilasters!.filter((x) => x.id !== p.id))) }, svgIcon(ICONS.trash)),
        ),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'From wall start', value: p.offset, min: 0, max: 1000, step: inch(6), onCommit: (v) => update(p.id, 'Move pilaster', (x) => (x.offset = v)) }),
          lengthField({ label: 'Width', value: p.width, min: inch(4), max: ft(20), step: inch(2), onCommit: (v) => update(p.id, 'Resize pilaster', (x) => (x.width = v)) }),
          lengthField({ label: 'Sticks out from wall', value: p.depth, min: inch(1), max: ft(10), step: inch(1), onCommit: (v) => update(p.id, 'Resize pilaster', (x) => (x.depth = v)) }),
          h('div'),
        ),
      ),
    );
    const add = () => {
      const res = addPilaster(this.layout.room);
      if (!this.applyRoom('Add stone pilaster', () => res.room)) return;
      if (!this.editCorners) this.setEditCorners(true);
      toast(`Added a stone pilaster on wall ${res.pilaster.wallIndex + 1}. Drag it along the wall to place it.`);
      requestAnimationFrame(() => this.focusItem(res.pilaster.id));
    };
    return this.fold(
      'pilasters',
      `Stone pilasters (${list.length})`,
      h('p', { class: 'muted small' }, 'Stone piers built into a wall, running floor to ceiling. Drag them along the wall on the plan, or onto another wall; the round end grips change the width. They block walking in the walkthrough.'),
      list.length ? h('ul', { class: 'opening-list' }, rows) : null,
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'btn btn-ghost btn-small', onclick: add }, svgIcon(ICONS.plus), 'Stone pilaster'),
        list.length > 1 ? h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.applyRoom('Remove pilasters', (room) => void (room.features!.pilasters = [])) }, svgIcon(ICONS.trash), 'Remove all') : null,
      ),
    );
  }

  private ceilingsSection(r: Room): HTMLElement {
    const zones = r.features?.ceilings ?? [];
    const update = (id: string, label: string, fn: (z: CeilingZone) => void) =>
      this.applyRoom(label, (room) => {
        const z = room.features?.ceilings?.find((x) => x.id === id);
        if (!z) return;
        fn(z);
        if (z.kind === 'vaulted') z.peakHeight = Math.max(z.peakHeight ?? z.height, z.height + ft(1));
      });
    const overlaps = overlappingZones(r);
    const num = new Map(zones.map((z, i) => [z.id, i + 1]));
    const rows = zones.map((z, i) => {
      const { sx, sz } = zoneExtents(z);
      const truss = z.kind === 'vaulted';
      return this.itemRow(
        z.id,
        `Ceiling area ${i + 1}`,
        `${truss ? `Truss ${formatFeetShort(z.height)}–${formatFeetShort(z.peakHeight ?? z.height)}` : `Flat ${formatFeetShort(z.height)}`} · ${formatFeetShort(sx)} × ${formatFeetShort(sz)}`,
        h(
          'div',
          { class: 'opening-head' },
          selectField<CeilingZone['kind']>(`Ceiling area ${i + 1}`, z.kind, [
            { value: 'flat', label: 'Flat (lower)' },
            { value: 'vaulted', label: 'Truss (vaulted)' },
          ], (v) =>
            update(z.id, 'Change ceiling type', (x) => {
              x.kind = v;
              if (v === 'vaulted') {
                x.peakHeight = Math.max(x.peakHeight ?? 0, x.height + ft(8));
                x.trussSpacing = x.trussSpacing ?? ft(12);
              }
            }),
          ),
          truss
            ? selectField('Ridge runs', ridgeLeftRight(z) ? 'lr' : 'tb', [
                { value: 'lr', label: '↔ Left–right' },
                { value: 'tb', label: '↕ Top–bottom' },
              ], (v) => update(z.id, 'Turn ridge', (x) => setRidge(x, v === 'lr')))
            : h('div'),
          h('button', { class: 'icon-btn', title: 'Remove this ceiling area', 'aria-label': `Remove ceiling area ${i + 1}`, onclick: () => this.applyRoom('Remove ceiling area', (room) => void (room.features!.ceilings = room.features!.ceilings!.filter((x) => x.id !== z.id))) }, svgIcon(ICONS.trash)),
        ),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: truss ? 'Height at the sides' : 'Ceiling height', value: z.height, min: ft(7), max: ft(40), step: inch(6), onCommit: (v) => update(z.id, 'Ceiling height', (x) => (x.height = v)) }),
          truss
            ? lengthField({ label: 'Height at the peak', value: z.peakHeight ?? z.height, min: ft(8), max: ft(60), step: inch(6), onCommit: (v) => update(z.id, 'Ceiling peak', (x) => (x.peakHeight = Math.max(v, x.height + ft(1)))) })
            : h('div'),
          lengthField({ label: 'Left–right size', value: sx, min: ft(3), max: ft(300), step: inch(6), onCommit: (v) => update(z.id, 'Resize ceiling area', (x) => setZoneExtents(x, v, zoneExtents(x).sz)) }),
          lengthField({ label: 'Top–bottom size', value: sz, min: ft(3), max: ft(300), step: inch(6), onCommit: (v) => update(z.id, 'Resize ceiling area', (x) => setZoneExtents(x, zoneExtents(x).sx, v)) }),
          truss
            ? lengthField({ label: 'Truss spacing', value: z.trussSpacing ?? ft(12), min: 0, max: ft(40), step: ft(1), onCommit: (v) => update(z.id, 'Truss spacing', (x) => (x.trussSpacing = v < ft(2) ? 0 : v)) })
            : null,
        ),
      );
    });
    const add = (kind: CeilingZone['kind']) => {
      const z = newCeilingZone(this.layout.room, kind, this.ctx.editor.viewCenter());
      if (!this.applyRoom(kind === 'flat' ? 'Add flat ceiling' : 'Add truss ceiling', (room) => {
        room.features = room.features ?? {};
        (room.features.ceilings = room.features.ceilings ?? []).push(z);
      })) return;
      if (!this.editCeilings) this.setEditCeilings(true);
      toast(`Added a ${kind === 'flat' ? 'flat' : 'truss'} ceiling area. Drag its edges on the plan to fit the space.`);
      requestAnimationFrame(() => this.focusItem(z.id));
    };
    return this.fold(
      'ceilings',
      `Ceilings (${zones.length})`,
      h('p', { class: 'muted small' }, `Anywhere without a ceiling area has a flat ceiling at the wall height (${formatFeetShort(r.wallHeight)}). Ceilings show in the walkthrough.`),
      overlaps.length
        ? h('p', { class: 'small callout callout-warn' }, `Ceiling areas ${overlaps.map(([a, b]) => `${num.get(a.id)} and ${num.get(b.id)}`).join(', ')} overlap. The first one listed wins where they overlap; drag the edges apart so they only touch.`)
        : null,
      rows.length ? h('ul', { class: 'opening-list' }, rows) : null,
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => add('flat') }, svgIcon(ICONS.plus), 'Flat ceiling'),
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => add('vaulted') }, svgIcon(ICONS.plus), 'Truss ceiling'),
      ),
    );
  }

  private sconcesSection(r: Room): HTMLElement {
    const list = (r.features?.fixtures ?? []).filter((f) => f.kind === 'sconce');
    const wallOptions = r.vertices.map((_, i) => ({ value: String(i), label: `Wall ${i + 1} (${formatFeetShort(wallLength(r.vertices, i))})` }));
    const update = (id: string, label: string, fn: (f: Fixture, room: Room) => void) =>
      this.applyRoom(label, (room) => {
        const f = room.features?.fixtures?.find((x) => x.id === id);
        if (f) fn(f, room);
      });
    const rows = list.map((f, i) => {
      const { wall, along } = sconcePlacement(r, f);
      const over = r.openings.find((o) => o.wallIndex === wall && along > o.offset - 0.1 && along < o.offset + o.width + 0.1);
      return this.itemRow(
        f.id,
        `Wall light ${i + 1}`,
        `Wall ${wall + 1} · ${formatFtIn(along)} from start · ${formatFtIn(f.height)} high${over ? ` · over a ${over.kind}` : ''}`,
        h(
          'div',
          { class: 'opening-head two' },
          selectField('On wall', String(wall), wallOptions, (v) =>
            // same distance from the corner on the new wall (clamped if that wall is shorter)
            update(f.id, 'Move wall light', (x, room) => (x.position = pointOnWall(room, Number(v), along))),
          ),
          h('button', { class: 'icon-btn', title: 'Remove this wall light', 'aria-label': `Remove wall light ${i + 1}`, onclick: () => this.applyRoom('Remove wall light', (room) => void (room.features!.fixtures = room.features!.fixtures!.filter((x) => x.id !== f.id))) }, svgIcon(ICONS.trash)),
        ),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'From wall start', value: along, min: 0, max: 1000, step: inch(6), onCommit: (v) => update(f.id, 'Move wall light', (x, room) => (x.position = pointOnWall(room, wall, v))) }),
          lengthField({ label: 'Height (centre)', value: f.height, min: ft(3), max: Math.max(ft(4), r.wallHeight - inch(6)), step: inch(3), onCommit: (v) => update(f.id, 'Wall light height', (x, room) => (x.height = Math.min(v, room.wallHeight - inch(6)))) }),
        ),
        over ? h('p', { class: 'muted small' }, `This light is over a ${over.kind}.`) : null,
      );
    });
    const add = () => {
      const f = newSconce(this.layout.room, this.ctx.editor.viewCenter());
      if (!this.applyRoom('Add wall light', (room) => {
        room.features = room.features ?? {};
        (room.features.fixtures = room.features.fixtures ?? []).push(f);
      })) return;
      if (!this.editCorners && !this.editCeilings) this.setEditCorners(true);
      const { wall } = sconcePlacement(this.layout.room, f);
      toast(`Added a wall light on wall ${wall + 1}. Drag it along the wall to place it.`);
      requestAnimationFrame(() => this.focusItem(f.id));
    };
    return this.fold(
      'sconces',
      `Wall lights (${list.length})`,
      h('p', { class: 'muted small' }, 'Sconces mounted on the walls, shown in the walkthrough. A new one goes on the wall nearest the middle of your view, clear of doors and windows. Drag the glowing dots on the plan to move them; tap one to jump to its settings.'),
      rows.length ? h('ul', { class: 'opening-list' }, rows) : null,
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'btn btn-ghost btn-small', onclick: add }, svgIcon(ICONS.plus), 'Wall light'),
        list.length > 1 ? h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.applyRoom('Remove wall lights', (room) => void (room.features!.fixtures = room.features!.fixtures!.filter((x) => x.kind !== 'sconce'))) }, svgIcon(ICONS.trash), 'Remove all') : null,
      ),
    );
  }

  private chandeliersSection(r: Room): HTMLElement {
    const all = r.features?.fixtures ?? [];
    const list = all.filter(isChandelier);
    const update = (id: string, label: string, fn: (f: Fixture) => void) =>
      this.applyRoom(label, (room) => {
        const f = room.features?.fixtures?.find((x) => x.id === id);
        if (f) fn(f);
      });
    const rows = list.map((f, i) => {
      const ceil = ceilingAt(r, f.position);
      const hang = chandelierHangHeight(r, f);
      return this.itemRow(
        f.id,
        `Chandelier ${i + 1}`,
        `${f.kind === 'iron-chandelier' ? 'Iron ring' : 'Crystal drum'} · ${formatFeetShort(f.size)} wide · bottom at ${formatFtIn(hang)}`,
        h(
          'div',
          { class: 'opening-head' },
          selectField<ChandelierKind>(`Chandelier ${i + 1}`, f.kind, [
            { value: 'iron-chandelier', label: 'Iron ring' },
            { value: 'crystal-chandelier', label: 'Crystal drum' },
          ], (v) => update(f.id, 'Change chandelier', (x) => (x.kind = v))),
          h('span', { class: 'muted small', title: 'Ceiling height above this chandelier' }, `Ceiling ${formatFeetShort(ceil)}`),
          h('button', { class: 'icon-btn', title: 'Remove this chandelier', 'aria-label': `Remove chandelier ${i + 1}`, onclick: () => this.applyRoom('Remove chandelier', (room) => void (room.features!.fixtures = room.features!.fixtures!.filter((x) => x.id !== f.id))) }, svgIcon(ICONS.trash)),
        ),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'Diameter', value: f.size, min: ft(1), max: ft(12), step: inch(6), onCommit: (v) => update(f.id, 'Chandelier size', (x) => (x.size = v)) }),
          lengthField({ label: 'Bottom above floor', value: hang, min: ft(6), max: ft(50), step: inch(6), onCommit: (v) => update(f.id, 'Chandelier height', (x) => (x.height = v)) }),
        ),
        f.height > hang + 0.01 ? h('p', { class: 'muted small' }, `Raised as high as the ceiling here allows.`) : null,
      );
    });
    const add = (kind: ChandelierKind) => {
      const f = newChandelier(this.layout.room, kind, this.ctx.editor.viewCenter());
      if (!this.applyRoom(kind === 'iron-chandelier' ? 'Add iron chandelier' : 'Add crystal chandelier', (room) => {
        room.features = room.features ?? {};
        (room.features.fixtures = room.features.fixtures ?? []).push(f);
      })) return;
      if (!this.editCeilings) this.setEditCeilings(true);
      toast('Added a chandelier in the middle of the view. Drag it on the plan to place it.');
      requestAnimationFrame(() => this.focusItem(f.id));
    };
    return this.fold(
      'chandeliers',
      `Chandeliers (${list.length})`,
      h('p', { class: 'muted small' }, 'Chandeliers hang from the ceiling above them and show in the walkthrough. If a ceiling is lowered, they rise only as high as it allows.'),
      rows.length ? h('ul', { class: 'opening-list' }, rows) : null,
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => add('iron-chandelier') }, svgIcon(ICONS.plus), 'Iron ring'),
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => add('crystal-chandelier') }, svgIcon(ICONS.plus), 'Crystal drum'),
        list.length > 1 ? h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.applyRoom('Remove chandeliers', (room) => void (room.features!.fixtures = room.features!.fixtures!.filter((x) => !isChandelier(x)))) }, svgIcon(ICONS.trash), 'Remove all') : null,
      ),
    );
  }

  private columnsSection(r: Room): HTMLElement {
    const rows = r.columns.map((c) =>
      h(
        'li',
        { class: 'column-row' },
        lengthField({ label: 'X', compact: true, value: c.position.x, allowNegative: true, min: -1000, max: 1000, step: inch(6), onCommit: (v) => this.applyRoom('Move column', (room) => void (room.columns.find((x) => x.id === c.id)!.position.x = v)) }),
        lengthField({ label: 'Z', compact: true, value: c.position.z, allowNegative: true, min: -1000, max: 1000, step: inch(6), onCommit: (v) => this.applyRoom('Move column', (room) => void (room.columns.find((x) => x.id === c.id)!.position.z = v)) }),
        lengthField({ label: 'Size', compact: true, value: c.width, min: inch(4), max: ft(10), step: inch(2), onCommit: (v) => this.applyRoom('Resize column', (room) => {
          const x = room.columns.find((y) => y.id === c.id)!;
          x.width = v;
          x.depth = v;
        }) }),
        h('button', { class: 'icon-btn', title: 'Remove column', 'aria-label': 'Remove column', onclick: () => this.applyRoom('Remove column', (room) => void (room.columns = room.columns.filter((x) => x.id !== c.id))) }, svgIcon(ICONS.trash)),
      ),
    );
    return this.fold(
      'columns',
      `Columns (${r.columns.length})`,
      h('ul', { class: 'column-list' }, rows),
      h('button', { class: 'btn btn-ghost btn-small', onclick: () => {
        const c = polygonCentroid(this.layout.room.vertices);
        this.applyRoom('Add column', (room) => void room.columns.push({ id: newId('col'), position: c, width: ft(1.5), depth: ft(1.5) }));
      } }, svgIcon(ICONS.plus), 'Column'),
    );
  }

  private entranceSection(r: Room): HTMLElement {
    const dirs = [
      { value: '0', label: '↑ Toward the top of the plan' },
      { value: String(-Math.PI / 2), label: '→ Toward the right' },
      { value: String(Math.PI), label: '↓ Toward the bottom' },
      { value: String(Math.PI / 2), label: '← Toward the left' },
    ];
    const nearest = dirs.reduce((best, d) => (Math.abs(Math.atan2(Math.sin(Number(d.value) - r.spawnYaw), Math.cos(Number(d.value) - r.spawnYaw))) < Math.abs(Math.atan2(Math.sin(Number(best.value) - r.spawnYaw), Math.cos(Number(best.value) - r.spawnYaw))) ? d : best));
    return this.fold(
      'entrance',
      'Walkthrough entrance',
      h('p', { class: 'muted small' }, 'Where the walkthrough starts (pink arrow on the plan).'),
      h('button', { class: 'btn btn-ghost btn-small', onclick: () => {
        this.ctx.editor.setTool({ kind: 'spawn' });
        if (this.ctx.isNarrow()) this.ctx.closeDrawers();
      } }, svgIcon(ICONS.target), 'Tap the plan to set'),
      selectField('Facing', nearest.value, dirs, (v) => this.applyRoom('Entrance direction', (room) => void (room.spawnYaw = Number(v)))),
    );
  }

  private referenceSection(r: Room): HTMLElement {
    const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const { blob, width, height } = await normalizeImage(file);
        const id = newId('img');
        const persisted = await putAsset(id, blob);
        if (!persisted) toast('This browser could not store the image permanently; it will need to be re-added after reload.', { kind: 'error' });
        const b = polygonBounds(this.layout.room.vertices);
        const old = this.layout.room.overlay?.assetId;
        this.applyRoom('Add reference image', (room) => {
          room.overlay = { assetId: id, width: (b.maxX - b.minX) * 1.1, aspect: height / width, center: polygonCentroid(room.vertices), rotation: 0, opacity: 0.55, visible: true };
        });
        if (old) void deleteAsset(old);
        toast('Image added. Use “Calibrate scale” with a known measurement next.');
      } catch (e) {
        toast(String((e as Error).message ?? e), { kind: 'error' });
      }
    });
    const o = r.overlay;
    const children: (HTMLElement | null)[] = [
      h('p', { class: 'muted small' }, 'Trace a venue floor plan: add the image, calibrate its scale from a known measurement, then line it up. It is only a visual guide — walls and collisions come from the outline above.'),
      h('div', { class: 'button-row' }, h('button', { class: 'btn btn-ghost btn-small', onclick: () => fileInput.click() }, svgIcon(ICONS.image), o ? 'Replace image' : 'Add floor-plan image'), fileInput),
    ];
    if (o) {
      const upd = (label: string, fn: (ov: NonNullable<Room['overlay']>) => void) => this.applyRoom(label, (room) => room.overlay && fn(room.overlay));
      const opacity = h('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: String(o.opacity), class: 'range', 'aria-label': 'Image opacity' });
      opacity.addEventListener('change', () => upd('Image opacity', (ov) => (ov.opacity = Number(opacity.value))));
      children.push(
        toggleField('Show image', o.visible, (v) => upd('Toggle image', (ov) => (ov.visible = v))),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Opacity'), opacity),
        h(
          'div',
          { class: 'button-row' },
          h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.calibrate() }, svgIcon(ICONS.ruler), 'Calibrate scale'),
          h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.align() }, svgIcon(ICONS.target), 'Line up a point'),
        ),
        h(
          'div',
          { class: 'grid-2' },
          lengthField({ label: 'Image width', value: o.width, min: ft(1), max: ft(2000), step: inch(6), onCommit: (v) => upd('Image width', (ov) => (ov.width = v)) }),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Rotation'), h('input', { class: 'input', type: 'number', step: '0.5', value: String(Math.round((o.rotation * 1800) / Math.PI) / 10), onchange: (e: Event) => upd('Rotate image', (ov) => (ov.rotation = (Number((e.target as HTMLInputElement).value) * Math.PI) / 180)) })),
          lengthField({ label: 'Centre X', value: o.center.x, allowNegative: true, min: -1000, max: 1000, step: inch(6), onCommit: (v) => upd('Move image', (ov) => (ov.center = { ...ov.center, x: v })) }),
          lengthField({ label: 'Centre Z', value: o.center.z, allowNegative: true, min: -1000, max: 1000, step: inch(6), onCommit: (v) => upd('Move image', (ov) => (ov.center = { ...ov.center, z: v })) }),
        ),
        h('button', { class: 'btn btn-ghost btn-small btn-danger-text', onclick: async () => {
          if (!(await confirmDialog('Remove reference image?', 'The image is removed from this layout. Your outline and furniture are unaffected.', 'Remove', true))) return;
          this.applyRoom('Remove reference image', (room) => void delete room.overlay);
        } }, svgIcon(ICONS.trash), 'Remove image'),
        h('p', { class: 'muted small' }, 'Reference images are stored in this browser. Include them when exporting a project backup to move them to another device.'),
      );
    }
    return this.fold('reference', 'Reference image', ...children);
  }

  private calibrate(): void {
    toast('Tap two points on the image whose real distance you know (e.g. the ends of a labelled wall).', { ms: 5000 });
    if (this.ctx.isNarrow()) this.ctx.closeDrawers();
    this.ctx.editor.setTool({
      kind: 'calibrate',
      points: [],
      onDone: async (a, b) => {
        const measured = dist(a, b);
        if (measured < 0.05) return toast('Those points are too close together.', { kind: 'error' });
        const text = await promptDialog('Calibrate scale', `Real distance between the two points (currently ${formatFtIn(measured, 1)})`, '', 'Apply');
        if (text === null) return;
        const real = parseLength(text);
        if (real === null || real <= 0) return toast('Enter a distance like 42\' or 12.8 m.', { kind: 'error' });
        const k = real / measured;
        this.applyRoom('Calibrate image', (room) => {
          const ov = room.overlay;
          if (!ov) return;
          ov.width *= k;
          ov.center = { x: a.x + (ov.center.x - a.x) * k, z: a.z + (ov.center.z - a.z) * k };
        });
        toast(`Scaled the image by ${k.toFixed(3)}×. ${toFeet(real).toFixed(1)} ft now matches.`);
      },
    });
  }

  private align(): void {
    toast('Tap a point on the image (like a room corner), then tap where it really belongs.', { ms: 5000 });
    if (this.ctx.isNarrow()) this.ctx.closeDrawers();
    this.ctx.editor.setTool({
      kind: 'calibrate',
      points: [],
      onDone: (a, b) => {
        this.applyRoom('Line up image', (room) => {
          const ov = room.overlay;
          if (ov) ov.center = { x: ov.center.x + (b.x - a.x), z: ov.center.z + (b.z - a.z) };
        });
      },
    });
  }
}

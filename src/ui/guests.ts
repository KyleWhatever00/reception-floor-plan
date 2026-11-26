import type { AppContext } from './context';
import type { Guest, Layout } from '../model/types';
import { clear, debounce, h, svgIcon } from './dom';
import { ICONS } from './icons';
import { addGuests, assignGuestToTable, removeGuest, renameGuest, seatOfGuest, seatStats, tablesWithSeats, unassignGuest } from '../model/commands';
import { confirmDialog, openDialog, promptDialog, toast } from './dialogs';
import { guestNamesFromCsv } from '../model/serialization';
import { downloadBlob, safeFileName, seatingCsvBlob, dateStamp } from '../persistence/exports';

type Filter = 'all' | 'unassigned' | 'seated';

/** Guest roster: add, bulk paste, CSV, search, assign to tables. Names stay in this browser. */
export class GuestPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private stats: HTMLElement;
  private search = '';
  private filter: Filter = 'all';
  private filterBar: HTMLElement;
  private visible = false;

  constructor(private ctx: AppContext) {
    const addInput = h('input', { class: 'input', type: 'text', placeholder: 'Guest name', 'aria-label': 'New guest name', autocomplete: 'off' });
    const add = () => {
      const name = addInput.value.trim();
      if (!name) return;
      ctx.store.apply('Add guest', (l) => addGuests(l, [name]));
      addInput.value = '';
      addInput.focus();
    };
    addInput.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Search guests', 'aria-label': 'Search guests' });
    searchInput.addEventListener('input', debounce(() => {
      this.search = searchInput.value.trim().toLowerCase();
      this.renderList();
    }, 120));
    const csvInput = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', hidden: true });
    csvInput.addEventListener('change', async () => {
      const file = csvInput.files?.[0];
      csvInput.value = '';
      if (!file) return;
      const names = guestNamesFromCsv(await file.text());
      if (!names.length) return toast('No names found in that file.', { kind: 'error' });
      if (await confirmDialog('Import guests', `Add ${names.length} guest${names.length === 1 ? '' : 's'} from ${file.name}?`, 'Add guests')) {
        ctx.store.apply('Import guests', (l) => addGuests(l, names));
        toast(`Added ${names.length} guests.`);
      }
    });
    this.stats = h('div', { class: 'guest-stats' });
    this.filterBar = h('div', { class: 'segmented segmented-small', role: 'radiogroup', 'aria-label': 'Filter guests' });
    this.list = h('ul', { class: 'guest-list' });
    this.el = h(
      'div',
      { class: 'guests' },
      this.stats,
      h('div', { class: 'add-row' }, addInput, h('button', { class: 'btn btn-primary', onclick: add }, svgIcon(ICONS.plus), 'Add')),
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.bulkPaste() }, 'Paste a list…'),
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => csvInput.click() }, 'Import CSV'),
        h('button', { class: 'btn btn-ghost btn-small', onclick: () => this.exportCsv() }, 'Seating CSV'),
        csvInput,
      ),
      searchInput,
      this.filterBar,
      this.list,
      h('p', { class: 'muted small' }, 'Guest names are stored only in this browser and in files you export. “Layout only” exports leave them out.'),
    );
    ctx.store.subscribe((e) => {
      if (e.transient) return;
      if (e.kind === 'layout' || e.kind === 'project') this.render();
    });
    this.render();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.render();
  }

  private get layout(): Layout {
    return this.ctx.store.layout;
  }

  render(): void {
    if (!this.visible) return;
    const st = seatStats(this.layout);
    const open = Math.max(0, st.seats - st.assigned);
    clear(this.stats);
    this.stats.append(
      h('div', { class: 'stat' }, h('strong', null, String(st.guests)), h('span', null, 'guests')),
      h('div', { class: 'stat' }, h('strong', null, String(st.assigned)), h('span', null, 'seated')),
      h('div', { class: `stat ${st.unassigned ? 'stat-attn' : ''}` }, h('strong', null, String(st.unassigned)), h('span', null, 'unseated')),
      h('div', { class: 'stat' }, h('strong', null, String(open)), h('span', null, 'open seats')),
    );
    if (st.guests > st.seats) {
      this.stats.append(h('p', { class: 'small text-warn full-row' }, svgIcon(ICONS.warn, 'icon icon-inline'), `${st.guests - st.seats} more guests than chairs.`));
    }
    clear(this.filterBar);
    const opts: [Filter, string][] = [['all', 'All'], ['unassigned', 'Unseated'], ['seated', 'Seated']];
    for (const [v, label] of opts) {
      this.filterBar.append(
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(this.filter === v), class: this.filter === v ? 'active' : '', onclick: () => ((this.filter = v), this.render()) }, label),
      );
    }
    this.renderList();
  }

  private renderList(): void {
    clear(this.list);
    const l = this.layout;
    const tables = tablesWithSeats(l);
    let guests = [...l.guests];
    if (this.search) guests = guests.filter((g) => g.name.toLowerCase().includes(this.search));
    const seatMap = new Map<string, ReturnType<typeof seatOfGuest>>();
    for (const g of guests) seatMap.set(g.id, seatOfGuest(l, g.id));
    if (this.filter === 'unassigned') guests = guests.filter((g) => !seatMap.get(g.id));
    if (this.filter === 'seated') guests = guests.filter((g) => seatMap.get(g.id));
    guests.sort((a, b) => a.name.localeCompare(b.name));
    if (!guests.length) {
      this.list.append(h('li', { class: 'empty' }, l.guests.length ? 'No guests match.' : 'No guests yet. Add names above or paste a list.'));
      return;
    }
    const MAX = 400;
    for (const g of guests.slice(0, MAX)) this.list.append(this.row(g, seatMap.get(g.id), tables));
    if (guests.length > MAX) this.list.append(h('li', { class: 'empty' }, `Showing ${MAX} of ${guests.length}. Search to narrow the list.`));
  }

  private row(g: Guest, seat: ReturnType<typeof seatOfGuest>, tables: ReturnType<typeof tablesWithSeats>): HTMLElement {
    const { store } = this.ctx;
    const select = h(
      'select',
      { class: 'input input-compact', 'aria-label': `Table for ${g.name}` },
      h('option', { value: '' }, 'Unseated'),
      tables.map((t) => {
        const free = t.seats!.filter((s) => !s.guestId).length;
        const mine = seat?.table.id === t.id;
        return h('option', { value: t.id, selected: mine, disabled: !mine && free === 0 }, `${t.label}${mine ? ` · seat ${seat!.index + 1}` : free ? ` (${free} open)` : ' (full)'}`);
      }),
    );
    select.addEventListener('change', () => {
      const v = select.value;
      if (!v) store.apply('Unseat guest', (l) => unassignGuest(l, g.id));
      else {
        const ok = store.apply('Seat guest', (l) => assignGuestToTable(l, g.id, v));
        if (!ok) toast('That table is full.', { kind: 'error' });
      }
    });
    return h(
      'li',
      { class: `guest-row ${seat ? 'seated' : 'unseated'}` },
      h(
        'button',
        { class: 'guest-name', title: 'Rename', onclick: async () => {
          const name = await promptDialog('Rename guest', 'Name', g.name);
          if (name?.trim()) store.apply('Rename guest', (l) => renameGuest(l, g.id, name));
        } },
        h('span', { class: `status-dot ${seat ? 'on' : ''}`, 'aria-hidden': 'true' }),
        g.name,
      ),
      select,
      seat
        ? h('button', {
            class: 'icon-btn',
            title: `See ${g.name}’s view`,
            'aria-label': `View from ${g.name}’s seat`,
            onclick: () => this.ctx.walk.enter({ seatId: seat.seat.id }),
          }, svgIcon(ICONS.eye))
        : h('span', { class: 'icon-btn-spacer' }),
      h('button', {
        class: 'icon-btn',
        title: `Remove ${g.name}`,
        'aria-label': `Remove ${g.name}`,
        onclick: async () => {
          if (await confirmDialog('Remove guest?', `Remove ${g.name} from the guest list${seat ? ` and free their seat at ${seat.table.label}` : ''}?`, 'Remove', true)) {
            store.apply('Remove guest', (l) => removeGuest(l, g.id));
          }
        },
      }, svgIcon(ICONS.trash)),
    );
  }

  private async bulkPaste(): Promise<void> {
    const ta = h('textarea', { class: 'input', rows: 10, placeholder: 'One name per line\nAvery Example\nJordan Example', 'aria-label': 'Guest names, one per line' });
    let names: string[] = [];
    const r = await openDialog({
      title: 'Paste guest list',
      body: h('div', null, h('p', { class: 'muted small' }, 'Paste one name per line (from a spreadsheet, notes or email). Blank lines are skipped. People with the same name are kept as separate guests.'), ta),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Add guests',
          kind: 'primary',
          onClick: () => {
            names = ta.value.split(/\r?\n/).map((s) => s.replace(/\t.*$/, '').trim()).filter(Boolean);
            if (!names.length) {
              toast('Paste at least one name.', { kind: 'error' });
              return false;
            }
          },
        },
      ],
    });
    if (r === 1 && names.length) {
      this.ctx.store.apply('Add guests', (l) => addGuests(l, names));
      toast(`Added ${names.length} guest${names.length === 1 ? '' : 's'}.`);
    }
  }

  private exportCsv(): void {
    const l = this.layout;
    downloadBlob(seatingCsvBlob(l), `${safeFileName(l.name)}-seating-${dateStamp()}.csv`);
  }
}

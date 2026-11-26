import type { AppContext } from './context';
import type { Project, Quality } from '../model/types';
import { h, svgIcon } from './dom';
import { ICONS } from './icons';
import { confirmDialog, openDialog, promptDialog, toast } from './dialogs';
import { parseProjectFile, reidentifyLayout, summarizeLayout, clone, type ParsedImport } from '../model/serialization';
import { blankLayout, demoProject } from '../model/demo';
import { newId } from '../model/ids';
import { canShareFiles, canvasToBlob, composePlanCanvas, dateStamp, downloadBlob, printPlan, projectFileBlob, projectFileName, safeFileName, seatingCsvBlob, shareOrDownload } from '../persistence/exports';
import { dataUrlToBlob, putAsset } from '../persistence/assets';
import { lengthField, section, segmented, selectField } from './fields';
import { inch } from '../model/units';

// ------------------------------------------------------------------ layouts (variants)

export async function layoutsDialog(ctx: AppContext): Promise<void> {
  const { store } = ctx;
  const render = (): HTMLElement => {
    const p = store.project;
    return h(
      'div',
      { class: 'layout-list' },
      h('p', { class: 'muted small' }, 'Each layout is a separate version of the room with its own furniture and guest seating — handy for comparing ideas. Changes in one never affect another.'),
      h(
        'ul',
        null,
        p.layouts.map((l) => {
          const s = summarizeLayout(l);
          const active = l.id === p.activeLayoutId;
          return h(
            'li',
            { class: `layout-row ${active ? 'active' : ''}` },
            h(
              'button',
              { class: 'layout-pick', onclick: () => { store.switchLayout(l.id); ctx.sm.fitTopView(); refresh(); }, 'aria-current': active ? 'true' : undefined },
              h('span', { class: 'radio-dot', 'aria-hidden': 'true' }),
              h('span', null, h('strong', null, l.name), h('small', null, `${s.tables} tables · ${s.seats} seats · ${s.guests} guests`)),
            ),
            h('button', { class: 'icon-btn', title: 'Rename', 'aria-label': `Rename ${l.name}`, onclick: async () => {
              const n = await promptDialog('Rename layout', 'Layout name', l.name);
              if (n) store.renameLayout(l.id, n);
              refresh();
            } }, svgIcon(ICONS.settings)),
            h('button', { class: 'icon-btn', title: 'Duplicate', 'aria-label': `Duplicate ${l.name}`, onclick: () => {
              const copy = reidentifyLayout(l, newId);
              copy.name = `${l.name} (copy)`;
              store.addLayout(copy);
              refresh();
            } }, svgIcon(ICONS.copy)),
            h('button', { class: 'icon-btn', title: 'Delete', 'aria-label': `Delete ${l.name}`, disabled: p.layouts.length <= 1, onclick: async () => {
              if (await confirmDialog('Delete layout?', `“${l.name}” and its seating will be deleted from this browser. Export a backup first if you might want it later.`, 'Delete layout', true)) {
                store.deleteLayout(l.id);
                ctx.sm.fitTopView();
              }
              refresh();
            } }, svgIcon(ICONS.trash)),
          );
        }),
      ),
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'btn btn-ghost', onclick: async () => {
          const name = await promptDialog('New layout', 'Layout name', `Layout ${store.project.layouts.length + 1}`, 'Create');
          if (!name) return;
          const fresh = blankLayout(name, store.layout.room);
          fresh.guests = clone(store.layout.guests).map((g) => ({ ...g, id: newId('g') }));
          store.addLayout(fresh);
          toast('New empty layout with the same room and a copy of the guest list.');
          refresh();
        } }, svgIcon(ICONS.plus), 'New empty layout'),
      ),
    );
  };
  const host = h('div');
  const refresh = () => {
    host.replaceChildren(render());
  };
  refresh();
  await openDialog({ title: 'Layouts', body: host, actions: [{ label: 'Done', kind: 'primary' }] });
}

// ------------------------------------------------------------------ export

type ExportChoice = 'project' | 'layout-only' | 'png' | 'print' | 'csv';

export async function exportDialog(ctx: AppContext): Promise<void> {
  const { store, sm } = ctx;
  let choice: ExportChoice = 'project';
  let includeImages = true;
  const hasImages = store.project.layouts.some((l) => l.room.overlay);
  const options: { value: ExportChoice; title: string; text: string }[] = [
    { value: 'project', title: 'Project backup (JSON)', text: 'Everything: all layouts, furniture, guests and seating. Use this to back up or move your plan to another device (AirDrop, Messages, email, Files).' },
    { value: 'layout-only', title: 'Layout only — no guest names (JSON)', text: 'Room and furniture without any guest information. Safe to share with the venue or planner.' },
    { value: 'png', title: 'Overhead image (PNG)', text: 'A clean, labelled top-down picture of the current layout with scale and seat counts.' },
    { value: 'print', title: 'Print or save as PDF', text: 'Floor plan plus a table-by-table seating list.' },
    { value: 'csv', title: 'Seating list (CSV)', text: 'Table, seat and guest name — opens in Numbers, Excel or Google Sheets.' },
  ];
  const imagesToggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => (includeImages = (e.target as HTMLInputElement).checked) }), ' Include reference images (larger file)');
  imagesToggle.hidden = !hasImages;
  const list = h(
    'div',
    { class: 'choice-list', role: 'radiogroup', 'aria-label': 'What to export' },
    options.map((o) =>
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'radio', name: 'export-choice', value: o.value, checked: o.value === choice, onchange: () => {
          choice = o.value;
          imagesToggle.hidden = !hasImages || choice !== 'project';
        } }),
        h('span', null, h('strong', null, o.title), h('small', null, o.text)),
      ),
    ),
  );
  const run = async (share: boolean) => {
    try {
      const layout = store.layout;
      let blob: Blob;
      let name: string;
      if (choice === 'print') {
        await printPlan(sm, layout);
        return;
      }
      if (choice === 'project' || choice === 'layout-only') {
        blob = await projectFileBlob(store.project, choice, choice === 'project' && includeImages);
        name = projectFileName(store.project, choice);
      } else if (choice === 'png') {
        blob = await canvasToBlob(composePlanCanvas(sm, layout, { showNames: store.settings.showNames }));
        name = `${safeFileName(layout.name)}-plan-${dateStamp()}.png`;
      } else {
        blob = seatingCsvBlob(layout);
        name = `${safeFileName(layout.name)}-seating-${dateStamp()}.csv`;
      }
      const r = share ? await shareOrDownload(blob, name, layout.name) : (downloadBlob(blob, name), 'downloaded');
      if (r === 'downloaded') toast(`Saved ${name}.`, { kind: 'success' });
      if (choice === 'project') localStorage.setItem('wfp.lastBackup', new Date().toISOString());
    } catch (e) {
      toast(`Export failed: ${String((e as Error)?.message ?? e)}`, { kind: 'error' });
    }
  };
  const actions = [{ label: 'Cancel', kind: 'ghost' as const }];
  const shareSupported = canShareFiles();
  if (shareSupported) actions.push({ label: 'Share…', kind: 'ghost' as const, onClick: () => run(true) } as any);
  actions.push({ label: 'Download', kind: 'primary', onClick: () => run(false) } as any);
  await openDialog({
    title: 'Export',
    wide: true,
    body: h('div', null, list, imagesToggle, h('p', { class: 'muted small' }, 'Each browser keeps its own copy of your plan. Sharing the app link does not share your floor plan — send a project file and import it on the other device.')),
    actions,
  });
}

// ------------------------------------------------------------------ import

export async function importFromFile(ctx: AppContext, file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    toast('That file could not be read.', { kind: 'error' });
    return;
  }
  const parsed = parseProjectFile(text);
  if (!parsed.ok || !parsed.value) {
    await openDialog({
      title: 'Can’t import this file',
      body: h('div', null, h('p', null, 'Nothing was changed. The file has these problems:'), h('ul', { class: 'error-list' }, parsed.errors.slice(0, 12).map((e) => h('li', null, e))), parsed.errors.length > 12 ? h('p', { class: 'muted small' }, `…and ${parsed.errors.length - 12} more.`) : null),
    });
    return;
  }
  await importPreview(ctx, parsed, file.name);
}

async function restoreAssets(parsed: ParsedImport): Promise<void> {
  for (const [id, url] of Object.entries(parsed.assets)) {
    try {
      await putAsset(id, await dataUrlToBlob(url));
    } catch {
      /* the overlay will simply be missing */
    }
  }
}

async function importPreview(ctx: AppContext, parsed: ParsedImport, fileName: string): Promise<void> {
  const p = parsed.value!;
  const missingImages = p.layouts.some((l) => l.room.overlay && !parsed.assets[l.room.overlay.assetId]);
  const body = h(
    'div',
    null,
    h('p', null, h('strong', null, fileName), parsed.kind === 'layout-only' ? h('span', { class: 'tag' }, 'Layout only — no guests') : null),
    h(
      'table',
      { class: 'preview-table' },
      h('thead', null, h('tr', null, h('th', null, 'Layout'), h('th', null, 'Tables'), h('th', null, 'Seats'), h('th', null, 'Guests'), h('th', null, 'Room'))),
      h('tbody', null, p.layouts.map((l) => {
        const s = summarizeLayout(l);
        return h('tr', null, h('td', null, s.name), h('td', null, String(s.tables)), h('td', null, String(s.seats)), h('td', null, `${s.guests} (${s.assigned} seated)`), h('td', null, s.status));
      })),
    ),
    parsed.warnings.length ? h('ul', { class: 'muted small' }, parsed.warnings.map((w) => h('li', null, w))) : null,
    missingImages ? h('p', { class: 'small text-warn' }, 'This file refers to reference images that are not included. They can be re-added on the Room tab.') : null,
    h('p', { class: 'muted small' }, '“Add as new layouts” keeps everything you have now. “Replace my project” swaps your whole project for this file — export a backup first if unsure. Nothing is ever merged automatically.'),
  );
  const r = await openDialog({
    title: 'Import project',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Replace my project…', kind: 'danger' },
      { label: 'Add as new layouts', kind: 'primary' },
    ],
  });
  if (r === 2) {
    await restoreAssets(parsed);
    const existing = new Set(ctx.store.project.layouts.map((l) => l.name));
    let first: string | null = null;
    for (const l of p.layouts) {
      const fresh = reidentifyLayout(l, newId);
      if (existing.has(fresh.name)) fresh.name = `${fresh.name} (imported)`;
      ctx.store.addLayout(fresh);
      first = first ?? fresh.id;
    }
    if (first) ctx.store.switchLayout(first);
    ctx.sm.fitTopView();
    toast(`Imported ${p.layouts.length} layout${p.layouts.length === 1 ? '' : 's'}.`, { kind: 'success' });
  } else if (r === 1) {
    const choice = await openDialog({
      title: 'Replace your whole project?',
      body: h('p', null, `All ${ctx.store.project.layouts.length} layout(s) in this browser will be replaced by the file. Download a backup of your current project first?`),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Back up, then replace', kind: 'primary', onClick: async () => {
          const blob = await projectFileBlob(ctx.store.project, 'project', true);
          downloadBlob(blob, projectFileName(ctx.store.project, 'project').replace('.json', '-before-import.json'));
        } },
        { label: 'Replace without backup', kind: 'danger' },
      ],
    });
    if (choice <= 0) return;
    await restoreAssets(parsed);
    replaceProject(ctx, p);
    toast('Project replaced.', { kind: 'success' });
  }
}

export function replaceProject(ctx: AppContext, p: Project): void {
  ctx.store.replaceProject(p);
  ctx.sm.fitTopView();
}

export function pickProjectFile(ctx: AppContext): void {
  const input = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: 'display:none' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.remove();
    if (f) void importFromFile(ctx, f);
  });
  document.body.appendChild(input);
  input.click();
}

// ------------------------------------------------------------------ settings

export async function settingsDialog(ctx: AppContext): Promise<void> {
  const { store } = ctx;
  const s = store.settings;
  const host = h('div');
  const render = () =>
    host.replaceChildren(
      section(
        'Graphics',
        segmented<Quality>('Quality', s.quality, [
          { value: 'low', label: 'Battery saver' },
          { value: 'medium', label: 'Balanced' },
          { value: 'high', label: 'Best (shadows)' },
        ], (v) => {
          store.updateSettings({ quality: v });
          render();
        }),
        segmented<'day' | 'evening'>('Lighting', s.lighting, [
          { value: 'day', label: 'Daytime' },
          { value: 'evening', label: 'Evening glow' },
        ], (v) => {
          store.updateSettings({ lighting: v });
          render();
        }),
      ),
      section(
        'Walkthrough',
        lengthField({ label: 'Standing eye height', value: s.eyeHeight, min: inch(36), max: inch(84), step: inch(1), onCommit: (v) => store.updateSettings({ eyeHeight: v }) }),
        lengthField({ label: 'Seated eye height', value: s.seatedEyeHeight, min: inch(32), max: inch(60), step: inch(1), onCommit: (v) => store.updateSettings({ seatedEyeHeight: v }) }),
        selectField('Walking speed', String(s.walkSpeed), [
          { value: '1', label: 'Stroll' },
          { value: '1.6', label: 'Normal' },
          { value: '2.4', label: 'Brisk' },
        ], (v) => store.updateSettings({ walkSpeed: Number(v) })),
      ),
      section(
        'Planning guidelines (advisory)',
        lengthField({ label: 'Comfortable aisle', value: s.aisleWidth, min: inch(18), max: inch(96), step: inch(6), onCommit: (v) => store.updateSettings({ aisleWidth: v }), hint: 'Flags gaps between tables (including chairs) narrower than this.' }),
        lengthField({ label: 'Table edge per guest', value: s.perimeterPerGuest, min: inch(16), max: inch(40), step: inch(1), onCommit: (v) => store.updateSettings({ perimeterPerGuest: v }), hint: 'A rough comfort rule of thumb, not a requirement.' }),
      ),
      section(
        'Your data',
        h('p', { class: 'small' }, 'Everything is saved automatically in this browser only — nothing is uploaded. Clearing website data (or iPad storage clean-up) erases it, so export a project backup now and then.'),
        h('button', { class: 'btn btn-danger-text btn-small', onclick: async () => {
          if (!(await confirmDialog('Start over with the demo?', 'All layouts and guests in this browser will be replaced by the demo. Export a backup first if you want to keep them.', 'Reset to demo', true))) return;
          replaceProject(ctx, demoProject());
          toast('Reset to the demo layout.');
        } }, 'Reset to demo…'),
      ),
    );
  render();
  await openDialog({ title: 'Settings', body: host, wide: true, actions: [{ label: 'Done', kind: 'primary' }] });
}

// ------------------------------------------------------------------ help

export async function helpDialog(): Promise<void> {
  const row = (k: string, v: string) => h('tr', null, h('th', null, k), h('td', null, v));
  await openDialog({
    title: 'How to use',
    wide: true,
    body: h(
      'div',
      { class: 'help' },
      h('h3', null, 'Editing the floor plan'),
      h('table', { class: 'help-table' },
        row('Add furniture', 'Tap an item in Add, or drag it onto the plan.'),
        row('Move', 'Drag an item. It snaps to a 6″ grid (Option/Alt-drag for free placement).'),
        row('Rotate', 'Use the rotate buttons, drag the round handle, or press R / Shift+R.'),
        row('Pan & zoom', 'Two fingers (iPad) · scroll or drag empty space (Mac) · pinch or ⌘ scroll to zoom.'),
        row('Precise edits', 'Select an item and type sizes like 60", 5\' 6" or 1.5 m in the details panel.'),
        row('Undo', '⌘Z / Ctrl+Z, or the undo arrows in the toolbar.'),
      ),
      h('h3', null, 'Walkthrough'),
      h('table', { class: 'help-table' },
        row('Mac / PC', 'Click the view to look with the mouse. W A S D or arrows to walk, Shift to hurry. Esc releases the mouse; Esc again returns to the editor.'),
        row('iPad', 'Left thumb anywhere on the left side moves; drag on the right side to look around.'),
        row('Sit down', 'Tap Sit near a chair, or use the eye button next to a seat or guest to see their view.'),
      ),
      h('h3', null, 'Keeping your plan safe'),
      h('p', null, 'Your plan is saved automatically in this browser. Each device has its own copy: use Export → Project backup to move it between Mac and iPad, and Import to load it.'),
      h('p', { class: 'muted small' }, 'Warnings about spacing, aisles and doors are planning aids only. Review the final layout, accessibility and emergency exits with the venue.'),
    ),
  });
}

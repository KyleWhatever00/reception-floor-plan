import './styles/main.css';
import { Store } from './model/store';
import { demoProject } from './model/demo';
import type { Project } from './model/types';
import { SceneManager } from './scene/sceneManager';
import { Editor } from './editor/editor';
import { Walkthrough } from './walkthrough/walkthrough';
import { AutoSaver, loadSavedProject, quarantineCorrupt, type SaveStatus } from './persistence/storage';
import { getAsset } from './persistence/assets';
import { downloadBlob } from './persistence/exports';
import { h, svgIcon } from './ui/dom';
import { ICONS } from './ui/icons';
import { openDialog, toast } from './ui/dialogs';
import { Inspector } from './ui/inspector';
import { buildPalette } from './ui/palette';
import { GuestPanel } from './ui/guests';
import { RoomPanel } from './ui/roomPanel';
import { OverlayLabels } from './ui/overlayLabels';
import type { AppContext } from './ui/context';
import { exportDialog, helpDialog, importFromFile, layoutsDialog, pickProjectFile, replaceProject, settingsDialog } from './ui/projectDialogs';
import { seatStats } from './model/commands';
import { registerServiceWorker } from './pwa';

type LeftTab = 'add' | 'guests' | 'room';

function boot(): void {
  const root = document.getElementById('app')!;

  if (!SceneManager.isWebGLAvailable()) {
    root.replaceChildren(
      h(
        'div',
        { class: 'fatal' },
        h('h1', null, 'This browser can’t show 3D graphics'),
        h('p', null, 'The floor plan needs WebGL. Try the latest Safari or Chrome, make sure hardware acceleration is turned on, or try another device. Your saved plan is untouched.'),
      ),
    );
    return;
  }

  // ---------------------------------------------------------------- load project
  const loaded = loadSavedProject();
  let project: Project;
  let firstRun = false;
  let corrupt: { raw: string; errors: string[] } | null = null;
  let storageProblem: string | null = null;
  if (loaded.status === 'ok') project = loaded.project;
  else {
    project = demoProject();
    if (loaded.status === 'empty') firstRun = true;
    if (loaded.status === 'corrupt') corrupt = { raw: loaded.raw, errors: loaded.errors };
    if (loaded.status === 'unavailable') storageProblem = loaded.error;
  }
  const store = new Store(project);

  // ---------------------------------------------------------------- shell
  const viewport = h('main', { class: 'viewport', id: 'viewport', 'aria-label': 'Floor plan' });
  const leftPanel = h('aside', { class: 'panel panel-left', 'aria-label': 'Add furniture, guests and room' });
  const rightPanel = h('aside', { class: 'panel panel-right', 'aria-label': 'Details' });
  const scrim = h('div', { class: 'scrim', hidden: true });
  const statusBar = h('footer', { class: 'statusbar', role: 'status' });
  const toolbar = h('header', { class: 'toolbar' });
  const workspace = h('div', { class: 'workspace' }, leftPanel, viewport, rightPanel, scrim);
  root.replaceChildren(toolbar, workspace, statusBar);

  let sm: SceneManager;
  try {
    sm = new SceneManager(viewport, store);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'fatal' }, h('h1', null, 'The 3D view could not start'), h('p', null, String((e as Error)?.message ?? e))));
    return;
  }
  sm.resolveAsset = async (id) => {
    const b = await getAsset(id);
    return b ? URL.createObjectURL(b) : null;
  };
  const editor = new Editor(store, sm, viewport);
  const walk = new Walkthrough(store, sm, viewport);
  const saver = new AutoSaver(store);

  const narrowQuery = matchMedia('(max-width: 1023px)');
  const ui = { left: 'add' as LeftTab, leftOpen: !narrowQuery.matches, rightOpen: !narrowQuery.matches };

  const ctx: AppContext = {
    store,
    sm,
    editor,
    walk,
    saver,
    openLeft: (tab) => {
      setLeftTab(tab);
      ui.leftOpen = true;
      if (narrowQuery.matches) ui.rightOpen = false;
      applyPanels();
    },
    openInspector: () => {
      ui.rightOpen = true;
      if (narrowQuery.matches) ui.leftOpen = false;
      applyPanels();
    },
    closeDrawers: () => {
      if (!narrowQuery.matches) return;
      ui.leftOpen = false;
      ui.rightOpen = false;
      applyPanels();
    },
    isNarrow: () => narrowQuery.matches,
  };

  // ---------------------------------------------------------------- left panel
  const guests = new GuestPanel(ctx);
  const room = new RoomPanel(ctx);
  const labels = new OverlayLabels(ctx, viewport);
  labels.onWallItemClick = (id) => room.focusItem(id);
  room.onEditCeilingsChange = (on) => {
    labels.editCeilings = on;
    sm.invalidate();
  };
  room.onEditCornersChange = (on) => {
    labels.editCorners = on;
    sm.invalidate();
  };
  const tabDefs: { id: LeftTab; label: string; icon: string }[] = [
    { id: 'add', label: 'Add', icon: ICONS.sofa },
    { id: 'guests', label: 'Guests', icon: ICONS.people },
    { id: 'room', label: 'Room', icon: ICONS.room },
  ];
  const tabButtons = tabDefs.map((t) =>
    h('button', { role: 'tab', class: 'tab', id: `tab-${t.id}`, 'aria-controls': `pane-${t.id}`, onclick: () => setLeftTab(t.id) }, svgIcon(t.icon), h('span', null, t.label)),
  );
  const panes: Record<LeftTab, HTMLElement> = {
    add: h('div', { role: 'tabpanel', id: 'pane-add', class: 'tab-pane' }, buildPalette(ctx)),
    guests: h('div', { role: 'tabpanel', id: 'pane-guests', class: 'tab-pane' }, guests.el),
    room: h('div', { role: 'tabpanel', id: 'pane-room', class: 'tab-pane' }, room.el),
  };
  leftPanel.append(
    h('div', { class: 'panel-head' }, h('div', { class: 'tabs', role: 'tablist' }, tabButtons), h('button', { class: 'icon-btn panel-close', 'aria-label': 'Close panel', onclick: () => { ui.leftOpen = false; applyPanels(); } }, svgIcon(ICONS.close))),
    h('div', { class: 'panel-scroll' }, Object.values(panes)),
  );
  function setLeftTab(tab: LeftTab): void {
    ui.left = tab;
    tabDefs.forEach((t, i) => {
      tabButtons[i].setAttribute('aria-selected', String(t.id === tab));
      panes[t.id].hidden = t.id !== tab;
    });
    guests.setVisible(tab === 'guests');
    room.setVisible(tab === 'room');
    labels.showWallNumbers = tab === 'room' && ui.leftOpen;
    sm.invalidate();
  }

  // ---------------------------------------------------------------- right panel
  const inspector = new Inspector(ctx);
  rightPanel.append(
    h('div', { class: 'panel-head panel-head-right' }, h('span', { class: 'panel-title' }, 'Details'), h('button', { class: 'icon-btn panel-close', 'aria-label': 'Close details', onclick: () => { ui.rightOpen = false; applyPanels(); } }, svgIcon(ICONS.close))),
    h('div', { class: 'panel-scroll' }, inspector.el),
  );

  function applyPanels(): void {
    const narrow = narrowQuery.matches;
    document.body.classList.toggle('narrow', narrow);
    leftPanel.classList.toggle('open', ui.leftOpen);
    rightPanel.classList.toggle('open', ui.rightOpen);
    workspace.classList.toggle('left-collapsed', !ui.leftOpen);
    workspace.classList.toggle('right-collapsed', !ui.rightOpen);
    scrim.hidden = !(narrow && (ui.leftOpen || ui.rightOpen));
    leftToggle.setAttribute('aria-pressed', String(ui.leftOpen));
    rightToggle.setAttribute('aria-pressed', String(ui.rightOpen));
    labels.showWallNumbers = ui.left === 'room' && ui.leftOpen;
    if (!ui.leftOpen && room.editCorners) room.setEditCorners(false);
    if (!ui.leftOpen && room.editCeilings) room.setEditCeilings(false);
    requestAnimationFrame(() => sm.resize());
  }
  scrim.addEventListener('click', () => ctx.closeDrawers());
  narrowQuery.addEventListener('change', () => {
    ui.leftOpen = !narrowQuery.matches;
    ui.rightOpen = !narrowQuery.matches;
    applyPanels();
  });

  // ---------------------------------------------------------------- toolbar
  const tbButton = (icon: string, label: string, onclick: () => void, extra: Record<string, any> = {}) => {
    const { class: cls, title, ...rest } = extra;
    return h('button', { class: `tb-btn ${cls ?? ''}`, title: title ?? label, 'aria-label': label, onclick, ...rest }, svgIcon(icon), h('span', { class: 'tb-label' }, label));
  };
  const leftToggle = tbButton(ICONS.panelLeft, 'Add & guests', () => {
    ui.leftOpen = !ui.leftOpen;
    if (ui.leftOpen && narrowQuery.matches) ui.rightOpen = false;
    applyPanels();
  }, { class: 'tb-panel' });
  const rightToggle = tbButton(ICONS.panelRight, 'Details', () => {
    ui.rightOpen = !ui.rightOpen;
    if (ui.rightOpen && narrowQuery.matches) ui.leftOpen = false;
    applyPanels();
  }, { class: 'tb-panel' });
  const undoBtn = tbButton(ICONS.undo, 'Undo', () => {
    const l = store.undo();
    if (l) toast(`Undid: ${l}`, { ms: 1600 });
  });
  const redoBtn = tbButton(ICONS.redo, 'Redo', () => {
    const l = store.redo();
    if (l) toast(`Redid: ${l}`, { ms: 1600 });
  });
  const layoutBtn = h('button', { class: 'layout-btn', onclick: () => layoutsDialog(ctx), title: 'Switch, copy or rename layouts' }, h('span', { class: 'layout-name' }), svgIcon(ICONS.chevronDown));
  const viewTop = h('button', { role: 'radio', class: 'seg', onclick: () => setView('top'), title: 'Top-down plan' }, svgIcon(ICONS.top), h('span', { class: 'tb-label' }, 'Plan'));
  const viewOrbit = h('button', { role: 'radio', class: 'seg', onclick: () => setView('orbit'), title: '3D overview — drag to orbit' }, svgIcon(ICONS.orbit), h('span', { class: 'tb-label' }, '3D'));
  const snapBtn = tbButton(ICONS.magnet, 'Snap', () => store.updateSettings({ snapEnabled: !store.settings.snapEnabled }), { title: 'Snap to grid (6″)' });
  const walkBtn = h('button', { class: 'btn btn-primary walk-cta', onclick: () => walk.enter(), title: 'Walk through the room in first person' }, svgIcon(ICONS.walk), h('span', null, 'Walk through'));
  function setView(v: 'top' | 'orbit'): void {
    sm.setView(v);
    viewTop.setAttribute('aria-checked', String(v === 'top'));
    viewOrbit.setAttribute('aria-checked', String(v === 'orbit'));
    viewTop.classList.toggle('active', v === 'top');
    viewOrbit.classList.toggle('active', v === 'orbit');
    sm.invalidate();
  }
  toolbar.append(
    h('div', { class: 'tb-group' },
      h('div', { class: 'brand', title: 'Wedding Floor Plan' }, svgIcon(ICONS.heart, 'icon brand-icon'), h('span', { class: 'brand-text' }, 'Floor Plan')),
      leftToggle,
      layoutBtn,
    ),
    h('div', { class: 'tb-group tb-center' },
      undoBtn,
      redoBtn,
      h('span', { class: 'tb-sep' }),
      h('div', { class: 'seg-group', role: 'radiogroup', 'aria-label': 'View' }, viewTop, viewOrbit),
      tbButton(ICONS.fit, 'Fit', () => (sm.view === 'top' ? sm.fitTopView() : setView('orbit')), { title: 'Fit the room in view (F)' }),
      snapBtn,
    ),
    h('div', { class: 'tb-group tb-right' },
      tbButton(ICONS.upload, 'Import', () => pickProjectFile(ctx), { title: 'Import a project file' }),
      tbButton(ICONS.download, 'Export', () => exportDialog(ctx), { title: 'Export backup, image, print or seating list' }),
      tbButton(ICONS.settings, 'Settings', () => settingsDialog(ctx)),
      tbButton(ICONS.info, 'Help', () => helpDialog()),
      rightToggle,
      walkBtn,
    ),
  );

  // view-corner controls (zoom for touch users)
  const tool = h('div', { class: 'tool-banner', hidden: true, role: 'status' });
  const roomBadge = h('div', { class: 'room-badge' });
  viewport.append(
    roomBadge,
    tool,
    h('div', { class: 'zoom-controls' },
      h('button', { class: 'round-btn', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => sm.zoomTopAt(1.3, sm.viewportSize.w / 2, sm.viewportSize.h / 2) }, svgIcon(ICONS.zoomIn)),
      h('button', { class: 'round-btn', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => sm.zoomTopAt(1 / 1.3, sm.viewportSize.w / 2, sm.viewportSize.h / 2) }, svgIcon(ICONS.zoomOut)),
    ),
  );
  editor.onToolChange = (t) => {
    tool.hidden = t.kind === 'select';
    if (t.kind === 'spawn') tool.replaceChildren(h('span', null, 'Tap where the walkthrough should start.'), h('button', { class: 'btn btn-link', onclick: () => editor.setTool({ kind: 'select' }) }, 'Cancel'));
    if (t.kind === 'calibrate') tool.replaceChildren(h('span', null, t.points.length === 0 ? 'Tap the first point on the image.' : 'Now tap the second point.'), h('button', { class: 'btn btn-link', onclick: () => editor.setTool({ kind: 'select' }) }, 'Cancel'));
    sm.invalidate();
  };

  // ---------------------------------------------------------------- status bar
  const sbStats = h('span', { class: 'sb-item' });
  const sbWarn = h('button', { class: 'sb-item sb-warn', onclick: () => { store.select(null); ctx.openInspector(); } });
  const sbSave = h('span', { class: 'sb-item sb-save' });
  const sbOffline = h('span', { class: 'sb-item sb-offline', hidden: true }, 'Available offline');
  statusBar.append(sbStats, sbWarn, h('span', { class: 'sb-spacer' }), sbOffline, sbSave);

  const refreshChrome = () => {
    const st = seatStats(store.layout);
    sbStats.replaceChildren(
      h('span', null, h('strong', null, String(st.guests)), ' guests'),
      h('span', null, h('strong', null, String(st.seats)), ' seats'),
      h('span', null, h('strong', null, String(st.assigned)), ' seated'),
      h('span', { class: st.unassigned ? 'attn' : '' }, h('strong', null, String(st.unassigned)), ' unseated'),
    );
    const ws = sm.analysis.warnings;
    const hard = ws.filter((w) => w.severity === 'warning').length;
    sbWarn.hidden = ws.length === 0;
    sbWarn.replaceChildren(svgIcon(hard ? ICONS.warn : ICONS.info), h('span', null, hard ? `${hard} to check` : '', hard && ws.length - hard ? ' · ' : '', ws.length - hard ? `${ws.length - hard} advice` : ''));
    sbWarn.classList.toggle('has-hard', hard > 0);
    (layoutBtn.firstChild as HTMLElement).textContent = store.layout.name;
    undoBtn.toggleAttribute('disabled', !store.canUndo);
    redoBtn.toggleAttribute('disabled', !store.canRedo);
    undoBtn.title = store.canUndo ? `Undo ${store.undoLabel}` : 'Nothing to undo';
    redoBtn.title = store.canRedo ? `Redo ${store.redoLabel}` : 'Nothing to redo';
    snapBtn.setAttribute('aria-pressed', String(store.settings.snapEnabled));
    snapBtn.classList.toggle('on', store.settings.snapEnabled);
    const status = store.layout.room.dimensionStatus;
    roomBadge.className = `room-badge status-${status}`;
    roomBadge.textContent = status === 'demo' ? 'Demo room · not actual venue dimensions' : status === 'estimated' ? 'Estimated dimensions' : 'Measured dimensions';
  };
  store.subscribe((e) => {
    if (e.transient && e.kind === 'layout') return;
    refreshChrome();
    if (e.kind === 'selection' && store.selection.furnitureId && !narrowQuery.matches) {
      ui.rightOpen = true;
      applyPanels();
    }
    if (e.kind === 'mode') document.body.classList.toggle('walking', store.mode === 'walk');
  });
  const renderSave = (s: SaveStatus) => {
    sbSave.className = `sb-item sb-save save-${s.state}`;
    const text =
      s.state === 'saved' ? `Saved on this device${s.at ? ' · ' + s.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}` : s.state === 'saving' ? 'Saving…' : s.state === 'paused' ? s.message ?? 'Not saving' : s.message ?? 'Not saved';
    sbSave.replaceChildren(svgIcon(s.state === 'error' || s.state === 'paused' ? ICONS.warn : ICONS.check), h('span', null, text));
  };
  saver.onStatus(renderSave);

  walk.onExit = () => {
    sm.invalidate();
  };

  // drag & drop a project file anywhere (desktop)
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f && /\.json$/i.test(f.name)) {
      e.preventDefault();
      void importFromFile(ctx, f);
    }
  });
  // stop Safari's page pinch-zoom inside the editor
  document.addEventListener('gesturestart', (e) => {
    if ((e.target as HTMLElement)?.closest?.('.viewport')) e.preventDefault();
  });

  sm.onContextLost = () => toast('The graphics system was interrupted. Trying to recover… your plan is safe.', { kind: 'error', ms: 8000 });
  sm.onContextRestored = () => toast('3D view restored.');

  setLeftTab('add');
  setView('top');
  applyPanels();
  refreshChrome();
  sm.start();
  requestAnimationFrame(() => sm.fitTopView());

  // ---------------------------------------------------------------- startup notices
  if (corrupt) {
    const key = quarantineCorrupt(corrupt.raw);
    saver.pause('Not saving — saved data needs attention');
    void openDialog({
      title: 'Your saved plan couldn’t be opened',
      dismissable: false,
      body: h(
        'div',
        null,
        h('p', null, 'The plan saved in this browser appears damaged, so it has not been loaded and nothing has been overwritten. You are looking at the demo layout for now.'),
        h('ul', { class: 'error-list' }, corrupt.errors.slice(0, 6).map((e) => h('li', null, e))),
        key ? h('p', { class: 'muted small' }, 'A copy of the damaged data was kept in this browser.') : null,
      ),
      actions: [
        { label: 'Download damaged data', kind: 'ghost', onClick: () => { downloadBlob(new Blob([corrupt!.raw], { type: 'application/json' }), 'floor-plan-unreadable-data.json'); return false; } },
        { label: 'Import a backup…', kind: 'ghost', onClick: () => { saver.resume(); pickProjectFile(ctx); } },
        { label: 'Start fresh with the demo', kind: 'primary', onClick: () => { replaceProject(ctx, demoProject()); saver.resume(); } },
      ],
    });
  } else if (storageProblem) {
    toast('This browser isn’t allowing saving. Export a project backup to keep your work.', { kind: 'error', ms: 10000 });
  } else if (firstRun) {
    saver.schedule();
    void openDialog({
      title: 'Welcome',
      body: h(
        'div',
        { class: 'welcome' },
        h('p', null, 'Design your reception layout from above, then walk through it in 3D.'),
        h('ul', null,
          h('li', null, h('strong', null, 'This is a demo room.'), ' Its size and shape are placeholders — not Vintage Villas — until real measurements are entered on the Room tab.'),
          h('li', null, h('strong', null, 'Your plan saves automatically'), ' in this browser only. Each device has its own copy; use Export → Project backup to move it between Mac and iPad.'),
          h('li', null, 'Drag tables to move them, tap one to edit or seat guests, and press ', h('strong', null, 'Walk through'), ' to explore.'),
        ),
      ),
      actions: [{ label: 'Start planning', kind: 'primary' }],
    });
  }
  registerServiceWorker((state) => {
    if (state === 'offline-ready') sbOffline.hidden = false;
    if (state === 'update')
      toast('A new version of the app is ready. Your plan is kept.', {
        ms: 15000,
        action: {
          label: 'Reload',
          onClick: () => {
            saver.flush();
            const activate = (window as any).__wfpActivateUpdate as (() => void) | undefined;
            if (activate) activate();
            else location.reload();
          },
        },
      });
  });

  // expose for debugging in the browser console
  (window as any).__wfp = { store, sm, editor, walk };
}

boot();

import type { AppContext } from './context';
import { h } from './dom';
import { PALETTE, type PaletteCategory } from '../model/catalog';
import { PALETTE_ICONS } from './icons';

const ORDER: PaletteCategory[] = ['Guest tables', 'Couple & cake', 'Entertainment', 'Service', 'Decor'];

/**
 * Furniture palette. Tap/click adds the item in a free spot near the middle of the view;
 * press-and-drag onto the plan drops it exactly where you let go (mouse, pen or finger).
 */
export function buildPalette(ctx: AppContext): HTMLElement {
  const groups = ORDER.map((cat) =>
    h(
      'section',
      { class: 'palette-group' },
      h('h3', { class: 'section-title' }, cat),
      h(
        'div',
        { class: 'palette-grid' },
        PALETTE.filter((p) => p.category === cat).map((item) => {
          const btn = h(
            'button',
            { class: 'palette-item', type: 'button', title: `Add ${item.name} — tap to add, or drag onto the plan`, 'data-key': item.key },
            h('span', { class: 'palette-art', html: PALETTE_ICONS[item.icon] }),
            h('span', { class: 'palette-name' }, item.name),
            h('span', { class: 'palette-detail' }, item.detail),
          );
          attachDrag(ctx, btn, item.key, item.icon);
          return btn;
        }),
      ),
    ),
  );
  return h(
    'div',
    { class: 'palette' },
    h('p', { class: 'muted small palette-tip' }, 'Tap to add near the centre of the view, or drag onto the floor plan. Sizes are editable demo sizes — swap in your rental measurements.'),
    groups,
  );
}

function attachDrag(ctx: AppContext, btn: HTMLButtonElement, key: string, icon: string): void {
  let start: { x: number; y: number; id: number } | null = null;
  let ghost: HTMLElement | null = null;
  let dragging = false;
  let justDragged = false;

  const viewportRect = () => ctx.sm.renderer.domElement.getBoundingClientRect();
  const overViewport = (x: number, y: number) => {
    const r = viewportRect();
    const el = document.elementFromPoint(x, y);
    const onCanvasArea = !!el && (el === ctx.sm.renderer.domElement || !!el.closest('.viewport'));
    return onCanvasArea && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || ctx.store.mode !== 'build') return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
  });
  btn.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    // on touch, vertical movement scrolls the palette; horizontal drags pick the item up
    const threshold = e.pointerType === 'touch' ? 14 : 6;
    if (!dragging) {
      if (Math.hypot(dx, dy) < threshold) return;
      if (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx) * 1.2) {
        start = null;
        return;
      }
      dragging = true;
      btn.setPointerCapture(e.pointerId);
      ghost = h('div', { class: 'drag-ghost', html: PALETTE_ICONS[icon] });
      document.body.appendChild(ghost);
      document.body.classList.add('palette-dragging');
      if (ctx.isNarrow()) ctx.closeDrawers();
    }
    if (ghost) {
      ghost.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 28}px)`;
      ghost.classList.toggle('over', overViewport(e.clientX, e.clientY));
    }
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!start || e.pointerId !== start.id) return;
    const wasDragging = dragging;
    start = null;
    dragging = false;
    ghost?.remove();
    ghost = null;
    document.body.classList.remove('palette-dragging');
    if (cancelled) return;
    if (wasDragging) {
      justDragged = true;
      setTimeout(() => (justDragged = false), 400);
      if (overViewport(e.clientX, e.clientY)) {
        const r = viewportRect();
        const p = ctx.sm.screenToFloor(e.clientX - r.left, e.clientY - r.top);
        if (p) ctx.editor.addFromPalette(key, p);
      }
    }
  };
  btn.addEventListener('pointerup', (e) => end(e, false));
  btn.addEventListener('pointercancel', (e) => end(e, true));
  btn.addEventListener('click', (e) => {
    // a click that wasn't a drag adds the item near the centre of the view
    e.preventDefault();
    if (justDragged) {
      justDragged = false;
      return;
    }
    if (ctx.store.mode !== 'build') return;
    ctx.editor.addFromPalette(key);
    if (ctx.isNarrow()) ctx.closeDrawers();
  });
}

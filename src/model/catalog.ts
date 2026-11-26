import type { Furniture, FurnitureType, SeatingConfig, Vec2 } from './types';
import { ft, inch } from './units';
import { newId } from './ids';
import { makeSeats } from './seats';

/**
 * Plausible, editable demo dimensions only. Real rental inventory measurements take precedence
 * and can be typed into the inspector.
 */

export const LINEN_COLORS: { name: string; value: string }[] = [
  { name: 'White', value: '#f8f6f2' },
  { name: 'Ivory', value: '#f2eadb' },
  { name: 'Blush', value: '#ecc8c4' },
  { name: 'Dusty rose', value: '#d4a3a1' },
  { name: 'Champagne', value: '#e6d5b8' },
  { name: 'Black', value: '#232020' },
];

export const DEFAULT_SEATING: SeatingConfig = {
  chairWidth: inch(16.5),
  chairDepth: inch(17),
  chairHeight: inch(36),
  chairOffset: inch(11),
  chairFinish: 'gold',
};

export const TYPE_NAMES: Record<FurnitureType, string> = {
  roundTable: 'Round guest table',
  rectTable: 'Rectangular guest table',
  sweetheart: 'Sweetheart table',
  cake: 'Cake table',
  danceFloor: 'Dance floor',
  dj: 'DJ booth',
  bar: 'Bar',
  buffet: 'Buffet / dessert table',
  gift: 'Gift table',
  welcome: 'Welcome table',
  decoration: 'Decoration',
};

/** Items that block walking in the walkthrough. */
export function isSolid(f: Furniture): boolean {
  return f.type !== 'danceFloor';
}

/** Items that count as guest tables (numbered, hold guests). */
export function isGuestTable(f: Furniture): boolean {
  return f.type === 'roundTable' || f.type === 'rectTable';
}

export type PaletteCategory = 'Guest tables' | 'Couple & cake' | 'Entertainment' | 'Service' | 'Decor';

export interface PaletteItem {
  key: string;
  name: string;
  detail: string;
  category: PaletteCategory;
  icon: 'round' | 'rect' | 'sweetheart' | 'cake' | 'dance' | 'dj' | 'bar' | 'buffet' | 'gift' | 'welcome' | 'floral' | 'sign';
  create: (position: Vec2) => Furniture;
}

function base(type: FurnitureType, label: string, position: Vec2, w: number, d: number, h: number): Furniture {
  return { id: newId('f'), type, label, position: { ...position }, rotation: 0, width: w, depth: d, height: h };
}

export const PALETTE: PaletteItem[] = [
  {
    key: 'round60',
    name: '60″ round',
    detail: 'Seats 8 · 5 ft',
    category: 'Guest tables',
    icon: 'round',
    create: (p) => ({
      ...base('roundTable', 'Table', p, inch(60), inch(60), inch(30)),
      seats: makeSeats(8),
      appearance: { linenColor: LINEN_COLORS[0].value, centerpiece: 'low-floral', placeSettings: true },
    }),
  },
  {
    key: 'round72',
    name: '72″ round',
    detail: 'Seats 10 · 6 ft',
    category: 'Guest tables',
    icon: 'round',
    create: (p) => ({
      ...base('roundTable', 'Table', p, inch(72), inch(72), inch(30)),
      seats: makeSeats(10),
      appearance: { linenColor: LINEN_COLORS[0].value, centerpiece: 'tall-floral', placeSettings: true },
    }),
  },
  {
    key: 'rect6',
    name: '6 ft banquet',
    detail: 'Seats 6 · 72″ × 30″',
    category: 'Guest tables',
    icon: 'rect',
    create: (p) => ({
      ...base('rectTable', 'Table', p, ft(6), inch(30), inch(30)),
      sideCounts: [3, 0, 3, 0],
      seats: makeSeats(6),
      appearance: { linenColor: LINEN_COLORS[0].value, centerpiece: 'candles', placeSettings: true },
    }),
  },
  {
    key: 'rect8',
    name: '8 ft banquet',
    detail: 'Seats 8–10 · 96″ × 30″',
    category: 'Guest tables',
    icon: 'rect',
    create: (p) => ({
      ...base('rectTable', 'Table', p, ft(8), inch(30), inch(30)),
      sideCounts: [4, 0, 4, 0],
      seats: makeSeats(8),
      appearance: { linenColor: LINEN_COLORS[0].value, centerpiece: 'low-floral', placeSettings: true },
    }),
  },
  {
    key: 'sweetheart',
    name: 'Sweetheart table',
    detail: 'Two seats · 48″ × 30″',
    category: 'Couple & cake',
    icon: 'sweetheart',
    create: (p) => ({
      ...base('sweetheart', 'Sweetheart table', p, inch(48), inch(30), inch(30)),
      sideCounts: [0, 0, 2, 0],
      seats: makeSeats(2),
      appearance: { linenColor: LINEN_COLORS[2].value, centerpiece: 'low-floral', placeSettings: true },
    }),
  },
  {
    key: 'cakeRound',
    name: 'Cake table',
    detail: 'Round · 36″',
    category: 'Couple & cake',
    icon: 'cake',
    create: (p) => ({
      ...base('cake', 'Cake table', p, inch(36), inch(36), inch(30)),
      variant: 'round',
      appearance: { linenColor: LINEN_COLORS[0].value },
    }),
  },
  {
    key: 'danceFloor',
    name: 'Dance floor',
    detail: '18 ft × 18 ft · walkable',
    category: 'Entertainment',
    icon: 'dance',
    create: (p) => ({
      ...base('danceFloor', 'Dance floor', p, ft(18), ft(18), inch(1)),
      appearance: { floor: 'checker' },
    }),
  },
  {
    key: 'dj',
    name: 'DJ booth',
    detail: '6 ft × 30″ · speakers',
    category: 'Entertainment',
    icon: 'dj',
    create: (p) => ({ ...base('dj', 'DJ booth', p, ft(6), inch(30), inch(42)), appearance: { speakers: true } }),
  },
  {
    key: 'bar',
    name: 'Bar',
    detail: '8 ft × 30″ · 42″ high',
    category: 'Service',
    icon: 'bar',
    create: (p) => ({ ...base('bar', 'Bar', p, ft(8), inch(30), inch(42)) }),
  },
  {
    key: 'buffet',
    name: 'Buffet table',
    detail: '8 ft × 30″',
    category: 'Service',
    icon: 'buffet',
    create: (p) => ({ ...base('buffet', 'Buffet', p, ft(8), inch(30), inch(30)), appearance: { linenColor: LINEN_COLORS[1].value } }),
  },
  {
    key: 'dessert',
    name: 'Dessert table',
    detail: '6 ft × 30″',
    category: 'Service',
    icon: 'buffet',
    create: (p) => ({ ...base('buffet', 'Dessert table', p, ft(6), inch(30), inch(30)), appearance: { linenColor: LINEN_COLORS[2].value } }),
  },
  {
    key: 'gift',
    name: 'Gift table',
    detail: '6 ft × 30″',
    category: 'Service',
    icon: 'gift',
    create: (p) => ({ ...base('gift', 'Gift table', p, ft(6), inch(30), inch(30)), appearance: { linenColor: LINEN_COLORS[0].value } }),
  },
  {
    key: 'welcome',
    name: 'Welcome table',
    detail: '4 ft × 24″',
    category: 'Service',
    icon: 'welcome',
    create: (p) => ({ ...base('welcome', 'Welcome table', p, ft(4), inch(24), inch(30)), appearance: { linenColor: LINEN_COLORS[0].value } }),
  },
  {
    key: 'floral',
    name: 'Floral arrangement',
    detail: 'Freestanding · 2 ft',
    category: 'Decor',
    icon: 'floral',
    create: (p) => ({ ...base('decoration', 'Florals', p, ft(2), ft(2), ft(5)), variant: 'floral' }),
  },
  {
    key: 'sign',
    name: 'Sign on easel',
    detail: 'Welcome / seating chart',
    category: 'Decor',
    icon: 'sign',
    create: (p) => ({ ...base('decoration', 'Welcome sign', p, inch(26), inch(20), inch(66)), variant: 'sign' }),
  },
];

export function paletteItem(key: string): PaletteItem | undefined {
  return PALETTE.find((p) => p.key === key);
}

/** Numeric bounds used by the inspector and by import validation. */
export const BOUNDS = {
  minDim: inch(2),
  maxDim: ft(120),
  maxHeight: ft(20),
  maxCoord: 1000,
  maxSeats: 24,
};

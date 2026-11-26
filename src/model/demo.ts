import type { Furniture, Guest, Layout, Project, Room, Settings, Vec2 } from './types';
import { SCHEMA_VERSION } from './types';
import { DEFAULT_SEATING, paletteItem } from './catalog';
import { deg, ft, inch } from './units';
import { newId } from './ids';

/**
 * DEMO ROOM — invented placeholder geometry, NOT the Vintage Villas reception hall.
 * An L-shaped (concave) 84′ × 52′ hall used only until real measurements are supplied.
 */

const OX = 42; // shift so the room is roughly centred on the origin
const OZ = 26;
const P = (xFt: number, zFt: number): Vec2 => ({ x: ft(xFt - OX), z: ft(zFt - OZ) });

export function demoRoom(): Room {
  return {
    name: 'Demo reception hall (placeholder)',
    vertices: [P(0, 0), P(84, 0), P(84, 34), P(64, 34), P(64, 52), P(0, 52)],
    wallHeight: ft(14),
    wallThickness: inch(8),
    openings: [
      // wall 4: bottom wall, running from (64,52) toward (0,52)
      { id: newId('open'), wallIndex: 4, offset: ft(26), width: ft(6), height: ft(8), sillHeight: 0, kind: 'door' },
      // wall 1: right wall — patio doors
      { id: newId('open'), wallIndex: 1, offset: ft(12), width: ft(6), height: ft(8), sillHeight: 0, kind: 'door' },
      // wall 3: notch wall — service door
      { id: newId('open'), wallIndex: 3, offset: ft(7), width: ft(3.5), height: ft(7), sillHeight: 0, kind: 'door' },
      // windows on the long top wall and left wall
      ...[8, 24, 56, 72].map((o) => ({ id: newId('open'), wallIndex: 0, offset: ft(o), width: ft(4), height: ft(6), sillHeight: ft(3), kind: 'window' as const })),
      ...[12, 30].map((o) => ({ id: newId('open'), wallIndex: 5, offset: ft(o), width: ft(4), height: ft(6), sillHeight: ft(3), kind: 'window' as const })),
    ],
    columns: [
      { id: newId('col'), position: P(28, 12), width: ft(1.5), depth: ft(1.5) },
      { id: newId('col'), position: P(56, 12), width: ft(1.5), depth: ft(1.5) },
    ],
    spawn: P(35, 48),
    spawnYaw: 0,
    dimensionStatus: 'demo',
  };
}

const SAMPLE_FIRST = [
  'Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Rowan', 'Harper', 'Emerson', 'Sage',
  'Reese', 'Parker', 'Hayden', 'Finley', 'Blair', 'Drew', 'Ellis', 'Jules', 'Kai', 'Lane',
  'Marlowe', 'Noel', 'Oakley', 'Peyton', 'Remy', 'Shiloh', 'Tatum', 'Wren', 'Arden', 'Briar',
];

function sampleGuests(n: number): Guest[] {
  return Array.from({ length: n }, (_, i) => ({ id: newId('g'), name: `${SAMPLE_FIRST[i % SAMPLE_FIRST.length]} Sample${i >= SAMPLE_FIRST.length ? ' ' + (Math.floor(i / SAMPLE_FIRST.length) + 1) : ''}` }));
}

function place(key: string, xFt: number, zFt: number, rotDeg = 0, patch: Partial<Furniture> = {}): Furniture {
  const item = paletteItem(key)!;
  const f = item.create(P(xFt, zFt));
  f.rotation = deg(rotDeg);
  return { ...f, ...patch };
}

export function demoLayout(name = 'Demo layout'): Layout {
  const furniture: Furniture[] = [];
  furniture.push(place('danceFloor', 42, 21));
  furniture.push(place('dj', 42, 4));
  furniture.push(place('sweetheart', 42, 34.5));
  furniture.push(place('floral', 37, 35.5));
  furniture.push(place('floral', 47, 35.5));
  furniture.push(place('cakeRound', 22, 5));
  // guest tables
  const spots: [number, number][] = [
    [8, 14], [8, 27], [8, 40],
    [20.5, 17], [20.5, 30], [20.5, 43],
    [63, 8], [63, 20], [75, 8], [75, 20],
    [44.8, 44.5], [56.3, 44.5],
  ];
  spots.forEach(([x, z], i) => furniture.push(place('round60', x, z, 0, { label: `Table ${i + 1}`, number: i + 1 })));
  furniture.push(place('bar', 74, 29.6, 180)); // bartender works between the bar and the wall
  furniture.push(place('buffet', 53, 2.2));
  furniture.push(place('welcome', 28, 49.6));
  furniture.push(place('gift', 8, 49.8));
  furniture.push(place('sign', 31, 45.5, 0, { label: 'Welcome sign' }));

  const guests = sampleGuests(48);
  // assign the first 40 sample guests to tables 1–5 so the seating features have something to show
  let g = 0;
  for (const f of furniture) {
    if (f.type !== 'roundTable' || !f.seats) continue;
    if ((f.number ?? 0) > 5) break;
    for (const s of f.seats) {
      if (g < 40) s.guestId = guests[g++].id;
    }
  }
  return {
    id: newId('layout'),
    name,
    room: demoRoom(),
    furniture,
    guests,
    seating: { ...DEFAULT_SEATING },
  };
}

/** A blank layout that keeps the room of an existing layout. */
export function blankLayout(name: string, room: Room): Layout {
  return {
    id: newId('layout'),
    name,
    room: JSON.parse(JSON.stringify(room)),
    furniture: [],
    guests: [],
    seating: { ...DEFAULT_SEATING },
  };
}

export const DEFAULT_SETTINGS: Settings = {
  snapInches: 6,
  snapEnabled: true,
  rotationSnapDeg: 15,
  showGrid: true,
  showLabels: true,
  showNames: false,
  showClearance: false,
  showDimensions: true,
  aisleWidth: inch(36),
  perimeterPerGuest: inch(22),
  eyeHeight: 1.65,
  seatedEyeHeight: 1.2,
  walkSpeed: 1.6,
  quality: 'medium',
  lighting: 'evening',
};

export function demoProject(): Project {
  const layout = demoLayout();
  return { schemaVersion: SCHEMA_VERSION, activeLayoutId: layout.id, layouts: [layout], settings: { ...DEFAULT_SETTINGS } };
}

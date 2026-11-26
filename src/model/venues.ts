import type { Fixture, Layout, Opening, Pilaster, Room, Vec2 } from './types';
import { ft, inch, deg } from './units';
import { DEFAULT_SEATING, paletteItem } from './catalog';
import { newId } from './ids';

/**
 * VINTAGE VILLAS EVENT CENTER — ESTIMATE FROM PHOTOS (not measured).
 *
 * How this was derived:
 *  - Overall size from the venue's published figure of ~4,800 sq ft for the Event Center,
 *    modelled as a 96′ × 50′ rectangle.
 *  - Layout read from the couple's photos: a vaulted great room (exposed cedar trusses, plank
 *    ceiling, iron ring chandeliers, spiral ducts) with a lower flat-ceiling wing along one long
 *    side (crystal drum chandeliers, recessed lights), separated by a row of square white pillars.
 *  - End wall A ("entrance end"): main dark-framed glass double doors with an EXIT sign in the
 *    flat wing; stone pilasters framing tall windows in the vaulted part.
 *  - Long wall B ("French-door side"): three pairs of glass French doors, windows, wall sconces,
 *    and a service door near the far end.
 *  - End wall C ("lake end"): four tall picture windows with curtains; a service door in the wing.
 *  - Long wall D ("patio side"): large picture windows looking onto the oak-shaded patio and the lake.
 * Every number here is an estimate. Replace them with tape measurements or the venue's floor plan.
 */

const LEN = 96; // ft, along X
const WID = 50; // ft, along Z
const WING = 16; // flat-ceiling wing depth (ft)
const OX = LEN / 2;
const OZ = WID / 2;
const P = (xFt: number, zFt: number): Vec2 => ({ x: ft(xFt - OX), z: ft(zFt - OZ) });

function op(wallIndex: number, offsetFt: number, widthFt: number, heightFt: number, sillFt: number, kind: Opening['kind'], style: Opening['style']): Opening {
  return { id: newId('open'), wallIndex, offset: ft(offsetFt), width: ft(widthFt), height: ft(heightFt), sillHeight: ft(sillFt), kind, style };
}

export function vintageVillasRoomEstimate(): Room {
  // walls: 0 = French-door side (top of plan), 1 = lake end (right), 2 = patio side (bottom), 3 = entrance end (left)
  const vertices = [P(0, 0), P(LEN, 0), P(LEN, WID), P(0, WID)];
  const openings: Opening[] = [];
  // wall 0: French doors ×3, windows between, service door near the lake end
  for (const o of [17, 39, 61]) openings.push(op(0, o, 6, 8, 0, 'door', { leaves: 'french', frame: 'white', exitSign: o === 39 }));
  for (const o of [7, 28, 50, 72]) openings.push(op(0, o, 5, 6.5, 3, 'window', { panes: 2, frame: 'white' }));
  openings.push(op(0, 86, 3.5, 7.5, 0, 'door', { leaves: 'single', frame: 'white' }));
  // wall 1 (lake end, runs z 0→50): four tall windows in the vaulted part, service door in the wing
  for (const o of [5, 11, 17, 23]) openings.push(op(1, o, 5.6, 9.5, 2.5, 'window', { panes: 1, frame: 'white', curtains: o === 5 || o === 23 }));
  openings.push(op(1, 41, 3.5, 7.5, 0, 'door', { leaves: 'single', frame: 'wood' }));
  // wall 2 (patio side, runs x 96→0): big picture windows
  for (const o of [5, 17, 29, 41, 53, 65, 77]) openings.push(op(2, o, 7, 7.5, 1.75, 'window', { panes: 1, frame: 'white' }));
  // wall 3 (entrance end, runs z 50→0): main double doors in the wing, tall windows between stone pilasters
  openings.push(op(3, 5, 6, 8.5, 0, 'door', { leaves: 'double', frame: 'bronze', exitSign: true }));
  for (const o of [21.5, 30.5, 39.5]) openings.push(op(3, o, 5, 11, 1.5, 'window', { panes: 2, frame: 'white', transom: 0.62 }));
  const pilasters: Pilaster[] = [17.5, 27, 36, 45].map((o) => ({ id: newId('pil'), wallIndex: 3, offset: ft(o), width: ft(3), depth: ft(1), material: 'stone' as const }));

  const columns = [16, 32, 48, 64, 80].map((x) => ({ id: newId('col'), position: P(x, WID - WING), width: ft(1.25), depth: ft(1.25) }));

  const vaultDepth = WID - WING;
  const fixtures: Fixture[] = [
    ...[24, 48, 72].map((x) => ({ id: newId('fx'), kind: 'iron-chandelier' as const, position: P(x, vaultDepth / 2), height: ft(12), size: ft(5) })),
    ...[12, 36, 60, 84].map((x) => ({ id: newId('fx'), kind: 'crystal-chandelier' as const, position: P(x, WID - WING / 2), height: ft(9.6), size: ft(3) })),
    { id: newId('fx'), kind: 'duct', position: P(2, vaultDepth / 2 - 5), end: P(94, vaultDepth / 2 - 5), height: ft(19), size: ft(1.5) },
    { id: newId('fx'), kind: 'duct', position: P(2, vaultDepth / 2 + 5), end: P(94, vaultDepth / 2 + 5), height: ft(19), size: ft(1.5) },
    // sconces on the French-door wall between openings, and on the lake end of the wing
    ...[14.5, 35.5, 57.5, 79].map((x) => ({ id: newId('fx'), kind: 'sconce' as const, position: P(x, 0), height: ft(8), size: ft(1) })),
    ...[37, 47].map((z) => ({ id: newId('fx'), kind: 'sconce' as const, position: P(LEN, z), height: ft(7.5), size: ft(1) })),
  ];

  return {
    name: 'Vintage Villas Event Center (estimated from photos)',
    vertices,
    wallHeight: ft(14),
    wallThickness: inch(8),
    openings,
    columns,
    spawn: P(2.5, 42),
    spawnYaw: deg(-90), // facing into the room along the wing
    dimensionStatus: 'estimated',
    features: {
      ceilings: [
        { id: newId('ceil'), kind: 'vaulted', center: P(LEN / 2, vaultDepth / 2), width: ft(LEN), depth: ft(vaultDepth), rotation: 0, height: ft(14), peakHeight: ft(23), trussSpacing: ft(12) },
        { id: newId('ceil'), kind: 'flat', center: P(LEN / 2, WID - WING / 2), width: ft(LEN), depth: ft(WING), rotation: 0, height: ft(11) },
      ],
      fixtures,
      pilasters,
      finish: { floor: 'dark-walnut', wallColor: '#ece1cf', exterior: 'lake-hill-country' },
    },
    notes:
      'Estimated from photos and the venue’s published ~4,800 sq ft. Not measured. Ask the venue for their floor plan or measure: overall length & width, the wing depth (pillar line to patio wall), pillar spacing, and each door/window position.',
  };
}

/** A starter layout in the estimated Event Center. Tables are a starting point only. */
export function vintageVillasStarterLayout(): Layout {
  const room = vintageVillasRoomEstimate();
  const place = (key: string, xFt: number, zFt: number, rotDeg = 0, label?: string, num?: number) => {
    const f = paletteItem(key)!.create(P(xFt, zFt));
    f.rotation = deg(rotDeg);
    if (label) f.label = label;
    if (num !== undefined) f.number = num;
    return f;
  };
  const furniture = [
    place('danceFloor', 60, 17),
    place('dj', 60, 4.6, 0),
    place('sweetheart', 47, 17, -90),
    place('cakeRound', 44, 7),
  ];
  let n = 1;
  for (const x of [8, 21, 34]) for (const z of [8, 21]) furniture.push(place('round72', x, z, 0, `Table ${n}`, n++));
  for (const x of [77.5, 90.5]) for (const z of [12, 25.5]) furniture.push(place('round72', x, z, 0, `Table ${n}`, n++));
  for (const x of [9, 25, 41, 57, 73, 87.5]) furniture.push(place('round72', x, WID - WING / 2 - 0.5, 0, `Table ${n}`, n++));
  return {
    id: newId('layout'),
    name: 'Event Center — starter (estimated room)',
    room,
    furniture,
    guests: [],
    seating: { ...DEFAULT_SEATING, chairFinish: 'white' },
  };
}

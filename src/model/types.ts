/**
 * Canonical data model. All lengths are meters, angles are radians.
 * Coordinate convention: X/Z horizontal floor plane, Y up.
 * `rotation` matches Three.js `object.rotation.y`.
 *
 * Deviations from the illustrative contract in the spec (documented in README):
 *  - Furniture has optional `variant`, `number` and `notes` fields.
 *  - Layout has a `seating` config block (chair dimensions, offset, finish).
 *  - Room has `name`, `wallThickness`, `spawnYaw` and an optional reference `overlay`.
 *  - Project has a `settings` block for display / snapping / quality preferences.
 */

export type Vec2 = { x: number; z: number };

export type FurnitureType =
  | 'roundTable'
  | 'rectTable'
  | 'sweetheart'
  | 'cake'
  | 'danceFloor'
  | 'dj'
  | 'bar'
  | 'buffet'
  | 'gift'
  | 'welcome'
  | 'decoration';

export interface Guest {
  id: string;
  name: string;
}

export interface Seat {
  id: string;
  guestId?: string;
}

export type FrameColor = 'white' | 'black' | 'bronze' | 'wood';

export interface OpeningStyle {
  /** Frame / mullion colour. Defaults: windows white, doors bronze. */
  frame?: FrameColor;
  /** Doors: 'double' (two glass leaves), 'french' (glass leaves with grid), 'single' (solid leaf). */
  leaves?: 'single' | 'double' | 'french';
  /** Green EXIT sign above the opening. */
  exitSign?: boolean;
  /** Windows: number of vertical panes (1 = single pane). */
  panes?: number;
  /** Windows: horizontal transom bar at this fraction of the height (0 = none). */
  transom?: number;
  /** Floor-length curtains beside the window. */
  curtains?: boolean;
}

export interface Opening {
  id: string;
  wallIndex: number;
  /** Distance along the wall from its start vertex to the opening's near edge. */
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  kind: 'door' | 'window';
  style?: OpeningStyle;
}

export interface Column {
  id: string;
  position: Vec2;
  width: number;
  depth: number;
}

export type DimensionStatus = 'demo' | 'estimated' | 'measured';

/** A rectangular ceiling area. Vaulted zones slope up from `height` at the long edges to `peakHeight` along a ridge on the zone's local X axis. */
export interface CeilingZone {
  id: string;
  kind: 'flat' | 'vaulted';
  center: Vec2;
  width: number;
  depth: number;
  rotation: number;
  height: number;
  peakHeight?: number;
  /** Vaulted: spacing of exposed wood trusses (0 = none). */
  trussSpacing?: number;
}

export type FixtureKind = 'iron-chandelier' | 'crystal-chandelier' | 'sconce' | 'duct';

export interface Fixture {
  id: string;
  kind: FixtureKind;
  position: Vec2;
  /** Height of the fixture's bottom (chandeliers), centre (sconces, ducts). */
  height: number;
  /** Diameter (chandeliers, ducts). */
  size: number;
  /** Ducts: end point. */
  end?: Vec2;
}

/** Decorative wall-mounted pier (e.g. limestone pilaster) on a wall's inside face. */
export interface Pilaster {
  id: string;
  wallIndex: number;
  offset: number;
  width: number;
  /** How far it projects into the room. */
  depth: number;
  material: 'stone' | 'plaster';
}

export type FloorFinish = 'honey-oak' | 'dark-walnut' | 'light-oak';
export type ExteriorView = 'lawn' | 'lake-hill-country';

export interface RoomFinish {
  floor?: FloorFinish;
  wallColor?: string;
  exterior?: ExteriorView;
}

export interface RoomFeatures {
  ceilings?: CeilingZone[];
  fixtures?: Fixture[];
  pilasters?: Pilaster[];
  finish?: RoomFinish;
}

export interface ReferenceOverlay {
  assetId: string;
  /** Width of the image in meters once placed on the floor. */
  width: number;
  /** Image aspect (height / width) so we can size the plane before the image loads. */
  aspect: number;
  center: Vec2;
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface Room {
  name: string;
  vertices: Vec2[];
  wallHeight: number;
  wallThickness: number;
  openings: Opening[];
  columns: Column[];
  spawn: Vec2;
  /** Direction the walker faces on entering (Three.js rotation.y of the camera). */
  spawnYaw: number;
  dimensionStatus: DimensionStatus;
  overlay?: ReferenceOverlay;
  /** Optional architectural detail (ceilings, lights, pilasters, finishes). */
  features?: RoomFeatures;
  /** Free-text notes about where the dimensions came from. */
  notes?: string;
}

export type DanceFloorMaterial = 'checker' | 'white' | 'black' | 'wood';
export type ChairFinish = 'gold' | 'white' | 'black' | 'wood' | 'clear';
export type CenterpiecePreset = 'none' | 'low-floral' | 'tall-floral' | 'candles';

export interface FurnitureAppearance {
  linenColor?: string;
  preset?: string;
  floor?: DanceFloorMaterial;
  centerpiece?: CenterpiecePreset;
  /** Show the place settings (plates/napkins) on guest tables. */
  placeSettings?: boolean;
  /** Optional speakers for the DJ booth. */
  speakers?: boolean;
}

export interface Furniture {
  id: string;
  type: FurnitureType;
  label: string;
  /** Table number for guest tables; optional. */
  number?: number;
  position: Vec2;
  rotation: number;
  width: number;
  depth: number;
  height: number;
  seats?: Seat[];
  /** Rectangular tables: seats per side [far (−Z), right (+X), near (+Z), left (−X)] in local space. */
  sideCounts?: [number, number, number, number];
  /** cake: 'round' | 'rect'; decoration: 'floral' | 'sign'. */
  variant?: string;
  appearance?: FurnitureAppearance;
  notes?: string;
}

export interface SeatingConfig {
  chairWidth: number;
  chairDepth: number;
  chairHeight: number;
  /** Distance from the table edge to the chair centre. */
  chairOffset: number;
  chairFinish: ChairFinish;
}

export interface Layout {
  id: string;
  name: string;
  room: Room;
  furniture: Furniture[];
  guests: Guest[];
  seating: SeatingConfig;
}

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  snapInches: number;
  snapEnabled: boolean;
  rotationSnapDeg: number;
  showGrid: boolean;
  showLabels: boolean;
  showNames: boolean;
  showClearance: boolean;
  showDimensions: boolean;
  /** Minimum comfortable aisle between occupied footprints (advisory). */
  aisleWidth: number;
  /** Advisory perimeter per guest at a table. */
  perimeterPerGuest: number;
  eyeHeight: number;
  seatedEyeHeight: number;
  walkSpeed: number;
  quality: Quality;
  lighting: 'day' | 'evening';
}

export interface Project {
  schemaVersion: number;
  activeLayoutId: string;
  layouts: Layout[];
  settings: Settings;
}

export const SCHEMA_VERSION = 1;

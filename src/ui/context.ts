import type { Store } from '../model/store';
import type { SceneManager } from '../scene/sceneManager';
import type { Editor } from '../editor/editor';
import type { Walkthrough } from '../walkthrough/walkthrough';
import type { AutoSaver } from '../persistence/storage';

export interface AppContext {
  store: Store;
  sm: SceneManager;
  editor: Editor;
  walk: Walkthrough;
  saver: AutoSaver;
  /** Open a side panel tab (on narrow screens this opens the drawer). */
  openLeft: (tab: 'add' | 'guests' | 'room') => void;
  openInspector: () => void;
  closeDrawers: () => void;
  isNarrow: () => boolean;
}

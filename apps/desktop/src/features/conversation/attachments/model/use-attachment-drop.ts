import * as React from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Native file drop for the app window: Tauri reports filesystem paths, not
 *  File objects, so a dropped path is read by the backend. In a plain browser
 *  (tests, gallery) there is no native drop and the HTML5 handlers take over. */
export function useAttachmentDrop({ onPaths }: { onPaths: (paths: string[]) => void }) {
  const [dragging, setDragging] = React.useState(false);
  const onPathsRef = React.useRef(onPaths);
  React.useEffect(() => {
    onPathsRef.current = onPaths;
  }, [onPaths]);

  React.useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!active) return;
        if (event.payload.type === 'drop') {
          setDragging(false);
          if (event.payload.paths.length > 0) onPathsRef.current(event.payload.paths);
        } else if (event.payload.type === 'enter') {
          setDragging(true);
        } else if (event.payload.type === 'leave') {
          setDragging(false);
        }
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {
        // Drag-drop unavailable (e.g. older shell): the picker still works.
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return { dragging };
}

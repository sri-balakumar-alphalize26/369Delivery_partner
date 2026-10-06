import { Fragment, ReactNode, useEffect, useId, useLayoutEffect, useState } from 'react';

/**
 * A layer over the whole app for a popup that a screen draws deep inside its
 * own content - the code card sits in the job's scrolling sheet, where a full
 * screen layer cannot reach past the sheet's edges.
 *
 * Not a <Modal>: a Modal is a separate Android window, and one closed while
 * the keyboard was going down stayed behind, white, taking every tap and Back
 * (see CameraSheet). This draws in the app's own window, from the root layout,
 * under the camera and the confirm box.
 */

let put: ((id: string, node: ReactNode) => void) | null = null;

export function OverlayHost() {
  const [nodes, setNodes] = useState<Record<string, ReactNode>>({});

  useEffect(() => {
    put = (id, node) =>
      setNodes((all) => {
        if (node == null) {
          if (!(id in all)) return all;
          const rest = { ...all };
          delete rest[id];
          return rest;
        }
        return { ...all, [id]: node };
      });
    return () => {
      put = null;
    };
  }, []);

  return (
    <>
      {Object.entries(nodes).map(([id, node]) => (
        <Fragment key={id}>{node}</Fragment>
      ))}
    </>
  );
}

/** Draws `node` in the overlay while it is not null; gone on unmount. */
export function useOverlay(node: ReactNode) {
  const id = useId();
  // Layout effect: the overlay updates in the same frame as the screen, so a
  // typed digit is not drawn a frame late.
  useLayoutEffect(() => {
    put?.(id, node);
  });
  useEffect(
    () => () => {
      put?.(id, null);
    },
    [id]
  );
}

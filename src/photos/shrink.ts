import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * The parcel photos on the phone: kept out of the cache until they are sent,
 * and made lighter just before they go up.
 *
 * The camera hands back its raw JPEG (`skipProcessing` keeps the shutter
 * instant, and Android then ignores `quality`), 3-6 MB on most phones. Saved
 * again at 80% it keeps every pixel - the same width and height, no resize -
 * and comes out about a third of the size: the label and the seal stay sharp,
 * and it goes up over a rider's mobile data in a third of the time.
 */

const QUALITY = 0.8;

function folder(): Directory {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * A copy of the camera's file where Android will not clear it: the cache can
 * be emptied while a photo still waits for signal. The original uri on any fault.
 */
export function keepPhoto(uri: string): string {
  try {
    const from = new File(uri);
    const to = new File(folder(), from.name);
    if (!to.exists) from.copy(to);
    return to.uri;
  } catch {
    return uri;
  }
}

/** Gone once sent, or once the server will take no more. Quiet on any fault. */
export function dropPhotos(uris: (string | undefined)[]): void {
  for (const uri of uris) {
    if (!uri) continue;
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // A file already gone is the goal anyway.
    }
  }
}

/**
 * The photo saved again at 80%, full size, the right way up (the raw file's
 * turn is in its EXIF, which not every viewer reads). Kept beside the original
 * so a retry does not do it twice. The original itself when the lighter one is
 * not lighter, or when anything fails - a heavy photo beats no photo.
 */
export async function shrinkPhoto(uri: string): Promise<string> {
  try {
    const before = new File(uri).size;
    const image = await ImageManipulator.manipulate(uri).renderAsync();
    const saved = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
    const out = new File(saved.uri);
    if (before > 0 && out.size >= before) {
      out.delete();
      return uri;
    }
    const kept = new File(folder(), `small_${new File(uri).name}`);
    if (kept.exists) kept.delete();
    out.move(kept);
    if (__DEV__) {
      console.log(
        `[photos] ${saved.width}x${saved.height} ${Math.round(before / 1024)} KB -> ${Math.round(kept.size / 1024)} KB`
      );
    }
    return kept.uri;
  } catch (err) {
    console.warn('[photos] could not shrink, sending the original:', err);
    return uri;
  }
}

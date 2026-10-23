// Shrinks a picked cover image before it's stored in Telegram: covers are
// shown at most a few hundred pixels wide, and every client downloads the
// whole file. Small enough JPEGs/PNGs are kept as they are.
const MAX_SIDE = 1200;
const KEEP_BELOW_BYTES = 600 * 1024;

export async function prepareCover(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Not an image file");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Couldn't read that image");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_BELOW_BYTES && /^image\/(jpeg|png)$/.test(file.type)) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't convert the image"))), "image/jpeg", 0.9),
  );
}

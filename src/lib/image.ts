// Normalise uploaded coin images: sniff the real type, strip metadata, cap the
// size, and re-encode as PNG (or WebP if the PNG would be large).
import sharp from "sharp";
import { AppError } from "@/lib/errors";
import { LIMITS } from "@/config/site";
import { sniffImage } from "@/lib/validation";

export interface NormalisedImage {
  bytes: Buffer;
  mime: "image/png" | "image/webp";
  ext: "png" | "webp";
  width: number;
  height: number;
}

const MAX_SIDE = 1000;
const PNG_SOFT_LIMIT = 1_500_000;

export async function normaliseImage(input: Uint8Array): Promise<NormalisedImage> {
  if (input.byteLength > LIMITS.imageMaxBytes)
    throw new AppError("validation", { fields: { image: `Images must be under ${LIMITS.imageMaxBytes / 1024 / 1024} MB.` } });
  if (!sniffImage(input)) throw new AppError("validation", { fields: { image: "Use a PNG, JPG, WebP or GIF image." } });

  try {
    const base = sharp(input, { limitInputPixels: 40_000_000, animated: false, failOn: "error" })
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true });
    let bytes = await base.clone().png({ compressionLevel: 9, palette: false }).toBuffer();
    let mime: NormalisedImage["mime"] = "image/png";
    if (bytes.byteLength > PNG_SOFT_LIMIT) {
      bytes = await base.clone().webp({ quality: 90 }).toBuffer();
      mime = "image/webp";
    }
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height || meta.width < 32 || meta.height < 32)
      throw new AppError("validation", { fields: { image: "The image is too small. Use at least 32×32 pixels." } });
    return { bytes, mime, ext: mime === "image/png" ? "png" : "webp", width: meta.width, height: meta.height };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("validation", { fields: { image: "That image couldn't be read. Try another file." }, cause: e });
  }
}

// Generates every image the app needs from the single source `src/assets/logo.png`.
//
//   node scripts/generate-icons.mjs        (or: npm run icons)
//
// Two separate outputs, because they have opposite requirements:
//
// 1. PWA / favicon icons (public/*.png) are fetched by the browser from
//    `public/`, so they can be larger. The logo is a photograph, so a naive
//    resize yields a ~530 KB 512px PNG; sharp's palette quantization
//    (`palette: true`) cuts that to ~100 KB with no visible loss at icon sizes.
//
// 2. `src/assets/logo-ui.png` is *imported into the JS bundle*, so Vite emits
//    it as a hashed asset. At the full 1254px it was 1.7 MB and shipped on
//    every page load, so it is downscaled to 128px first -- the largest UI slot
//    is 32 CSS px, so 4x still covers HiDPI screens.
import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/assets/logo.png");

const icons = [
  { path: "public/icon-192.png", size: 192 },
  { path: "public/icon-512.png", size: 512 },
  { path: "public/apple-touch-icon.png", size: 180 },
  { path: "public/favicon-32.png", size: 32 },
];

for (const { path, size } of icons) {
  const dest = resolve(root, path);
  await mkdir(dirname(dest), { recursive: true });
  const buffer = await sharp(source)
    .resize(size, size, { fit: "cover" })
    .png({ quality: 82, compressionLevel: 9, palette: true, effort: 10 })
    .toBuffer();
  await sharp(buffer).toFile(dest);
  const { size: bytes } = await stat(dest);
  console.log(`${path} (${size}x${size}) ${Math.round(bytes / 1024)} KB`);
}

// Bundle-friendly copy: 128px is 4x the largest UI slot (32px).
const uiDest = resolve(root, "src/assets/logo-ui.png");
const uiBuffer = await sharp(source)
  .resize(128, 128, { fit: "cover" })
  .png({ quality: 88, compressionLevel: 9, palette: true, effort: 10 })
  .toBuffer();
await sharp(uiBuffer).toFile(uiDest);
console.log(
  `src/assets/logo-ui.png (128x128) ${Math.round(uiBuffer.length / 1024)} KB`,
);

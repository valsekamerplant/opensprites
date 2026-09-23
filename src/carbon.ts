export type CarbonEntry = { filename: string; data: string };

export type CarbonBundle = {
  entries: CarbonEntry[];
  defs: any[];
};

export function parseCarbon(text: string): any {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(clean);
}

export function imageDataUrl(entry: CarbonEntry): string {
  return entry.data.startsWith('data:') ? entry.data : `data:image/png;base64,${entry.data}`;
}

export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrlToBase64(dataUrl));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to decode PNG image'));
    image.src = dataUrl;
  });
}

export function canvasDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

export function sourceFrameCount(image: HTMLImageElement): number {
  if (image.width === 320 && image.height === 128) return 5;
  if (image.width === 960 && image.height === 128) return 15;
  return 0;
}

export function cropStrip(image: HTMLImageElement, frames: number, frameIndex: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = frames * 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const cell = Math.max(0, Math.min(frames - 1, frameIndex));
  ctx.drawImage(image, cell * 64, 0, 64, 128, 0, 0, 64, 128);
  return canvas;
}

export function copyAtlasWithSlot(
  image: HTMLImageElement,
  strip: HTMLImageElement,
  frames: number,
  spriteId: number,
): HTMLCanvasElement {
  const cols = Math.max(1, Math.floor(image.width / 64));
  const cells = spriteId * frames;
  const startRow = Math.floor(cells / cols);
  const startCol = cells % cols;
  const rowsNeeded = Math.ceil((startCol + frames) / cols);
  const height = Math.max(image.height, (startRow + rowsNeeded) * 128);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  for (let frame = 0; frame < frames; frame++) {
    const absoluteCell = cells + frame;
    const x = (absoluteCell % cols) * 64;
    const y = Math.floor(absoluteCell / cols) * 128;
    ctx.clearRect(x, y, 64, 128);
    ctx.drawImage(strip, frame * 64, 0, 64, 128, x, y, 64, 128);
  }
  return canvas;
}

export function atlasSlotCount(image: HTMLImageElement, frames: number): number {
  const cells = Math.floor(image.width / 64) * Math.floor(image.height / 128);
  return Math.ceil(cells / frames);
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function buildZip(files: { name: string; data: string | Uint8Array }[]): Blob {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const body = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const checksum = crc32(body);
    const header = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum),
      u32(body.length), u32(body.length), u16(name.length), u16(0), name,
    ]);
    local.push(header, body);
    const directory = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum),
      u32(body.length), u32(body.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]);
    central.push(directory);
    offset += header.length + body.length;
  }
  const centralBytes = concat(central);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBytes.length), u32(offset), u16(0)]);
  const bytes = concat([...local, centralBytes, end]);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
}

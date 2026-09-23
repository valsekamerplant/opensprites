/** A mapping from one RGB colour to another. Tolerance is normalized RGB distance, 0–100. */
export type ColorReplacement = {
  from: string;
  to: string;
  tolerance: number;
  preserveShading: boolean;
  enabled?: boolean;
};

const HEX = /^#([0-9a-f]{6})$/i;
const MAX_RULES = 32;

function parseHex(value: string): [number, number, number] {
  const match = HEX.exec(value);
  if (!match) throw new Error(`Invalid colour “${value}”; expected #RRGGBB.`);
  const n = Number.parseInt(match[1], 16);
  return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

/** Validate and copy untrusted replacement data. */
export function validateColorReplacements(value: unknown): ColorReplacement[] {
  if (!Array.isArray(value) || value.length > MAX_RULES) {
    throw new Error(`Colour replacements must be an array of at most ${MAX_RULES} rules.`);
  }
  return value.map((rule: unknown, index: number) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`Colour replacement ${index + 1} must be an object.`);
    }
    const r = rule as Record<string, unknown>;
    if (typeof r.from !== 'string' || !HEX.test(r.from)) throw new Error(`Colour replacement ${index + 1} has an invalid source colour.`);
    if (typeof r.to !== 'string' || !HEX.test(r.to)) throw new Error(`Colour replacement ${index + 1} has an invalid target colour.`);
    if (typeof r.tolerance !== 'number' || !Number.isFinite(r.tolerance) || r.tolerance < 0 || r.tolerance > 100) {
      throw new Error(`Colour replacement ${index + 1} tolerance must be between 0 and 100.`);
    }
    if (typeof r.preserveShading !== 'boolean') throw new Error(`Colour replacement ${index + 1} preserveShading must be boolean.`);
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') throw new Error(`Colour replacement ${index + 1} enabled must be boolean.`);
    return { from: r.from, to: r.to, tolerance: r.tolerance, preserveShading: r.preserveShading, ...(r.enabled === undefined ? {} : { enabled: r.enabled }) };
  });
}

/** Return opaque RGB colours sorted by descending pixel frequency (ties by hex). */
export function extractPalette(data: Uint8ClampedArray, limit = 16): { hex: string; count: number }[] {
  if (!Number.isInteger(limit) || limit < 0 || limit > 256) throw new Error('Palette limit must be an integer from 0 to 256.');
  if (data.length % 4 !== 0) throw new Error('Pixel data length must be a multiple of four.');
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit)
    .map(([rgb, count]) => ({ hex: `#${rgb.toString(16).padStart(6, '0')}`, count }));
}

/**
 * Apply each pixel's closest enabled source rule within tolerance. Matching always
 * uses the pixel's original RGB value, so rules never cascade. Alpha is untouched.
 */
export function applyColorReplacements(data: Uint8ClampedArray, rules: ColorReplacement[]): void {
  if (data.length % 4 !== 0) throw new Error('Pixel data length must be a multiple of four.');
  const active = validateColorReplacements(rules).filter(r => r.enabled !== false).map(r => ({
    ...r, source: parseHex(r.from), target: parseHex(r.to),
  }));
  const maxDistance = Math.sqrt(3 * 255 * 255);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const original: [number, number, number] = [data[i], data[i + 1], data[i + 2]];
    let selected: typeof active[number] | undefined;
    let selectedDistance = Infinity;
    for (const rule of active) {
      const dr = original[0] - rule.source[0], dg = original[1] - rule.source[1], db = original[2] - rule.source[2];
      const distance = Math.sqrt(dr * dr + dg * dg + db * db) / maxDistance * 100;
      if (distance <= rule.tolerance && distance < selectedDistance) { selected = rule; selectedDistance = distance; }
    }
    if (!selected) continue;
    let output = selected.target;
    if (selected.preserveShading) {
      const luminance = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      const sourceLight = luminance(selected.source), pixelLight = luminance(original);
      // A black source has no useful ratio; leave it as the exact target colour.
      if (sourceLight > 0) {
        const factor = pixelLight / sourceLight;
        output = selected.target.map(channel => Math.max(0, Math.min(255, channel * factor))) as [number, number, number];
      }
    }
    data[i] = output[0]; data[i + 1] = output[1]; data[i + 2] = output[2];
  }
}

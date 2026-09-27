/**
 * A mapping from one RGB colour to another. Tolerance is normalized RGB distance, 0–100.
 * With `colours`, the rule recolours that whole group of shades: pixels match their nearest
 * member, and with preserveShading the group's average shade becomes `to` exactly while
 * darker and lighter shades ramp toward black and white.
 */
export type ColorReplacement = {
  from: string;
  to: string;
  tolerance: number;
  preserveShading: boolean;
  enabled?: boolean;
  colours?: string[];
  /** Group rules: 0–100 hue-shifted reshading strength (default 50); 0 keeps a plain lightness ramp. */
  reshade?: number;
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
    if (r.colours !== undefined && (!Array.isArray(r.colours) || !r.colours.length || r.colours.length > 256 || r.colours.some(c => typeof c !== 'string' || !HEX.test(c)))) throw new Error(`Colour replacement ${index + 1} has an invalid colour group.`);
    if (r.reshade !== undefined && (typeof r.reshade !== 'number' || !Number.isFinite(r.reshade) || r.reshade < 0 || r.reshade > 100)) throw new Error(`Colour replacement ${index + 1} reshade must be between 0 and 100.`);
    return { from: r.from, to: r.to, tolerance: r.tolerance, preserveShading: r.preserveShading, ...(r.enabled === undefined ? {} : { enabled: r.enabled }), ...(r.colours === undefined ? {} : { colours: [...r.colours as string[]] }), ...(r.reshade === undefined ? {} : { reshade: r.reshade }) };
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
    ...r, source: parseHex(r.from), target: parseHex(r.to), members: (r.colours ?? [r.from]).map(parseHex), stats: new ShadeStats(),
  }));
  const maxDistance = Math.sqrt(3 * 255 * 255);
  // First pass: each pixel's closest rule. Group rules also need their matched average shade.
  const owner = new Int16Array(data.length / 4).fill(-1), byColour = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let found = byColour.get(key);
    if (found === undefined) {
      let selectedDistance = Infinity; found = -1;
      for (const [index, rule] of active.entries()) for (const m of rule.members) {
        const dr = data[i] - m[0], dg = data[i + 1] - m[1], db = data[i + 2] - m[2];
        const distance = Math.sqrt(dr * dr + dg * dg + db * db) / maxDistance * 100;
        if (distance <= rule.tolerance && distance < selectedDistance) { found = index; selectedDistance = distance; }
      }
      byColour.set(key, found);
    }
    owner[i / 4] = found;
    active[found]?.stats.add(data[i], data[i + 1], data[i + 2]);
  }
  const shaders = active.map(rule => rule.colours && rule.preserveShading ? reshader(rule.target, rule.stats, (rule.reshade ?? 50) / 100) : undefined);
  for (let i = 0; i < data.length; i += 4) {
    const selected = active[owner[i / 4]];
    if (!selected) continue;
    const pixelLight = luminance(data[i], data[i + 1], data[i + 2]);
    let output: number[] = selected.target;
    const shader = shaders[owner[i / 4]];
    if (shader) output = shader(data[i], data[i + 1], data[i + 2]);
    else if (selected.preserveShading) {
      const sourceLight = luminance(...selected.source);
      // A black source has no useful ratio; leave it as the exact target colour.
      if (sourceLight > 0) output = selected.target.map(channel => Math.max(0, Math.min(255, channel * pixelLight / sourceLight)));
    }
    data[i] = output[0]; data[i + 1] = output[1]; data[i + 2] = output[2];
  }
}

function luminance(r: number, g: number, b: number) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

// OKLab: a perceptual colour space, so lightness steps and hue shifts look even.
const linear = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const encode = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklab(r: number, g: number, b: number) {
  const R = linear(r), G = linear(g), B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function fromOklab(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076923010 * s].map(encode);
}
// Largest chroma at this lightness and hue that sRGB can show, so colours never clip into other hues.
function fromOklch(L: number, C: number, h: number) {
  L = Math.min(1, Math.max(0, L));
  let lo = 0, hi = C;
  const at = (c: number) => fromOklab(L, c * Math.cos(h), c * Math.sin(h));
  if (at(C).every(v => v >= -0.5 && v <= 255.5)) lo = C;
  else for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (at(mid).every(v => v >= -0.5 && v <= 255.5)) lo = mid; else hi = mid; }
  return at(lo).map(v => Math.round(Math.min(255, Math.max(0, v))));
}
class ShadeStats {
  sum = 0; count = 0; min = Infinity; max = -Infinity;
  add(r: number, g: number, b: number) { const L = oklab(r, g, b)[0]; this.sum += L; this.count++; this.min = Math.min(this.min, L); this.max = Math.max(this.max, L); }
}
// Shadows lean toward purple (so yellow shades through orange, not green); highlights toward yellow.
const COOL = 300 * Math.PI / 180, WARM = 95 * Math.PI / 180;
const turnToward = (h: number, goal: number, amount: number) => { const d = Math.atan2(Math.sin(goal - h), Math.cos(goal - h)); return h + Math.sign(d) * Math.min(Math.abs(d), amount); };
/**
 * Reshade pixels onto one colour, as a pixel artist would. The group's average shade becomes
 * the colour exactly. Darker shades get darker, cooler and a little richer; lighter shades get
 * lighter, warmer and paler. Low-contrast groups are stretched so the shading stays visible.
 * `strength` 0 keeps a plain lightness ramp in the colour's own hue.
 */
function reshader(colour: number[], stats: ShadeStats, strength: number) {
  const [Lt, at, bt] = oklab(colour[0], colour[1], colour[2]), Ct = Math.hypot(at, bt), ht = Math.atan2(bt, at);
  const mean = stats.count ? stats.sum / stats.count : Lt, spread = stats.max - stats.min, minSpread = 0.3 * strength;
  const contrast = spread > 1e-6 && spread < minSpread ? Math.min(4, minSpread / spread) : 1;
  const cache = new Map<number, number[]>();
  return (r: number, g: number, b: number) => {
    const key = (r << 16) | (g << 8) | b, known = cache.get(key); if (known) return known;
    const d = (oklab(r, g, b)[0] - mean) * contrast;
    let result = colour;
    if (Math.abs(d) > 1e-6) {
      const t = Math.max(-1, Math.min(1, d / 0.2)), shift = 40 * Math.PI / 180 * strength * Math.abs(t);
      const C = Ct * (t < 0 ? 1 + 0.3 * strength * -t : Math.max(0, 1 - 0.8 * strength * t));
      result = fromOklch(Lt + d, C, turnToward(ht, t < 0 ? COOL : WARM, shift));
    }
    cache.set(key, result);
    return result;
  };
}
/**
 * Recolour a whole layer onto one colour with the same reshading as group rules: the layer's
 * average shade becomes the tint, and shadows and highlights shift hue like hand shading.
 */
export function applyTint(data: Uint8ClampedArray, hex: string, reshade = 50): void {
  if (data.length % 4 !== 0) throw new Error('Pixel data length must be a multiple of four.');
  const tint = parseHex(hex), stats = new ShadeStats();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) stats.add(data[i], data[i + 1], data[i + 2]);
  if (!stats.count) return;
  const shade = reshader(tint, stats, reshade / 100);
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) data.set(shade(data[i], data[i + 1], data[i + 2]), i);
}

export type ColourGroup = { colours: { hex: string; count: number }[]; count: number; hex: string };
function hueSat(hex: string) {
  const [r, g, b] = parseHex(hex).map(v => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min, light = (max + min) / 2;
  let hue = 0;
  if (chroma) { hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4; hue = (hue * 60 + 360) % 360; }
  return { hue, sat: chroma ? chroma / (1 - Math.abs(2 * light - 1)) : 0, chroma, light };
}
const NEUTRAL_CHROMA = 0.08, NEUTRAL_GAP = 0.25;
/**
 * Group a palette into shades of the same colour. Near-greys split only at large lightness
 * gaps; coloured pixels merge by hue and saturation, not lightness, so dark and light shades
 * of one material stay together. `strength` (0–60) widens how different merged shades may be.
 * Groups are sorted by pixel count; each group's colours run dark to light.
 */
export function groupPalette(palette: { hex: string; count: number }[], strength = 20): ColourGroup[] {
  const neutral = palette.filter(p => hueSat(p.hex).chroma < NEUTRAL_CHROMA).sort((a, b) => hueSat(a.hex).light - hueSat(b.hex).light);
  const clusters: { members: typeof palette; count: number; x: number; y: number; sat: number; light: number }[] = [];
  const groups: (typeof palette)[] = [];
  for (const [i, p] of neutral.entries()) {
    if (!i || hueSat(p.hex).light - hueSat(neutral[i - 1].hex).light > NEUTRAL_GAP) groups.push([]);
    groups[groups.length - 1].push(p);
  }
  for (const p of palette) {
    const c = hueSat(p.hex); if (c.chroma < NEUTRAL_CHROMA) continue;
    clusters.push({ members: [p], count: p.count, x: Math.cos(c.hue * Math.PI / 180) * p.count, y: Math.sin(c.hue * Math.PI / 180) * p.count, sat: c.sat * p.count, light: c.light * p.count });
  }
  const centre = (k: typeof clusters[number]) => ({ hue: (Math.atan2(k.y, k.x) * 180 / Math.PI + 360) % 360, sat: k.sat / k.count, light: k.light / k.count });
  const distance = (a: typeof clusters[number], b: typeof clusters[number]) => {
    const p = centre(a), q = centre(b), dh = Math.abs(p.hue - q.hue);
    // Saturation is unreliable in deep shadows, so it counts less as either side darkens.
    return Math.min(dh, 360 - dh) + 40 * Math.min(1, Math.min(p.light, q.light) / 0.3) * Math.abs(p.sat - q.sat);
  };
  for (;;) {
    let best: [number, number] | undefined, bestDistance = strength;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const d = distance(clusters[i], clusters[j]); if (d <= bestDistance) { bestDistance = d; best = [i, j]; }
    }
    if (!best) break;
    const [a, b] = best.map(i => clusters[i]);
    a.members.push(...b.members); a.count += b.count; a.x += b.x; a.y += b.y; a.sat += b.sat; a.light += b.light;
    clusters.splice(best[1], 1);
  }
  return [...groups, ...clusters.map(k => k.members)].map(members => {
    const colours = [...members].sort((a, b) => hueSat(a.hex).light - hueSat(b.hex).light), count = colours.reduce((s, c) => s + c.count, 0);
    return { colours, count, hex: [...colours].sort((a, b) => b.count - a.count)[0].hex };
  }).sort((a, b) => b.count - a.count);
}

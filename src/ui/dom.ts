// Small DOM helpers shared by the studio's panels.
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const input = (id: string) => $<HTMLInputElement>(id);
export const select = (id: string) => $<HTMLSelectElement>(id);
export const number = (id: string) => Number(input(id).value);

type Props = Record<string, unknown> & { class?: string; text?: string; style?: Partial<CSSStyleDeclaration>; dataset?: Record<string, string> };
/** Create an element: h('button', { class: 'x', text: 'Go', onclick }, child…). Other props are set as properties, or as attributes when they contain a dash. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Node | string | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.includes('-')) el.setAttribute(key, String(value));
    else (el as any)[key] = value;
  }
  for (const child of children) if (child !== false && child !== undefined) el.append(child);
  return el;
}

export function download(name: string, data: Blob | string) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const downloadBytes = (name: string, bytes: Uint8Array, type = 'image/png') => download(name, new Blob([bytes as BlobPart], { type }));
export const fileData = (file: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Per-viewer conveniences only; storage can be unavailable (private windows, blocked sites).
export function stored<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }
export function store(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not persisted */ } }

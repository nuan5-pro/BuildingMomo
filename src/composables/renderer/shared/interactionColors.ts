export const DEFAULT_ITEM_COLOR = 0x94a3b8
export const SELECTED_ITEM_COLOR = 0x60a5fa
export const HOVER_ITEM_COLOR = 0xf59e0b
export const ALIGN_REFERENCE_ITEM_COLOR = 0xfacc15

export function convertColorToHex(colorStr: string | undefined): number {
  if (!colorStr) return DEFAULT_ITEM_COLOR
  const matches = colorStr.match(/\d+/g)
  if (!matches || matches.length < 3) return DEFAULT_ITEM_COLOR
  const r = parseInt(matches[0] ?? '148', 10)
  const g = parseInt(matches[1] ?? '163', 10)
  const b = parseInt(matches[2] ?? '184', 10)
  return (r << 16) | (g << 8) | b
}

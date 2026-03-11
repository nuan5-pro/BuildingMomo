import type { GameColorMap, GameDataFile, GameItem } from '@/types/editor'

// BuildRecord 文件中单条记录的原始字段结构（字段值类型宽泛，需要规范化）
type BuildRecordEntry = Record<string, unknown> & {
  ItemID?: unknown
  InstanceID?: unknown
  GroupID?: unknown
  AttachID?: unknown
  Location?: Record<string, unknown>
  Rotation?: Record<string, unknown>
  Scale?: Record<string, unknown>
  ColorMap?: unknown
  TempInfo?: unknown
}

/** 将任意值转为有限数字，转换失败时返回 fallback */
function toFiniteNumber(value: unknown, fallback: number): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/**
 * 规范化颜色映射字段，兼容两种原始格式：
 *   - 数组格式：[null, 1, 2, ...]  → GameColorMap 数组
 *   - 对象格式：{ "0": 1, "1": 2 } → 键值对记录
 * 若两者都不匹配则返回 undefined。
 */
function normalizeColorMap(value: unknown): GameColorMap | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === null) return null
      const num = Number(item)
      return Number.isFinite(num) ? num : null
    })
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, number> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const num = Number(raw)
      if (Number.isFinite(num)) {
        result[key] = num
      }
    }
    return result
  }

  return undefined
}

/**
 * 将 BuildRecord 中的单条原始记录转换为标准 GameItem。
 * ItemID 或 InstanceID 无效时返回 null，该记录会被跳过。
 */
function normalizeRecordEntryToGameItem(entry: BuildRecordEntry): GameItem | null {
  const itemId = toFiniteNumber(entry.ItemID, Number.NaN)
  const instanceId = toFiniteNumber(entry.InstanceID, Number.NaN)
  if (!Number.isFinite(itemId) || !Number.isFinite(instanceId)) {
    return null
  }

  const locationRaw = (entry.Location ?? {}) as Record<string, unknown>
  const rotationRaw = (entry.Rotation ?? {}) as Record<string, unknown>
  const scaleRaw = (entry.Scale ?? {}) as Record<string, unknown>

  const item: GameItem = {
    ItemID: itemId,
    InstanceID: instanceId,
    GroupID: toFiniteNumber(entry.GroupID, 0),
    AttachID: toFiniteNumber(entry.AttachID, 0),
    Location: {
      X: toFiniteNumber(locationRaw.X, 0),
      Y: toFiniteNumber(locationRaw.Y, 0),
      Z: toFiniteNumber(locationRaw.Z, 0),
    },
    Rotation: {
      Pitch: toFiniteNumber(rotationRaw.Pitch, 0),
      Yaw: toFiniteNumber(rotationRaw.Yaw, 0),
      Roll: toFiniteNumber(rotationRaw.Roll, 0),
    },
    Scale: {
      X: toFiniteNumber(scaleRaw.X, 1),
      Y: toFiniteNumber(scaleRaw.Y, 1),
      Z: toFiniteNumber(scaleRaw.Z, 1),
    },
  }

  const colorMap = normalizeColorMap(entry.ColorMap)
  if (colorMap !== undefined) {
    item.ColorMap = colorMap
  }

  if (typeof entry.TempInfo === 'object' && entry.TempInfo !== null) {
    item.TempInfo = entry.TempInfo as Record<string, any>
  }

  return item
}

/**
 * 将 .record 文件的原始 JSON 字符串解析为 GameDataFile。
 * .record 文件是一个 GameItem 数组，解析后封装为标准存档格式（NeedRestore: true）。
 * 无效记录会被过滤，不会导致整体解析失败。
 */
export function parseBuildRecordToGameData(recordContent: string): GameDataFile {
  const raw = JSON.parse(recordContent)
  if (!Array.isArray(raw)) {
    throw new Error('Invalid record format: root is not array')
  }

  const items: GameItem[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const item = normalizeRecordEntryToGameItem(row as BuildRecordEntry)
    if (item) {
      items.push(item)
    }
  }

  return {
    NeedRestore: true,
    PlaceInfo: items,
  }
}

/**
 * 将 GameItem 数组序列化为写回 .record 文件所需的 payload 格式。
 * 与 parseBuildRecordToGameData 互为逆操作，附加游戏要求的 bIsAdd 字段。
 */
export function buildRecordPayloadFromGameItems(gameItems: GameItem[]): unknown[] {
  return gameItems.map((item) => {
    const { ItemID, InstanceID, GroupID, AttachID, Location, Rotation, Scale, ...others } =
      item as GameItem & Record<string, unknown>

    return {
      ...others,
      bIsAdd: false,
      GroupID,
      Rotation: { Pitch: Rotation.Pitch, Yaw: Rotation.Yaw, Roll: Rotation.Roll },
      ItemID,
      Scale: { X: Scale.X, Y: Scale.Y, Z: Scale.Z },
      InstanceID,
      AttachID,
      Location: { X: Location.X, Y: Location.Y, Z: Location.Z },
    }
  })
}

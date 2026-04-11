import type { AppItem } from '@/types/editor'
import type { FurnitureColorConfig } from '@/types/furniture'
import { decodeColorMapToGroupMap } from '@/lib/colorMap'

export type ModelDyePlan =
  | { mode: 'plain' }
  | {
      mode: 'dyed'
      /** meshIdx → { pattern, tint }：每个源 mesh 的贴图变体选择 */
      dyeMap: Map<number, { pattern: number; tint: number }>
    }

interface ModelDyeCacheEntry {
  signature: string
  dyePlan: ModelDyePlan
  meshKey: string
}

export interface ModelDyeMeta {
  dyePlan: ModelDyePlan
  meshKey: string
}

// item.internalId -> 染色解析结果缓存。
// 这里刻意按“物品实例”缓存，而不是仅按 gameId 缓存：
// - 同 gameId 的不同物品可能拥有不同 ColorMap
// - 移动/旋转/缩放不会影响染色结果，因此缓存命中率会很高
const modelDyeCache = new Map<string, ModelDyeCacheEntry>()

function serializeColorMapSignature(colorMap: AppItem['extra']['ColorMap'] | undefined): string {
  if (colorMap === undefined || colorMap === null) return ''

  if (Array.isArray(colorMap)) {
    return `a:${colorMap.map((entry) => (entry == null ? '' : String(entry))).join(',')}`
  }

  const parts = Object.entries(colorMap)
    .sort(([left], [right]) => Number(left) - Number(right) || left.localeCompare(right))
    .map(([groupId, colorIndex]) => `${groupId}:${String(colorIndex)}`)
  return `o:${parts.join(',')}`
}

function buildModelDyeSignature(
  item: Pick<AppItem, 'gameId' | 'extra'>,
  colorsConfig: FurnitureColorConfig | undefined
): string {
  const colorMapSignature = serializeColorMapSignature(item.extra.ColorMap)
  const colorsMode = colorsConfig ? 'cfg' : 'plain'
  return `${item.gameId}|${colorsMode}|${colorMapSignature}`
}

/**
 * 根据家具模型的染色配置和物品 ColorMap，解析模型染色计划。
 *
 * 规则：
 * 1) 无 colors 配置 → plain
 * 2) 对每个存在染色配置的区域：优先使用 ColorMap 中显式选择的 colorIndex，
 *    未显式选择时回退到该区域的 0 号配置
 * 3) 仅当任一区域命中非默认变体（pattern/tint 非全 0）时，返回 dyed；否则 plain
 */
export function resolveModelDyePlan({
  item,
  colorsConfig,
}: {
  item: Pick<AppItem, 'extra'>
  colorsConfig: FurnitureColorConfig | undefined
}): ModelDyePlan {
  if (!colorsConfig) return { mode: 'plain' }

  const groupMap = decodeColorMapToGroupMap(item.extra.ColorMap)

  const dyeMap = new Map<number, { pattern: number; tint: number }>()

  for (const [rawGroupId, groupConfig] of Object.entries(colorsConfig)) {
    if (!groupConfig) continue
    const groupId = Number(rawGroupId)
    if (!Number.isFinite(groupId)) continue

    const colorIndex = groupMap.get(groupId) ?? 0
    const entry = groupConfig[colorIndex]
    if (!entry) continue

    for (const [meshIdx, pattern, tint] of entry.cfg) {
      if (pattern === 0 && tint === 0) continue
      dyeMap.set(meshIdx, { pattern, tint })
    }
  }

  if (dyeMap.size === 0) return { mode: 'plain' }
  return { mode: 'dyed', dyeMap }
}

/**
 * 生成模型分组缓存键，完整表达染色意图，避免错误复用。
 */
export function buildModelMeshKey(gameId: number, plan: ModelDyePlan): string {
  if (plan.mode === 'plain') return `${gameId}|plain`

  const parts = Array.from(plan.dyeMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([meshIdx, { pattern, tint }]) => `${meshIdx}:${pattern},${tint}`)
    .join(';')
  return `${gameId}|dyed|${parts}`
}

/**
 * 解析模型染色元信息（dyePlan + meshKey），并基于 item 维度做缓存。
 *
 * 设计目的：
 * - `useModelMode.rebuild()` 在大场景下会反复遍历所有 item
 * - 对于绝大多数“仅位置变化”或“未修改染色”的物品来说，重复解 ColorMap 与拼 meshKey 纯属浪费
 * - 因此这里按 `internalId` 记住上次结果；只要 gameId / ColorMap 没变，就直接复用
 *
 * 注意：
 * - 这里缓存的是“染色意图”，不缓存 Three.js 材质对象；材质生命周期仍由 ModelManager 负责
 * - `colorsConfig` 在当前项目中由 gameId 决定，通常稳定；这里仍将其是否存在编码进 signature，避免 plain/dyed 语义串位
 */
export function resolveCachedModelDyeMeta({
  item,
  colorsConfig,
}: {
  item: Pick<AppItem, 'internalId' | 'gameId' | 'extra'>
  colorsConfig: FurnitureColorConfig | undefined
}): ModelDyeMeta {
  const signature = buildModelDyeSignature(item, colorsConfig)
  const cached = modelDyeCache.get(item.internalId)
  if (cached && cached.signature === signature) {
    return {
      dyePlan: cached.dyePlan,
      meshKey: cached.meshKey,
    }
  }

  const dyePlan = resolveModelDyePlan({ item, colorsConfig })
  const meshKey = buildModelMeshKey(item.gameId, dyePlan)

  modelDyeCache.set(item.internalId, {
    signature,
    dyePlan,
    meshKey,
  })

  return {
    dyePlan,
    meshKey,
  }
}

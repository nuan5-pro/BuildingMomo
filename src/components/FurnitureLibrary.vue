<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'
import { useI18n } from '@/composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LayoutGrid, Search, X } from 'lucide-vue-next'
import type { FurnitureCategory } from '@/types/furniture'

const gameDataStore = useGameDataStore()
const editorStore = useEditorStore()
const { addFurnitureItem } = useEditorItemAdd()
const { t, locale } = useI18n()

// 控制显示
const isVisible = defineModel<boolean>('open', { default: false })

const searchQuery = ref('')
const selectedMajorId = ref<number | null>(null)
const selectedMinorId = ref<number | null>(null)
const furnitureScrollRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const furnitureScrollPositions = new Map<string, number>()

const categoryList = computed(() =>
  Object.values(gameDataStore.furnitureCategories).sort((a, b) => a.id - b.id)
)

const populatedMinorIds = computed(
  () => new Set(Object.values(gameDataStore.furnitureData).map((item) => item.categoryId))
)

const minorCategoryList = computed(() =>
  categoryList.value.filter(
    (category) => category.parentId !== null && populatedMinorIds.value.has(category.id)
  )
)

const majorCategories = computed(() => {
  const populatedMajorIds = new Set(minorCategoryList.value.map((category) => category.parentId))
  return categoryList.value.filter(
    (category) => category.parentId === null && populatedMajorIds.has(category.id)
  )
})

const activeMajorId = computed(() => selectedMajorId.value ?? majorCategories.value[0]?.id ?? null)

const activeMajor = computed(
  () => majorCategories.value.find((category) => category.id === activeMajorId.value) ?? null
)

const minorCategories = computed(() =>
  minorCategoryList.value.filter((category) => category.parentId === activeMajorId.value)
)

const activeMinor = computed(
  () => minorCategories.value.find((category) => category.id === selectedMinorId.value) ?? null
)

const furnitureScrollKey = computed(() => {
  if (searchQuery.value.trim()) return 'search'
  if (selectedMinorId.value !== null) return `minor:${selectedMinorId.value}`
  return `major:${activeMajorId.value ?? 'none'}`
})

function getFurnitureScrollViewport(): HTMLElement | null {
  return furnitureScrollRef.value?.$el?.querySelector('[data-slot="scroll-area-viewport"]') ?? null
}

watch(furnitureScrollKey, async (key, previousKey) => {
  const previousViewport = getFurnitureScrollViewport()
  if (previousViewport) furnitureScrollPositions.set(previousKey, previousViewport.scrollTop)

  await nextTick()
  const viewport = getFurnitureScrollViewport()
  if (viewport) viewport.scrollTop = furnitureScrollPositions.get(key) ?? 0
})

function getCategoryName(category: FurnitureCategory): string {
  return locale.value === 'zh' ? category.name_cn : category.name_en
}

function getCategoryIconStyle(categoryId: number): CSSProperties {
  const url = gameDataStore.getCategoryIconUrl(categoryId)
  return {
    backgroundColor: 'currentColor',
    maskImage: `url("${url}")`,
    maskMode: 'luminance',
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    WebkitMaskImage: `url("${url}")`,
    WebkitMaskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
  }
}

const classificationLabel = computed(() => {
  if (searchQuery.value.trim()) return t('furnitureLibrary.searchResults')
  if (!activeMajor.value) return ''
  return `${getCategoryName(activeMajor.value)} · ${activeMinor.value ? getCategoryName(activeMinor.value) : t('furnitureLibrary.all')}`
})

// 处理家具列表
const furnitureList = computed(() => {
  const data = gameDataStore.furnitureData
  const lang = locale.value

  return Object.entries(data)
    .map(([id, item]) => ({
      id: parseInt(id),
      name: lang === 'zh' ? item.name_cn : item.name_en,
      icon: gameDataStore.getIconUrl(parseInt(id)),
      categoryId: item.categoryId,
    }))
    .sort((a, b) => a.id - b.id)
})

// 搜索过滤
const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    return furnitureList.value.filter(
      (item) => item.name.toLowerCase().includes(query) || item.id.toString().includes(query)
    )
  }

  if (selectedMinorId.value !== null) {
    return furnitureList.value.filter((item) => item.categoryId === selectedMinorId.value)
  }

  const categoryIds = new Set(minorCategories.value.map((category) => category.id))
  return furnitureList.value.filter((item) => categoryIds.has(item.categoryId))
})

const totalCount = computed(() => furnitureList.value.length)

// 添加家具
function handleAddItem(itemId: number) {
  if (!editorStore.activeScheme) return

  addFurnitureItem(itemId)
  // 不关闭面板，方便连续添加
}

function close() {
  isVisible.value = false
}

function selectMajor(categoryId: number) {
  selectedMajorId.value = categoryId
  selectedMinorId.value = null
  searchQuery.value = ''
}

function selectMinor(categoryId: number | null) {
  selectedMinorId.value = categoryId
  searchQuery.value = ''
}

// 清除搜索
function clearSearch() {
  searchQuery.value = ''
}
</script>

<template>
  <!-- 悬浮在画布左上角 -->
  <div
    v-show="isVisible"
    class="absolute inset-y-4 left-4 z-50 flex w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background/90 shadow-2xl backdrop-blur-md"
  >
    <!-- 顶部搜索栏 -->
    <div class="flex items-center gap-2 border-b p-2">
      <div class="relative min-w-0 flex-1">
        <Search
          class="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="searchQuery"
          :placeholder="t('furnitureLibrary.searchPlaceholder')"
          class="h-8 pr-8 pl-7 text-xs"
          autofocus
        />
        <Button
          v-if="searchQuery.trim()"
          variant="ghost"
          size="icon"
          class="absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          @click="clearSearch"
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 shrink-0"
        :aria-label="t('common.close')"
        @click="close"
      >
        <X class="h-4 w-4" />
      </Button>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- 游戏中的左侧大类栏 -->
      <nav
        class="w-14 shrink-0 border-r bg-muted/35"
        :aria-label="t('furnitureLibrary.majorCategories')"
      >
        <ScrollArea class="h-full">
          <div class="flex flex-col items-center gap-1.5 p-1.5">
            <button
              v-for="category in majorCategories"
              :key="category.id"
              type="button"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-all hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              :class="
                activeMajorId === category.id
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary'
                  : 'text-foreground/70'
              "
              :title="getCategoryName(category)"
              :aria-label="getCategoryName(category)"
              :aria-pressed="activeMajorId === category.id"
              @click="selectMajor(category.id)"
            >
              <span class="h-8 w-8" :style="getCategoryIconStyle(category.id)" />
            </button>
          </div>
          <ScrollBar orientation="vertical" class="!w-1.5" />
        </ScrollArea>
      </nav>

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- 游戏中的顶部小类栏；“全部”是每个大类下的合并视图 -->
        <nav
          v-if="!searchQuery.trim()"
          class="flex items-center border-b bg-muted/20"
          :aria-label="t('furnitureLibrary.minorCategories')"
        >
          <ScrollArea class="min-w-0 flex-1 whitespace-nowrap">
            <div class="flex w-max gap-1 px-2 py-1.5">
              <button
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                :class="
                  selectedMinorId === null
                    ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary'
                    : ''
                "
                :title="t('furnitureLibrary.all')"
                :aria-label="t('furnitureLibrary.all')"
                :aria-pressed="selectedMinorId === null"
                @click="selectMinor(null)"
              >
                <LayoutGrid class="h-6 w-6" />
              </button>

              <button
                v-for="category in minorCategories"
                :key="category.id"
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-foreground/70 transition-all hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                :class="
                  selectedMinorId === category.id
                    ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary'
                    : ''
                "
                :title="getCategoryName(category)"
                :aria-label="getCategoryName(category)"
                :aria-pressed="selectedMinorId === category.id"
                @click="selectMinor(category.id)"
              >
                <span class="h-8 w-8" :style="getCategoryIconStyle(category.id)" />
              </button>
            </div>
            <ScrollBar orientation="horizontal" class="!h-1.5" />
          </ScrollArea>
          <div
            class="max-w-32 shrink-0 truncate border-l px-3 text-sm font-semibold text-foreground sm:max-w-56"
            :title="classificationLabel"
          >
            {{ classificationLabel }}
          </div>
        </nav>

        <!-- 家具网格（可滚动） -->
        <ScrollArea ref="furnitureScrollRef" class="min-h-0 flex-1">
          <div
            class="grid grid-cols-3 gap-1 p-2 min-[480px]:grid-cols-4 min-[600px]:grid-cols-5 md:grid-cols-6"
          >
            <button
              v-for="item in filteredItems"
              :key="item.id"
              class="flex min-w-0 flex-col items-center rounded-md p-1.5 transition-colors hover:bg-accent active:scale-95"
              :title="item.name"
              @click="handleAddItem(item.id)"
            >
              <img
                :src="item.icon"
                class="aspect-square w-full max-w-20 rounded border bg-muted object-cover"
                :alt="item.name"
                loading="lazy"
                @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
              />
              <span class="mt-1 line-clamp-2 max-w-full text-center text-[11px] leading-tight">
                {{ item.name }}
              </span>
            </button>
          </div>

          <!-- 空状态 -->
          <div
            v-if="filteredItems.length === 0"
            class="flex h-32 flex-col items-center justify-center text-muted-foreground"
          >
            <Search class="mb-2 h-8 w-8 opacity-50" />
            <span class="text-sm">{{ t('furnitureLibrary.noResults') }}</span>
          </div>

          <ScrollBar orientation="vertical" class="!w-1.5" />
        </ScrollArea>
      </div>
    </div>

    <!-- 底部：统计信息 -->
    <div class="border-t px-2 py-1.5 text-center text-[11px] text-muted-foreground">
      {{ t('furnitureLibrary.stats', { total: totalCount, showing: filteredItems.length }) }}
    </div>
  </div>
</template>

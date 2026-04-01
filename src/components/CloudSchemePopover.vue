<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useCloudSchemeSync } from '@/composables/useCloudSchemeSync'
import { useI18n } from '@/composables/useI18n'
import { useNotification } from '@/composables/useNotification'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import type { CloudHistoryEvent } from '@/types/cloudScheme'
import { joinOnlineDisplayNames } from '@/lib/cloudPresence'

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const notification = useNotification()
const editorStore = useEditorStore()
const cloudStore = useCloudSchemeStore()
const {
  currentCloudScheme,
  shareCode,
  copyShareCode,
  disconnect,
  reconnectActiveCloudScheme,
  getStoredDisplayName,
} = useCloudSchemeSync()

const activeSchemeId = computed(() => editorStore.activeScheme?.id)

const isLiveConnected = computed(
  () =>
    !!activeSchemeId.value && cloudStore.schemeId === activeSchemeId.value && cloudStore.isConnected
)

const isConnectingSession = computed(
  () =>
    !!activeSchemeId.value &&
    cloudStore.schemeId === activeSchemeId.value &&
    cloudStore.status === 'connecting'
)

const showReconnectAction = computed(
  () => !!currentCloudScheme.value && !isLiveConnected.value && !isConnectingSession.value
)

const statusButtonClass = computed(() => {
  if (isLiveConnected.value) {
    return 'bg-green-500/15 text-green-600 hover:bg-destructive hover:text-destructive-foreground dark:bg-green-500/20 dark:text-green-400'
  }
  if (isConnectingSession.value) {
    return 'cursor-not-allowed bg-muted text-muted-foreground opacity-80'
  }
  return 'bg-green-500/15 text-green-600 hover:bg-green-500/25 dark:bg-green-500/20 dark:text-green-400'
})

const sessionActionLabel = computed(() => {
  if (!currentCloudScheme.value) return ''
  if (isLiveConnected.value) {
    return t(`cloudScheme.status.${currentCloudScheme.value.status}`)
  }
  if (isConnectingSession.value) {
    return t('cloudScheme.status.connecting')
  }
  return t('cloudScheme.reconnect')
})

const sessionActionTooltip = computed(() => {
  if (isLiveConnected.value) return t('cloudScheme.disconnect')
  if (isConnectingSession.value) return t('cloudScheme.status.connecting')
  return t('cloudScheme.reconnect')
})

const pendingTransactionCount = computed(() => editorStore.cloudPendingCount)
const hasStaleUndo = computed(() => editorStore.hasStaleUndo)
const historyEvents = computed(() => cloudStore.historyEvents)

interface DisplayHistoryEvent extends CloudHistoryEvent {
  mergedCount: number
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  if (diffMs < 0) {
    return t('watchMode.history.justNow')
  }

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return t('watchMode.history.justNow')
  if (minutes < 60) return t('watchMode.history.minutesAgo', { n: minutes })

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('watchMode.history.hoursAgo', { n: hours })

  const days = Math.floor(hours / 24)
  return t('watchMode.history.daysAgo', { n: days })
}

function getHistoryLabel(event: CloudHistoryEvent): string {
  const actorName = event.actorDisplayName || t('cloudScheme.history.fallbackActor')

  switch (event.type) {
    case 'remote_tx': {
      const added = event.addedCount || 0
      const removed = event.removedCount || 0
      const updated = event.updatedCount || 0
      const activeKinds = [added > 0, removed > 0, updated > 0].filter(Boolean).length

      if (activeKinds <= 1) {
        if (added > 0) return t('cloudScheme.history.remoteTxAdded', { actor: actorName, n: added })
        if (removed > 0)
          return t('cloudScheme.history.remoteTxRemoved', { actor: actorName, n: removed })
        return t('cloudScheme.history.remoteTxUpdated', {
          actor: actorName,
          n: updated || event.itemCount || 0,
        })
      }

      return t('cloudScheme.history.remoteTxMixed', {
        actor: actorName,
        total: event.itemCount || added + removed + updated,
        add: added,
        remove: removed,
        update: updated,
      })
    }
    case 'user_joined':
      return t('cloudScheme.history.userJoined', { actor: actorName })
    case 'user_left':
      return t('cloudScheme.history.userLeft', { actor: actorName })
    case 'connected':
      return t('cloudScheme.history.connected')
    case 'reconnected':
      return t('cloudScheme.history.reconnected')
    case 'conflict_reload':
      return t('cloudScheme.history.conflictReload')
    default:
      return t('cloudScheme.history.unknown')
  }
}

function mergeAdjacentHistoryEvents(events: CloudHistoryEvent[]): DisplayHistoryEvent[] {
  const merged: DisplayHistoryEvent[] = []

  for (const event of events) {
    const timeLabel = formatRelativeTime(event.createdAt)
    const textLabel = getHistoryLabel(event)
    const previous = merged.length > 0 ? merged[merged.length - 1] : undefined

    if (!previous) {
      merged.push({ ...event, mergedCount: 1 })
      continue
    }

    const previousTimeLabel = formatRelativeTime(previous.createdAt)
    const previousTextLabel = getHistoryLabel(previous)
    const canMerge = previous.type === 'remote_tx' && event.type === 'remote_tx'
    const sameText = previousTextLabel === textLabel && previousTimeLabel === timeLabel

    if (canMerge && sameText) {
      previous.itemCount = (previous.itemCount || 0) + (event.itemCount || 0)
      previous.addedCount = (previous.addedCount || 0) + (event.addedCount || 0)
      previous.removedCount = (previous.removedCount || 0) + (event.removedCount || 0)
      previous.updatedCount = (previous.updatedCount || 0) + (event.updatedCount || 0)
      previous.createdAt = Math.max(previous.createdAt, event.createdAt)
      previous.mergedCount += 1
      continue
    }

    merged.push({ ...event, mergedCount: 1 })
  }

  return merged
}

const displayHistoryEvents = computed(() => mergeAdjacentHistoryEvents(historyEvents.value))

const onlineMembersNamesLine = computed(() => {
  const users = currentCloudScheme.value?.users ?? []
  if (users.length === 0) return ''
  return joinOnlineDisplayNames(users, cloudStore.clientId, t('cloudScheme.onlineMembersSeparator'))
})

function handleDisconnect() {
  disconnect()
  emit('update:open', false)
}

async function handleReconnect() {
  const scheme = editorStore.activeScheme
  if (!scheme || scheme.source.value !== 'cloud') return

  const roomCode = (scheme.cloudRoomCode.value || '').trim()
  if (!roomCode) {
    notification.error(t('cloudScheme.error.invalidRoomCode'))
    return
  }
  if (!getStoredDisplayName().trim()) {
    notification.error(t('cloudScheme.error.invalidDisplayName'))
    return
  }

  const ok = await reconnectActiveCloudScheme()
  if (!ok) {
    notification.error(t('cloudScheme.error.connectFailed'))
  }
}

async function handleSessionAction() {
  if (isLiveConnected.value) {
    handleDisconnect()
    return
  }
  if (isConnectingSession.value || !showReconnectAction.value) return
  await handleReconnect()
}
</script>

<template>
  <div v-if="currentCloudScheme" class="flex flex-col overflow-hidden py-2">
    <div class="px-4 pb-2">
      <div class="text-sm font-medium">{{ t('cloudScheme.title') }}</div>
      <div class="mt-0.5 text-xs text-muted-foreground">{{ t('cloudScheme.statusHint') }}</div>
    </div>

    <div class="flex items-center justify-between gap-2 px-4">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-8 max-w-64 min-w-0 flex-1 justify-start overflow-hidden font-mono text-sm tracking-[0.1em]"
            @click="copyShareCode"
          >
            <span class="min-w-0 flex-1 truncate text-left">{{ shareCode }}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent :side-offset="4">
          {{ t('cloudScheme.copyCode') }}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="secondary"
            size="sm"
            class="h-8 px-2 text-xs font-medium"
            :class="statusButtonClass"
            :disabled="isConnectingSession"
            @click="handleSessionAction"
          >
            {{ sessionActionLabel }}
          </Button>
        </TooltipTrigger>
        <TooltipContent :side-offset="4">
          {{ sessionActionTooltip }}
        </TooltipContent>
      </Tooltip>
    </div>

    <!-- 在线成员列表（仅在有成员时展示；断开时 users 为空，不显示占位文案） -->
    <div class="px-4 pt-4">
      <div v-if="currentCloudScheme.users.length > 0">
        <div class="text-xs text-muted-foreground">
          {{ t('cloudScheme.onlineUsers', { n: currentCloudScheme.users.length }) }}
        </div>
        <div class="flex items-center justify-between gap-2 rounded-sm py-1.5 text-sm">
          <span class="min-w-0 flex-1 text-xs">{{ onlineMembersNamesLine }}</span>
        </div>
      </div>
      <div v-if="pendingTransactionCount > 0" class="text-xs text-muted-foreground">
        {{ t('cloudScheme.pendingTransactions', { n: pendingTransactionCount }) }}
      </div>
      <div v-if="hasStaleUndo" class="text-xs text-amber-600 dark:text-amber-400">
        {{ t('cloudScheme.undoStale') }}
      </div>
    </div>

    <!-- 同步历史 -->
    <div class="px-4 pt-4">
      <div class="text-xs text-muted-foreground">{{ t('cloudScheme.history.title') }}</div>
    </div>

    <ScrollArea class="max-h-48">
      <div class="px-2 pb-2">
        <div
          v-if="displayHistoryEvents.length === 0"
          class="px-2 py-4 text-center text-xs text-muted-foreground"
        >
          {{ t('cloudScheme.history.empty') }}
        </div>
        <div
          v-for="event in displayHistoryEvents"
          :key="event.id"
          class="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
        >
          <span class="min-w-0 flex-1 truncate text-xs">
            {{ getHistoryLabel(event) }}
          </span>
          <span class="shrink-0 text-xs text-muted-foreground">
            {{ formatRelativeTime(event.createdAt) }}
          </span>
        </div>
      </div>
      <ScrollBar orientation="vertical" />
    </ScrollArea>
  </div>
</template>

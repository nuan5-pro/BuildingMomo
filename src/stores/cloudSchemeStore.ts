import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CloudHistoryEvent, CloudPresenceUser } from '@/types/cloudScheme'

export type CloudSchemeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'conflict'
  | 'error'
  | 'disconnected'

export const useCloudSchemeStore = defineStore('cloudScheme', () => {
  const MAX_HISTORY_EVENTS = 50
  const roomCode = ref<string | null>(null)
  const schemeId = ref<string | null>(null)
  const clientId = ref<string | null>(null)
  const revision = ref(0)
  const status = ref<CloudSchemeStatus>('idle')
  const users = ref<CloudPresenceUser[]>([])
  const historyEvents = ref<CloudHistoryEvent[]>([])
  const lastError = ref<string | null>(null)

  const isConnected = computed(() => status.value === 'connected' || status.value === 'syncing')
  const activeUserCount = computed(() => users.value.length)

  function startSession(payload: {
    roomCode: string
    schemeId: string
    clientId: string
    revision: number
  }) {
    roomCode.value = payload.roomCode
    schemeId.value = payload.schemeId
    clientId.value = payload.clientId
    revision.value = payload.revision
    status.value = 'connecting'
    lastError.value = null
  }

  function setError(message: string) {
    lastError.value = message
    status.value = 'error'
  }

  function appendHistoryEvent(event: CloudHistoryEvent) {
    historyEvents.value = [event, ...historyEvents.value].slice(0, MAX_HISTORY_EVENTS)
  }

  function clearHistoryEvents() {
    historyEvents.value = []
  }

  function clearSession() {
    roomCode.value = null
    schemeId.value = null
    clientId.value = null
    revision.value = 0
    status.value = 'idle'
    users.value = []
    clearHistoryEvents()
    lastError.value = null
  }

  return {
    roomCode,
    schemeId,
    clientId,
    revision,
    status,
    users,
    historyEvents,
    lastError,
    isConnected,
    activeUserCount,
    startSession,
    setError,
    appendHistoryEvent,
    clearHistoryEvents,
    clearSession,
  }
})

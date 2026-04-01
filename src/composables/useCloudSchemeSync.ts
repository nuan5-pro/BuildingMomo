import { computed, ref, triggerRef, watch } from 'vue'
import { collectTransactionTouchedItemIds } from '@/lib/editorTransactions'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useNotification } from '@/composables/useNotification'
import { useI18n } from '@/composables/useI18n'
import { applyEditorTransactionToScheme } from '@/lib/editorTransactions'
import { buildSharedSchemeSnapshot } from '@/lib/schemeSnapshot'
import type {
  CloudSchemeDocument,
  CloudSnapshotResponse,
  CloudWsIncomingMessage,
  CreateCloudSchemeResponse,
} from '@/types/cloudScheme'

const DISPLAY_NAME_STORAGE_KEY = 'cloud_scheme_display_name'

let socket: WebSocket | null = null
let stopTransactionWatch: (() => void) | null = null
const isApplyingRemoteUpdate = ref(false)
const inFlightTransactionId = ref<string | null>(null)

function createClientId() {
  return crypto.randomUUID()
}

function normalizeDisplayName(value?: string) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRoomCode(value?: string) {
  return typeof value === 'string' ? value.trim() : ''
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
  }
  return data as T
}

export function useCloudSchemeSync() {
  const editorStore = useEditorStore()
  const cloudStore = useCloudSchemeStore()
  const { markTransactionCommitted, markTransactionsStale } = useEditorHistory()
  const notification = useNotification()
  const { t } = useI18n()

  const currentCloudScheme = computed(() => {
    const scheme = editorStore.activeScheme
    if (!scheme || scheme.source.value !== 'cloud') {
      return null
    }

    return {
      schemeId: scheme.id,
      roomCode: scheme.cloudRoomCode.value || cloudStore.roomCode,
      status: cloudStore.schemeId === scheme.id ? cloudStore.status : 'disconnected',
      users: cloudStore.schemeId === scheme.id ? cloudStore.users : [],
    }
  })

  const shareCode = computed(() => currentCloudScheme.value?.roomCode || '')

  function getStoredDisplayName() {
    return localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || ''
  }

  function setStoredDisplayName(name: string) {
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name)
  }

  /**
   * 监听本地事务变更的 Watcher
   * 当历史记录模块产生一条新的提交时，`transactionVersion` 会跳变，
   * 进而触发 `flushPendingTransactions` 尝试把这笔账单发往云端。
   */
  function ensureTransactionWatcher() {
    if (stopTransactionWatch) return

    stopTransactionWatch = watch(
      [
        () => editorStore.transactionVersion,
        () => cloudStore.revision,
        () => cloudStore.status,
        () => cloudStore.schemeId,
      ],
      () => {
        void flushPendingTransactions()
      },
      { immediate: true }
    )
  }

  function stopTransactionWatcher() {
    stopTransactionWatch?.()
    stopTransactionWatch = null
  }

  async function applyRemoteDocument(document: CloudSchemeDocument) {
    isApplyingRemoteUpdate.value = true
    inFlightTransactionId.value = null

    try {
      let schemeId = cloudStore.schemeId
      if (!schemeId) {
        schemeId = editorStore.openCloudSchemeSnapshot(document.scheme, document.roomCode)
      } else {
        const replaced = editorStore.replaceSchemeSnapshot(schemeId, document.scheme, {
          preserveViewState: true,
        })
        if (!replaced) {
          schemeId = editorStore.openCloudSchemeSnapshot(document.scheme, document.roomCode)
        }
      }

      editorStore.clearPendingTransactions(schemeId)
      editorStore.setSchemeCloudMeta(schemeId, {
        source: 'cloud',
        cloudRoomCode: document.roomCode,
      })
      cloudStore.schemeId = schemeId
      cloudStore.revision = document.revision
      cloudStore.status = 'connected'
    } finally {
      isApplyingRemoteUpdate.value = false
    }
  }

  /**
   * 接收来自其他使用者的远程事务快照更新事件。
   * 此方法被用来接收从远端直接“空降”过来的 `applyEditorTransactionToScheme` 补丁，并将其应用。
   */
  function applyCommittedTransaction(transaction: { schemeId: string; ops: unknown[] }) {
    const scheme = editorStore.getSchemeById(transaction.schemeId)
    if (!scheme) return

    isApplyingRemoteUpdate.value = true
    try {
      applyEditorTransactionToScheme(scheme, transaction as never)
      triggerRef(scheme.groupOrigins) // 原点关系的改动单独触发强刷新
      editorStore.triggerSceneUpdate()
    } finally {
      isApplyingRemoteUpdate.value = false
    }
  }

  /**
   * 将当前挂起等待（Pending）发往云端的编辑操作发送给 WebSocket。
   * 同一台电脑、同一时间绝对不能有第二笔交易正在“飞行中”，必须等到对方应答（Ack）或发生冲突（Conflict/Reset）。
   */
  async function flushPendingTransactions() {
    if (isApplyingRemoteUpdate.value) return
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (!cloudStore.isConnected || !cloudStore.schemeId) return
    if (inFlightTransactionId.value) return

    // 通过队列取出第一条待发送事务
    const transaction = editorStore.peekPendingTransaction(cloudStore.schemeId)
    if (!transaction) return

    inFlightTransactionId.value = transaction.id
    cloudStore.status = 'syncing'
    socket.send(
      JSON.stringify({
        type: 'push_tx',
        clientId: cloudStore.clientId,
        baseRevision: cloudStore.revision,
        transaction,
      })
    )
  }

  function handleIncomingMessage(raw: string) {
    const message = JSON.parse(raw) as CloudWsIncomingMessage

    switch (message.type) {
      case 'hello':
        cloudStore.revision = message.revision
        cloudStore.status = 'connected'
        void flushPendingTransactions()
        return
      case 'presence':
        cloudStore.users = message.users
        return
      case 'error':
        cloudStore.setError(message.message)
        notification.error(message.message)
        return
      case 'reset':
        if (cloudStore.schemeId) {
          editorStore.clearPendingTransactions(cloudStore.schemeId)
        }
        inFlightTransactionId.value = null
        void applyRemoteDocument(message.document)
        cloudStore.status = 'conflict'
        notification.warning(t('cloudScheme.toast.conflict'))
        return
      case 'snapshot':
        void applyRemoteDocument(message.document)
        return
      case 'tx_committed':
        cloudStore.revision = message.revision
        cloudStore.status = 'connected'
        applyCommittedTransaction(message.transaction)

        if (message.authorClientId === cloudStore.clientId) {
          editorStore.acknowledgePendingTransaction(message.transaction.id)
          markTransactionCommitted(message.transaction.schemeId, message.transaction.id)
          inFlightTransactionId.value = null
        }

        if (message.authorClientId !== cloudStore.clientId) {
          markTransactionsStale(
            message.transaction.schemeId,
            collectTransactionTouchedItemIds(message.transaction)
          )
          notification.info(t('cloudScheme.toast.remoteUpdated'))
        }

        void flushPendingTransactions()
        return
    }
  }

  async function connectSocket(params: {
    roomCode: string
    clientId: string
    displayName: string
  }) {
    if (socket) {
      socket.close()
      socket = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/cloud-schemes/ws?code=${encodeURIComponent(params.roomCode)}&clientId=${encodeURIComponent(params.clientId)}&displayName=${encodeURIComponent(params.displayName)}`

    await new Promise<void>((resolve, reject) => {
      const nextSocket = new WebSocket(wsUrl)
      let settled = false

      nextSocket.addEventListener('open', () => {
        socket = nextSocket
        if (!settled) {
          settled = true
          resolve()
        }
      })

      nextSocket.addEventListener('message', (event) => {
        handleIncomingMessage(event.data)
      })

      nextSocket.addEventListener('close', () => {
        if (socket === nextSocket) {
          socket = null
          inFlightTransactionId.value = null
          if (cloudStore.roomCode) {
            cloudStore.status = 'disconnected'
          }
        }
      })

      nextSocket.addEventListener('error', () => {
        if (!settled) {
          settled = true
          reject(new Error('WebSocket connection failed'))
        }
        cloudStore.setError(t('cloudScheme.error.connectFailed'))
      })
    })
  }

  async function startSession(params: {
    roomCode: string
    schemeId: string
    revision: number
    displayName: string
  }) {
    const clientId = createClientId()
    cloudStore.startSession({
      roomCode: params.roomCode,
      schemeId: params.schemeId,
      clientId,
      revision: params.revision,
    })
    ensureTransactionWatcher()
    await connectSocket({
      roomCode: params.roomCode,
      clientId,
      displayName: params.displayName,
    })
  }

  async function createRoom(options: { roomCode?: string; displayName: string }) {
    if (!editorStore.activeScheme) {
      notification.warning(t('cloudScheme.error.noActiveScheme'))
      return null
    }

    const roomCode = normalizeRoomCode(options.roomCode)
    const displayName = normalizeDisplayName(options.displayName)
    if (!displayName) {
      notification.error(t('cloudScheme.error.invalidDisplayName'))
      return null
    }

    setStoredDisplayName(displayName)

    const data = await requestJson<CreateCloudSchemeResponse>('/api/cloud-schemes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomCode: roomCode || undefined,
        snapshot: buildSharedSchemeSnapshot(editorStore.activeScheme),
      }),
    })

    disconnect(false)
    const schemeId = editorStore.normalizeSchemeAsCloudRoom(
      editorStore.activeScheme.id,
      data.roomCode,
      {
        resetHistory: true,
      }
    )
    if (!schemeId) {
      throw new Error('Failed to normalize cloud scheme identity')
    }

    await startSession({
      roomCode: data.roomCode,
      schemeId,
      revision: data.document.revision,
      displayName,
    })

    notification.success(t('cloudScheme.toast.created'))
    return data.roomCode
  }

  async function joinRoom(options: { roomCode: string; displayName: string }) {
    const roomCode = normalizeRoomCode(options.roomCode)
    const displayName = normalizeDisplayName(options.displayName)

    if (!roomCode) {
      notification.error(t('cloudScheme.error.invalidRoomCode'))
      return null
    }

    if (!displayName) {
      notification.error(t('cloudScheme.error.invalidDisplayName'))
      return null
    }

    setStoredDisplayName(displayName)

    const data = await requestJson<CloudSnapshotResponse>('/api/cloud-schemes/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomCode }),
    })

    disconnect(false)
    const schemeId = editorStore.openCloudSchemeSnapshot(data.document.scheme, roomCode)
    editorStore.setSchemeCloudMeta(schemeId, {
      source: 'cloud',
      cloudRoomCode: roomCode,
    })

    await startSession({
      roomCode,
      schemeId,
      revision: data.document.revision,
      displayName,
    })

    notification.success(t('cloudScheme.toast.joined'))
    return roomCode
  }

  async function copyShareCode() {
    if (!shareCode.value) return false
    await navigator.clipboard.writeText(shareCode.value)
    notification.success(t('cloudScheme.toast.codeCopied'))
    return true
  }

  async function reconnectActiveCloudScheme() {
    const scheme = editorStore.activeScheme
    if (!scheme || scheme.source.value !== 'cloud') {
      return false
    }

    const roomCode = normalizeRoomCode(scheme.cloudRoomCode.value)
    const displayName = normalizeDisplayName(getStoredDisplayName())
    if (!roomCode || !displayName) {
      return false
    }

    try {
      const data = await requestJson<CloudSnapshotResponse>('/api/cloud-schemes/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomCode }),
      })

      disconnect(false)
      const schemeId = editorStore.openCloudSchemeSnapshot(data.document.scheme, roomCode)
      editorStore.setSchemeCloudMeta(schemeId, {
        source: 'cloud',
        cloudRoomCode: roomCode,
      })

      await startSession({
        roomCode,
        schemeId,
        revision: data.document.revision,
        displayName,
      })

      return true
    } catch (error) {
      console.warn('[CloudScheme] Auto reconnect failed:', error)
      return false
    }
  }

  function disconnect(showToast = true) {
    if (socket) {
      socket.close()
      socket = null
    }

    if (cloudStore.schemeId) {
      editorStore.clearPendingTransactions(cloudStore.schemeId)
    }

    inFlightTransactionId.value = null
    stopTransactionWatcher()
    const hadSession = !!cloudStore.roomCode
    cloudStore.clearSession()

    if (hadSession && showToast) {
      notification.info(t('cloudScheme.toast.disconnected'))
    }
  }

  return {
    currentCloudScheme,
    shareCode,
    isApplyingRemoteUpdate: computed(() => isApplyingRemoteUpdate.value),
    createRoom,
    joinRoom,
    copyShareCode,
    reconnectActiveCloudScheme,
    disconnect,
    getStoredDisplayName,
  }
}

import type { AppItem, EditorTransaction } from './editor'

export interface SharedSchemeSnapshot {
  name: string
  filePath?: string
  lastModified?: number
  items: AppItem[]
  groupOrigins: Array<[number, string]>
}

export interface CloudSchemeDocument {
  roomCode: string
  revision: number
  updatedAt: number
  scheme: SharedSchemeSnapshot
}

export interface CloudPresenceUser {
  clientId: string
  displayName: string
  connectedAt: number
}

export interface CreateCloudSchemeResponse {
  roomCode: string
  document: CloudSchemeDocument
}

export interface CloudSnapshotResponse {
  document: CloudSchemeDocument
}

export interface CloudWsHelloMessage {
  type: 'hello'
  roomCode: string
  revision: number
}

export interface CloudWsSnapshotMessage {
  type: 'snapshot'
  document: CloudSchemeDocument
}

export interface CloudWsCommittedTransactionMessage {
  type: 'tx_committed'
  revision: number
  authorClientId: string
  transaction: EditorTransaction
}

export interface CloudWsResetMessage {
  type: 'reset'
  document: CloudSchemeDocument
  reason: 'version_mismatch'
}

export interface CloudWsPresenceMessage {
  type: 'presence'
  users: CloudPresenceUser[]
}

export interface CloudWsErrorMessage {
  type: 'error'
  message: string
}

export interface CloudWsPushTransactionMessage {
  type: 'push_tx'
  clientId: string
  baseRevision: number
  transaction: EditorTransaction
}

export type CloudWsIncomingMessage =
  | CloudWsHelloMessage
  | CloudWsSnapshotMessage
  | CloudWsCommittedTransactionMessage
  | CloudWsResetMessage
  | CloudWsPresenceMessage
  | CloudWsErrorMessage

export type CloudWsOutgoingMessage = CloudWsPushTransactionMessage

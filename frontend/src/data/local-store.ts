import { SEED_ROWS } from './seed'
import { MODULE_BY_KEY } from './modules'
import { DISCHARGE_KEY, EMPTY_REVIEW, deriveFlags } from '@/api/discharge-workflow'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧记录兼容：没有版本号的补版本号；流量记录补齐审核中间结论字段，并按受控状态重算标志位。
function migrateRows(key: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  const controlled = Boolean(meta?.transitions)
  return rows.map((row) => {
    if (!controlled) {
      return row.version === undefined ? { ...row, version: 1 } : row
    }
    const next: EntryRow = { ...row, version: Number(row.version ?? 1) }
    if (key === DISCHARGE_KEY) {
      for (const [field, value] of Object.entries(EMPTY_REVIEW)) {
        if (next[field] === undefined) {
          next[field] = value
        }
      }
    }
    const { pending, abnormal } = deriveFlags(String(next.status))
    next.pending = pending
    next.abnormal = abnormal
    return next
  })
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 老模块只有种子数据、新模块以浏览器里的改动为准，合并后统一做一次旧记录迁移。
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    const migrated: Record<string, EntryRow[]> = {}
    for (const [key, rows] of Object.entries(merged)) {
      migrated[key] = migrateRows(key, Array.isArray(rows) ? rows : [])
    }
    return migrated
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

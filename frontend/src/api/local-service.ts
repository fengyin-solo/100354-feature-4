import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import {
  COMPILATION_KEY,
  DISCHARGE_KEY,
  allowedActions,
  applyDischargePatch,
  deriveFlags,
  describeCompilationSync,
  syncCompilationTodo,
} from './discharge-workflow'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '退回']

export type RunActionOptions = {
  /** 提交方持有的记录版本：与当前版本不一致说明已被另一个入口先处理，本次提交作废。 */
  expectedVersion?: number
  /** 流量审核动作携带的业务数据。 */
  opinion?: string
  operator?: string
  time?: string
  method?: string
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function createEntry(key: string, values: Record<string, string | number | boolean>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const recordCode = String(values[meta.fields[0]] ?? '').trim()
  if (recordCode && rows.some((row) => String(row[meta.fields[0]] ?? '') === recordCode)) {
    return { ok: false, message: `${meta.fields[0]}「${recordCode}」已存在，不能重复登记` }
  }
  const initialStatus = meta.transitions ? meta.statuses[0] : meta.statuses[0]
  const flags = meta.transitions
    ? deriveFlags(initialStatus)
    : { pending: initialStatus !== meta.statuses[meta.statuses.length - 1], abnormal: false }
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: initialStatus,
    pending: flags.pending,
    abnormal: flags.abnormal,
    version: 1,
    ...values,
  }
  saveRows(key, [...rows, row])
  return { ok: true, message: `${meta.entity}已登记，当前状态「${initialStatus}」` }
}

export function runAction(key: string, id: number, action: string, options: RunActionOptions = {}): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  const rule = meta.transitions?.[action]
  if (!target && !rule) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  const currentVersion = Number(row.version ?? 1)

  // 并发判定优先：两个审核入口同时提交时，版本不匹配的一方作废，只接受第一个结果。
  // 必须先于状态门禁，否则后到的提交会被状态变化先拦下，丢失「并发冲突」语义。
  if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
    return {
      ok: false,
      conflict: true,
      message: `该记录已被另一个审核入口处理（当前状态「${current}」），本次提交未生效，请刷新后查看最新结论`,
    }
  }

  // 受控轨迹门禁：登记了 transitions 的模块，只允许从声明的源状态执行动作。
  if (rule && !rule.from.includes(current)) {
    return {
      ok: false,
      message: `「${action}」不可用：${meta.entity}当前为「${current}」，该动作仅允许在${rule.from.join('、')}状态下执行`,
    }
  }

  const nextStatus = rule ? rule.to ?? current : target
  let updated: EntryRow = { ...row }

  if (key === DISCHARGE_KEY) {
    updated = applyDischargePatch(updated, action, {
      opinion: options.opinion ?? '',
      operator: options.operator ?? '',
      time: options.time ?? '',
      method: options.method ?? '',
    })
  }

  if (nextStatus !== current) {
    updated.status = nextStatus
  }
  updated.version = currentVersion + 1
  if (meta.transitions) {
    const flags = deriveFlags(nextStatus)
    updated.pending = flags.pending
    updated.abnormal = flags.abnormal
  } else {
    const lastStatus = meta.statuses[meta.statuses.length - 1]
    updated.pending = nextStatus !== lastStatus
    updated.abnormal = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  }

  const next = [...rows]
  next[index] = updated

  let message: string
  if (rule && rule.to === null) {
    message = `${meta.entity}已${action}，状态仍为「${nextStatus}」`
  } else {
    message = `${meta.entity}已${action}，当前状态「${nextStatus}」`
  }

  // 流量审核通过后同步整编待办；退回异常或其他动作绝不产生整编待办。
  if (key === DISCHARGE_KEY && action === '确认通过') {
    const { rows: compilationRows, created } = syncCompilationTodo(listRows(COMPILATION_KEY), updated)
    saveRows(COMPILATION_KEY, compilationRows)
    message += describeCompilationSync(created)
  }
  saveRows(key, next)

  return { ok: true, message }
}

/** 当前记录允许执行的动作（受控模块按轨迹过滤），供页面禁用非法操作。 */
export function availableActions(key: string, status: string): string[] {
  const meta = moduleMeta(key)
  return allowedActions(meta, status)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

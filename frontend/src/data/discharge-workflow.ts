import { listRows, saveRows } from './local-store'
import type { ActionResult, EntryRow } from './types'

// 流量记录受控轨迹：已采集 →（送审）→ 待审核 →（确认通过 / 退回异常）→ 已通过 / 异常值
// 异常值更正重采后回到「已采集」，可再次送审。未通过（异常值、待审核、已采集）都不得进入整编。

export const DISCHARGE_KEY = 'discharge'
const COMPILATION_KEY = 'compilation'

export const DISCHARGE_STATUS = {
  collected: '已采集',
  reviewing: '待审核',
  approved: '已通过',
  abnormal: '异常值',
} as const

export const DISCHARGE_ACTIONS = {
  submit: '提交审核',
  approve: '确认通过',
  reject: '退回异常',
  revise: '更正重采',
} as const

// 流量测量字段：退回异常时这些原值一律保留，不允许清空。
export const MEASURE_FIELDS = ['测量方法', '断面流量', '最大流速', '过水面积', '测量时间'] as const

type ReviewDecision = typeof DISCHARGE_ACTIONS.approve | typeof DISCHARGE_ACTIONS.reject

type DraftRow = {
  站点编号: string
  测量方法: string
  断面流量: string
  最大流速: string
  过水面积: string
  测量时间: string
}

// 审核在途锁：两个审核入口（列表行内、审核工作台）并发提交时，同一条记录只接受第一个结果。
const reviewLocks = new Set<number>()

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function nextDischargeId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextRecordNo(rows: EntryRow[]): string {
  const seq = rows.length + 1
  const used = new Set(rows.map((row) => String(row['记录编号'] ?? '')))
  let candidate = `DISC-${String(seq).padStart(4, '0')}`
  let extra = seq
  while (used.has(candidate)) {
    extra += 1
    candidate = `DISC-${String(extra).padStart(4, '0')}`
  }
  return candidate
}

// 旧记录可能没有轨迹字段：读出来补齐默认值，只在内存里归一，不改动持久化原值。
export function normalizeDischarge(row: EntryRow): EntryRow {
  const status = String(row.status ?? DISCHARGE_STATUS.collected)
  return {
    ...row,
    status,
    pending: status !== DISCHARGE_STATUS.approved,
    abnormal: status === DISCHARGE_STATUS.abnormal,
    送审时间: row['送审时间'] ?? '',
    送审快照: row['送审快照'] ?? '',
    审核人: row['审核人'] ?? '',
    审核时间: row['审核时间'] ?? '',
    审核意见: row['审核意见'] ?? '',
    变更说明: row['变更说明'] ?? '',
    整编待办: row['整编待办'] ?? '',
  }
}

export function listDischarge(): EntryRow[] {
  return listRows(DISCHARGE_KEY).map(normalizeDischarge)
}

function persistDischarge(rows: EntryRow[]): void {
  saveRows(DISCHARGE_KEY, rows)
}

// 受控轨迹允许的来源状态：不满足就拒绝，保证「已采集才能送审、审核中只能出通过或退回」。
const SUBMIT_FROM: Set<string> = new Set([DISCHARGE_STATUS.collected])
const REVIEW_FROM: Set<string> = new Set([DISCHARGE_STATUS.reviewing])
const REVISE_FROM: Set<string> = new Set([DISCHARGE_STATUS.abnormal])

function findDischarge(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function snapshotText(row: EntryRow): string {
  return MEASURE_FIELDS.map((field) => `${field}=${row[field] ?? ''}`).join('；')
}

export function canSubmit(status: string): boolean {
  return SUBMIT_FROM.has(status)
}

export function canReview(status: string): boolean {
  return REVIEW_FROM.has(status)
}

export function canRevise(status: string): boolean {
  return REVISE_FROM.has(status)
}

export function createDischarge(draft: DraftRow, operator: string): ActionResult {
  const rows = listDischarge()
  const id = nextDischargeId(rows)
  const row: EntryRow = {
    id,
    status: DISCHARGE_STATUS.collected,
    pending: true,
    abnormal: false,
    记录编号: nextRecordNo(rows),
    站点编号: draft.站点编号.trim(),
    测量方法: draft.测量方法.trim(),
    断面流量: draft.断面流量.trim(),
    最大流速: draft.最大流速.trim(),
    过水面积: draft.过水面积.trim(),
    测量时间: draft.测量时间.trim(),
    记录状态: DISCHARGE_STATUS.collected,
    送审时间: '',
    送审快照: '',
    审核人: '',
    审核时间: '',
    审核意见: '',
    变更说明: '',
    整编待办: '',
  }
  persistDischarge([...rows, row])
  return { ok: true, message: `流量记录 ${row['记录编号']} 已登记为「${DISCHARGE_STATUS.collected}」，采集完成后才能送审` }
}

export function submitDischarge(id: number): ActionResult {
  const rows = listDischarge()
  const index = findDischarge(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的流量记录` }
  }
  const current = normalizeDischarge(rows[index])
  if (!canSubmit(String(current.status))) {
    return { ok: false, message: `当前状态「${current.status}」不能送审，只有「${DISCHARGE_STATUS.collected}」记录可提交审核` }
  }
  const updated: EntryRow = {
    ...current,
    status: DISCHARGE_STATUS.reviewing,
    pending: true,
    abnormal: false,
    记录状态: DISCHARGE_STATUS.reviewing,
    送审时间: nowText(),
    // 送审即冻结测量结论，审核期间改测量值不影响本次结论。
    送审快照: snapshotText(current),
    审核人: '',
    审核时间: '',
    审核意见: '',
  }
  const next = [...rows]
  next[index] = updated
  persistDischarge(next)
  return { ok: true, message: `记录 ${updated['记录编号']} 已送审，审核中只能「${DISCHARGE_ACTIONS.approve}」或「${DISCHARGE_ACTIONS.reject}」` }
}

function compilationTodoId(row: EntryRow): string {
  const station = String(row['站点编号'] ?? 'UNKNOWN').replace(/[^A-Za-z0-9]/g, '') || 'UNKNOWN'
  const year = String(row['测量时间'] ?? '').slice(0, 4) || 'NA'
  return `AUTO-${station}-${year}`
}

function yearOf(row: EntryRow): string {
  return String(row['测量时间'] ?? '').slice(0, 4)
}

// 确认通过后同步生成整编待办：按站点+年份归并，幂等可重复通过累加；待办一旦开始整编不被回退。
function syncCompilationTodo(rows: EntryRow[], approved: EntryRow): EntryRow[] {
  const todoId = String(approved['整编待办'] ?? '')
  if (!todoId) {
    return rows
  }
  const station = String(approved['站点编号'] ?? '')
  const year = yearOf(approved)
  const existing = rows.find((row) => String(row['成果编号']) === todoId)
  if (existing) {
    const count = Number(existing['原始记录数']) || 0
    // 已刊印也只累加原始记录数，不改整编状态，避免整编轨迹倒流。
    const status = String(existing.status) === '待整编' ? '待整编' : String(existing.status)
    return rows.map((row) =>
      String(row['成果编号']) === todoId
        ? { ...row, '原始记录数': count + 1, status, pending: status !== '已刊印' }
        : row,
    )
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const todo: EntryRow = {
    id,
    status: '待整编',
    pending: true,
    abnormal: false,
    成果编号: todoId,
    整编年份: year,
    站点编号: station,
    整编类型: '流量整编',
    原始记录数: 1,
    整编人: '',
    审核人: '',
    整编状态: '待整编',
    来源: '流量审核通过',
  }
  return [...rows, todo]
}

function commitReview(id: number, action: ReviewDecision, operator: string, opinion: string): ActionResult {
  // 落库前再次从存储读取，防止两个并发调用之间状态已经被另一个入口改掉。
  const rows = listDischarge()
  const index = findDischarge(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的流量记录` }
  }
  const current = normalizeDischarge(rows[index])
  if (!canReview(String(current.status))) {
    return { ok: false, message: `记录 ${current['记录编号']} 已不在审核中（当前「${current.status}」），以首次提交的审核结果为准` }
  }

  if (action === DISCHARGE_ACTIONS.approve) {
    const todoId = compilationTodoId(current)
    const updated: EntryRow = {
      ...current,
      status: DISCHARGE_STATUS.approved,
      pending: false,
      abnormal: false,
      记录状态: DISCHARGE_STATUS.approved,
      审核人: operator,
      审核时间: nowText(),
      审核意见: opinion.trim() || '审核通过',
      整编待办: todoId,
    }
    const nextDischargeRows = [...rows]
    nextDischargeRows[index] = updated
    persistDischarge(nextDischargeRows)
    saveRows(COMPILATION_KEY, syncCompilationTodo(listRows(COMPILATION_KEY), updated))
    return { ok: true, message: `记录 ${updated['记录编号']} 已确认通过，整编待办 ${todoId} 已同步生成` }
  }

  // 退回异常：清空审核中间结论（审核人/审核时间/审核意见），退回原因写入变更说明留痕；
  // 测量原值（MEASURE_FIELDS）与送审快照、送审时间一律保留。
  const cleared: EntryRow = {
    ...current,
    status: DISCHARGE_STATUS.abnormal,
    pending: true,
    abnormal: true,
    记录状态: DISCHARGE_STATUS.abnormal,
    审核人: '',
    审核时间: '',
    审核意见: '',
  }
  const rejectNote = `${nowText()} ${operator} 审核退回异常：${opinion.trim() || '未通过'}`
  cleared['变更说明'] = [
    ...String(current['变更说明'] ?? '').split('\n').filter(Boolean),
    rejectNote,
  ].join('\n')
  // 退回不得进入整编：清掉可能存在的整编待办关联（正常轨迹下此处为空）。
  cleared['整编待办'] = ''
  const nextDischargeRows = [...rows]
  nextDischargeRows[index] = cleared
  persistDischarge(nextDischargeRows)
  return { ok: true, message: `记录 ${cleared['记录编号']} 已退回异常，测量原值保留，可更正后重新采集送审` }
}

// 审核入口统一走这里：先抢在途锁，抢不到说明另一个入口正在提交，直接拒绝第二个结果。
export function reviewDischarge(
  id: number,
  action: ReviewDecision,
  operator: string,
  opinion = '',
): ActionResult {
  if (reviewLocks.has(id)) {
    return { ok: false, message: '该记录正在由另一个审核入口提交，本次并发操作不予接受' }
  }
  reviewLocks.add(id)
  try {
    return commitReview(id, action, operator, opinion)
  } finally {
    reviewLocks.delete(id)
  }
}

type MeasurePatch = Partial<Record<(typeof MEASURE_FIELDS)[number], string>>

// 测量更正：只允许在「已采集 / 异常值」上改测量字段；审核中锁定。
// 测量方法更换不回写既有过水面积：过水面积原样保留，仅把更换情况记入变更说明（兼容旧记录）。
export function reviseMeasure(
  id: number,
  patch: MeasurePatch,
  operator: string,
  changeNote = '',
): ActionResult {
  const rows = listDischarge()
  const index = findDischarge(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的流量记录` }
  }
  const current = normalizeDischarge(rows[index])
  const status = String(current.status)
  if (status === DISCHARGE_STATUS.reviewing) {
    return { ok: false, message: `记录 ${current['记录编号']} 审核中，测量值已随送审冻结，不能修改` }
  }
  if (status === DISCHARGE_STATUS.approved) {
    return { ok: false, message: `记录 ${current['记录编号']} 已审核通过并入整编轨迹，不能直接改测` }
  }

  const updated: EntryRow = { ...current }
  const notes: string[] = []
  for (const field of MEASURE_FIELDS) {
    const value = patch[field]
    if (value === undefined) {
      continue
    }
    const trimmed = value.trim()
    const before = String(current[field] ?? '')
    if (trimmed !== before) {
      notes.push(`${operator} 将${field}「${before}」更正为「${trimmed}」`)
      updated[field] = trimmed
    }
  }

  // 更换测量方法：既有过水面积保持原值，不随方法重算回写。
  const methodChanged = patch['测量方法'] !== undefined && patch['测量方法'].trim() !== String(current['测量方法'] ?? '')
  if (methodChanged) {
    notes.push(`测量方法更换，既有过水面积「${current['过水面积'] ?? ''}」保留原值，不回写`)
  }
  if (changeNote.trim()) {
    notes.push(changeNote.trim())
  }

  // 异常值更正后视为重新采集：回到轨迹起点，清掉上一轮审核中间结论。
  const backToCollected = status === DISCHARGE_STATUS.abnormal
  updated.status = backToCollected ? DISCHARGE_STATUS.collected : status
  updated['记录状态'] = updated.status
  updated.pending = updated.status !== DISCHARGE_STATUS.approved
  updated.abnormal = updated.status === DISCHARGE_STATUS.abnormal
  if (backToCollected) {
    updated['送审时间'] = ''
    updated['送审快照'] = ''
    updated['审核人'] = ''
    updated['审核时间'] = ''
    updated['审核意见'] = ''
    updated['整编待办'] = ''
    notes.push('异常已更正，记录重新进入「已采集」')
  }
  updated['变更说明'] = [...String(current['变更说明'] ?? '').split('\n').filter(Boolean), ...notes].join('\n')

  const next = [...rows]
  next[index] = updated
  persistDischarge(next)
  return { ok: true, message: `记录 ${updated['记录编号']} 测量信息已更新，过水面积保留原值` }
}

// 旧记录迁移专用：待办缺失才补建；已存在（上一轮迁移或实时通过已建）则原样保留，保证迁移幂等。
function backfillCompilationTodo(rows: EntryRow[], approved: EntryRow): EntryRow[] {
  const todoId = String(approved['整编待办'] ?? '')
  if (!todoId || rows.some((row) => String(row['成果编号']) === todoId)) {
    return rows
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  return [
    ...rows,
    {
      id,
      status: '待整编',
      pending: true,
      abnormal: false,
      成果编号: todoId,
      整编年份: yearOf(approved),
      站点编号: String(approved['站点编号'] ?? ''),
      整编类型: '流量整编',
      原始记录数: 1,
      整编人: '',
      审核人: '',
      整编状态: '待整编',
      来源: '流量审核通过',
    },
  ]
}

// 一次性迁移旧记录：补齐轨迹字段、按状态重建待办/异常标记，并为历史已通过记录补建整编待办。
// 只增不改：已有的轨迹字段和整编行保持不动，兼容播种数据与早期 localStorage。
export function migrateDischargeLegacy(operator = '系统迁移'): void {
  const dischargeRows = listRows(DISCHARGE_KEY)
  const migrated = dischargeRows.map((raw) => {
    const row = normalizeDischarge(raw)
    const status = String(row.status)
    // 记录状态列与受控 status 同义：旧记录里的示例文案统一对齐到受控状态。
    const normalized: EntryRow = {
      ...row,
      pending: status !== DISCHARGE_STATUS.approved,
      abnormal: status === DISCHARGE_STATUS.abnormal,
      记录状态: status,
    }
    if (status === DISCHARGE_STATUS.reviewing && !normalized['送审快照']) {
      normalized['送审快照'] = snapshotText(row)
      normalized['送审时间'] = normalized['送审时间'] || '历史数据补录'
    }
    if (status === DISCHARGE_STATUS.approved && !normalized['整编待办']) {
      normalized['整编待办'] = compilationTodoId(row)
      if (!normalized['审核人']) {
        normalized['审核人'] = operator
      }
      if (!normalized['审核时间']) {
        normalized['审核时间'] = '历史数据补录'
      }
    }
    return normalized
  })

  const changed = migrated.some((row, index) => JSON.stringify(row) !== JSON.stringify(dischargeRows[index]))
  if (changed) {
    persistDischarge(migrated)
  }

  // 为历史已通过记录补建整编待办（幂等：成果编号已存在则原样保留，不重复计数）。
  const compilationRows = [...listRows(COMPILATION_KEY)]
  let nextCompilationRows = compilationRows
  for (const row of migrated.filter((item) => String(item.status) === DISCHARGE_STATUS.approved)) {
    nextCompilationRows = backfillCompilationTodo(nextCompilationRows, row)
  }
  if (nextCompilationRows.length !== compilationRows.length) {
    saveRows(COMPILATION_KEY, nextCompilationRows)
  }
}

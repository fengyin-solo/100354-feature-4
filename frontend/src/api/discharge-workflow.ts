import type { ActionResult, EntryRow, ModuleMeta } from '@/data/types'

// 流量记录受控轨迹专用规则：服务层的通用流转在这里取流量模块特有的判定与副作用。

export const DISCHARGE_KEY = 'discharge'
export const COMPILATION_KEY = 'compilation'

/** 审核过程产生的「中间结论」字段：退回异常时清空，原始测量值一律保留。 */
const REVIEW_FIELDS = ['审核意见', '审核人', '审核时间'] as const

/** 审核结论字段在登记新记录时就写入空值，旧记录没有这些字段时按空值兼容。 */
export const EMPTY_REVIEW: Record<string, string> = {
  审核意见: '',
  审核人: '',
  审核时间: '',
}

const ABNORMAL_STATUS = '异常值'
const PASSED_STATUS = '已通过'

/** 依据状态推导待处理/异常标志，旧记录的标志位不再直接信任。 */
export function deriveFlags(status: string): { pending: boolean; abnormal: boolean } {
  return { pending: status !== PASSED_STATUS, abnormal: status === ABNORMAL_STATUS }
}

/** 该记录当前允许执行的动作：按受控轨迹的源状态过滤，页面按它渲染按钮。 */
export function allowedActions(meta: ModuleMeta, status: string): string[] {
  return meta.actions.filter((action) => {
    const rule = meta.transitions?.[action]
    return rule ? rule.from.includes(status) : true
  })
}

/** 更换测量方法时的取值约定：只改测量方法，既有过水面积与实测值一律不回写。 */
export function mergeMethodChange(current: EntryRow, method: string): EntryRow {
  return { ...current, 测量方法: method }
}

/**
 * 应用动作对业务字段的修改：
 * - 送审：不产生结论；
 * - 确认通过：写入审核意见/审核人/审核时间等中间结论；
 * - 退回异常：清空中间结论，断面流量、最大流速、过水面积等原值保留；
 * - 更换测量方法：不动测量数据。
 */
export function applyDischargePatch(
  row: EntryRow,
  action: string,
  values: { opinion: string; operator: string; time: string; method: string },
): EntryRow {
  if (action === '确认通过') {
    return {
      ...row,
      审核意见: values.opinion || '审核通过',
      审核人: values.operator,
      审核时间: values.time,
    }
  }
  if (action === '退回异常') {
    // 退回即清空全部中间结论（含审核意见/审核人/审核时间）；退回原因只在操作回执里即时反馈，不落审核结论。
    const cleared: Record<string, string> = {}
    for (const field of REVIEW_FIELDS) {
      cleared[field] = ''
    }
    return { ...row, ...cleared }
  }
  if (action === '更换测量方法') {
    return mergeMethodChange(row, values.method)
  }
  return row
}

function yearOf(time: string): string {
  return String(time ?? '').slice(0, 4) || String(new Date().getFullYear())
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 流量记录确认通过后，把整编待办同步进整编模块：
 * 同站点同年度且仍处于「待整编」的待办做聚合，其余（已开始整编/已作废）不再回写，
 * 保证只有审核通过的记录会进入整编。
 */
export function syncCompilationTodo(
  compilationRows: EntryRow[],
  record: EntryRow,
): { rows: EntryRow[]; created: boolean } {
  const station = String(record['站点编号'] ?? '')
  const year = yearOf(String(record['测量时间'] ?? ''))
  const sourceId = String(record.id)
  const 成果编号 = `COMP-${year}-${station.replace(/[^A-Za-z0-9]/g, '') || 'STATION'}`

  const existing = compilationRows.find(
    (row) => row.status === '待整编' && String(row['成果编号'] ?? '') === 成果编号,
  )
  if (existing) {
    const sources = String(existing['_来源记录'] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (sources.includes(sourceId)) {
      return { rows: compilationRows, created: false }
    }
    const next = compilationRows.map((row) =>
      row === existing
        ? {
            ...row,
            原始记录数: sources.length + 1,
            _来源记录: [...sources, sourceId].join(','),
            version: Number(row.version ?? 1) + 1,
          }
        : row,
    )
    return { rows: next, created: false }
  }

  const created: EntryRow = {
    id: nextId(compilationRows),
    status: '待整编',
    pending: true,
    abnormal: false,
    version: 1,
    成果编号,
    整编年份: year,
    站点编号: station,
    整编类型: '流量整编',
    原始记录数: 1,
    整编人: '',
    审核人: '',
    整编状态: '',
    _来源记录: sourceId,
  }
  return { rows: [...compilationRows, created], created: true }
}

/** 组装服务层的返回消息，说明整编待办的同步结果。 */
export function describeCompilationSync(created: boolean): string {
  return created ? '，整编待办已同步生成' : '，已归入对应站点年度的整编待办'
}

export function notInReviewMessage(status: string): ActionResult {
  return {
    ok: false,
    message: `流量记录当前为「${status}」，只有待审核的记录才能确认通过或退回异常`,
  }
}

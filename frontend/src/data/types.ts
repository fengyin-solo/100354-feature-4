/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 乐观锁版本：每次受控流转 +1，两个审核入口并发提交时只接受版本匹配的那一个。 */
  version?: number
  [field: string]: string | number | boolean | undefined
}

/** 单条受控流转规则：from 为允许执行该动作的源状态；to 为 null 表示动作不改变状态。 */
export type TransitionRule = {
  from: string[]
  to: string | null
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 登记了受控轨迹的模块才做状态门禁；没登记的模块保持旧的自由流转。 */
  transitions?: Record<string, TransitionRule>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 版本不匹配导致的并发冲突：页面应提示刷新而非当作普通失败。 */
  conflict?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

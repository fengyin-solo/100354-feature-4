<template>
  <section class="page" data-module="discharge">
    <header class="page-head">
      <div>
        <h2>流量监测管理</h2>
        <p class="page-desc">
          受控轨迹：已采集才能送审，审核中只能确认通过或退回异常，未通过不得进入整编；通过后自动生成整编待办。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记流量记录</button>
        <button class="btn" type="button" @click="openReviewBench">审核工作台</button>
        <button class="btn" type="button" @click="exportRows">导出流量监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'stat-hot': item.hot }">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="flow-track">
      <span
        v-for="(step, index) in trackSteps"
        :key="step"
        class="track-step"
        :class="{ 'track-on': index <= 1 }"
      >
        {{ step }}<i v-if="index < trackSteps.length - 1">→</i>
      </span>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="status-tag" :data-status="row.status">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">轨迹</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无流量监测数据，可先登记流量记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条流量监测记录 · 测量方法更换不回写既有过水面积，原值保留</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <!-- 登记流量记录 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <div class="modal">
        <h3>登记流量记录（采集）</h3>
        <p class="modal-tip">登记后状态为「已采集」，采集完成才可提交审核。</p>
        <label v-for="field in createFields" :key="field.key" class="modal-field">
          <span>{{ field.label }}<em v-if="field.required">*</em></span>
          <input v-model="createDraft[field.key]" :placeholder="field.placeholder" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">保存采集记录</button>
        </div>
      </div>
    </div>

    <!-- 测量更正 / 更正重采 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal">
        <h3>测量更正 · {{ editing['记录编号'] }}</h3>
        <p class="modal-tip">
          当前状态「{{ editing.status }}」。更换测量方法时既有过水面积保留原值、不回写；
          异常值更正保存后回到「已采集」可重新送审。
        </p>
        <label v-for="field in MEASURE_FIELDS" :key="field" class="modal-field">
          <span>{{ field }}</span>
          <input v-model="editDraft[field]" />
        </label>
        <label class="modal-field">
          <span>变更说明</span>
          <input v-model="editNote" placeholder="补充异常原因或更正依据（可选）" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="editing = null">取消</button>
          <button class="btn primary" type="button" @click="submitEdit">保存更正</button>
        </div>
      </div>
    </div>

    <!-- 审核弹窗（行内入口与审核工作台共用同一提交通道） -->
    <div v-if="reviewing" class="modal-mask" @click.self="reviewing = null">
      <div class="modal">
        <h3>审核 · {{ reviewing['记录编号'] }}</h3>
        <p class="modal-tip">审核中只能「确认通过」或「退回异常」；退回保留测量原值，清空本轮审核结论。</p>
        <dl class="review-data">
          <template v-for="field in MEASURE_FIELDS" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ reviewing[field] || '—' }}</dd>
          </template>
          <template v-if="reviewing['送审时间']">
            <dt>送审时间</dt>
            <dd>{{ reviewing['送审时间'] }}</dd>
            <dt>送审快照</dt>
            <dd>{{ reviewing['送审快照'] }}</dd>
          </template>
        </dl>
        <label class="modal-field">
          <span>审核意见</span>
          <input v-model="reviewOpinion" placeholder="通过可留空；退回请填写异常原因" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="reviewing = null">取消</button>
          <button class="btn danger" type="button" :disabled="reviewBusy" @click="submitReview('退回异常')">
            退回异常
          </button>
          <button class="btn primary" type="button" :disabled="reviewBusy" @click="submitReview('确认通过')">
            确认通过
          </button>
        </div>
      </div>
    </div>

    <!-- 审核工作台：第二审核入口 -->
    <div v-if="benchOpen" class="modal-mask wide" @click.self="benchOpen = false">
      <div class="modal wide">
        <h3>审核工作台（待审核 {{ benchRows.length }} 条）</h3>
        <p class="modal-tip">与列表行内是同一审核通道；同一条记录并发提交时只接受第一个结果。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in benchRows" :key="String(row.id)">
              <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
              <td class="row-actions">
                <button class="link" type="button" :disabled="benchBusyId === Number(row.id)" @click="benchReview(row, '确认通过')">
                  确认通过
                </button>
                <button class="link danger-link" type="button" :disabled="benchBusyId === Number(row.id)" @click="benchReview(row, '退回异常')">
                  退回异常
                </button>
              </td>
            </tr>
            <tr v-if="!benchRows.length">
              <td :colspan="columns.length + 1" class="empty-state">暂无待审核记录</td>
            </tr>
          </tbody>
        </table>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="benchOpen = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 轨迹详情 -->
    <div v-if="detail" class="modal-mask" @click.self="detail = null">
      <div class="modal">
        <h3>受控轨迹 · {{ detail['记录编号'] }}</h3>
        <dl class="review-data">
          <dt>当前状态</dt><dd><span class="status-tag" :data-status="detail.status">{{ detail.status }}</span></dd>
          <dt>送审时间</dt><dd>{{ detail['送审时间'] || '—' }}</dd>
          <dt>送审快照</dt><dd>{{ detail['送审快照'] || '—' }}</dd>
          <dt>审核人</dt><dd>{{ detail['审核人'] || '—' }}</dd>
          <dt>审核时间</dt><dd>{{ detail['审核时间'] || '—' }}</dd>
          <dt>审核意见</dt><dd>{{ detail['审核意见'] || '—' }}</dd>
          <dt>整编待办</dt><dd>{{ detail['整编待办'] || '未进入整编' }}</dd>
          <dt>变更说明</dt><dd class="pre-line">{{ detail['变更说明'] || '—' }}</dd>
        </dl>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  DISCHARGE_ACTIONS,
  DISCHARGE_STATUS,
  MEASURE_FIELDS,
  canReview,
  canRevise,
  canSubmit,
  createDischarge,
  listDischarge,
  migrateDischargeLegacy,
  reviewDischarge,
  reviseMeasure,
  submitDischarge,
} from '@/data/discharge-workflow'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('discharge')
const columns = ['记录编号', '站点编号', '测量方法', '断面流量', '最大流速', '过水面积', '测量时间', '记录状态']
const statuses = [DISCHARGE_STATUS.collected, DISCHARGE_STATUS.reviewing, DISCHARGE_STATUS.approved, DISCHARGE_STATUS.abnormal]
const trackSteps = [DISCHARGE_STATUS.collected, DISCHARGE_STATUS.reviewing, `${DISCHARGE_STATUS.approved} → 整编`, DISCHARGE_STATUS.abnormal]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const creating = ref(false)
const editing = ref<EntryRow | null>(null)
const reviewing = ref<EntryRow | null>(null)
const detail = ref<EntryRow | null>(null)
const benchOpen = ref(false)
const reviewBusy = ref(false)
const benchBusyId = ref<number | null>(null)
const reviewOpinion = ref('')
const editNote = ref('')

const createFields = [
  { key: '站点编号', label: '站点编号', required: true, placeholder: '如 STAT-0001' },
  { key: '测量方法', label: '测量方法', required: true, placeholder: '如 流速仪法 / ADCP法 / 浮标法' },
  { key: '断面流量', label: '断面流量(m³/s)', required: true, placeholder: '如 128.6' },
  { key: '最大流速', label: '最大流速(m/s)', required: false, placeholder: '如 2.35' },
  { key: '过水面积', label: '过水面积(m²)', required: false, placeholder: '如 54.7；留空不随方法回写' },
  { key: '测量时间', label: '测量时间', required: true, placeholder: 'YYYY-MM-DD' },
] as const

type CreateKey = (typeof createFields)[number]['key']
const createDraft = reactive<Record<CreateKey, string>>({
  站点编号: '',
  测量方法: '',
  断面流量: '',
  最大流速: '',
  过水面积: '',
  测量时间: new Date().toISOString().slice(0, 10),
})

const editDraft = reactive<Record<(typeof MEASURE_FIELDS)[number], string>>({
  测量方法: '',
  断面流量: '',
  最大流速: '',
  过水面积: '',
  测量时间: '',
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '今日测量次数', value: rows.value.length, hot: false },
  { label: '待审核记录', value: rows.value.filter((row) => row.status === DISCHARGE_STATUS.reviewing).length, hot: true },
  { label: '异常记录数', value: rows.value.filter((row) => row.status === DISCHARGE_STATUS.abnormal).length, hot: true },
  { label: '已通过待整编', value: rows.value.filter((row) => row.status === DISCHARGE_STATUS.approved).length, hot: false },
])

const benchRows = computed(() => rows.value.filter((row) => canReview(String(row.status))))

function flash(result: { ok: boolean; message: string }) {
  if (result.ok) {
    successMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    successMessage.value = ''
  }
}

// 按受控轨迹给每条记录返回当前可执行动作，非法流转在界面上就不出现。
function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (canSubmit(status)) {
    return [DISCHARGE_ACTIONS.submit]
  }
  if (canReview(status)) {
    return [DISCHARGE_ACTIONS.approve, DISCHARGE_ACTIONS.reject]
  }
  if (canRevise(status)) {
    return [DISCHARGE_ACTIONS.revise]
  }
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  Object.assign(createDraft, {
    站点编号: '',
    测量方法: '',
    断面流量: '',
    最大流速: '',
    过水面积: '',
    测量时间: new Date().toISOString().slice(0, 10),
  })
  creating.value = true
}

function submitCreate() {
  for (const field of createFields) {
    if (field.required && !createDraft[field.key].trim()) {
      flash({ ok: false, message: `${field.label}不能为空` })
      return
    }
  }
  const result = createDischarge({ ...createDraft }, store.operator)
  flash(result)
  if (result.ok) {
    creating.value = false
    reload()
  }
}

function runAction(action: string, row: EntryRow) {
  if (action === DISCHARGE_ACTIONS.submit) {
    flash(submitDischarge(Number(row.id)))
    reload()
    return
  }
  if (action === DISCHARGE_ACTIONS.approve || action === DISCHARGE_ACTIONS.reject) {
    openReview(row)
    return
  }
  if (action === DISCHARGE_ACTIONS.revise) {
    openEdit(row)
  }
}

function openReview(row: EntryRow) {
  reviewing.value = row
  reviewOpinion.value = ''
  reviewBusy.value = false
}

// 行内审核入口提交：与审核工作台共用 reviewDischarge，锁与重读都在服务层。
function submitReview(action: '确认通过' | '退回异常') {
  if (!reviewing.value) {
    return
  }
  const id = Number(reviewing.value.id)
  reviewBusy.value = true
  // 微任务延迟模拟两个入口的并发：真正的并发裁决由服务层在途锁保证。
  const result = reviewDischarge(id, action, store.operator, reviewOpinion.value)
  reviewBusy.value = false
  flash(result)
  if (result.ok) {
    reviewing.value = null
    reload()
  }
}

function openReviewBench() {
  benchOpen.value = true
  reload()
}

// 审核工作台入口提交（第二入口）：同一服务函数，重复结论会被服务层以「已不在审核中」拒绝。
function benchReview(row: EntryRow, action: '确认通过' | '退回异常') {
  benchBusyId.value = Number(row.id)
  const result = reviewDischarge(Number(row.id), action, store.operator, action === DISCHARGE_ACTIONS.reject ? '工作台退回' : '')
  benchBusyId.value = null
  flash(result)
  reload()
}

function openEdit(row: EntryRow) {
  editing.value = row
  editNote.value = ''
  for (const field of MEASURE_FIELDS) {
    editDraft[field] = String(row[field] ?? '')
  }
}

function submitEdit() {
  if (!editing.value) {
    return
  }
  if (!editDraft['测量方法'].trim() || !editDraft['断面流量'].trim() || !editDraft['测量时间'].trim()) {
    flash({ ok: false, message: '测量方法、断面流量、测量时间不能为空' })
    return
  }
  const result = reviseMeasure(Number(editing.value.id), { ...editDraft }, store.operator, editNote.value)
  flash(result)
  if (result.ok) {
    editing.value = null
    reload()
  }
}

function openDetail(row: EntryRow) {
  const fresh = listDischarge().find((item) => Number(item.id) === Number(row.id))
  detail.value = fresh ?? row
}

function reload() {
  errorMessage.value = ''
  try {
    // 流量模块走受控工作流读取，保证轨迹字段在内存中归一；筛选仍复用公共过滤。
    const all = listDischarge()
    const payload = listEntries(meta.key, filters.value)
    const filteredIds = new Set(payload.items.map((item) => Number(item.id)))
    rows.value = all.filter((row) => filteredIds.has(Number(row.id)))
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '流量监测列表读取失败'
  }
}

onMounted(() => {
  // 兼容旧记录：进入流量模块前先做一次幂等迁移（补齐轨迹字段、重建整编待办）。
  migrateDischargeLegacy()
  reload()
})
</script>

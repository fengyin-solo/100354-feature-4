<template>
  <section class="page" data-module="discharge">
    <header class="page-head">
      <div>
        <h2>流量监测管理</h2>
        <p class="page-desc">流量记录实行受控轨迹：已采集才能送审，审核中只能确认通过或退回异常，未通过不得进入整编；审核通过后自动同步整编待办。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记流量记录</button>
        <button class="btn" type="button" @click="exportRows">导出流量监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 审核入口一：待审核工作台，只呈现审核中的记录，只给「确认通过 / 退回异常」两个结论 -->
    <section class="review-desk">
      <h3 class="review-title">待审核工作台</h3>
      <p class="review-tip">仅待审核记录在此处理；与列表行内审核共用同一版本锁，两个入口并发提交只接受第一个结果。</p>
      <table v-if="reviewRows.length" class="data-table">
        <thead>
          <tr>
            <th>记录编号</th>
            <th>站点编号</th>
            <th>测量方法</th>
            <th>断面流量</th>
            <th>过水面积</th>
            <th>测量时间</th>
            <th>审核意见</th>
            <th class="review-col">审核结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="`desk-${String(row.id)}`">
            <td>{{ row['记录编号'] }}</td>
            <td>{{ row['站点编号'] }}</td>
            <td>{{ row['测量方法'] }}</td>
            <td>{{ row['断面流量'] }}</td>
            <td>{{ row['过水面积'] }}</td>
            <td>{{ row['测量时间'] }}</td>
            <td class="opinion-cell">
              <input
                v-model="opinions[String(row.id)]"
                placeholder="通过意见或退回原因（退回不落库）"
                :disabled="submittingId === row.id"
              />
            </td>
            <td class="row-actions review-col">
              <button
                class="btn small primary"
                type="button"
                :disabled="submittingId === row.id"
                @click="submitReview('确认通过', row)"
              >
                确认通过
              </button>
              <button
                class="btn small danger"
                type="button"
                :disabled="submittingId === row.id"
                @click="submitReview('退回异常', row)"
              >
                退回异常
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state" style="padding: 12px;">暂无待审核记录</p>
    </section>

    <form class="filter-bar" @submit.prevent="applyFilter">
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
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] === undefined ? '—' : row[column] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <!-- 审核入口二：行内操作，按受控轨迹只渲染当前状态允许的动作 -->
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              :disabled="submittingId === row.id"
              @click="handleRowAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted-text">已锁定</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无流量监测数据，可先登记流量记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条流量监测记录</span>
      <span v-if="flash" :class="flash.ok ? 'success-text' : 'error-text'">{{ flash.text }}</span>
    </footer>

    <!-- 审核弹窗：行内的确认通过 / 退回异常走这里 -->
    <div v-if="review.open" class="modal-mask" @click.self="closeReview">
      <div class="modal">
        <h3 class="modal-title">{{ review.action }} · {{ String(review.row?.['记录编号'] ?? '') }}</h3>
        <dl class="modal-readonly">
          <div><dt>当前状态</dt><dd>{{ review.row?.status }}</dd></div>
          <div><dt>测量方法</dt><dd>{{ review.row?.['测量方法'] }}</dd></div>
          <div><dt>断面流量</dt><dd>{{ review.row?.['断面流量'] }}</dd></div>
          <div><dt>最大流速</dt><dd>{{ review.row?.['最大流速'] }}</dd></div>
          <div><dt>过水面积</dt><dd>{{ review.row?.['过水面积'] }}</dd></div>
        </dl>
        <label class="modal-field">
          <span>审核意见{{ review.action === '退回异常' ? '（退回将清空中间结论，原值保留，意见不落库）' : '' }}</span>
          <textarea v-model="review.opinion" rows="3" placeholder="请填写审核结论"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" :disabled="review.busy" @click="closeReview">取消</button>
          <button
            class="btn"
            :class="review.action === '确认通过' ? 'primary' : 'danger'"
            type="button"
            :disabled="review.busy"
            @click="confirmReview"
          >
            {{ review.busy ? '提交中…' : review.action }}
          </button>
        </div>
      </div>
    </div>

    <!-- 更换测量方法弹窗：明确不回写既有过水面积 -->
    <div v-if="method.open" class="modal-mask" @click.self="closeMethod">
      <div class="modal">
        <h3 class="modal-title">更换测量方法 · {{ String(method.row?.['记录编号'] ?? '') }}</h3>
        <label class="modal-field">
          <span>测量方法</span>
          <select v-model="method.value">
            <option v-for="item in methodOptions" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <p class="modal-note">
          既有过水面积为 {{ method.row?.['过水面积'] }} m²。更换测量方法只更新方法本身，
          <strong>不会回写既有过水面积、断面流量与最大流速</strong>；如需新面积请重新测量登记。
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" :disabled="method.busy" @click="closeMethod">取消</button>
          <button class="btn primary" type="button" :disabled="method.busy" @click="confirmMethod">
            {{ method.busy ? '提交中…' : '确认更换' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 登记弹窗：采集入口，登记后状态为「已采集」 -->
    <div v-if="create.open" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3 class="modal-title">登记流量记录</h3>
        <div class="modal-grid">
          <label class="modal-field">
            <span>记录编号</span>
            <input v-model="create.form['记录编号']" placeholder="如 DISC-2026-0004" />
          </label>
          <label class="modal-field">
            <span>站点编号</span>
            <input v-model="create.form['站点编号']" placeholder="如 STAT-0001" />
          </label>
          <label class="modal-field">
            <span>测量方法</span>
            <select v-model="create.form['测量方法']">
              <option v-for="item in methodOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="modal-field">
            <span>测量时间</span>
            <input v-model="create.form['测量时间']" type="datetime-local" />
          </label>
          <label class="modal-field">
            <span>断面流量 (m³/s)</span>
            <input v-model="create.form['断面流量']" type="number" step="0.01" />
          </label>
          <label class="modal-field">
            <span>最大流速 (m/s)</span>
            <input v-model="create.form['最大流速']" type="number" step="0.01" />
          </label>
          <label class="modal-field">
            <span>过水面积 (m²)</span>
            <input v-model="create.form['过水面积']" type="number" step="0.01" />
          </label>
        </div>
        <p v-if="create.error" class="error-text">{{ create.error }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" @click="confirmCreate">登记并采集</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  availableActions,
  createEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const meta = moduleMeta('discharge')
const columns = ['记录编号', '站点编号', '测量方法', '断面流量', '最大流速', '过水面积', '测量时间', '审核意见']
const methodOptions = ['流速仪法', '声学多普勒法', '浮标法', '量水堰法', '比降面积法']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const submittingId = ref<number | null>(null)
const flash = ref<{ ok: boolean; text: string } | null>(null)
const opinions = reactive<Record<string, string>>({})

const reviewRows = computed(() => rows.value.filter((row) => String(row.status) === '待审核'))

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return [
    {
      label: '今日测量次数',
      value: rows.value.filter((row) => String(row['测量时间'] ?? '').slice(0, 10) === today).length,
    },
    { label: '待审核记录', value: reviewRows.value.length },
    { label: '异常记录数', value: rows.value.filter((row) => row.abnormal).length },
  ]
})

function actionsFor(row: EntryRow): string[] {
  return availableActions(meta.key, String(row.status))
}

function versionOf(row: EntryRow): number {
  return Number(row.version ?? 1)
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function applyFilter() {
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// ---- 审核入口：行内弹窗 / 工作台共用同一个带版本锁的提交 ----

const review = reactive({
  open: false,
  action: '确认通过',
  row: null as EntryRow | null,
  opinion: '',
  busy: false,
})

function handleRowAction(action: string, row: EntryRow) {
  flash.value = null
  if (action === '更换测量方法') {
    openMethodDialog(row)
    return
  }
  if (action === '确认通过' || action === '退回异常') {
    review.open = true
    review.action = action
    review.row = row
    review.opinion = opinions[String(row.id)] ?? ''
    review.busy = false
    return
  }
  void submit(action, row, {})
}

function closeReview() {
  if (review.busy) return
  review.open = false
  review.row = null
  review.opinion = ''
}

function confirmReview() {
  if (!review.row) return
  const row = review.row
  const action = review.action
  const opinion = review.opinion
  review.busy = true
  void submit(action, row, { opinion }, () => {
    review.busy = false
  })
}

async function submitReview(action: string, row: EntryRow) {
  flash.value = null
  await submit(action, row, { opinion: opinions[String(row.id)] ?? '' })
}

async function submit(
  action: string,
  row: EntryRow,
  extra: { opinion?: string },
  done?: () => void,
) {
  submittingId.value = Number(row.id)
  // 让按钮禁用态先渲染，再同步落库，避免同帧双击产生两次提交。
  await Promise.resolve()
  const result = applyAction(meta.key, Number(row.id), action, {
    expectedVersion: versionOf(row),
    opinion: extra.opinion ?? '',
    operator: session.operator,
    time: nowText(),
  })
  submittingId.value = null
  done?.()
  // 成功或并发冲突都关闭弹窗：冲突时弹窗持有的是旧版本，留着只会重复冲突，最新结论以列表为准。
  if (result.ok || result.conflict) {
    review.open = false
    review.row = null
    review.opinion = ''
    opinions[String(row.id)] = ''
  }
  flash.value = { ok: result.ok, text: result.message }
  // 无论成功失败都刷新：成功要同步新状态/整编待办，失败（尤其并发冲突）要对齐最新版本。
  reload(flash.value)
}

// ---- 更换测量方法：只改方法，不回写过水面积 ----

const method = reactive({
  open: false,
  row: null as EntryRow | null,
  value: '',
  busy: false,
})

function openMethodDialog(row: EntryRow) {
  method.open = true
  method.row = row
  method.value = String(row['测量方法'] ?? methodOptions[0])
  method.busy = false
}

function closeMethod() {
  if (method.busy) return
  method.open = false
  method.row = null
}

async function confirmMethod() {
  if (!method.row) return
  method.busy = true
  submittingId.value = Number(method.row.id)
  await Promise.resolve()
  const result = applyAction(meta.key, Number(method.row.id), '更换测量方法', {
    expectedVersion: versionOf(method.row),
    method: method.value,
  })
  submittingId.value = null
  method.busy = false
  if (result.ok) {
    method.open = false
    method.row = null
  }
  flash.value = { ok: result.ok, text: result.message }
  reload(flash.value)
}

// ---- 登记入口 ----

type CreateForm = Record<string, string>

const create = reactive({
  open: false,
  error: '',
  form: {} as CreateForm,
})

function nextRecordCode(): string {
  const year = new Date().getFullYear()
  const max = rows.value.reduce((acc, row) => {
    const m = String(row['记录编号'] ?? '').match(/(\d+)$/)
    return Math.max(acc, m ? Number(m[1]) : 0)
  }, 0)
  return `DISC-${year}-${String(max + 1).padStart(4, '0')}`
}

function openCreate() {
  flash.value = null
  create.open = true
  create.error = ''
  create.form = {
    记录编号: nextRecordCode(),
    站点编号: '',
    测量方法: methodOptions[0],
    测量时间: nowText().replace(' ', 'T'),
    断面流量: '',
    最大流速: '',
    过水面积: '',
  }
}

function closeCreate() {
  create.open = false
  create.error = ''
}

function confirmCreate() {
  const form = create.form
  if (!form['记录编号']?.trim() || !form['站点编号']?.trim()) {
    create.error = '记录编号与站点编号为必填项'
    return
  }
  for (const field of ['断面流量', '最大流速', '过水面积']) {
    if (form[field] !== '' && Number.isNaN(Number(form[field]))) {
      create.error = `${field}必须是数值`
      return
    }
  }
  const values: Record<string, string | number> = { ...form }
  for (const field of ['断面流量', '最大流速', '过水面积']) {
    if (form[field] !== '') values[field] = Number(form[field])
  }
  const result = createEntry(meta.key, values)
  if (!result.ok) {
    create.error = result.message
    return
  }
  create.open = false
  flash.value = { ok: true, text: result.message }
  reload(flash.value)
}

function reload(notice?: { ok: boolean; text: string }) {
  flash.value = notice ?? null
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    flash.value = {
      ok: false,
      text: error instanceof Error ? error.message : '流量监测列表读取失败',
    }
  }
}

// 重写行内动作处理：提交审核直接提交，确认通过/退回异常走弹窗，更换测量方法走方法弹窗。
onMounted(reload)
</script>

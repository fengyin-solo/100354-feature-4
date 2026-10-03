<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">
          维护整编成果，做登记、筛选与状态流转；流量记录审核通过后会在此同步生成「流量整编待办」，未通过的记录不会进入。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记整编成果</button>
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3 class="section-head">
      流量整编待办
      <span class="badge">待整编 {{ autoPendingRows.length }}</span>
      <span class="page-desc">由流量审核通过自动同步，按站点+测量年份归并，重复通过只累加原始记录数</span>
    </h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in autoColumns" :key="column">{{ column }}</th>
          <th>来源</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in autoRows" :key="`auto-${String(row.id)}`">
          <td v-for="column in autoColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td><span class="source-tag">{{ row['来源'] ?? '流量审核通过' }}</span></td>
          <td><span class="status-tag" :data-status="compilationStatus(row.status)">{{ row.status }}</span></td>
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
          </td>
        </tr>
        <tr v-if="!autoRows.length">
          <td :colspan="autoColumns.length + 3" class="empty-state">暂无流量整编待办，流量记录审核通过后会自动出现在这里</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-head">其他整编成果</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in manualRows" :key="`manual-${String(row.id)}`">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td><span class="status-tag" :data-status="compilationStatus(row.status)">{{ row.status }}</span></td>
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
          </td>
        </tr>
        <tr v-if="!manualRows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无人工登记的整编成果</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条整编记录（其中流量待办 {{ autoRows.length }} 条）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listDischarge } from '@/data/discharge-workflow'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('compilation')
const columns = ['成果编号', '整编年份', '站点编号', '整编类型', '原始记录数', '整编人', '审核人', '整编状态']
const autoColumns = ['成果编号', '整编年份', '站点编号', '整编类型', '原始记录数']
const statuses = ['待整编', '整编中', '待审核', '已刊印', '已驳回']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 从流量模块拿到所有审核通过时生成的待办编号，用来区分自动待办与历史/人工成果。
const autoTodoIds = computed(() => {
  const ids = new Set<string>()
  for (const row of listDischarge()) {
    const todo = String(row['整编待办'] ?? '')
    if (todo) {
      ids.add(todo)
    }
  }
  return ids
})

const autoRows = computed(() =>
  rows.value.filter((row) => {
    const code = String(row['成果编号'] ?? '')
    return autoTodoIds.value.has(code) || code.startsWith('AUTO-') || row['来源'] === '流量审核通过'
  }),
)
const manualRows = computed(() => rows.value.filter((row) => !autoRows.value.includes(row)))
const autoPendingRows = computed(() => autoRows.value.filter((row) => String(row.status) === '待整编'))

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '流量待整编', value: autoPendingRows.value.length, hot: true },
  { label: '整编中年度', value: rows.value.filter((row) => String(row.status) === '整编中').length, hot: false },
  { label: '待审核成果', value: rows.value.filter((row) => String(row.status) === '待审核').length, hot: true },
  { label: '已刊印成果', value: rows.value.filter((row) => String(row.status) === '已刊印').length, hot: false },
])

// 整编页沿用公共动作；开始整编 / 提交审核按状态出现，避免对已刊印成果重复操作。
function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待整编') {
    return ['开始整编']
  }
  if (status === '整编中') {
    return ['提交审核']
  }
  if (status === '待审核') {
    return ['驳回整编']
  }
  return []
}

function compilationStatus(status: string | number | boolean): string {
  return String(status)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '整编成果登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

// 跨页签同步：在流量页审核通过后切回整编页（或另一窗口操作）也能立刻看到待办。
function onStorage(event: StorageEvent) {
  if (event.key && event.key.includes('entries')) {
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
onUnmounted(() => window.removeEventListener('storage', onStorage))
</script>

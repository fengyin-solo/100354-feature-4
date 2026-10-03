// 流量受控轨迹的核心规则测试：不依赖浏览器，用内存存储模拟 localStorage。
import assert from 'node:assert/strict'

// 最小内存存储垫片
const memory = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, v),
  },
}

const { listEntries, runAction, createEntry, availableActions } = await import('./local-service.ts')

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function findCode(code: string) {
  return listEntries('discharge').items.find((r) => r['记录编号'] === code)!
}

test('已采集可送审；已通过不能再送审/通过（受控轨迹门禁）', () => {
  const fresh = findCode('DISC-2026-0001')
  assert.equal(fresh.status, '已采集')
  assert.ok(runAction('discharge', fresh.id, '提交审核', { expectedVersion: 1 }).ok)
  const inReview = findCode('DISC-2026-0001')
  assert.equal(inReview.status, '待审核')
  // 已通过记录尝试任何审核动作都被拒绝
  const passed = findCode('DISC-2026-0003')
  assert.equal(runAction('discharge', passed.id, '提交审核').ok, false)
  assert.equal(runAction('discharge', passed.id, '确认通过').ok, false)
  // 待审核不能跳过审核直接改方法
  assert.equal(runAction('discharge', inReview.id, '更换测量方法', { method: '浮标法' }).ok, false)
})

test('退回异常：清空审核中间结论，保留断面流量/最大流速/过水面积原值', () => {
  const row = findCode('DISC-2026-0001') // 当前待审核，v2
  const before = { 流量: row['断面流量'], 流速: row['最大流速'], 面积: row['过水面积'] }
  const res = runAction('discharge', row.id, '退回异常', {
    expectedVersion: 2,
    opinion: '流速点据异常请复测',
  })
  assert.ok(res.ok, res.message)
  const back = findCode('DISC-2026-0001')
  assert.equal(back.status, '异常值')
  assert.equal(back.abnormal, true)
  assert.equal(back['审核意见'], '')
  assert.equal(back['审核人'], '')
  assert.equal(back['审核时间'], '')
  assert.deepEqual(
    { 流量: back['断面流量'], 流速: back['最大流速'], 面积: back['过水面积'] },
    before,
  )
  // 异常值重新整改后可再次送审
  assert.ok(availableActions('discharge', '异常值').includes('提交审核'))
})

test('只有确认通过才同步整编待办；退回不产生待办', () => {
  const compBefore = listEntries('compilation').items.filter((r) => r.status === '待整编').length
  // DISC-0001 退回后重新送审再退回一次，整编待办不应增加
  let r = findCode('DISC-2026-0001')
  runAction('discharge', r.id, '提交审核', { expectedVersion: 3 })
  r = findCode('DISC-2026-0001')
  runAction('discharge', r.id, '退回异常', { expectedVersion: 4 })
  const compRejected = listEntries('compilation').items.filter((x) => x.status === '待整编').length
  assert.equal(compRejected, compBefore)

  // 种子里的待审核记录 DISC-2026-0002（STAT-0001 / 2026）通过，生成整编待办
  const reviewing = findCode('DISC-2026-0002')
  const res = runAction('discharge', reviewing.id, '确认通过', {
    expectedVersion: 3,
    operator: '值班管理员',
    opinion: '通过',
  })
  assert.ok(res.ok, res.message)
  const todo = listEntries('compilation').items.find(
    (x) => x.status === '待整编' && x['成果编号'] === 'COMP-2026-STAT0001',
  )
  assert.ok(todo, '应生成按站点年度聚合的整编待办')
  assert.equal(todo!['整编类型'], '流量整编')
  assert.equal(todo!['原始记录数'], 1)
  const passedRow = findCode('DISC-2026-0002')
  assert.equal(passedRow['审核人'], '值班管理员')
})

test('同站点同年度再次通过聚合进同一条待办', () => {
  // 再登记一条 STAT-0001 / 2026 的流量并走完审核
  const created = createEntry('discharge', {
    记录编号: 'DISC-2026-0099',
    站点编号: 'STAT-0001',
    测量方法: '流速仪法',
    断面流量: 100,
    最大流速: 2.1,
    过水面积: 60,
    测量时间: '2026-10-01T08:00',
  })
  assert.ok(created.ok, created.message)
  const id = listEntries('discharge').items.find((r) => r['记录编号'] === 'DISC-2026-0099')!.id
  runAction('discharge', id, '提交审核')
  runAction('discharge', id, '确认通过', { operator: '值班管理员' })
  const todo = listEntries('compilation').items.find(
    (x) => x['成果编号'] === 'COMP-2026-STAT0001' && x.status === '待整编',
  )
  assert.equal(todo!['原始记录数'], 2)
})

test('两个审核入口并发提交只接受第一个（版本锁）', () => {
  createEntry('discharge', {
    记录编号: 'DISC-2026-0100',
    站点编号: 'STAT-0002',
    测量方法: '浮标法',
    断面流量: 80,
    最大流速: 1.8,
    过水面积: 50,
    测量时间: '2026-10-02T09:00',
  })
  const row = listEntries('discharge').items.find((r) => r['记录编号'] === 'DISC-2026-0100')!
  runAction('discharge', row.id, '提交审核') // v1 -> v2
  // 入口A、入口B 都拿着送审后的版本 v2 并发提交
  const a = runAction('discharge', row.id, '确认通过', { expectedVersion: 2 })
  const b = runAction('discharge', row.id, '退回异常', { expectedVersion: 2 })
  assert.ok(a.ok, a.message)
  assert.equal(b.ok, false)
  assert.equal(b.conflict, true)
  const final = listEntries('discharge').items.find((r) => r.id === row.id)!
  assert.equal(final.status, '已通过', '只接受第一个提交的结果')
  assert.equal(final.version, 3)
})

test('更换测量方法不回写既有过水面积', () => {
  createEntry('discharge', {
    记录编号: 'DISC-2026-0101',
    站点编号: 'STAT-0003',
    测量方法: '流速仪法',
    断面流量: 70,
    最大流速: 1.6,
    过水面积: 48.2,
    测量时间: '2026-10-03T09:00',
  })
  const row = listEntries('discharge').items.find((r) => r['记录编号'] === 'DISC-2026-0101')!
  const res = runAction('discharge', row.id, '更换测量方法', { expectedVersion: 1, method: '声学多普勒法' })
  assert.ok(res.ok, res.message)
  const after = listEntries('discharge').items.find((r) => r.id === row.id)!
  assert.equal(after['测量方法'], '声学多普勒法')
  assert.equal(after['过水面积'], 48.2)
  assert.equal(after['断面流量'], 70)
  assert.equal(after.status, '已采集')
})

console.log(`\n全部 ${passed} 项规则测试通过`)

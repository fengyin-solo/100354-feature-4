import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { migrateDischargeLegacy } from './data/discharge-workflow'
import './styles/global.css'

// 兼容旧记录：补齐流量受控轨迹字段、重建历史已通过记录对应的整编待办（幂等）。
migrateDischargeLegacy()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

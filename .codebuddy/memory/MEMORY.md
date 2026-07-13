# 长期记忆

## 项目：workouts_log

### COROS API 同步（coros_api_sync.py）
- 使用 `activity/detail/query` 接口，不依赖 FIT 文件
- 字段单位已坐实：distance cm→m(÷100)，timestamp 1/10秒(÷100)，timezone 15min/单位
- average_speed 不用 summary.avgSpeed（单位随运动类型变），改用 distance/moving_time
- summary.timezone 优先用于 start_date_local，避免 tzfpy 依赖和 DST 误差
- COROS_SPORT_TYPE_DICT 覆盖 40+ 运动类型，产出 config.TYPE_DICT 合法键
- 开发计划文档：docs/coros-detail-query-plan.md

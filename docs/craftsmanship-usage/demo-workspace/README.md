# demo-workspace 说明

这是一个和当前 `src-tauri/src/craftsmanship/` 后端实现对齐的最小演示 workspace。

它的目标不是覆盖全部功能，而是提供一套：

- 目录结构完整
- 字段满足当前校验规则
- recipe 含有真实 GPIO + HMIP/TCP + wait-signal 三类步骤

核心 recipe：`projects/project-a/recipes/mixed-transport-process.json`

运行时预期：

1. `S010` 打开 GPIO 阀门
2. `S020` 向 `main-tcp-process` 发送 HMIP 启动帧
3. 收到 `response(status=0, channel=9)` 后，把 `device.pump_01.running` 置为 `true`
4. 收到 `event(eventId=91, channel=9)` 后，把 `process_ready` 置为 `1`
5. `S030` 完成，recipe 结束

如果你只是要验证目录装配是否正确，优先调：

- `craftsmanship_scan_workspace`
- `craftsmanship_get_project_bundle`
- `craftsmanship_get_recipe_bundle`

如果你要跑通 runtime，就需要一个监听 `127.0.0.1:15090` 的 HMIP/TCP 对端。

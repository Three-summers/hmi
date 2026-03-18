>[!note] about
>**创建日期**： 2026-02-10 13:23
>**详细日期**： 星期二 10日 二月 2026 13:23:02


## **总体设计**
整个项目采用 4 层文件模型：
- 系统定义层：定义系统支持什么动作、什么设备类型
- 项目资源层：定义当前项目有哪些具体设备、信号、联锁
- 工艺层：定义每个工艺文件的步骤内容
- 发布层：定义工艺发布后的冻结结果

如果你现在只想先做编辑器，也可以先只做前 3 层，发布层保留。

-----------------------------------
### **一、目录结构**
建议目录结构如下：
```txt
workspace/
  system/
    actions/
    device-types/
    schemas/

  projects/
    <project-id>/
      project.json
      devices/
      signals/
      safety/
      recipes/
```
一个实际例子：
```txt
workspace/
  system/
    actions/
      common.delay.json
      common.wait-signal.json
      pump.start.json
      pump.stop.json
      valve.open.json
      valve.close.json
    device-types/
      pump.json
      valve.json
      heater.json
    schemas/
      action.schema.json
      device-type.schema.json
      project.schema.json
      device.schema.json
      signal.schema.json
      recipe.schema.json
      template.schema.json
      release.schema.json

  projects/
    project-a/
      project.json
      devices/
        pump_01.json
        pump_02.json
        valve_01.json
      signals/
        chamber_pressure.json
        chamber_temperature.json
        door_closed.json
      safety/
        interlocks.json
        safe-stop.json
      recipes/
        pumpdown.json
        vent.json
```

-----------------------------------
### **二、目录职责**
**1. `system/actions/`**
定义系统支持的动作能力。
例如：
- 延时
- 等待信号
- 开泵
- 关泵
- 开阀
- 关阀
- 设温度

这层解决的是：
“系统到底支持哪些可配置动作”。
**2. `system/device-types/`**
定义抽象设备类型。
例如：
- 泵
- 阀
- 加热器
- MFC
- 传感器

这层解决的是：
“某一类设备允许使用哪些动作”。
**3. `projects/<project-id>/project.json`**
定义一个项目的基本信息。
这层解决的是：
“当前项目是谁，展示名是什么，当前启用了哪些资源目录”。
**4. `projects/<project-id>/devices/`**
定义当前项目中的具体设备实例。
例如：
- 前级泵
- 分子泵
- 粗抽阀
- 主加热器

这层解决的是：
“UI 下拉框里有哪些具体设备可选”。
**5. `projects/<project-id>/signals/`**
定义当前项目中的可读信号。
例如：
- 腔体压力
- 腔体温度
- 门关闭
- 真空到位
- 流量稳定

这层解决的是：
“等待条件、联锁条件里有哪些信号可选”。
**6. `projects/<project-id>/safety/`**
定义安全规则。
例如：
- 开泵前门必须关闭
- 高温下不能开门
- 故障时执行安全停机顺序

这层解决的是：
“工艺执行时什么条件必须满足，异常时怎么退回安全态”。
**7. `projects/<project-id>/recipes/`**
每个文件表示一个工艺。
例如：
- 抽真空
- 放气
- 预热
- 清洗

这层解决的是：
“工程师实际编辑和运行的流程”。
### **三、文件结构定义**
下面我按文件类型分别给出标准结构。
**1. 动作定义文件**
位置：`system/actions/*.json`
作用：
定义一个“动作能力”。
例如：
- 延时
- 开泵
- 关泵
- 等待信号

建议结构：
```json
{
  "id": "pump.start",
  "name": "开泵",
  "category": "pump",
  "targetMode": "required",
  "allowedDeviceTypes": ["pump"],
  "parameters": [],
  "completion": {
    "type": "deviceFeedback",
    "key": "running",
    "operator": "eq",
    "value": true,
    "stableTimeMs": 1000
  },
  "summaryTemplate": "{device.name} 开泵"
}
```
字段说明：
- `id`
  - 动作唯一标识
  - 系统内部使用
  - 全局唯一
  - 建议格式：`类型.动作`
  - 例：`pump.start`

- `name`
  - 动作显示名
  - UI 下拉框展示
  - 例：`开泵`

- `category`
  - 动作分类
  - 用于 UI 分组
  - 例：`pump`、`common`、`heater`

- `targetMode`
  - 该动作是否需要目标对象
  - 可选值建议：
    - `none`：不需要设备，例如延时
    - `required`：必须选择设备，例如开泵
  - 例：延时为 `none`，开泵为 `required`

- `allowedDeviceTypes`
  - 允许作用的设备类型列表
  - 当 `targetMode=required` 时必须有值
  - 例：`["pump"]`

- `parameters`
  - 动作参数定义列表
  - 决定 UI 右侧属性面板显示什么输入项

- `completion`
  - 动作完成判定规则
  - 用于定义什么时候算“执行成功”
  - 可以为空，表示动作发出即认为完成

- `summaryTemplate`
  - 用于生成步骤摘要文本
  - 例：`{device.name} 开泵`


**动作参数 `parameters` 子结构**
示例：
```json
{
  "key": "durationMs",
  "name": "时长",
  "type": "number",
  "required": true,
  "unit": "ms",
  "min": 0,
  "max": 600000,
  "default": 1000
}
```
字段说明：
- `key`
  - 参数键名
  - 工艺步骤中保存参数时使用

- `name`
  - 参数显示名
  - UI 展示用

- `type`
  - 参数类型
  - 建议值：
    - `number`
    - `string`
    - `boolean`
    - `enum`

- `required`
  - 是否必填

- `unit`
  - 单位
  - 例：`ms`、`Pa`、`°C`

- `min` / `max`
  - 数值范围限制

- `default`
  - 默认值

- `options`
  - 当 `type=enum` 时可选项列表


**动作完成规则 `completion` 子结构**
示例：
```json
{
  "type": "deviceFeedback",
  "key": "running",
  "operator": "eq",
  "value": true,
  "stableTimeMs": 1000
}
```
字段说明：
- `type`
  - 完成规则类型
  - 建议值：
    - `immediate`：命令发出即完成
    - `deviceFeedback`：等待设备反馈
    - `signalCompare`：等待某个信号满足条件

- `key`
  - 当 `type=deviceFeedback` 时，表示反馈键名

- `signalId`
  - 当 `type=signalCompare` 时，表示引用的信号

- `operator`
  - 比较操作符
  - 建议值：`eq`、`ne`、`gt`、`ge`、`lt`、`le`

- `value`
  - 目标值

- `stableTimeMs`
  - 连续稳定多长时间后才算完成


**2. 设备类型定义文件**
位置：`system/device-types/*.json`
作用：
定义抽象设备类别，以及这一类设备允许的动作。
示例：
```json
{
  "id": "pump",
  "name": "泵",
  "allowedActions": [
    "pump.start",
    "pump.stop"
  ],
  "group": "vacuum"
}
```
字段说明：
- `id`
  - 设备类型唯一标识
  - 例：`pump`

- `name`
  - 设备类型显示名
  - 例：`泵`

- `allowedActions`
  - 此类型允许使用的动作 ID 列表
  - UI 根据它过滤动作下拉框

- `group`
  - 用于 UI 分组展示
  - 例：`vacuum`、`thermal`


**3. 项目定义文件**
位置：`projects/<project-id>/project.json`
作用：
定义项目基本信息。
示例：
```json
{
  "id": "project-a",
  "name": "项目A",
  "description": "刻蚀设备A线",
  "version": "1.0",
  "enabled": true
}
```
字段说明：
- `id`
  - 项目标识
  - 用于目录名和系统内部引用

- `name`
  - 项目显示名

- `description`
  - 项目说明

- `version`
  - 项目配置版本

- `enabled`
  - 当前项目是否启用


**4. 设备实例文件**
位置：`projects/<project-id>/devices/*.json`
作用：
定义某个项目中的具体设备。
示例：
```json
{
  "id": "pump_01",
  "name": "前级泵",
  "typeId": "pump",
  "enabled": true,
  "tags": {
    "start": "device.pump01.start",
    "stop": "device.pump01.stop",
    "running": "device.pump01.running",
    "fault": "device.pump01.fault"
  }
}
```
字段说明：
- `id`
  - 设备实例唯一标识
  - 工艺中保存这个值

- `name`
  - 设备显示名
  - UI 下拉框展示这个值

- `typeId`
  - 设备类型 ID
  - 关联 `device-types`

- `enabled`
  - 是否启用
  - UI 通常只显示启用设备

- `tags`
  - 设备相关的命令和反馈映射
  - 键名建议和动作定义、完成规则中的键名统一


**设备实例 `tags` 的意义**
这是“抽象动作”和“具体设备信号”之间的连接层。
例如：
- 动作 `pump.start` 只知道自己要发 `start`
- 设备 `pump_01` 在 `tags.start` 中定义实际映射
- 运行时通过 `deviceId + tag key` 找到真实对象

建议 `tags` 至少分两类语义：
- 命令类：`start`、`stop`、`open`、`close`
- 状态类：`running`、`opened`、`fault`


**5. 信号定义文件**
位置：`projects/<project-id>/signals/*.json`
作用：
定义项目中可用于等待、判断、联锁的过程信号。
示例：
```json
{
  "id": "chamber_pressure",
  "name": "腔体压力",
  "dataType": "number",
  "unit": "Pa",
  "source": "signal.chamber.pressure",
  "enabled": true
}
```
字段说明：
- `id`
  - 信号唯一标识

- `name`
  - 信号显示名

- `dataType`
  - 数据类型
  - 建议值：
    - `number`
    - `boolean`
    - `string`

- `unit`
  - 单位
  - 数值类信号可填写

- `source`
  - 信号来源标识
  - 这里不限定具体技术形式
  - 只要求能唯一定位真实信号

- `enabled`
  - 是否启用


**6. 安全联锁文件**
位置：`projects/<project-id>/safety/interlocks.json`
作用：
定义执行动作前必须满足的全局规则。
示例：
```json
{
  "rules": [
    {
      "id": "door-must-closed-before-pump-start",
      "name": "开泵前门必须关闭",
      "actionIds": ["pump.start"],
      "condition": {
        "signalId": "door_closed",
        "operator": "eq",
        "value": true
      },
      "onViolation": "block"
    }
  ]
}
```
字段说明：
- `rules`
  - 联锁规则列表

每条规则的字段说明：
- `id`
  - 规则唯一标识

- `name`
  - 规则显示名

- `actionIds`
  - 该规则适用于哪些动作
  - 例：`pump.start`

- `condition`
  - 联锁条件
  - 只有条件满足时动作才允许执行

- `onViolation`
  - 违反联锁时的处理方式
  - 建议值：
    - `block`：阻止执行
    - `alarm`：报警并终止


**联锁条件 `condition` 子结构**
简单版可以先统一为：
```json
{
  "signalId": "door_closed",
  "operator": "eq",
  "value": true
}
```
如果你以后需要多个条件，可以扩成：
```json
{
  "logic": "and",
  "items": [
    {
      "signalId": "door_closed",
      "operator": "eq",
      "value": true
    },
    {
      "signalId": "chamber_temperature",
      "operator": "lt",
      "value": 80
    }
  ]
}
```

**7. 安全停机文件**
位置：`projects/<project-id>/safety/safe-stop.json`
作用：
定义异常时要执行的固定安全步骤。
示例：
```json
{
  "id": "safe-stop",
  "name": "安全停机",
  "steps": [
    {
      "seq": 10,
      "actionId": "valve.close",
      "deviceId": "valve_01"
    },
    {
      "seq": 20,
      "actionId": "pump.stop",
      "deviceId": "pump_02"
    },
    {
      "seq": 30,
      "actionId": "pump.stop",
      "deviceId": "pump_01"
    }
  ]
}
```
字段说明：
- `id`
  - 安全停机方案 ID

- `name`
  - 名称

- `steps`
  - 固定顺序步骤列表

每个 `step` 字段说明：
- `seq`
  - 执行顺序

- `actionId`
  - 动作 ID

- `deviceId`
  - 目标设备 ID


**8. 工艺文件**
位置：`projects/<project-id>/recipes/*.json`
作用：
一个文件表示一个完整工艺。
示例：
```json
{
  "id": "pumpdown",
  "name": "抽真空",
  "description": "标准抽真空工艺",
  "steps": [
    {
      "id": "S010",
      "seq": 10,
      "name": "启动前级泵",
      "actionId": "pump.start",
      "deviceId": "pump_01",
      "parameters": {},
      "timeoutMs": 5000,
      "onError": "stop"
    },
    {
      "id": "S020",
      "seq": 20,
      "name": "延时",
      "actionId": "common.delay",
      "parameters": {
        "durationMs": 3000
      },
      "timeoutMs": 4000,
      "onError": "stop"
    },
    {
      "id": "S030",
      "seq": 30,
      "name": "等待压力到位",
      "actionId": "common.wait-signal",
      "parameters": {
        "signalId": "chamber_pressure",
        "operator": "lt",
        "value": 1000,
        "stableTimeMs": 2000
      },
      "timeoutMs": 30000,
      "onError": "stop"
    }
  ]
}
```
字段说明：
- `id`
  - 工艺唯一标识

- `name`
  - 工艺显示名

- `description`
  - 工艺说明

- `steps`
  - 步骤列表
  - 按 `seq` 顺序执行


**工艺步骤 `steps` 子结构**
- `id`
  - 步骤唯一标识
  - 在当前工艺内唯一

- `seq`
  - 顺序号
  - 用于排序执行
  - 建议预留间隔，例如 `10,20,30`

- `name`
  - 步骤显示名
  - 可以手工填写，也可自动生成

- `actionId`
  - 步骤执行的动作 ID
  - 关联 `system/actions`

- `deviceId`
  - 目标设备 ID
  - 当动作需要设备时必填
  - 当动作不需要设备时省略

- `parameters`
  - 该步骤实际参数值
  - 键名必须来自对应动作定义中的 `parameters.key`

- `timeoutMs`
  - 步骤最大超时时间
  - 超时后按 `onError` 处理

- `onError`
  - 出错处理方式
  - 建议值：
    - `stop`：停止工艺
    - `safe-stop`：执行安全停机
    - `ignore`：忽略并继续
  - 最终方案推荐只允许前两种，`ignore` 谨慎使用


### **四、字段设计规则**
这是整个方案里最重要的统一约束。
**1. 所有引用都存 ID，不存名称**
例如：
- 工艺步骤里存 `deviceId: "pump_01"`
- 不存 `deviceName: "前级泵"`

原因：
- 名称可以改
- ID 必须稳定

**2. 名称只用于显示**
所有 `name` 都是给 UI 用的，不参与关联。
**3. 一个文件一个对象**
不要把所有设备都堆在一个大文件里。
建议：
- 一个设备一个文件
- 一个信号一个文件
- 一个工艺一个文件

这样更适合管理、比对、版本控制和 UI 编辑。
**4. 步骤顺序用 `seq`，不要依赖数组位置**
虽然 JSON 里是数组，但逻辑顺序建议以 `seq` 为准。
**5. 步骤参数必须由动作定义约束**
工艺文件里的 `parameters` 不能自由发挥，必须来自动作定义。
**6. 设备可选项由 `typeId + allowedDeviceTypes` 决定**
例如：
- 当前动作是 `pump.start`
- 它允许 `pump`
- 那 UI 设备下拉框只显示 `typeId=pump` 的设备

**7. 等待与判断优先走 `signals`**
不要在工艺步骤里直接写底层信号地址，统一走信号定义。
**8. 联锁规则独立于工艺**
不要把安全规则散落到每个工艺里，统一放项目安全目录。
### **五、UI 对应关系**
你前面最关心的是 UI 下拉框，这里直接对应起来。
**1. 步骤动作下拉框**
来源：
- `system/actions/`

显示：
- `name`

保存：
- `actionId`

**2. 设备下拉框**
来源：
- `projects/<project-id>/devices/`

过滤逻辑：
- 只显示 `enabled=true`
- 且 `typeId` 在当前动作的 `allowedDeviceTypes` 中

显示：
- `name`

保存：
- `deviceId`

**3. 信号下拉框**
来源：
- `projects/<project-id>/signals/`

显示：
- `name`

保存：
- `signalId`

**4. 参数编辑区**
来源：
- 当前动作定义中的 `parameters`

显示控件：
- 根据 `type`、`unit`、`options` 渲染

保存位置：
- 当前步骤的 `parameters`


### **六、最终方案一句话总结**
你的系统最终应该定义为：
- `actions` 负责定义“能做什么”
- `device-types` 负责定义“哪类设备能做哪些动作”
- `devices` 负责定义“当前项目里有哪些具体设备”
- `signals` 负责定义“可等待、可判断的过程信号”
- `recipes` 负责定义“工艺步骤怎么排”
- `safety` 负责定义“执行前后必须满足的安全规则”



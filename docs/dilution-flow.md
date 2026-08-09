# 稀释工艺流程设计（v2）

> 创建日期：2026-08-10
> 状态：设计基线（待实施）
> 关联文档：
> - PRMS Dilution Tool 接口对接文档 V1.4（docs/PRMS_DilutionTool接口对接文档_v1.1.md）
> - 工艺引擎后端说明（docs/craftsmanship-usage/README.md）
> - 工艺引擎设计（docs/craftsmanship_build.md）

---

## 一、背景与目标

### 1.1 现状

- `dilution` 后端状态机与前端 Dilution 视图均为 mock（`src-tauri/src/dilution/types.rs` 中 `PrmsClient` / `DilutionDeviceGateway` 全部是 Mock 实现）
- 当前设计假设 PRMS 提供 3 个语义操作：`queryMapping` / `uploadViscosity` / `requestDilutionBarcodes`
- 新 PRMS 接口（SOAP v1.4）改为统一入口 + 3 个方法：`resistInfo` / `check` / `batchCreate`，**创建瓶、生成条码、打印、异步收值、写报表都在 PRMS 侧完成**

### 1.2 本次改动的核心

1. PRMS 交互改为 SOAP 三步：`resistInfo` →（可选 `check`）→ `batchCreate`
2. 本地设备动作（称量 / 搅拌 / 静置 / 测粘度）**复用 craftsmanship 引擎**，通过 **HMIP 通信**与真实设备交互
3. 本地工艺参数（比例 / 搅拌 / 静置 / 密度 / 粘度上下限）以 resistInfo 返回的 `concentration` 为键，从 **workspace `system/` 配置**读取
4. `eqptId` / `operator` / `checker` 等机台与人员信息在 **workspace `system/` 配置**中定义

### 1.3 范围

本文档只覆盖稀释业务链路（PRMS 交互 + 本地工艺执行 + 配置），craftsmanship 引擎自身的机制（loader / validation / runtime）不重写，按现有实现复用。

---

## 二、总体架构

### 2.1 职责划分

| 层 | 职责 | 模块 |
|---|---|---|
| PRMS 交互层 | `resistInfo` / `check` / `batchCreate` SOAP 调用 | dilution 状态机 + 新增 SOAP 客户端 |
| 本地工艺执行层 | 称量 / 搅拌 / 静置 / 测粘度等设备动作 | craftsmanship 引擎 + `comm`（HMIP） |
| 配置层 | 浓度工艺参数表、eqptId、人员信息 | workspace `system/` 配置 |
| UI 层 | 扫码 → 浓度选择 → 执行监控 → 结果展示 | 前端 Dilution 视图（对接后端） |

### 2.2 数据流

```
1. create_batch（machineId 入参，未传时取 system 配置 eqptId / operator 默认值）
2. 扫码原液条码 → resistInfo(vendorBarcode) → 原液信息 + dilutionRelationship[] 浓度列表
3. 选浓度 →（可选）check(vendorBarcodeList, concentration) 预校验 → resistDefRrn
4. 本地工艺段：craftsmanship 运行时执行本地配方
      称量原液 → 称量溶剂（按比例）→ 搅拌 → 静置 → 测粘度（全部走 HMIP）
5. 从 craftsmanship 运行时结果读取粘度 / 实际质量
6. batchCreate(vendorBarcodeList, resistDefRrn, eqptId, bottleCount, viscosity, 报表字段)
      → 返回 resistSysRrn[] / resistBarcode[] / printSuccess
7. 本地分装（条码关联瓶子）
8. Completed（收值 / 报表由 PRMS 异步完成）
```

---

## 三、PRMS 接口对接（SOAP）

### 3.1 统一入口

`InvokeCommonRVMessageByXMLMsgBody(methodName, msgBodyXmlString)`：`methodName` + `msgBodyXmlString`（CDATA 包裹的业务 XML，根节点 `<msgBody>`）。请求 / 响应包装、`result` / `errorDesc` 语义详见官方文档 §2。

### 3.2 三个方法（本地使用字段）

| 方法 | 入参 | 出参（本地使用字段） |
|---|---|---|
| `resistInfo` | `vendorBarcode` | 原液定义（resistName / concentration / viscosityUpperLimit / viscosityLowerLimit / defrostTime / mtrNO 等，只读展示）；`dilutionRelationship[]`：每项 `concentration` + `sysRrn` |
| `check` | `vendorBarcodeList[]` + `concentration` | 通过：`resistDefRrn` / `batchNO` / `expireDate` / `barcodeCount`；失败：`result=1` + `errorDesc` |
| `batchCreate` | `vendorBarcodeList[]` + `resistDefRrn` + `eqptId` + `bottleCount` + `viscosity` + 报表字段（17 个） | `resistSysRrn[]` / `resistBarcode[]` / `printSuccess` |

**关键约定：**
- `resistDefRrn` = `dilutionRelationship[]` 中与所选浓度匹配那条记录的 `sysRrn`（不是主节点原液定义的 sysRrn）
- 条码解析（7865 / BarcodeMappingRules）由 PRMS 侧自动完成，本地不解析
- `batchCreate` 成功后 PRMS 异步执行 dataCollection 收值，本地无需额外调用
- 报表 17 字段完整映射见官方文档 §5.3，本地只负责收集并透传

### 3.3 SOAP 客户端

- 技术选型：`reqwest`（HTTP）+ `quick-xml`（解析）或手写 XML 模板；当前 Cargo.toml 无相关依赖，需新增
- `PrmsClient` trait 方法重定义：

```rust
pub trait PrmsClient: Send + Sync {
    fn query_resist_info(&self, request: QueryResistInfoRequest)
        -> Result<AdapterResult<ResistInfo>, String>;
    fn check_batch(&self, request: CheckBatchRequest)
        -> Result<AdapterResult<CheckResult>, String>;
    fn create_dilution_batch(&self, request: CreateDilutionBatchRequest)
        -> Result<AdapterResult<CreateDilutionBatchResult>, String>;
}
```

- **删除**：`upload_viscosity` / `request_dilution_barcodes`
- 错误处理：`result=1` 时读 `errorDesc`，映射为本地错误（错误表见官方文档 §6），保留 `PrmsSyncRecord` 记录请求 / 响应载荷
- 新增 SOAP 客户端实现替换 `MockPrmsClient`；mock 实现保留用于开发 / 测试

---

## 四、本地工艺执行（craftsmanship）

### 4.1 设备与动作建模

在 workspace `system/` 与 `projects/<id>/` 下新增：

| 类型 | 文件 | 说明 |
|---|---|---|
| 设备类型 | `system/device-types/scale.json`、`mixer.json`、`viscometer.json` | 电子秤 / 搅拌器 / 粘度计 |
| 动作 | `system/actions/weigh.start.json`、`mix.start.json`、`settle.json`、`viscosity.measure.json` | `dispatch.kind=hmipFrame`，**msgType / payload 占位**（后续提供）；`completion` 用 `deviceFeedback` / `signalCompare`（反馈键占位） |
| 设备实例 | `projects/<id>/devices/scale_01.json` 等 | `transport.connectionId` 指向 HMIP 连接 |

### 4.2 本地配方（预写 recipe 文件）

- **每个浓度对应一份预写的 recipe 文件**：`projects/<id>/recipes/<recipe-id>.json`（结构同 demo-workspace 的 `mixed-transport-process.json`：步骤 = 动作 id + 设备 id + 参数）
- 配方步骤：称量原液（目标质量由瓶数计算）→ 称量溶剂（按比例）→ 搅拌（mixTimeMs）→ 静置（settleTimeMs）→ 测粘度（粘度计读数）
- 配方内可自由组合 `common.delay` / `common.wait-signal` 等内建动作（如搅拌期间等待信号），改流程不用动 Rust 代码
- 配方参数（比例 / 时长 / 密度 / 粘度上下限）来自系统配置（见第六章），**不来自 PRMS**
- 浓度 → recipe 文件的对应关系由系统配置维护（`dilutionOptions[].recipeId`），dilution 选完浓度后 `load_recipe` 对应文件

### 4.3 与 dilution 状态机的接口

- dilution 驱动 craftsmanship 运行时：`craftsmanship_runtime_load_recipe`（本地配方）→ `craftsmanship_runtime_start_with_input`（`runInputs.parameters` 传瓶数 / 比例等）→ 轮询 `get_status` 或订阅 `craftsmanship-runtime-event`
- 配方完成后，dilution 从运行时 `snapshot.runtime_values` / `signal_values` 读取：**粘度平均值、原液实际质量、溶剂实际质量**，用于 batchCreate 入参（viscosity）与报表字段（稀释重量等）

---

## 五、批次状态机（变更对照）

### 5.1 旧状态 / 步骤处理

| 旧状态 / 步骤 | 处理 |
|---|---|
| `MappingResolved`（queryMapping） | 改为 `ResistInfoResolved`（resistInfo 返回浓度列表） |
| `RecipeLocked`（本地锁定 mock 配方） | 保留概念；配方参数改为来自系统配置 |
| `RawLoading` / `SolventLoading` / `Mixing` / `Settling` / `ViscosityTesting` | 保留语义；**执行移交给 craftsmanship 引擎** |
| `ViscositySynced`（upload_viscosity） | 删除；粘度作为 batchCreate 入参 |
| `BarcodeRequested`（request_dilution_barcodes） | 删除；条码由 batchCreate 返回 |
| `Printing`（本地打印标签） | 删除；打印由 PRMS / Bartender 处理 |
| `Dispensing` | 保留；**移到 batchCreate 之后**，条码关联分装 |
| `ReportPending`（本地生成 report） | 改为报表字段收集并透传 batchCreate |

### 5.2 新状态机（语义）

```
Draft → ScanningRawResist → ResistInfoResolved → RecipeLocked
      → Running（craftsmanship 执行本地工艺段）
      → ProcessCompleted → BatchCreating → Dispensing
      → Completed / Failed
```

具体状态命名在实施时确定；`check` 预校验失败与 `batchCreate` 失败均进入 `Failed` 并保留 PRMS 错误信息。

---

## 六、配置（workspace `system/`）

### 6.1 机台与人员

`system/dilution.json`（示例，字段名实施时定稿）：

```json
{
  "machine": {
    "eqptId": "EQPT-001"
  },
  "personnel": {
    "operator": "张工",
    "checker": "李工"
  },
  "labelPrintUrl": "http://print-server/bartender/api"
}
```

- `eqptId`：batchCreate 的机台字段，同时用于 PRMS 侧打印配置查询（PRINTSETUP）；**作为 `CreateBatchRequest.machineId` 未传时的默认值**
- `operator` / `checker`：报表字段
- `labelPrintUrl` 可选；不配时 PRMS 按 `eqptId` 查打印地址

### 6.2 浓度工艺参数表

key = `dilutionRelationship[].concentration`（resistInfo 返回值），并关联本地 recipe 文件：

```json
{
  "dilutionOptions": [
    {
      "concentration": "0.01:5",
      "recipeId": "dilute-0.01-5",
      "ratio": { "raw": 7, "solvent": 3 },
      "mixTimeMs": 300000,
      "settleTimeMs": 120000,
      "rawDensityGPerMl": 1.0,
      "solventDensityGPerMl": 0.9,
      "viscosityMinCp": 1,
      "viscosityMaxCp": 10
    }
  ]
}
```

- `recipeId`：指向 `projects/<id>/recipes/<recipeId>.json`，即该浓度对应的本地配方（见 4.2）
- resistInfo 返回的浓度在表中查不到 → 该选项不可用（提示配置缺失，不阻断其它浓度）

---

## 七、数据模型变更（`src-tauri/src/dilution/types.rs`）

| 类型 | 变更 |
|---|---|
| `CreateBatchRequest` | `machineId` **保留**入参（支持一台 HMI 管多机台）；未传时取配置 `eqptId` 作默认值 |
| `Batch` | 新增 `resist_info` / `resist_def_rrn` / `resist_barcodes` / `check_result` 等 |
| `RawResistScan` | `validation_status` 由本地 mock 判定改为 resistInfo / check 结果 |
| `RunBatchRequest` | `viscosity_readings_cp` / `raw_load` 保留 |
| `DilutionReport` | 本地生成改为收集 17 个报表字段透传 batchCreate（官方文档 §5.3） |
| `PrmsOperation` | 删除 `UploadViscosity` / `RequestDilutionBarcodes`；新增 `Check` 等 |
| `DilutionRecipeSnapshot` | 来源改为系统配置 + resistInfo 结果 |

---

## 八、待补充输入（占位）

1. **HMIP 报文格式**：称量 / 搅拌 / 静置 / 测粘度的 `msgType`、payload、反馈键、信号定义（后续提供，先占位）
2. **浓度工艺参数表内容**：各浓度对应的比例 / 搅拌 / 静置时长等（PRMS 确认后填）
3. **分装 dispense 报文** 与 PRMS 条码的关联方式
4. `system/dilution.json` 配置字段最终形态

---

## 九、实施计划

| 阶段 | 内容 |
|---|---|
| P1 | SOAP 客户端（reqwest + quick-xml）+ `PrmsClient` 新 trait + 三接口封装（先 mock 数据跑通） |
| P2 | workspace `system/` 配置：浓度工艺参数表（含 recipeId 关联）+ eqptId / operator |
| P3 | craftsmanship 设备 / 动作建模（HMIP 报文占位）+ 预写各浓度 recipe 文件 |
| P4 | dilution 状态机重排 + 与 craftsmanship 运行时集成（读粘度 / 质量结果） |
| P5 | 前端 Dilution 视图对接：扫码 → 浓度选择 → 执行监控 → batchCreate → 分装 → 完成 |

---

## 十、删除清单

| 位置 | 删除内容 |
|---|---|
| `dilution/types.rs` | `PrmsClient::upload_viscosity` / `request_dilution_barcodes` |
| `dilution/types.rs` | `DilutionDeviceGateway::print_labels`（本地打印） |
| `dilution/types.rs` | `PrmsOperation::UploadViscosity` / `RequestDilutionBarcodes` |
| 前端 Dilution 视图 | mock 扫码 / mock 仪表 / mock 条码逻辑 |

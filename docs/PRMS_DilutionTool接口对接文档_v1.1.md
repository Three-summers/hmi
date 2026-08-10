# PRMS Dilution Tool SOAP 接口对接文档

> 版本：V1.4（2026-08-04）
> 说明：本文档描述 PRMS 为 Dilution Tool（外部系统）提供的稀释液自动化接口，包含接口参数定义、参数处理拼接逻辑与完整对接流程。

---

## 1. 接口概述

| 项目 | 说明 |
|---|---|
| 协议 | SOAP WebService（CXF 动态服务） |
| WSDL 地址 | `http://<PRMS地址>:12000/prms-serve/cxf/PrmsDilutionWebService?wsdl` |
| 统一调用方法 | `InvokeCommonRVMessageByXMLMsgBody`（入参：`methodName` + `msgBodyXmlString`） |
| 接口列表 | ① `resistInfo`：扫码查询原液定义信息<br>② `check`：校验条码+浓度（不创建数据，batchCreate 前预校验）<br>③ `batchCreate`：批量创建稀释液 |

**调用流程（三步，与 web 端 Dilution Create 页面逻辑一致）：**

```
第 1 步：扫描原液条码 → 调 resistInfo（只传 vendorBarcode）→ 返回定义信息 + 可选稀释浓度列表
第 2 步（可选，推荐）：调 check（传条码列表 + concentration）→ 预校验通过后返回 resistDefRrn，避免 batchCreate 失败
第 3 步：选定浓度 → 调 batchCreate（传条码列表 + resistDefRrn + 瓶数/粘度 + 报表字段）→ 返回创建的稀释液条码
        （创建成功后后端异步完成 dataCollection 收值，与 web 端 Dilution Create 页面行为一致，无需额外调用）
```

---

## 2. 调用约定

### 2.1 请求包装（SOAP Body）

```xml
<soap:Body>
    <InvokeCommonRVMessageByXMLMsgBody xmlns="http://tempuri.org/">
        <methodName>resistInfo</methodName>          <!-- 或 batchCreate -->
        <msgBodyXmlString><![CDATA[<msgBody>...</msgBody>]]></msgBodyXmlString>
    </InvokeCommonRVMessageByXMLMsgBody>
</soap:Body>
```

`msgBodyXmlString` 为各接口的业务参数 XML，根节点固定为 `<msgBody>`。

### 2.2 响应包装

```xml
<InvokeCommonRVMessageByXMLMsgBodyResponse xmlns="http://tempuri.org/">
    <InvokeCommonRVMessageByXMLMsgBodyResult>0</InvokeCommonRVMessageByXMLMsgBodyResult>
    <errorDesc>错误描述（失败时返回）</errorDesc>
    <returnMsgBodyXmlString><![CDATA[<msgBody>...</msgBody>]]></returnMsgBodyXmlString>
</InvokeCommonRVMessageByXMLMsgBodyResponse>
```

| 字段 | 说明 |
|---|---|
| `InvokeCommonRVMessageByXMLMsgBodyResult` | `0`=成功；`1`=失败 |
| `errorDesc` | 失败时的错误描述 |
| `returnMsgBodyXmlString` | 成功时的业务响应 XML（根节点 `<msgBody>`） |

---

## 3. 接口一：resistInfo（扫码查询原液定义）

### 3.1 用途

Dilution Tool 扫描原液条码后，查询该条码对应的原液定义信息及可稀释成的浓度列表（dilutionRelationship），用于确认条码有效并确定创建稀释液所用的浓度定义。

### 3.2 请求参数

**msgBody XML 示例：**

```xml
<msgBody>
    <vendorBarcode>MZJTST11234567826050700003</vendorBarcode>
</msgBody>
```

| 字段 | 类型 | 必传 | 说明 |
|---|---|---|---|
| `vendorBarcode` | String | 是 | 原液供应商条码（26 位，按 7865 规则；特殊条码可走 BarcodeMappingRules 规则） |

**条码解析规则（后端自动完成，对接方无需关心，仅说明）：**

| 条码位置 | 含义 |
|---|---|
| 前 7 位 | resistNO（光刻胶编号）→ 查 RESIST_DEF 定义表 |
| 7-15 位 | defBatchNO（批次号） |
| 15-21 位 | expireTime（有效期，YYMMDD 格式） |
| 前 7 位查不到定义时 | 走 BarcodeMappingRules 匹配规则解析（返回规则中的 TO_RESIST_NO / BatchNo / ExpireTime） |

### 3.3 响应参数

**returnMsgBodyXmlString 示例（字段按实际返回为准）：**

```xml
<msgBody>
    <resistNO>MZJTST1</resistNO>
    <resistName>光刻胶A</resistName>
    <concentration>0.5</concentration>
    <mtrNO>MTR001</mtrNO>
    <defrostTime>08:00</defrostTime>
    <defrostBufferDays>0</defrostBufferDays>
    <warningDay>7</warningDay>
    <extendDays>30</extendDays>
    <viscosityUpperLimit>10</viscosityUpperLimit>
    <viscosityLowerLimit>1</viscosityLowerLimit>
    <vendorBarcode>MZJTST11234567826050700003</vendorBarcode>
    <defBatchNO>12345678</defBatchNO>
    <toResistNo>MZJTST1</toResistNo>
    <expireTime>260507</expireTime>
    <dilutionRelationship>
        <resistNO>MZJTST1-D</resistNO>
        <resistName>稀释光刻胶A</resistName>
        <concentration>0.5</concentration>
        <sysRrn>2030625845182312449</sysRrn>
    </dilutionRelationship>
    <dilutionRelationship>
        <resistNO>MZJTST1-D2</resistNO>
        <resistName>稀释光刻胶A2</resistName>
        <concentration>0.3</concentration>
        <sysRrn>2030625845182312450</sysRrn>
    </dilutionRelationship>
</msgBody>
```

**关键字段说明：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `resistNO` / `toResistNo` | String | 原液光刻胶编号 |
| `defBatchNO` | String | 批次号（条码 7-15 位） |
| `expireTime` | String | 有效期 YYMMDD（条码 15-21 位） |
| `vendorBarcode` | String | 原条码回显 |
| `resistName`、`concentration`、`mtrNO` 等 | - | 原液定义信息（只读展示用） |
| `dilutionRelationship[]` | List | **该原液可稀释成的稀释液定义列表**。每个元素含 `sysRrn`（稀释液定义 RRN）、`resistNO`（稀释液编号）、`concentration`（浓度） |
| `spectrumLimitList[]` | List | 光谱限制项列表（可选，一般不用） |

> **对接要点（重要）：`resistDefRrn` 即所选浓度的稀释液定义 RRN**。Dilution Tool 展示浓度列表时，需把用户选择的浓度与 `dilutionRelationship[]` 中的 `concentration` 对应起来，**取该条记录的 `sysRrn`** 作为 batchCreate 的 `resistDefRrn` 入参。
>
> 示例（resistInfo 实际返回）：
>
> | dilutionRelationship 中的浓度（concentration） | 该条记录的 sysRrn（= resistDefRrn 入参） |
> |---|---|
> | 0.01:2.222 | `2004086388857843713` |
> | 0.01:5 | `2011636530905427970` |
>
> 即：**想创建 0.01:2.222 浓度的稀释液 → resistDefRrn 传 `2004086388857843713`；想创建 0.01:5 → 传 `2011636530905427970`**。注意不要误用主 ResistDefDetailVO 根节点的 `sysRrn`（那是原液定义的 RRN，不是稀释液定义的）。

---

## 4. 接口二：check（预校验，不创建数据）

### 4.1 用途

在执行 `batchCreate` 前，先用 `check` 接口验证条码和浓度的匹配关系。**校验逻辑与 batchCreate 完全一致**（复用同一个服务层代码），但不会创建任何数据。适用于 Dilution Tool 在用户确认前做预校验，避免 `batchCreate` 失败导致事务回滚。

**与 batchCreate 的区别：** check 接口入参为 `concentration`（稀释度）而非 `resistDefRrn`，后端根据条码解析出的原液 resistNO + concentration 反查匹配的稀释液定义，校验通过后返回 `resistDefRrn`，可直接用于后续 batchCreate。

**校验逻辑（与 batchCreate 完全一致）：**
1. 解析条码（7865 规则 / BarcodeMappingRules）
2. 检查所有条码的 resistNO 是否一致
3. 用原液 resistNO 查原液 ResistDef，再用原液 RRN + concentration 查匹配的稀释液定义是否存在

### 4.2 请求参数

**msgBody XML 示例：**

```xml
<msgBody>
    <vendorBarcodeList>MZJTST11234567826050700003</vendorBarcodeList>
    <vendorBarcodeList>MZJTST11234567826050700002</vendorBarcodeList>
    <concentration>0.5</concentration>
</msgBody>
```

| 字段 | 类型 | 必传 | 说明 |
|---|---|---|---|
| `vendorBarcodeList` | String（可重复） | 是（与 sourceResistInfo 二选一） | 同 batchCreate，传原液条码列表 |
| `concentration` | String | 是 | 稀释度（浓度），与 resistInfo 返回的 `dilutionRelationship[].concentration` 一致 |
| `sourceResistInfo` | String | 否 | 同 batchCreate，兼容方式，与 vendorBarcodeList 二选一 |

### 4.3 响应参数

**returnMsgBodyXmlString 示例（校验通过）：**

```xml
<msgBody>
    <resistNO>MZJTST1</resistNO>
    <defResistNO>MZJTST1-D</defResistNO>
    <resistDefRrn>2030625845182312449</resistDefRrn>
    <batchNO>12345678</batchNO>
    <expireDate>260507</expireDate>
    <concentration>0.5</concentration>
    <barcodeCount>2</barcodeCount>
</msgBody>
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `resistNO` | String | 解析后的原液 resistNO |
| `defResistNO` | String | 匹配到的稀释液定义 resistNO |
| `resistDefRrn` | Long | **匹配到的稀释液定义 RRN**（校验通过后可直接作为 batchCreate 的 `resistDefRrn` 入参） |
| `batchNO` | String | 解析后的批次号（取第一个条码） |
| `expireDate` | String | 解析后的有效期（取第一个条码） |
| `concentration` | String | 稀释液定义的浓度（回显入参） |
| `barcodeCount` | Integer | 校验通过的条码数量 |

> 校验失败时返回 `result=1` + `errorDesc`，错误信息与 batchCreate 完全一致（见第 6 节常见错误）。

---

## 5. 接口三：batchCreate（批量创建稀释液）

### 5.1 用途

将一批原液条码（同 resistNO）批量创建为指定浓度的稀释液，创建成功后返回每瓶稀释液的条码列表。

**自动收值（重要）：** 创建成功后，后端会异步执行 `dataCollection` 收值（模拟 web 端 Dilution Create 页面创建成功后再独立调用 `POST /resist/dataCollection` 的行为：按同一批次更新粘度、DCFlag/状态/MountableFlag 并写入历史记录）。**Dilution Tool 无需再单独调用收值接口**。

> 说明：收值在异步线程执行，与创建主流程互不影响（同 web 端两个独立请求）；收值失败不影响创建结果（仅记录日志）；`viscosity` 未传时自动跳过收值。

### 5.2 请求参数（推荐简化方式：只传条码列表，后端自动拼接）

**msgBody XML 示例（含报表字段）：**

```xml
<msgBody>
    <!-- 基础字段 -->
    <vendorBarcodeList>MZJTST11234567826050700003</vendorBarcodeList>
    <vendorBarcodeList>MZJTST11234567826050700002</vendorBarcodeList>
    <resistDefRrn>2030625845182312449</resistDefRrn>
    <eqptId>EQPT-001</eqptId>
    <bottleCount>1</bottleCount>
    <viscosity>5.0</viscosity>
    <labelPrintUrl>http://print-server/bartender/api</labelPrintUrl>
    <!-- 报表字段 -->
    <sourceResistName>原液A</sourceResistName>
    <sourceResistBarcode>SRC-BARCODE-001</sourceResistBarcode>
    <sourceResistWeight>5000.0000</sourceResistWeight>
    <sourceBottleCount>2</sourceBottleCount>
    <operator>张工</operator>
    <checker>李工</checker>
    <mixStartTime>2026-08-01 08:00:00</mixStartTime>
    <mixEndTime>2026-08-01 09:30:00</mixEndTime>
    <viscosityTestTime>2026-08-01 09:40:00</viscosityTestTime>
    <dilutionResistName>稀释光刻胶A</dilutionResistName>
    <dilutionBottleCount>1</dilutionBottleCount>
    <dilutionWeight>100.0000</dilutionWeight>
    <comment>稀释批次备注</comment>
</msgBody>
```

### 5.3 请求字段说明

**基础字段：**

| 字段 | 类型 | 必传 | 说明 |
|---|---|---|---|
| `vendorBarcodeList` | String（可重复） | 是（与 sourceResistInfo 二选一） | 原液条码列表，**重复该元素即多条，只传 1 个元素同样支持**。后端自动解析每个条码 |
| `resistDefRrn` | Long | 是 | **所选浓度的稀释液定义 RRN**：先在 resistInfo 返回的 `dilutionRelationship[]` 中找出 `concentration` 与所选浓度一致的记录，**取该条记录的 `sysRrn`** 传入（见 3.3 对接要点示例）。注意不是主节点（原液定义）的 sysRrn |
| `eqptId` | String | 否 | **机台 ID（报表"机台"字段）**。用于：① 后端按机台从 System Setting > Printing Setting 获取打印地址；② 写入报表表 RESIST_DILUTION_REPORT.EQPT_ID（报表专用独立表，不写 RESIST 主表） |
| `bottleCount` | Integer | 是 | 本次创建的稀释液瓶数 |
| `viscosity` | Double | 是 | 稀释液粘度 |
| `batchNO` | String | 否 | 批次号。**不传时后端从条码自动解析**（条码 7-15 位） |
| `expDate` | String | 否 | 有效期 YYMMDD。**不传时后端从条码自动解析**（条码 15-21 位） |
| `sourceResistInfo` | String | 否 | 兼容字段（见 5.5），简化方式下无需传。**必须传 web 端同款 JSON 字符串**（形如 `{"list":[{...}]}`），**禁止传 XML 对象嵌套结构**（如 `<HashMap><list>...</list></HashMap>`） |
| `labelPrintUrl` | String | 否 | Bartender 打印地址。**不传时后端按 `eqptId` 从 System Setting > Printing Setting（PRINTSETUP 表 EQPT_ID 匹配 SERVER_URL）获取**；两者都未配置则不打印 |

**报表字段（Dilution Tool 过程数据，全部可选，传空不阻塞创建）：**

> 报表字段不写入 RESIST / RESIST_H 主表，而是**每瓶一条写入独立报表表 `RESIST_DILUTION_REPORT`**（与 RESIST 通过 `RESIST_RRN` 1:1 关联，RESIST_RRN = 对应瓶 RESIST.SYS_RRN）。17 个报表字段完整映射如下：

| 报表字段（17 个） | 请求参数 | 报表表列（RESIST_DILUTION_REPORT） |
|---|---|---|
| 稀释日期 | 无（自动） | CREATE_TIME（= 该瓶 RESIST 创建时间） |
| 原液名称 | `sourceResistName` | SOURCE_RESIST_NAME |
| 原液Barcode | `sourceResistBarcode` | SOURCE_RESIST_BARCODE |
| 原液光阻质量 | `sourceResistWeight` | SOURCE_RESIST_WEIGHT |
| 原液瓶数 | `sourceBottleCount` | SOURCE_BOTTLE_COUNT |
| 机台 | `eqptId` | EQPT_ID |
| 作业员 | `operator` | OPERATOR |
| 核对员 | `checker` | CHECKER |
| 搅拌开始时间 | `mixStartTime` | MIX_START_TIME |
| 搅拌结束时间 | `mixEndTime` | MIX_END_TIME |
| 粘度测试时间 | `viscosityTestTime` | VISCOSITY_TEST_TIME |
| 粘度 | `viscosity`（基础字段） | VISCOSITY |
| 稀释光阻名称 | `dilutionResistName` | DILUTION_RESIST_NAME |
| 稀释光阻瓶数 | `dilutionBottleCount` | DILUTION_BOTTLE_COUNT |
| 稀释光阻Barcode | 无（自动） | DILUTION_BARCODE（= 创建成功后该瓶 RESIST_BARCODE） |
| 稀释光阻质量 | `dilutionWeight` | DILUTION_WEIGHT |
| Comment | `comment` | COMMENTS |

> 以上报表参数全部传空时，不产生报表记录（RESIST 照常创建）；`mixStartTime`/`mixEndTime`/`viscosityTestTime` 支持 yyyy-MM-dd HH:mm:ss 等 4 种常见格式，解析失败不阻塞。

### 5.4 参数处理与拼接逻辑（后端自动完成）

```
vendorBarcodeList（条码列表）
        │
        ▼
逐个条码解析（与 web 端 dilutionDetail 完全相同的规则）：
    ├─ 前 7 位查 RESIST_DEF 命中 → 7865 规则：
    │     resistNO = 条码[0,7)、batchNO = 条码[7,15)、expireDate = 条码[15,21)、长度必须 26 位
    └─ 未命中 → BarcodeMappingRules 规则解析 → resistNO / batchNO / expireDate
        │
        ▼
校验①：所有条码解析出的 resistNO 必须一致
校验②：resistNO 必须与 resistDefRrn 指向的稀释液定义匹配，且该定义已配置浓度
        │
        ▼
拼接 batchCreate 入参：
    ├─ batchNO   ：请求未传 → 取第一条条码解析的 batchNO
    ├─ expDate   ：请求未传 → 取第一条条码解析的 expireDate
    ├─ sourceResistInfo：请求未传 → 自动构造 {"list":[{vendorBarcode,resistNO,batchNO,expireDate}...]}
    │                    （与 web 端落库格式一致，仅 4 个字段、不含多余 null 字段），请求已传则原样保存
    │                    → 同时写入 RESIST.SOURCE_RESIST_INFO 与 RESIST.COMMENTS（与 web 端 create 语义一致）
    └─ 报表字段 → 逐字段透传
        │
        ▼
调 PRMS 现有 batchCreate 服务：
    resistDefRrn → 稀释液定义；条码 = resistNO + batchNO + expDate + 序号（批次号+瓶次）
    打印地址：labelPrintUrl 未传 → 按机台 eqptId 从 PRINTSETUP(EQPT_ID 匹配) 取 SERVER_URL
    按 bottleCount 循环创建（每瓶）：
        写 RESIST / RESIST_H / 事务日志
        → 报表字段非空则写 RESIST_DILUTION_REPORT（每瓶一条，RESIST_RRN 关联，稀释日期=CREATE_TIME）
        → 异步打印
```

### 5.5 兼容方式：sourceResistInfo JSON（web 端同款格式，旧调用不破坏）

若对接方沿用旧方式，可传 `sourceResistInfo` 而不传 `vendorBarcodeList`。**注意：`sourceResistInfo` 的内容是 JSON 字符串（与 web 端 Dilution Create 页面提交的完全一致），不是 XML 对象结构**——不要把 JSON 转成 `<HashMap><list>...` 之类的 XML 嵌套元素，否则后端无法解析。

JSON 字符串作为 XML 元素文本直接放置即可：JSON 中的 `"` `{` `}` 在 XML 文本节点中无需转义；若 JSON 中出现 `&`、`<`、`>` 字符则需按 XML 规则转义（正常条码 JSON 中不会出现）。

```xml
<msgBody>
    <resistDefRrn>2030625845182312449</resistDefRrn>
    <bottleCount>1</bottleCount>
    <viscosity>1</viscosity>
    <sourceResistInfo>{"list":[{"vendorBarcode":"MZJTST11234567826050700003","resistNO":"MZJTST1","batchNO":"12345678","expireDate":"260507"}]}</sourceResistInfo>
</msgBody>
```

> 两种方式二选一：同时传时以 `vendorBarcodeList` 为准。`batchNO`/`expDate` 均可省略，省略时取第一个条码（含 JSON 内）的解析值。

### 5.6 响应参数

**returnMsgBodyXmlString 示例：**

```xml
<msgBody>
    <resistSysRrn>2030625845182312501</resistSysRrn>
    <resistSysRrn>2030625845182312502</resistSysRrn>
    <printSuccess>true</printSuccess>
    <resistBarcode>MZJTST11234567826050701001</resistBarcode>
    <resistBarcode>MZJTST11234567826050701002</resistBarcode>
</msgBody>
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `resistSysRrn` | String（可重复） | 创建的稀释液系统 RRN 列表 |
| `resistBarcode` | String（可重复） | **创建的稀释液条码列表**（条码 = resistNO+batchNO+expDate+序号） |
| `printSuccess` | Boolean | 是否打印成功（未传 labelPrintUrl 时可能为 false/null） |

---

## 6. 常见错误（result=1 + errorDesc）

| 场景 | errorDesc 内容示例 |
|---|---|
| 条码为空 / 条码长度不足 7 位 | `vendorBarcode is empty` / StringIndexOutOfBounds 异常描述 |
| 7865 条码长度非 26 位 | `Invalid vendorBarcode length: xx, expect 26: 条码` |
| 未传条码列表且未传 sourceResistInfo | `sourceResistInfo is empty` |
| 多个条码 resistNO 不一致 | `Scanned Resist No are inconsistent, found: ...` |
| resistDefRrn 无效 | `ResistDef not found, resistDefRrn: xx` |
| 条码 resistNO 与定义不匹配 | `Resist No mismatch: source=xx, resistDef=xx` |
| 浓度未配置 | `Concentration is not configured for ResistDef: xx` |

---

## 7. 对接自测建议

1. 先调 `resistInfo` 验证条码可解析（返回 `toResistNo`、`dilutionRelationship` 非空）
2. 从 `dilutionRelationship` 任取一条的 `sysRrn` 作为 `resistDefRrn`
3. （可选）调 `check` 预校验，确认条码+浓度匹配通过
4. 调 `batchCreate`（简化方式），确认返回 `resistBarcode` 列表且 `result=0`
5. 报表字段逐个加上再调一次，确认不报错且落库正确（数据库 RESIST_DILUTION_REPORT 表：每瓶一条，RESIST_RRN 与 RESIST.SYS_RRN 对应，稀释日期=CREATE_TIME、Comment=COMMENTS）

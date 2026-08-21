# Docs 目录导航

本目录包含项目的架构与实现相关文档：

- `project_env.md`：格科光阻稀释机台项目背景与程序需求（已整合 `Dilution_程序需求.xlsx`）
- `Dilution_程序需求.xlsx`：光阻稀释程序需求原始表格（程序设置、报表样式参考）
- `architecture.md`：系统架构总览（宏观分层、数据流、目录结构等）
- `implementation/README.md`：实现原理拆解（对照源码、按模块深入）
- `implementation/11-hmip-binary-protocol.md`：HMIP 二进制协议（帧格式/CRC/消息类型/事件流）
- `implementation/12-craftsmanship-backend.md`：工艺流程后端实现说明（工作区模型、校验、运行时、设计理念）
- `implementation/13-dilution-preimplementation.md`：光阻稀释预实现设计（通用后端补强、领域层、批次状态机、接口与测试策略）
- `device-serial-interface.md`：**设备串口对接接口文档（HMIP v1 over Serial）**——给设备侧开发人员的完整接口契约（串口参数、链路行为、帧协议、动作/反馈模型、workspace 配置与调试方法）
- `PRMS_DilutionTool接口对接文档_v1.1.md`：PRMS 稀释工具 SOAP 接口对接文档
- `HMI_ARCHITECTURE.md`：HMI 架构补充说明（如有）
- `dev-plan.md`：开发计划与迭代记录（如有）
- `raspberry-pi-deploy/`：树莓派部署相关说明

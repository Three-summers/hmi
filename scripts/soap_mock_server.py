#!/usr/bin/env python3
"""本地 PRMS SOAP mock 服务（验证 dilution 的 SOAP invoke 层 / 真实 App UI 冒烟）

模拟 PRMS 的 `InvokeCommonRVMessageByXMLMsgBody` 统一 SOAP 入口，响应：
- PRMSResistInfoInq       → 原液信息 + 2 个稀释浓度关系（0.01:2.222 / 0.01:2.5）
- PRMSResistInfoCheckInq  → resistDefRrn / batchNO / expireDate
- PRMSBatchCreateReq      → 按请求 bottleCount 返回等量 resistSysRrn[] / resistBarcode[] / printSuccess

特殊条码触发错误分支（用于验证错误路径）：
- 条码含 UNKNOWN → PRMSResistInfoInq 返回 result=1（"vendorBarcode not found"）
- 条码含 REJECT  → PRMSResistInfoCheckInq 返回 result=1（"barcode not matched with concentration"）
- 条码含 FAIL    → PRMSBatchCreateReq 返回 result=1（"batchCreate failed"）

用法：
    python3 scripts/soap_mock_server.py [port]        # 默认 8899
    然后另开终端：
    PRMS_SOAP_ENDPOINT=http://127.0.0.1:8899/ ./dev.sh

注意：mock 支持两种场景：
- 默认场景：MZJTST 条码，浓度 0.01:2.222 / 0.01:2.5（raw:solvent 比例）
- 现场附表场景：MLTOK 前缀条码 → TMR-IK02 PM 5.4cP → 70% 稀释（也接受 70:30 写法）
"""
import html
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOAP_ACTION = "InvokeCommonRVMessageByXMLMsgBody"

RESIST_INFO_MSG_BODY = """<msgBody><resistNO>MZJTST1</resistNO><resistName>光刻胶A</resistName><concentration>1.0</concentration><mtrNO>MTR001</mtrNO><defrostTime>08:00</defrostTime><vendorBarcode>{barcode}</vendorBarcode><defBatchNO>12345678</defBatchNO><toResistNo>MZJTST1</toResistNo><expireTime>260507</expireTime><dilutionRelationship><resistNO>MZJTST1-D</resistNO><resistName>稀释光刻胶A 0.01:2.222</resistName><concentration>0.01:2.222</concentration><sysRrn>2030625845182312449</sysRrn></dilutionRelationship><dilutionRelationship><resistNO>MZJTST1-D2</resistNO><resistName>稀释光刻胶A2 0.01:2.5</resistName><concentration>0.01:2.5</concentration><sysRrn>2030625845182312450</sysRrn></dilutionRelationship></msgBody>"""

# 现场联调场景（附表）：MLTOK 前缀原液条码 → TMR-IK02 PM 5.4cP → 70% 稀释
MLTOK_RESIST_INFO_MSG_BODY = """<msgBody><resistNO>MLTOK01</resistNO><resistName>TMR-IK02 PM 5.4cP</resistName><concentration>1.0</concentration><mtrNO>MTR001</mtrNO><defrostTime>08:00</defrostTime><vendorBarcode>{barcode}</vendorBarcode><defBatchNO>{def_batch_no}</defBatchNO><toResistNo>MLTOK01</toResistNo><expireTime>{expire_time}</expireTime><dilutionRelationship><resistNO>MLTOK01-D</resistNO><resistName>TMR-IK02 PM 5.4cP-70%</resistName><concentration>70%</concentration><sysRrn>2030625845182312999</sysRrn></dilutionRelationship></msgBody>"""

FIELD_70_PCT_RRN = "2030625845182312999"

CHECK_MSG_BODY = "<msgBody><resistNO>MZJTST1</resistNO><defResistNO>MZJTST1-D</defResistNO><resistDefRrn>{rrn}</resistDefRrn><batchNO>12345678</batchNO><expireDate>260507</expireDate><concentration>{concentration}</concentration><barcodeCount>{barcode_count}</barcodeCount></msgBody>"

RRN_BY_CONCENTRATION = {
    "0.01:2.222": "2030625845182312449",
    "0.01:2.5": "2030625845182312450",
    "70%": FIELD_70_PCT_RRN,
    "70:30": FIELD_70_PCT_RRN,
}


def batch_create_msg_body(bottle_count, rrn=""):
    if rrn == FIELD_70_PCT_RRN:
        sys_rrn_prefix, barcode_prefix = "20306258451823130", "MLTOK01-D"
    else:
        sys_rrn_prefix, barcode_prefix = "20306258451823125", "MZJTST1-D"
    sys_rrns = "".join(
        f"<resistSysRrn>{sys_rrn_prefix}{i:02}</resistSysRrn>" for i in range(1, bottle_count + 1)
    )
    barcodes = "".join(
        f"<resistBarcode>{barcode_prefix}-{i:03}</resistBarcode>" for i in range(1, bottle_count + 1)
    )
    return f"<msgBody>{sys_rrns}{barcodes}<printSuccess>true</printSuccess></msgBody>"


def envelope(result, error_desc=None, return_body=None):
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
        "  <soap:Body>",
        '    <InvokeCommonRVMessageByXMLMsgBodyResponse xmlns="http://tempuri.org/">',
        f"      <InvokeCommonRVMessageByXMLMsgBodyResult>{result}</InvokeCommonRVMessageByXMLMsgBodyResult>",
    ]
    if error_desc:
        parts.append(f"      <errorDesc>{error_desc}</errorDesc>")
    if return_body:
        parts.append(f"      <returnMsgBodyXmlString><![CDATA[{return_body}]]></returnMsgBodyXmlString>")
    parts.extend([
        "    </InvokeCommonRVMessageByXMLMsgBodyResponse>",
        "  </soap:Body>",
        "</soap:Envelope>",
    ])
    return "\n".join(parts)


def _extract(escaped_body, element):
    """从（可能被 XML 转义的）请求体提取元素文本；兼容 CDATA 与转义两种形态

    SOAP 包装层的 methodName / msgBodyXmlString 带 `temp:` 命名空间前缀，
    业务 msgBody 内元素无前缀，故开/闭标签都允许可选前缀。
    """
    prefix = r"(?:[^<>\s]*:)?"
    pattern = rf"<{prefix}{element}>(.*?)</{prefix}{element}>"
    match = re.search(pattern, escaped_body)
    if not match:
        pattern = rf"&lt;{element}&gt;(.*?)&lt;/{element}&gt;"
        match = re.search(pattern, escaped_body)
    return html.unescape(match.group(1)) if match else None


def respond(body):
    method = _extract(body, "methodName") or "unknown"
    if method == "PRMSResistInfoInq":
        barcode = _extract(body, "vendorBarcode") or ""
        if "UNKNOWN" in barcode:
            return envelope(1, "vendorBarcode not found")
        if barcode.startswith("MLTOK"):
            return envelope(0, None, MLTOK_RESIST_INFO_MSG_BODY.format(
                barcode=barcode,
                def_batch_no=barcode[7:15],
                expire_time=barcode[15:21],
            ))
        return envelope(0, None, RESIST_INFO_MSG_BODY.format(barcode=barcode))
    if method == "PRMSResistInfoCheckInq":
        if "REJECT" in body:
            return envelope(1, "barcode not matched with concentration")
        concentration = _extract(body, "concentration") or ""
        rrn = RRN_BY_CONCENTRATION.get(concentration)
        if not rrn:
            return envelope(1, "barcode not matched with concentration")
        barcode_count = len(re.findall(r"&lt;vendorBarcodeList&gt;", body))
        return envelope(0, None, CHECK_MSG_BODY.format(
            concentration=concentration, rrn=rrn, barcode_count=barcode_count
        ))
    if method == "PRMSBatchCreateReq":
        if "FAIL" in body:
            return envelope(1, "batchCreate failed")
        if not _extract(body, "vendorBarcodeList"):
            return envelope(1, "sourceResistInfo is empty")
        rrn = _extract(body, "resistDefRrn") or ""
        if rrn not in RRN_BY_CONCENTRATION.values():
            return envelope(1, "ResistDef not found, resistDefRrn")
        try:
            viscosity = float(_extract(body, "viscosity") or "")
        except ValueError:
            return envelope(1, "viscosity is empty")
        if not viscosity == viscosity:
            return envelope(1, "viscosity is empty")
        try:
            count = int(_extract(body, "bottleCount") or "")
        except ValueError:
            return envelope(1, "bottleCount must be greater than 0")
        if count <= 0:
            return envelope(1, "bottleCount must be greater than 0")
        return envelope(0, None, batch_create_msg_body(count, rrn))
    return None  # 未知方法 → HTTP 500


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", "replace")
        method = _extract(body, "methodName") or "unknown"
        response = respond(body)
        if response is None:
            status, payload = 500, "unknown SOAP method"
        else:
            status, payload = 200, response
        print(f"[mock] POST {self.path} method={method} -> HTTP {status}", flush=True)
        self.send_response(status)
        self.send_header("Content-Type", "text/xml; charset=utf-8")
        self.send_header("Content-Length", str(len(payload.encode("utf-8"))))
        self.end_headers()
        self.wfile.write(payload.encode("utf-8"))

    def log_message(self, format, *args):  # 关闭默认日志，避免与上面的行重复
        del format, args


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"PRMS SOAP mock 服务已启动: http://127.0.0.1:{port}/")
    print(f"用法: PRMS_SOAP_ENDPOINT=http://127.0.0.1:{port}/ ./dev.sh")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()

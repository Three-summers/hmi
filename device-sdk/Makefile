CC ?= gcc
CFLAGS ?= -std=c99 -O2 -Wall -Wextra -pedantic -I.
SANITIZE ?=

ifeq ($(SANITIZE),1)
CFLAGS += -fsanitize=address,undefined -fno-omit-frame-pointer -g
LDFLAGS += -fsanitize=address,undefined
endif

# 所有主机端编译产物统一输出到 build/（已被 .gitignore 忽略）
OUT ?= build

SDK_DEPS = hmip.c hmip.h examples/device_business.c examples/device_business.h

# 互操作联调：需要 rustup 工具链（$HOME/.rustup）与 node
RUSTUP_BIN := $(HOME)/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin
CARGO ?= cargo
NODE ?= node

REF_HMIP ?= interop/ref-hmip/target/debug/ref-hmip
REF_SERIAL ?= interop/ref-serial/target/debug/ref-serial

.PHONY: all test example interop serial-mock clean

all: test example

test: $(OUT)/test_hmip
	./$(OUT)/test_hmip

$(OUT)/test_hmip: tests/test_hmip.c $(SDK_DEPS) | $(OUT)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ tests/test_hmip.c hmip.c examples/device_business.c

example: $(OUT)/host_demo
	./$(OUT)/host_demo

$(OUT)/host_demo: examples/host_demo.c $(SDK_DEPS) | $(OUT)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ examples/host_demo.c hmip.c examples/device_business.c

# 与 HMI 侧真实 Rust 协议代码（src-tauri/src/comm/proto.rs）的双向互操作联调
interop: $(OUT)/interop_cli
	PATH="$(RUSTUP_BIN):$(PATH)" CARGO_HOME=$(HOME)/.cargo RUSTUP_HOME=$(HOME)/.rustup $(CARGO) build --offline --manifest-path interop/ref-hmip/Cargo.toml
	PATH="$(RUSTUP_BIN):$(PATH)" INTEROP_CLI=$(OUT)/interop_cli REF_HMIP=$(REF_HMIP) $(NODE) interop/run_interop.mjs

$(OUT)/interop_cli: interop/interop_cli.c $(SDK_DEPS) | $(OUT)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ interop/interop_cli.c hmip.c examples/device_business.c

# socat 虚拟串口（PTY 对）联调：真实 HMI 串口栈 <-> C SDK 设备端，走真实 TTY
serial-mock: $(OUT)/pty_device
	PATH="$(RUSTUP_BIN):$(PATH)" CARGO_HOME=$(HOME)/.cargo RUSTUP_HOME=$(HOME)/.rustup $(CARGO) build --offline --manifest-path interop/ref-serial/Cargo.toml
	PATH="$(RUSTUP_BIN):$(PATH)" PTY_DEVICE=$(OUT)/pty_device REF_SERIAL=$(REF_SERIAL) $(NODE) interop/run_serial_mock.mjs

$(OUT)/pty_device: interop/pty_device.c hmip.c hmip.h | $(OUT)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ interop/pty_device.c hmip.c

$(OUT):
	mkdir -p $(OUT)

clean:
	rm -rf $(OUT)

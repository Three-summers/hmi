import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { SerialConfig, TcpConfig, CommState } from "@/types";

interface CommStoreState extends CommState {
  // Serial actions
  connectSerial: (config: SerialConfig) => Promise<void>;
  disconnectSerial: () => Promise<void>;
  sendSerialData: (data: number[]) => Promise<void>;

  // TCP actions
  connectTcp: (config: TcpConfig) => Promise<void>;
  disconnectTcp: () => Promise<void>;
  sendTcpData: (data: number[]) => Promise<void>;

  // Get available serial ports
  getSerialPorts: () => Promise<string[]>;

  // Clear error
  clearError: () => void;
}

export const useCommStore = create<CommStoreState>((set) => ({
  serialConnected: false,
  tcpConnected: false,
  serialConfig: undefined,
  tcpConfig: undefined,
  lastError: undefined,

  connectSerial: async (config) => {
    try {
      await invoke("connect_serial", {
        config: {
          port: config.port,
          baud_rate: config.baudRate,
          data_bits: config.dataBits,
          stop_bits: config.stopBits,
          parity: config.parity,
        },
      });
      set({ serialConnected: true, serialConfig: config, lastError: undefined });
    } catch (error) {
      set({ lastError: String(error) });
      throw error;
    }
  },

  disconnectSerial: async () => {
    try {
      await invoke("disconnect_serial");
      set({ serialConnected: false, serialConfig: undefined });
    } catch (error) {
      set({ lastError: String(error) });
      throw error;
    }
  },

  sendSerialData: async (data) => {
    try {
      await invoke("send_serial_data", { data });
    } catch (error) {
      set({ lastError: String(error) });
      throw error;
    }
  },

  connectTcp: async (config) => {
    try {
      await invoke("connect_tcp", {
        config: {
          host: config.host,
          port: config.port,
          timeout_ms: config.timeoutMs,
        },
      });
      set({ tcpConnected: true, tcpConfig: config, lastError: undefined });
    } catch (error) {
      set({ lastError: String(error) });
      throw error;
    }
  },

  disconnectTcp: async () => {
    try {
      await invoke("disconnect_tcp");
      set({ tcpConnected: false, tcpConfig: undefined });
    } catch (error) {
      set({ lastError: String(error) });
      throw error;
    }
  },

  sendTcpData: async (data) => {
    try {
      await invoke("send_tcp_data", { data });
    } catch (error) {
      set({ lastError: String(error) });
      throw error;
    }
  },

  getSerialPorts: async () => {
    try {
      const ports = await invoke<string[]>("get_serial_ports");
      return ports;
    } catch (error) {
      set({ lastError: String(error) });
      return [];
    }
  },

  clearError: () => set({ lastError: undefined }),
}));

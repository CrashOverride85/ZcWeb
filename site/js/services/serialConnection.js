import { APP_CONFIG } from "../config.js";

export class SerialConnection {
  constructor(port) {
    this.port = port;
    this.reader = null;
    this.writer = null;
    this.readQueue = [];
    this.waiters = [];
    this.closed = false;
    this.readLoopPromise = null;
  }

  static isSupported() {
    return "serial" in navigator;
  }

  static supportMessage() {
    if (!window.isSecureContext) {
      return "Web Serial requires HTTPS or localhost. This page is currently being served from an insecure origin, so Chromium will hide serial port access.";
    }

    if (!SerialConnection.isSupported()) {
      return "Web Serial is not available in this browser. Use Chrome, Edge, or another Chromium-based desktop browser version 89 or newer.";
    }

    return "";
  }

  static async requestPort() {
    const supportMessage = SerialConnection.supportMessage();
    if (supportMessage) {
      throw new Error(supportMessage);
    }

    return navigator.serial.requestPort();
  }

  async open() {
    if (this.port.readable && this.port.writable) {
      return;
    }

    await this.port.open({
      baudRate: APP_CONFIG.serial.baudRate,
      dataBits: APP_CONFIG.serial.dataBits,
      stopBits: APP_CONFIG.serial.stopBits,
      parity: APP_CONFIG.serial.parity,
      flowControl: APP_CONFIG.serial.flowControl,
    });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.closed = false;
    this.readLoopPromise = this.startReadLoop();
  }

  async close() {
    this.closed = true;
    this.rejectPendingReaders(new Error("Serial port closed."));

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
      }
    } catch {
      // The port may already be gone if the adapter was unplugged.
    }

    try {
      if (this.writer) {
        this.writer.releaseLock();
      }
    } catch {
      // Ignore release failures during shutdown.
    }

    if (this.port.readable || this.port.writable) {
      await this.port.close();
    }
  }

  clearInput() {
    this.readQueue = [];
  }

  async writeByte(byte) {
    await this.writeBytes(Uint8Array.of(byte));
  }

  async writeBytes(bytes) {
    if (!this.writer) {
      throw new Error("Serial port is not open.");
    }

    await this.writer.write(bytes);
  }

  readByte(timeoutMs) {
    if (this.readQueue.length > 0) {
      return Promise.resolve(this.readQueue.shift());
    }

    if (this.closed) {
      return Promise.reject(new Error("Serial port is closed."));
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = window.setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async startReadLoop() {
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }

        if (value) {
          this.pushIncomingBytes(value);
        }
      }
    } catch (error) {
      if (!this.closed) {
        this.rejectPendingReaders(error);
      }
    }
  }

  pushIncomingBytes(bytes) {
    for (const byte of bytes) {
      const waiter = this.waiters.shift();
      if (waiter) {
        window.clearTimeout(waiter.timer);
        waiter.resolve(byte);
      } else {
        this.readQueue.push(byte);
      }
    }
  }

  rejectPendingReaders(error) {
    for (const waiter of this.waiters) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }
}

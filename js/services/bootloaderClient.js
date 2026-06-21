import { APP_CONFIG } from "../config.js";
import { sendXModemCrc } from "../lib/xmodem.js";

const STX = 0x02;
const ETX = 0x03;
const ACK = 0x06;
const SYN = 0x16;

export class BootloaderClient {
  constructor(connection) {
    this.connection = connection;
  }

  async waitForBootloaderSyn(onStatus = () => {}) {
    const deadline = Date.now() + APP_CONFIG.serial.synTimeoutMs;
    onStatus("Waiting for the device to power up.");

    while (Date.now() < deadline) {
      const byte = await this.connection.readByte(Math.min(1000, deadline - Date.now()));

      if (byte === SYN) {
        await this.connection.writeByte(ACK);
        onStatus("Bootloader detected. ACK sent.");
        await sleep(100);
        return;
      }
    }

    throw new Error("Timed out waiting for SYN from the device.");
  }

  async sendCommand(command, onStatus = () => {}) {
    this.connection.clearInput();
    const encoded = new TextEncoder().encode(command);
    const frame = new Uint8Array(encoded.length + 2);
    frame[0] = STX;
    frame.set(encoded, 1);
    frame[frame.length - 1] = ETX;
    await this.connection.writeBytes(frame);
    onStatus(`Sent bootloader command ${command}.`);
    await sleep(100);
  }

  async uploadImages(preparedFirmware, hooks = {}) {
    const { onStatus = () => {}, onStageProgress = () => {} } = hooks;
    const stages = [
      {
        command: APP_CONFIG.bootloaderCommands.zc95Upload,
        label: "Uploading ZC95 firmware.",
        image: preparedFirmware.zc95,
      },
      {
        command: APP_CONFIG.bootloaderCommands.zc624Upload,
        label: "Uploading ZC624 output firmware.",
        image: preparedFirmware.zc624,
      },
    ];

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      const stage = stages[stageIndex];
      onStatus(stage.label);
      await this.sendCommand(stage.command, onStatus);
      await sendXModemCrc(this.connection, stage.image.uploadData, {
        onProgress: (current, total, bytesTransferred, totalBytes) =>
          onStageProgress(
            stageIndex,
            stages.length,
            current,
            total,
            bytesTransferred,
            totalBytes
          ),
        onStatus,
      });
    }

    await this.sendCommand(APP_CONFIG.bootloaderCommands.launchFirmware, onStatus);
    onStageProgress(stages.length, stages.length, 1, 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

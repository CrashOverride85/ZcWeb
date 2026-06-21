const SOH = 0x01;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const CRC_REQUEST = 0x43;
const BLOCK_SIZE = 128;
const CPM_EOF = 0x1A;

export class XModemError extends Error {
  constructor(message) {
    super(message);
    this.name = "XModemError";
  }
}

export async function sendXModemCrc(connection, payload, options = {}) {
  const {
    onProgress = () => {},
    onStatus = () => {},
    startTimeoutMs = 15_000,
    retryLimit = 10,
  } = options;

  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const totalBlocks = Math.max(1, Math.ceil(data.length / BLOCK_SIZE));

  onProgress(0, totalBlocks, 0, data.length);
  onStatus("Waiting for receiver to request XMODEM/CRC.");
  await waitForReceiverReady(connection, startTimeoutMs);
  onStatus("Receiver requested XMODEM/CRC; upload started.");

  let blockNumber = 1;
  for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
    const blockData = sliceAndPadBlock(data, blockIndex);
    const packet = buildPacket(blockNumber, blockData);
    await sendBlockWithRetries(connection, packet, blockIndex + 1, retryLimit, startTimeoutMs);
    onProgress(
      blockIndex + 1,
      totalBlocks,
      Math.min((blockIndex + 1) * BLOCK_SIZE, data.length),
      data.length
    );
    blockNumber = (blockNumber + 1) & 0xFF;
  }

  await finishTransfer(connection, retryLimit, startTimeoutMs);
}

async function waitForReceiverReady(connection, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const byte = await connection.readByte(Math.min(1000, deadline - Date.now()));
    if (byte === CRC_REQUEST) {
      return;
    }
    if (byte === CAN) {
      throw new XModemError("Receiver cancelled the transfer.");
    }
  }

  throw new XModemError("Timed out waiting for XMODEM/CRC start request.");
}

async function sendBlockWithRetries(connection, packet, blockIndex, retryLimit, ackTimeoutMs) {
  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    await connection.writeBytes(packet);
    const response = await waitForAckOrRetry(connection, ackTimeoutMs);

    if (response === ACK) {
      return;
    }

    if (response === CAN) {
      throw new XModemError("Receiver cancelled the transfer.");
    }
  }

  throw new XModemError(`Block ${blockIndex} was not acknowledged.`);
}

async function waitForAckOrRetry(connection, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const byte = await connection.readByte(Math.min(1000, deadline - Date.now()));
    if (byte === null) {
      continue;
    }
    if (byte === ACK || byte === NAK || byte === CAN) {
      return byte;
    }
  }

  return NAK;
}

async function finishTransfer(connection, retryLimit, ackTimeoutMs) {
  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    await connection.writeByte(EOT);
    const response = await waitForAckOrRetry(connection, ackTimeoutMs);

    if (response === ACK) {
      return;
    }

    if (response === CAN) {
      throw new XModemError("Receiver cancelled the transfer.");
    }
  }

  throw new XModemError("End of transfer was not acknowledged.");
}

function buildPacket(blockNumber, blockData) {
  const packet = new Uint8Array(3 + BLOCK_SIZE + 2);
  const crc = crc16Ccitt(blockData);

  packet[0] = SOH;
  packet[1] = blockNumber;
  packet[2] = 0xFF - blockNumber;
  packet.set(blockData, 3);
  packet[packet.length - 2] = (crc >> 8) & 0xFF;
  packet[packet.length - 1] = crc & 0xFF;

  return packet;
}

function sliceAndPadBlock(data, blockIndex) {
  const block = new Uint8Array(BLOCK_SIZE);
  block.fill(CPM_EOF);
  block.set(data.slice(blockIndex * BLOCK_SIZE, (blockIndex + 1) * BLOCK_SIZE));
  return block;
}

function crc16Ccitt(bytes) {
  let crc = 0;

  for (const byte of bytes) {
    crc = ((crc >> 8) | (crc << 8)) & 0xFFFF;
    crc ^= byte;
    crc ^= (crc & 0xFF) >> 4;
    crc ^= (crc << 8) << 4;
    crc ^= ((crc & 0xFF) << 4) << 1;
    crc &= 0xFFFF;
  }

  return crc;
}

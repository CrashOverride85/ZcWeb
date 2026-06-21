import { APP_CONFIG } from "../config.js";

const UF2_BLOCK_SIZE = 512;
const UF2_MAGIC_START0 = 0x0A324655;
const UF2_MAGIC_START1 = 0x9E5D5157;
const UF2_MAGIC_END = 0x0AB16F30;
const UF2_DATA_OFFSET = 32;
const UF2_MAX_PAYLOAD_SIZE = 476;

export class Uf2Error extends Error {
  constructor(message) {
    super(message);
    this.name = "Uf2Error";
  }
}

export async function downloadAndPrepareFirmware(firmwareOption, onStatus = () => {}) {
  const files = [
    { key: "zc95", asset: firmwareOption.assets.zc95, expectedName: "zc95.uf2" },
    { key: "zc624", asset: firmwareOption.assets.zc624, expectedName: "OutputZc.uf2" },
  ];

  const prepared = {};

  for (const file of files) {
    onStatus(`Downloading ${file.asset.name}.`);
    const rawUf2 = await fetchArrayBuffer(file.asset.downloadUrl);
    onStatus(`Preparing ${file.asset.name}.`);
    prepared[file.key] = prepareUf2Image(file.expectedName, rawUf2);
  }

  return prepared;
}

export function prepareUf2Image(filename, rawUf2) {
  const { imageData, baseAddress } = uf2ToBinBytes(rawUf2);
  const firmwareInfo = extractFirmwareInfo(imageData);
  const expectedMagic = APP_CONFIG.firmware.expectedMagic[filename];

  if (expectedMagic !== undefined && firmwareInfo.magic !== expectedMagic) {
    throw new Uf2Error(
      `${filename} has firmware magic ${toHex(firmwareInfo.magic)}; expected ${toHex(expectedMagic)}.`
    );
  }

  return {
    filename,
    baseAddress,
    firmwareInfo,
    fullImage: imageData,
    uploadData: imageData.slice(APP_CONFIG.firmware.bootloaderSkipBytes),
  };
}

export function uf2ToBinBytes(rawUf2) {
  const bytes = rawUf2 instanceof Uint8Array ? rawUf2 : new Uint8Array(rawUf2);
  if (bytes.length === 0 || bytes.length % UF2_BLOCK_SIZE !== 0) {
    throw new Uf2Error("UF2 file size must be a non-zero multiple of 512 bytes.");
  }

  const blocks = new Map();
  const seenBlockNumbers = new Set();
  let expectedTotalBlocks = null;

  for (let offset = 0, index = 0; offset < bytes.length; offset += UF2_BLOCK_SIZE, index += 1) {
    const block = bytes.slice(offset, offset + UF2_BLOCK_SIZE);

    if (readU32LE(block, 0) !== UF2_MAGIC_START0 || readU32LE(block, 4) !== UF2_MAGIC_START1) {
      throw new Uf2Error(`UF2 magic mismatch in block ${index}.`);
    }

    if (readU32LE(block, 508) !== UF2_MAGIC_END) {
      throw new Uf2Error(`UF2 end magic mismatch in block ${index}.`);
    }

    const targetAddress = readU32LE(block, 12);
    const payloadSize = readU32LE(block, 16);
    const blockNumber = readU32LE(block, 20);
    const totalBlocks = readU32LE(block, 24);

    if (payloadSize <= 0 || payloadSize > UF2_MAX_PAYLOAD_SIZE) {
      throw new Uf2Error(`Invalid UF2 payload size ${payloadSize} in block ${index}.`);
    }

    if (expectedTotalBlocks === null) {
      if (totalBlocks <= 0) {
        throw new Uf2Error("UF2 block count must be greater than zero.");
      }
      expectedTotalBlocks = totalBlocks;
    } else if (totalBlocks !== expectedTotalBlocks) {
      throw new Uf2Error("UF2 blocks disagree on total block count.");
    }

    if (blockNumber >= totalBlocks) {
      throw new Uf2Error(`Invalid block number ${blockNumber} in block ${index}.`);
    }

    const payload = block.slice(UF2_DATA_OFFSET, UF2_DATA_OFFSET + payloadSize);
    const existing = blocks.get(targetAddress);
    if (existing && !bytesEqual(existing, payload)) {
      throw new Uf2Error(`Conflicting UF2 payload at address ${toHex(targetAddress)}.`);
    }

    blocks.set(targetAddress, payload);
    seenBlockNumbers.add(blockNumber);
  }

  if (blocks.size === 0) {
    throw new Uf2Error("UF2 file did not contain any payload blocks.");
  }

  if (expectedTotalBlocks !== null && seenBlockNumbers.size !== expectedTotalBlocks) {
    throw new Uf2Error("UF2 file is missing one or more blocks.");
  }

  const addresses = [...blocks.keys()].sort((a, b) => a - b);
  const baseAddress = addresses[0];
  const endAddress = addresses.reduce(
    (max, address) => Math.max(max, address + blocks.get(address).length),
    baseAddress
  );
  const imageData = new Uint8Array(endAddress - baseAddress);
  imageData.fill(0xFF);

  for (const address of addresses) {
    imageData.set(blocks.get(address), address - baseAddress);
  }

  return { imageData, baseAddress };
}

export function extractFirmwareInfo(imageData) {
  const requiredSize = APP_CONFIG.firmware.bootloaderSkipBytes + APP_CONFIG.firmware.imageHeaderSize;
  if (imageData.length < requiredSize) {
    throw new Uf2Error("Converted image is too small to contain the expected firmware header.");
  }

  const headerOffset = APP_CONFIG.firmware.bootloaderSkipBytes;
  const magic = readU32LE(imageData, headerOffset);
  const versionStart = headerOffset + 8;
  const versionEnd = versionStart + APP_CONFIG.firmware.versionLength;
  const versionBytes = imageData.slice(versionStart, versionEnd);
  const nulIndex = versionBytes.indexOf(0);
  const versionSlice = nulIndex >= 0 ? versionBytes.slice(0, nulIndex) : versionBytes;
  const firmwareVersion = new TextDecoder("ascii").decode(versionSlice).trim();

  return { magic, firmwareVersion };
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download firmware asset (${response.status}).`);
  }
  return response.arrayBuffer();
}

function readU32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function bytesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function toHex(value) {
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

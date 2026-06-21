import { APP_CONFIG } from "../config.js";

export async function fetchAvailableFirmwares() {
  const response = await fetch(APP_CONFIG.firmwareIndexUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load firmware index (${response.status}).`);
  }

  const index = await response.json();
  if (!index || !Array.isArray(index.firmwares)) {
    throw new Error("Firmware index is not in the expected format.");
  }

  return index.firmwares
    .filter(isSupportedFirmware)
    .map(toFirmwareOption)
    .filter((firmware) => firmware.assets.zc95 && firmware.assets.zc624)
    .sort((a, b) => compareVersions(b.version, a.version));
}

function isSupportedFirmware(firmware) {
  const version = parseVersion(firmware.tag || "");
  if (!version) {
    return false;
  }

  return compareVersions(version, APP_CONFIG.minimumFirmwareVersion) >= 0;
}

function toFirmwareOption(firmware) {
  const tag = String(firmware.tag || "");

  return {
    id: tag,
    label: tag,
    tag,
    version: parseVersion(tag),
    description: firmware.description || "",
    moreInfoUrl: `${APP_CONFIG.zc95RepoUrl.replace(/\/$/, "")}/releases/tag/${encodeURIComponent(tag)}`,
    assets: {
      zc95: toAssetInfo("zc95.uf2", firmware.zc95Path, firmware.zc95SizeBytes),
      zc624: toAssetInfo("OutputZc.uf2", firmware.zc624Path, firmware.zc624SizeBytes),
    },
  };
}

function toAssetInfo(name, path, sizeBytes) {
  if (!path) {
    return null;
  }

  return {
    name,
    size: sizeBytes || 0,
    digest: "",
    downloadUrl: joinUrlPath(APP_CONFIG.firmwareBaseUrl, path),
  };
}

function joinUrlPath(base, path) {
  return `${base.replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
}

function parseVersion(input) {
  const match = String(input).trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) {
    return null;
  }

  return [match[1], match[2], match[3] || "0"].join(".");
}

function compareVersions(a, b) {
  const left = String(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return 0;
}

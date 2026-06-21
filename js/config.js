export const APP_CONFIG = {
  firmwareIndexUrl: "./data/firmware/index.json",
  firmwareBaseUrl: "./data/firmware/",
  zc95RepoUrl: "https://github.com/CrashOverride85/zc95",
  minimumFirmwareVersion: "2.1",
  serial: {
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    synTimeoutMs: 60_000,
  },
  firmware: {
    bootloaderSkipBytes: 48 * 1024,
    imageHeaderSize: 128,
    versionLength: 32,
    expectedAssets: ["zc95.uf2", "OutputZc.uf2"],
    expectedMagic: {
      "zc95.uf2": 0x5A433935,
      "OutputZc.uf2": 0x7A363234,
    },
  },
  bootloaderCommands: {
    zc95Upload: "95:05",
    zc624Upload: "624:05",
    launchFirmware: "95:07",
  },
};

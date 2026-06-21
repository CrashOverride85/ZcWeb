import { fetchAvailableFirmwares } from "../services/firmwareIndex.js";
import { downloadAndPrepareFirmware } from "../lib/uf2.js";
import { SerialConnection } from "../services/serialConnection.js";
import { BootloaderClient } from "../services/bootloaderClient.js";

export async function renderFirmwarePage(root) {
  const state = {
    firmwares: [],
    selectedFirmwareId: "",
    port: null,
    connection: null,
    busy: false,
  };

  root.innerHTML = `
    <section class="page-heading">
      <div>
        <h1>Firmware Update</h1>
        <p>Update firmware on ZC95 over the 3.5mm serial connection. ZC95 must already be running firmware v2.1 or higher for this to work.</p>
      </div>
    </section>

    <aside class="support-warning" data-support-warning>
    </aside>

    <section class="layout-grid">
      <form class="panel field-stack" data-controls>
        <h2>Update Firmware</h2>
        <div class="field">
          <label for="release-select">Firmware</label>
          <select id="release-select" data-release-select disabled>
            <option value="">Loading firmware index...</option>
          </select>
        </div>
        <div class="release-meta" data-release-meta>Firmware details will appear here.</div>
        <div class="actions-row">
          <button type="button" class="secondary" data-select-port>Choose Serial Port</button>
          <span class="port-state" data-port-state>No port selected</span>
        </div>
        <div class="actions-row">
          <button type="submit" data-update disabled>Update Firmware</button>
          <button type="button" class="secondary" data-reset-log>Clear Log</button>
        </div>
      </form>

      <section class="panel field-stack" aria-live="polite">
        <h2>Upload Progress</h2>
        <div class="progress-wrap">
          <div class="progress-header">
            <span data-progress-label>Idle</span>
            <span data-progress-percent>0%</span>
          </div>
          <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-progress>
            <div class="progress-bar__fill" data-progress-fill></div>
          </div>
        </div>
        <p class="status-line" data-status>Choose a serial port and firmware option to begin.</p>
        <div class="log" data-log aria-label="Update log"></div>
      </section>
    </section>
  `;

  const elements = {
    supportWarning: root.querySelector("[data-support-warning]"),
    releaseSelect: root.querySelector("[data-release-select]"),
    releaseMeta: root.querySelector("[data-release-meta]"),
    selectPortButton: root.querySelector("[data-select-port]"),
    portState: root.querySelector("[data-port-state]"),
    updateButton: root.querySelector("[data-update]"),
    resetLogButton: root.querySelector("[data-reset-log]"),
    controlsForm: root.querySelector("[data-controls]"),
    progress: root.querySelector("[data-progress]"),
    progressFill: root.querySelector("[data-progress-fill]"),
    progressLabel: root.querySelector("[data-progress-label]"),
    progressPercent: root.querySelector("[data-progress-percent]"),
    status: root.querySelector("[data-status]"),
    log: root.querySelector("[data-log]"),
  };

  const serialSupportMessage = SerialConnection.supportMessage();
  if (serialSupportMessage) {
    elements.supportWarning.textContent = serialSupportMessage;
    elements.supportWarning.classList.add("is-visible");
  }

  bindEvents(state, elements);
  await loadFirmwareOptions(state, elements);
  updateControls(state, elements);
}

function bindEvents(state, elements) {
  elements.releaseSelect.addEventListener("change", () => {
    state.selectedFirmwareId = elements.releaseSelect.value;
    updateFirmwareMeta(state, elements);
    updateControls(state, elements);
  });

  elements.selectPortButton.addEventListener("click", async () => {
    try {
      state.port = await SerialConnection.requestPort();
      elements.portState.textContent = "Serial port selected";
      log(elements, "Serial port selected.");
      setStatus(elements, "Serial port selected.");
    } catch (error) {
      setStatus(elements, friendlyError(error));
      log(elements, friendlyError(error));
    } finally {
      updateControls(state, elements);
    }
  });

  elements.resetLogButton.addEventListener("click", () => {
    elements.log.textContent = "";
  });

  elements.controlsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUpdate(state, elements);
  });
}

async function loadFirmwareOptions(state, elements) {
  try {
    state.firmwares = await fetchAvailableFirmwares();
    elements.releaseSelect.replaceChildren();

    if (state.firmwares.length === 0) {
      elements.releaseSelect.append(new Option("No compatible firmware found", ""));
      setStatus(elements, "No compatible firmware entries were found in the local index.");
      return;
    }

    for (const firmware of state.firmwares) {
      elements.releaseSelect.append(new Option(firmware.label, firmware.id));
    }

    state.selectedFirmwareId = state.firmwares[0].id;
    elements.releaseSelect.value = state.selectedFirmwareId;
    elements.releaseSelect.disabled = false;
    updateFirmwareMeta(state, elements);
    setStatus(elements, "Firmware index loaded.");
    log(elements, `Loaded ${state.firmwares.length} compatible firmware option(s).`);
  } catch (error) {
    elements.releaseSelect.replaceChildren(new Option("Unable to load firmware index", ""));
    setStatus(elements, friendlyError(error));
    log(elements, friendlyError(error));
  }
}

async function runUpdate(state, elements) {
  if (state.busy || !state.port || !getSelectedFirmware(state)) {
    return;
  }

  const selectedFirmware = getSelectedFirmware(state);
  state.busy = true;
  updateControls(state, elements);
  setProgress(elements, 0, "Preparing");

  try {
    log(elements, `Selected firmware ${selectedFirmware.label}.`);
    setStatus(elements, "Downloading and preparing firmware files.");
    const firmware = await downloadAndPrepareFirmware(selectedFirmware, (message) => {
      setStatus(elements, message);
      log(elements, message);
    });
    logPreparedFirmware(elements, firmware);
    setProgress(elements, 8, "Ready");

    const shouldContinue = await showPowerOnDialog();
    if (!shouldContinue) {
      setStatus(elements, "Update cancelled before entering bootloader mode.");
      log(elements, "Update cancelled before entering bootloader mode.");
      setProgress(elements, 0, "Idle");
      return;
    }

    setStatus(elements, "Opening serial port. Switch the device on now.");
    log(elements, "Opening serial port at 115200 8N1.");
    state.connection = new SerialConnection(state.port);
    await state.connection.open();
    state.connection.clearInput();

    const client = new BootloaderClient(state.connection);
    await client.waitForBootloaderSyn((message) => {
      setStatus(elements, message);
      log(elements, message);
    });
    setProgress(elements, 10, "Bootloader");

    await client.uploadImages(firmware, {
      onStatus: (message) => {
        setStatus(elements, message);
        log(elements, message);
      },
      onStageProgress: (stageIndex, stageCount, current, total, bytesTransferred, totalBytes) => {
        setUploadProgress(
          elements,
          stageIndex,
          stageCount,
          current,
          total,
          bytesTransferred,
          totalBytes
        );
      },
    });

    setProgress(elements, 100, "Complete");
    setStatus(elements, "Firmware upload complete. The device has been told to launch the new firmware.");
    log(elements, "Firmware upload completed successfully.");
  } catch (error) {
    setStatus(elements, friendlyError(error));
    log(elements, `ERROR: ${friendlyError(error)}`);
  } finally {
    state.busy = false;
    updateControls(state, elements);
    await closeConnection(state, elements);
  }
}

function updateControls(state, elements) {
  const canUseSerial = SerialConnection.isSupported();
  const hasFirmware = Boolean(getSelectedFirmware(state));
  const canUpdate = canUseSerial && hasFirmware && state.port && !state.busy;

  elements.releaseSelect.disabled = state.busy || state.firmwares.length === 0;
  elements.selectPortButton.disabled = state.busy || !canUseSerial;
  elements.updateButton.disabled = !canUpdate;
  elements.resetLogButton.disabled = state.busy;
}

function updateFirmwareMeta(state, elements) {
  const firmware = getSelectedFirmware(state);
  if (!firmware) {
    elements.releaseMeta.textContent = "Firmware details will appear here.";
    return;
  }

  elements.releaseMeta.replaceChildren();
  const summary = document.createElement("div");
  summary.innerHTML = `
    <strong>${escapeHtml(firmware.label)}</strong><br>
    <span class="firmware-description">${escapeHtml(firmware.description || "No description supplied.")}</span><br>
    Assets: ${escapeHtml(firmware.assets.zc95.name)} (${formatBytes(firmware.assets.zc95.size)})
    and ${escapeHtml(firmware.assets.zc624.name)} (${formatBytes(firmware.assets.zc624.size)})<br>
    <a class="more-info-link" href="${escapeHtml(firmware.moreInfoUrl)}" target="_blank" rel="noopener noreferrer">More info</a>
  `;
  elements.releaseMeta.append(summary);
}

function getSelectedFirmware(state) {
  return state.firmwares.find((firmware) => firmware.id === state.selectedFirmwareId) || null;
}

function setUploadProgress(
  elements,
  stageIndex,
  stageCount,
  current,
  total,
  bytesTransferred = 0,
  totalBytes = 0
) {
  if (stageIndex >= stageCount) {
    setProgress(elements, 100, "Complete");
    return;
  }

  const uploadStart = 10;
  const uploadSize = 88;
  const stageSize = uploadSize / stageCount;
  const stageRatio = total > 0 ? current / total : 0;
  const percent = uploadStart + stageIndex * stageSize + stageRatio * stageSize;
  const label = stageIndex === 0 ? "ZC95 upload" : "ZC624 upload";
  const detail = current > 0
    ? `${label}: block ${current}/${total}, ${formatKiB(bytesTransferred)}/${formatKiB(totalBytes)}`
    : `${label}: upload starting.`;

  setProgress(elements, Math.min(99, percent), label);
  setStatus(elements, detail);
}

function setProgress(elements, value, label) {
  const rounded = Math.max(0, Math.min(100, Math.round(value)));
  elements.progress.setAttribute("aria-valuenow", String(rounded));
  elements.progressFill.style.width = `${rounded}%`;
  elements.progressLabel.textContent = label;
  elements.progressPercent.textContent = `${rounded}%`;
}

function setStatus(elements, message) {
  elements.status.textContent = message;
}

function log(elements, message) {
  const timestamp = new Date().toLocaleTimeString();
  elements.log.textContent += `[${timestamp}] ${message}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function logPreparedFirmware(elements, firmware) {
  log(
    elements,
    `zc95.uf2 prepared: firmware ${firmware.zc95.firmwareInfo.firmwareVersion || "<unknown>"}, ` +
      `${formatBytes(firmware.zc95.uploadData.length)} upload payload.`
  );
  log(
    elements,
    `OutputZc.uf2 prepared: firmware ${firmware.zc624.firmwareInfo.firmwareVersion || "<unknown>"}, ` +
      `${formatBytes(firmware.zc624.uploadData.length)} upload payload.`
  );
}

async function closeConnection(state, elements) {
  if (!state.connection) {
    return;
  }

  try {
    await state.connection.close();
  } catch (error) {
    log(elements, `Serial close warning: ${friendlyError(error)}`);
  } finally {
    state.connection = null;
  }
}

function showPowerOnDialog() {
  const template = document.querySelector("#dialog-template");
  const dialog = template.content.firstElementChild.cloneNode(true);
  dialog.querySelector("#dialog-title").textContent = "Ready to enter bootloader";
  dialog.querySelector(".dialog-body").innerHTML = `
    <ol>
      <li>Start with the ZC95 switched off.</li>
      <li>Click Continue.</li>
      <li>Switch the device on.</li>
      <li>Once the update starts, keep the device powered on until it finishes.</li>
    </ol>
  `;

  return new Promise((resolve) => {
    const actions = dialog.querySelector(".dialog-actions");
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary";
    cancelButton.textContent = "Cancel";

    const continueButton = document.createElement("button");
    continueButton.type = "button";
    continueButton.textContent = "Continue";

    cancelButton.addEventListener("click", () => {
      dialog.remove();
      resolve(false);
    });

    continueButton.addEventListener("click", () => {
      dialog.remove();
      resolve(true);
    });

    actions.append(cancelButton, continueButton);
    document.body.append(dialog);
    continueButton.focus();
  });
}

function friendlyError(error) {
  if (error?.name === "NotFoundError") {
    return "No serial port was selected.";
  }
  if (error?.message) {
    return error.message;
  }
  return String(error);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }

  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatKiB(bytes) {
  return `${Math.ceil(bytes / 1024)} KiB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

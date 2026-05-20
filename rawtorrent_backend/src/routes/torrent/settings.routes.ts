import { Router } from "express";
import { getGlobalSettings, setGlobalSettings } from "../../settings";
import { enforceTurboModeSeedingPolicy } from "../../services/torrentService";

const router = Router();

router.get("/settings", (req, res) => {
  try {
    const settings = getGlobalSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get settings" });
  }
});

router.post("/settings", async (req, res) => {
  try {
    const body = req.body ?? {};
    const previousTurboMode = getGlobalSettings().turboMode;
    const updatedSettings = setGlobalSettings(body);

    let seedingDisabled = 0;
    if (updatedSettings.turboMode) {
      seedingDisabled = await enforceTurboModeSeedingPolicy();
    }

    const turboActivated = !previousTurboMode && updatedSettings.turboMode;
    const turboPolicyMessage = updatedSettings.turboMode
      ? seedingDisabled > 0
        ? ` Turbo Mode policy disabled seeding for ${seedingDisabled} session(s).`
        : turboActivated
          ? " Turbo Mode policy is active."
          : ""
      : "";

    res.json({
      success: true,
      data: updatedSettings,
      message: `Settings updated. New downloads will use these settings immediately.${turboPolicyMessage}`,
      metadata: {
        seedingDisabled,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update settings" });
  }
});

router.get("/choose-directory", async (req, res) => {
  const os = await import("node:os");
  const { exec } = await import("node:child_process");
  const platform = os.platform();

  let cmd = "";
  if (platform === "win32") {
    cmd = `powershell.exe -NoProfile -STA -WindowStyle Hidden -Command "Add-Type -AssemblyName System.windows.forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Select Download Directory'; $f.ShowNewFolderButton=$true; $f.RootFolder='MyComputer'; $form = New-Object System.Windows.Forms.Form; $form.TopMost = $true; $form.ShowInTaskbar = $false; $form.WindowState = 'Minimized'; if($f.ShowDialog($form) -eq 'OK'){ [Console]::Write($f.SelectedPath) }"`;
  } else if (platform === "darwin") {
    cmd = `osascript -e 'tell application "System Events" to set f to choose folder with prompt "Select Download Directory"' -e 'POSIX path of f'`;
  } else {
    cmd = `zenity --file-selection --directory --title="Select Download Directory"`;
  }

  exec(cmd, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: "Could not open directory picker" });
    }
    const result = stdout.trim();
    if (!result) {
      return res.json({ canceled: true });
    }
    res.json({ path: result });
  });
});

export default router;

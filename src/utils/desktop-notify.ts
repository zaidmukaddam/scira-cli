/** Best-effort OS desktop notification. Never throws. */
export async function tryDesktopNotify(title: string, body: string): Promise<void> {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
      await Bun.spawn(["osascript", "-e", script]).exited;
    } else if (platform === "linux" && Bun.which("notify-send")) {
      await Bun.spawn(["notify-send", title, body]).exited;
    } else if (platform === "win32") {
      const ps = [
        `[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]`,
        `$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("ToastBasicText02")`,
        `$xml.GetElementsByTagName("text")[0].InnerText = ${JSON.stringify(title)}`,
        `$xml.GetElementsByTagName("text")[1].InnerText = ${JSON.stringify(body)}`,
        `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)`,
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Scira").Show($toast)`,
      ].join("; ");
      await Bun.spawn(["powershell", "-NoProfile", "-Command", ps]).exited;
    }
  } catch {
    /* best-effort — never propagate notification failures */
  }
}

const notice = document.querySelector("#notice");

try {
  const response = await fetch("/dev/assets/lab.js", { cache: "no-store" });
  if (!response.ok) throw new Error("无法载入实验室逻辑");

  const original = await response.text();
  const disconnectInjection = `
    const recoveryActions = document.createElement("div");
    recoveryActions.className = "player-actions";
    if (player.connected) {
      recoveryActions.append(createButton("模拟掉线", () => {
        player.socket.disconnect();
        const recoveryRoom = document.querySelector("#recovery-test-room");
        if (recoveryRoom) recoveryRoom.value = state.roomId;
        const recoveryStatus = document.querySelector("#recovery-test-status");
        if (recoveryStatus) recoveryStatus.textContent = \`${player.name} 已模拟掉线；请在房主端生成恢复码，然后在这里接管。\`;
      }, "compact"));
    }
    card.append(head, detail, renderGameControls(player), recoveryActions);
    return card;
`;

  const source = original
    .replace("\\d{6}", "\\d{4}")
    .replace("请输入正确的 6 位房间号。", "请输入正确的 4 位房间号。")
    .replace(
      "    card.append(head, detail, renderGameControls(player));\n    return card;\n",
      disconnectInjection,
    );

  if (!source.includes("/^\\d{4}$/u")) {
    throw new Error("实验室 4 位房间号适配失败");
  }
  if (!source.includes("模拟掉线")) {
    throw new Error("实验室掉线测试控件注入失败");
  }

  // lab.js has no imports/exports. Execute the adapted source directly so the
  // original lab event handlers attach without relying on blob-module imports.
  Function(source)();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (notice) {
    notice.textContent = `实验室启动失败：${message}`;
    notice.className = "notice error";
  }
  console.error(error);
}

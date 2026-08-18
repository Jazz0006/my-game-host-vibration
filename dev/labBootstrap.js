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
  .replace("/^\\d{6}$/u", "/^\\d{4}$/u")
  .replace("请输入正确的 6 位房间号。", "请输入正确的 4 位房间号。")
  .replace(
    "    card.append(head, detail, renderGameControls(player));\n    return card;\n",
    disconnectInjection,
  );

const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
try {
  await import(moduleUrl);
} finally {
  URL.revokeObjectURL(moduleUrl);
}

const response = await fetch("/dev/assets/lab.js", { cache: "no-store" });
if (!response.ok) throw new Error("无法载入实验室逻辑");

const source = (await response.text())
  .replace("/^\\d{6}$/u", "/^\\d{4}$/u")
  .replace("请输入正确的 6 位房间号。", "请输入正确的 4 位房间号。");

const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
try {
  await import(moduleUrl);
} finally {
  URL.revokeObjectURL(moduleUrl);
}

(function installWebClientProtocol(global) {
  "use strict";

  const CLIENT_PROTOCOL_VERSION = 1;
  const SOCKET_COMMAND_EVENT = "client:command";

  function requireNonEmptyString(value, fieldName) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${fieldName} is required`);
    }
    return value.trim();
  }

  function createCommandEnvelope(type, payload, commandId) {
    return {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "command",
      commandId: requireNonEmptyString(commandId, "commandId"),
      type: requireNonEmptyString(type, "command type"),
      payload: payload && typeof payload === "object" ? payload : {},
    };
  }

  function createSocketIoAdapter(socket, options = {}) {
    if (!socket?.timeout || !socket?.emit) {
      throw new Error("Socket.IO transport is required");
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5000;
    const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 1;
    const randomUUID = options.randomUUID || (() => global.crypto.randomUUID());

    return {
      sendCommand(type, payload, callback) {
        const envelope = createCommandEnvelope(type, payload, randomUUID());
        let retries = 0;

        function send() {
          socket.timeout(timeoutMs).emit(SOCKET_COMMAND_EVENT, envelope, (error, result) => {
            if (error && retries < maxRetries) {
              retries += 1;
              send();
              return;
            }
            callback?.(error, result);
          });
        }

        send();
        return envelope.commandId;
      },
    };
  }

  global.WebClientProtocol = Object.freeze({
    CLIENT_PROTOCOL_VERSION,
    SOCKET_COMMAND_EVENT,
    createCommandEnvelope,
    createSocketIoAdapter,
  });
})(globalThis);

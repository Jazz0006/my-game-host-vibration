(function installWebClientProtocol(global) {
  "use strict";

  const CLIENT_PROTOCOL_VERSION = 1;
  const SOCKET_COMMAND_EVENT = "client:command";
  const LEGACY_GAME_COMMAND_TYPES = Object.freeze({
    "player:confirm-role": "werewolf.confirmRole",
    "player:submit-wolf-target": "werewolf.submitWolfTarget",
    "player:submit-witch-action": "werewolf.submitWitchAction",
    "player:submit-seer-target": "werewolf.submitSeerTarget",
    "player:confirm-seer-result": "werewolf.confirmSeerResult",
    "player:submit-guard-target": "werewolf.submitGuardTarget",
    "player:submit-hunter-execution": "werewolf.submitHunterExecution",
    "player:submit-vote": "werewolf.submitVote",
    "host:start-night": "werewolf.startNight",
    "host:close-voting": "werewolf.closeVoting",
    "host:begin-night-start": "werewolf.beginNightStart",
  });

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

  function legacyCommandEnvelope(event, data) {
    const protocolType = LEGACY_GAME_COMMAND_TYPES[event];
    if (!protocolType) return null;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("legacy game command payload must be an object");
    }

    const { commandId, ...payload } = data;
    return createCommandEnvelope(protocolType, payload, commandId);
  }

  function wrapTimedEmitter(timedEmitter) {
    return new Proxy(timedEmitter, {
      get(target, property, receiver) {
        if (property === "emit") {
          return function emit(event, data, callback) {
            const envelope = legacyCommandEnvelope(event, data);
            return envelope
              ? target.emit(SOCKET_COMMAND_EVENT, envelope, callback)
              : target.emit(event, data, callback);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  function wrapSocket(socket) {
    if (!socket?.timeout || socket.__webClientProtocolWrapped) return socket;
    const originalTimeout = socket.timeout.bind(socket);
    Object.defineProperty(socket, "__webClientProtocolWrapped", {
      value: true,
      configurable: false,
      enumerable: false,
    });
    socket.timeout = function timeout(ms) {
      return wrapTimedEmitter(originalTimeout(ms));
    };
    return socket;
  }

  function installSocketIoLegacyCommandBridge() {
    if (typeof global.io !== "function") return false;
    if (global.io.__webClientProtocolBridge) return true;

    const originalIo = global.io;
    function bridgedIo(...args) {
      // The production app calls io() without arguments. E2.2 ClientSession now
      // owns the moment that transport connection begins, so only that default
      // call is changed to autoConnect:false. Explicit Socket.IO options from
      // other callers remain untouched.
      const socket = args.length === 0
        ? originalIo({ autoConnect: false })
        : originalIo(...args);
      return wrapSocket(socket);
    }
    Object.assign(bridgedIo, originalIo);
    Object.defineProperty(bridgedIo, "__webClientProtocolBridge", {
      value: true,
      configurable: false,
      enumerable: false,
    });
    global.io = bridgedIo;
    return true;
  }

  global.WebClientProtocol = Object.freeze({
    CLIENT_PROTOCOL_VERSION,
    SOCKET_COMMAND_EVENT,
    LEGACY_GAME_COMMAND_TYPES,
    createCommandEnvelope,
    createSocketIoAdapter,
    installSocketIoLegacyCommandBridge,
  });

  // index.html loads this file after Socket.IO and before app.js. Installing the
  // bridge here lets E2 migrate transport semantics without editing the large
  // UI file; non-migrated room/session/recovery events pass through unchanged.
  installSocketIoLegacyCommandBridge();
})(globalThis);
